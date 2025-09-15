const { createPublicClient, http } = require("viem");
const { base } = require("viem/chains");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const alchemyBaseApiKey = process.env.ALCHEMY_BASE_API_KEY;
if (!alchemyBaseApiKey) {
  throw new Error("No Alchemy Base API key found in environment variables");
}

const basePublicClient = createPublicClient({
  chain: base,
  transport: http(`https://base-mainnet.g.alchemy.com/v2/${alchemyBaseApiKey}`),
});

module.exports = { basePublicClient }; 