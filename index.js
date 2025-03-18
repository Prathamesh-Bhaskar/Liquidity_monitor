const { Agent } = require('@openserv-labs/sdk')
const axios = require('axios')
const fs = require('fs/promises')  // Use fs/promises instead of fs
const path = require('path')

// -------------------------
// Configuration Constants
// -------------------------
const THRESHOLDS = {
  liquidity_min: 100000,
  volatility_threshold: 20,
  abnormal_tx_ratio: 10,
  impermanent_loss_risk: 30,
  quick_dump_risk: 15,
  new_token_risk_days: 7,
  healthy_buy_sell_ratio: 1.2,
  pump_warning_threshold: 50
}

const ALERT_CONFIG = {
  price_change_threshold: 10,
  volume_change_threshold: 50,
  liquidity_change_threshold: 20,
  sentiment_change_threshold: 0.3
}

// -------------------------
// Local Data Stores
// -------------------------
const dataCache = {}
const priceHistory = {}

// -------------------------
// Utility Functions
// -------------------------
async function saveWeeklyData(tokenKey, data) {
  try {
    const dataDir = path.join(__dirname, 'data')
    
    // Check if directory exists and create if not
    try {
      await fs.access(dataDir)
    } catch (error) {
      await fs.mkdir(dataDir, { recursive: true })
    }
    
    const filename = path.join(dataDir, `${tokenKey.replace('/', '_')}.json`)
    await fs.writeFile(filename, JSON.stringify(data, null, 2))
    console.log(`Saved weekly data for ${tokenKey}`)
  } catch (error) {
    console.error('Error saving weekly data:', error)
  }
}

async function loadWeeklyData(tokenKey) {
  try {
    const filename = path.join(__dirname, 'data', `${tokenKey.replace('/', '_')}.json`)
    const data = await fs.readFile(filename, 'utf8')
    return JSON.parse(data)
  } catch (error) {
    return null
  }
}

function detectAlerts(current, previous) {
  const alerts = []
  const currentPrice = parseFloat(current.price_usd)
  const previousPrice = parseFloat(previous.price_usd)
  if (previousPrice > 0) {
    const priceChange = Math.abs((currentPrice - previousPrice) / previousPrice * 100)
    if (priceChange > ALERT_CONFIG.price_change_threshold) {
      const direction = currentPrice > previousPrice ? 'increased' : 'decreased'
      alerts.push(`PRICE ALERT: ${current.base_token.symbol} ${direction} by ${priceChange.toFixed(2)}%`)
    }
  }
  const currentVol = current.volume.h1
  const previousVol = previous.volume.h1
  if (previousVol > 0) {
    const volChange = Math.abs((currentVol - previousVol) / previousVol * 100)
    if (volChange > ALERT_CONFIG.volume_change_threshold) {
      const direction = currentVol > previousVol ? 'increased' : 'decreased'
      alerts.push(`VOLUME ALERT: Volume ${direction} by ${volChange.toFixed(2)}%`)
    }
  }
  const currentLiq = current.liquidity.usd
  const previousLiq = previous.liquidity.usd
  if (previousLiq > 0) {
    const liqChange = Math.abs((currentLiq - previousLiq) / previousLiq * 100)
    if (liqChange > ALERT_CONFIG.liquidity_change_threshold) {
      const direction = currentLiq > previousLiq ? 'increased' : 'decreased'
      alerts.push(`LIQUIDITY ALERT: Liquidity ${direction} by ${liqChange.toFixed(2)}%`)
    }
  }
  return alerts
}

