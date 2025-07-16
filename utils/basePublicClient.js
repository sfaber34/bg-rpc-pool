const { createPublicClient, http } = require("viem");
const { base } = require("viem/chains");

const basePublicClient = createPublicClient({
  chain: base,
  transport: http("https://base-rpc.publicnode.com"),
});

module.exports = { basePublicClient }; 