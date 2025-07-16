const { createPublicClient, http } = require("viem");
const { mainnet } = require("viem/chains");

const mainnetPublicClient = createPublicClient({
  chain: mainnet,
  transport: http(),
});

module.exports = { mainnetPublicClient }; 