async function getTokenData(chainId, tokenAddress) {
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`
    const response = await axios.get(url, { timeout: 10000 })
    const data = response.data
    if (data && data.pairs) {
      const pair = data.pairs.find((p) => p.chainId === chainId)
      if (pair) {
        return transformDexResponse(pair)
      }
    }
    return null
  } catch (error) {
    console.error("Error fetching token data:", error)
    return null
  }
}

function transformDexResponse(pair) {
  return {
    chain_id: pair.chainId || "",
    dex_id: pair.dexId || "",
    url: pair.url || "",
    pair_address: pair.pairAddress || "",
    labels: pair.labels || [],
    base_token: {
      address: pair.baseToken?.address || "",
      name: pair.baseToken?.name || "",
      symbol: pair.baseToken?.symbol || ""
    },
    quote_token: {
      address: pair.quoteToken?.address || "",
      name: pair.quoteToken?.name || "",
      symbol: pair.quoteToken?.symbol || ""
    },
    price_native: pair.priceNative || "0",
    price_usd: pair.priceUsd || "0",
    txns: {
      m5: pair.txns?.m5 || { buys: 0, sells: 0 },
      h1: pair.txns?.h1 || { buys: 0, sells: 0 },
      h6: pair.txns?.h6 || { buys: 0, sells: 0 },
      h24: pair.txns?.h24 || { buys: 0, sells: 0 }
    },
    volume: {
      h24: parseFloat(pair.volume?.h24) || 0,
      h6: parseFloat(pair.volume?.h6) || 0,
      h1: parseFloat(pair.volume?.h1) || 0,
      m5: parseFloat(pair.volume?.m5) || 0
    },
    price_change: {
      m5: parseFloat(pair.priceChange?.m5) || 0,
      h1: parseFloat(pair.priceChange?.h1) || 0,
      h6: parseFloat(pair.priceChange?.h6) || 0,
      h24: parseFloat(pair.priceChange?.h24) || 0
    },
    liquidity: {
      usd: parseFloat(pair.liquidity?.usd) || 0,
      base: parseFloat(pair.liquidity?.base) || 0,
      quote: parseFloat(pair.liquidity?.quote) || 0
    },
    fdv: parseFloat(pair.fdv) || 0,
    market_cap: parseFloat(pair.marketCap) || 0,
    pair_created_at: pair.pairCreatedAt || 0,
    info: pair.info,
    boosts: pair.boosts
  }
}

function analyzeTokenRisk(tokenData, previousData) {
  const vulnerabilities = []
  const recommendations = []
  let risk_score = 0

  // Liquidity check
  if (tokenData.liquidity.usd < THRESHOLDS.liquidity_min) {
    vulnerabilities.push("Low liquidity")
    risk_score += 30
    recommendations.push("Increase liquidity or wait for higher liquidity levels")
  }

  // Price volatility
  const volatility = Math.abs(tokenData.price_change.h6)
  if (volatility > THRESHOLDS.volatility_threshold) {
    vulnerabilities.push(`High volatility: ${volatility.toFixed(2)}% over 6h`)
    risk_score += 20
    recommendations.push("Exercise caution due to high fluctuations")
    if (volatility > THRESHOLDS.impermanent_loss_risk) {
      vulnerabilities.push("High impermanent loss risk")
      risk_score += 10
      recommendations.push("Consider impermanent loss risks")
    }
  }

  // Transaction patterns
  const tx_h6 = (tokenData.txns.h6.buys || 0) + (tokenData.txns.h6.sells || 0)
  const tx_h1 = (tokenData.txns.h1.buys || 0) + (tokenData.txns.h1.sells || 0)
  if (tx_h1 > 0 && tx_h6 / tx_h1 > THRESHOLDS.abnormal_tx_ratio) {
    vulnerabilities.push("Unusual transaction pattern")
    risk_score += 20
    recommendations.push("Monitor for market manipulation")
  }

  // Market cap vs liquidity
  if (tokenData.market_cap > 0 && tokenData.market_cap < tokenData.liquidity.usd) {
    vulnerabilities.push("Market cap < liquidity")
    risk_score += 20
    recommendations.push("Review valuation")
  }

  // Token age
  const currentTime = Date.now() / 1000
  const token_age = (currentTime - tokenData.pair_created_at) / 86400
  if (token_age < THRESHOLDS.new_token_risk_days) {
    vulnerabilities.push(`New token (${token_age.toFixed(1)} days old)`)
    risk_score += 15
    recommendations.push("Consider smaller position size")
  }

  // Sell pressure
  const h24_buys = tokenData.txns.h24.buys || 0
  const h24_sells = tokenData.txns.h24.sells || 0
  const total_tx = h24_buys + h24_sells
  if (total_tx > 10) {
    const sell_pct = (h24_sells / total_tx) * 100
    if (sell_pct > THRESHOLDS.quick_dump_risk) {
      vulnerabilities.push(`High selling pressure: ${sell_pct.toFixed(1)}%`)
      risk_score += 25
      recommendations.push("Watch for potential sell-off")
    }
  }

  // Pump detection
  if (tokenData.price_change.h24 > THRESHOLDS.pump_warning_threshold) {
    vulnerabilities.push(`Possible pump: ${tokenData.price_change.h24.toFixed(2)}%`)
    risk_score += 5
    recommendations.push("Extreme caution advised")
  }

  // Sudden price changes
  if (previousData) {
    const previousPrice = parseFloat(previousData.price_usd)
    const currentPrice = parseFloat(tokenData.price_usd)
    if (previousPrice > 0) {
      const price_diff = Math.abs(currentPrice - previousPrice) / previousPrice * 100
      if (price_diff > ALERT_CONFIG.price_change_threshold) {
        vulnerabilities.push(`Sudden price change: ${price_diff.toFixed(2)}%`)
        risk_score += 10
        recommendations.push("Investigate price movement")
      }
    }
  }

  return {
    risk_score: Math.min(risk_score, 70),
    vulnerabilities,
    recommendations
  }
}

function analyzeMarketSentiment(tokenData, previousSentiment) {
  const h24_buys = tokenData.txns.h24.buys || 0
  const h24_sells = tokenData.txns.h24.sells || 0
  const total_tx = h24_buys + h24_sells

  let tx_sentiment = 0
  if (total_tx > 0) {
    tx_sentiment = (h24_buys - h24_sells) / total_tx
  }

  const price_1h = tokenData.price_change.h1 / 100
  const price_24h = tokenData.price_change.h24 / 100
  let price_sentiment = (price_1h * 0.6) + (price_24h * 0.4)
  price_sentiment = Math.max(-1.0, Math.min(1.0, price_sentiment))

  const social_sentiment = (price_1h * 0.3) + (price_24h * 0.7)
  const overall_sentiment = (tx_sentiment * 0.4) + (price_sentiment * 0.4) + (social_sentiment * 0.2)

  const trends = []
  if (overall_sentiment > 0.7) {
    trends.push("Strong bullish sentiment")
  } else if (overall_sentiment > 0.3) {
    trends.push("Moderate bullish")
  } else if (overall_sentiment < -0.7) {
    trends.push("Strong bearish")
  } else if (overall_sentiment < -0.3) {
    trends.push("Moderate bearish")
  } else {
    trends.push("Neutral")
  }

  if (price_1h > 0 && price_24h < 0) {
    trends.push("Positive momentum vs negative trend")
  } else if (price_1h < 0 && price_24h > 0) {
    trends.push("Negative momentum vs positive trend")
  }

  if (h24_buys > h24_sells * 2) {
    trends.push("Strong buying pressure")
  } else if (h24_sells > h24_buys * 2) {
    trends.push("Strong selling pressure")
  }

  if (previousSentiment && Math.abs(overall_sentiment - previousSentiment.score) > 0.3) {
    const direction = overall_sentiment > previousSentiment.score ? "positive" : "negative"
    trends.push(`Significant ${direction} shift`)
  }

  return {
    score: overall_sentiment,
    breakdown: {
      social: social_sentiment,
      transactions: tx_sentiment,
      price_action: price_sentiment
    },
    trends
  }
}

async function generateAIInsights(tokenData, weeklyData, sentiment) {
  if (!process.env.CLAUDE_API_KEY) {
    return ["AI insights unavailable - API key missing"]
  }
  // Simulate AI insights; in production, integrate with the Anthropic API.
  try {
    const insights = [
      "Monitor liquidity closely.",
      "Consider impermanent loss risk.",
      "Unusual transaction pattern detected."
    ]
    return insights.slice(0, 5)
  } catch (error) {
    console.error("AI insight error:", error)
    return ["Failed to generate insights"]
  }
}

async function generateAnalyticsReport(tokenData, riskAnalysis, weeklyData, sentiment) {
  const ai_insights = await generateAIInsights(tokenData, weeklyData, sentiment)
  return {
    token_name: tokenData.base_token.name,
    token_symbol: tokenData.base_token.symbol,
    timestamp: Date.now() / 1000,
    metrics: {
      price: {
        current: parseFloat(tokenData.price_usd),
        change: {
          h1: tokenData.price_change.h1,
          h6: tokenData.price_change.h6,
          h24: tokenData.price_change.h24
        }
      },
      volume: {
        h1: tokenData.volume.h1,
        h6: tokenData.volume.h6,
        h24: tokenData.volume.h24
      },
      liquidity: tokenData.liquidity.usd,
      market_cap: tokenData.market_cap,
      fdv: tokenData.fdv,
      transactions: {
        h1: {
          buys: tokenData.txns.h1.buys,
          sells: tokenData.txns.h1.sells,
          ratio: tokenData.txns.h1.sells ? tokenData.txns.h1.buys / tokenData.txns.h1.sells : tokenData.txns.h1.buys
        }
      }
    },
    risk: riskAnalysis,
    ai_insights
  }
}

// -------------------------
// OpenServ Agent Capability
// -------------------------
const agent = new Agent({
  systemPrompt: 'You are a specialized liquidity monitoring agent.',
  apiKey: "19e9744583aa48a7b02aaba24dda618f"
})

agent.addCapability({
  name: 'monitorLiquidity',
  description: 'Fetch and analyze liquidity, risk, and market sentiment for a given token.',
  schema: {
    type: 'object',
    properties: {
      chainId: {
        type: 'string',
        description: 'Blockchain network identifier (e.g., "solana")'
      },
      tokenAddress: {
        type: 'string',
        description: 'Token contract address'
      }
    },
    required: ['chainId', 'tokenAddress']
  },
  async run({ args }) {
    const { chainId, tokenAddress } = args
    const tokenKey = `${chainId}-${tokenAddress}`
    const tokenData = await getTokenData(chainId, tokenAddress)
    if (!tokenData) {
      return `Error: Token data not found for ${tokenAddress} on ${chainId}`
    }

    // Process alerts if previous data exists.
    const previousData = dataCache[tokenKey]
    if (previousData) {
      const alerts = detectAlerts(tokenData, previousData)
      if (alerts.length > 0) {
        console.log("\n=== ALERTS ===")
        alerts.forEach(alert => console.log(alert))
        console.log("==============\n")
      }
    }

    // Update caches.
    dataCache[tokenKey] = tokenData
    const pricePoint = {
      timestamp: Date.now() / 1000,
      price: parseFloat(tokenData.price_usd),
      volume: tokenData.volume.h1
    }
    if (!priceHistory[tokenKey]) {
      priceHistory[tokenKey] = []
    }
    priceHistory[tokenKey].push(pricePoint)
    if (priceHistory[tokenKey].length > 1000) {
      priceHistory[tokenKey] = priceHistory[tokenKey].slice(-1000)
    }

    // Load any stored weekly data.
    const weeklyData = await loadWeeklyData(tokenKey)
    const sentiment = analyzeMarketSentiment(tokenData)
    const riskAnalysis = analyzeTokenRisk(tokenData, previousData)
    const report = await generateAnalyticsReport(tokenData, riskAnalysis, weeklyData, sentiment)

    // Save weekly data.
    await saveWeeklyData(tokenKey, report)

    return JSON.stringify(report)
  }
})

// -------------------------
// Start the Agent Server
// -------------------------
agent.start().then(() => {
  console.log('OpenServ liquidity monitoring agent started.')
}).catch(err => {
  console.error('Error starting the agent:', err)
})