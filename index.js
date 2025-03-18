const {Agent} = require("@openserv-labs/sdk");
const {z} = require("zod")

// Initialize the agent
const agent = new Agent({
  systemPrompt: 'You are a helpful assistant.',
  apiKey: '188b898005eb4b31a7cccf8fd47e87c4'
})

// Add a liquidity monitoring capability
agent.addCapability({
  name: 'getMonitoring',
  description: 'Fetch token details from the liquidity monitoring service',
  schema: z.object({
    token_address: z.string().describe('The token address to query')
  }),
  async run({ args }) {
    try {
      const response = await fetch(
        `https://liquidity-monitoring-1.onrender.com/get_token?token_address=${args.token_address}&chain_id=solana`,
        {
          mode: "cors",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      const data = await response.json();
      return data;
    } catch (error) {
      return { error: error.message };
    }
  }
})

// Start the agent server
agent.start();
