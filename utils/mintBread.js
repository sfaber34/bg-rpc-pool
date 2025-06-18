const { createWalletClient, http, isAddress } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { baseSepolia } = require("viem/chains");
const path = require("path");
const dotenv = require("dotenv");
const { getBreadTable } = require('../database_scripts/getBreadTable');
const { resetBreadTable } = require('../database_scripts/resetBreadTable');
const { baseSepoliaPublicClient } = require('./baseSepoliaPublicClient');
const { mainnetPublicClient } = require('./mainnetPublicClient');
const { breadContractAbi } = require('./breadContractAbi');
const { validateAndResolveAddresses, checkAddressesExist } = require('./addressUtils');

// const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function mintBread() {
  try {
    const key = process.env.RPC_BREAD_MINTER_KEY;
    const breadContractAddress = process.env.BREAD_CONTRACT_ADDRESS;
    if (!key) {
      console.error("No private key found in environment variables");
      return;
    }

    // Get pending bread amounts from database
    const { addresses, amounts } = await getBreadTable();
    
    if (addresses.length === 0) {
      console.log("No pending bread to mint");
      return;
    }

    console.log('Running pre-flight checks...');
    
    // 1. Validate and resolve addresses (ENS support)
    const addressValidation = await validateAndResolveAddresses(addresses);
    
    if (addressValidation.failedAddresses.length > 0) {
      console.log(`${addressValidation.failedAddresses.length} addresses failed validation:`, 
        addressValidation.failedAddresses.map(f => `${f.address}: ${f.reason}`));
    }
    
    if (addressValidation.resolvedAddresses.length === 0) {
      console.log("No valid addresses to mint to");
      return;
    }
    
    // 2. Check address existence for resolved addresses
    const existenceCheck = await checkAddressesExist(addressValidation.resolvedAddresses);
    
    // Filter to only include addresses that passed both checks
    const finalValidIndices = addressValidation.validAddresses.filter(i => 
      existenceCheck.validAddresses.includes(addressValidation.validAddresses.indexOf(i))
    );
    
    const finalAddresses = finalValidIndices.map(i => addressValidation.resolvedAddresses[addressValidation.validAddresses.indexOf(i)]);
    const finalAmounts = finalValidIndices.map(i => amounts[i]);
    const originalAddresses = finalValidIndices.map(i => addresses[i]); // Keep track of original addresses for database reset
    
    if (finalAddresses.length === 0) {
      console.log("No addresses passed all validation checks");
      return;
    }
    
    console.log(`Pre-flight checks passed for ${finalAddresses.length}/${addresses.length} addresses.`);

    // Scale each amount to 18 decimals
    const scaledAmounts = finalAmounts.map(amount => BigInt(amount) * 10n ** 18n);

    const account = privateKeyToAccount(key);
    const baseWalletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(),
    });

    const hash = await baseWalletClient.writeContract({
      address: breadContractAddress,
      abi: breadContractAbi,
      functionName: "batchMint",
      args: [finalAddresses, scaledAmounts],
    });

    console.log("🍞 Minted Bread");
    console.log("Transaction hash:", hash);
    console.log(`Minted to ${finalAddresses.length} addresses:`, finalAddresses.map((addr, i) => `${addr}: ${finalAmounts[i]}`));

    // Reset the bread table only for addresses that were successfully minted to
    await resetBreadTable(originalAddresses);
    
    if (finalAddresses.length < addresses.length) {
      console.log(`${addresses.length - finalAddresses.length} addresses were skipped and their pending bread remains in the database`);
    }
  } catch (error) {
    console.error("Error in mintBread:", error);
  }
}

module.exports = { mintBread };