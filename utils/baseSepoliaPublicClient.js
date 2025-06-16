const { createPublicClient, http } = require("viem");
const { baseSepolia } = require("viem/chains");

const baseSepoliaPublicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
});

module.exports = { baseSepoliaPublicClient }; 