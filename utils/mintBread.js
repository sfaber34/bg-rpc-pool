const { createWalletClient, http, isAddress } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { base } = require("viem/chains");
const path = require("path");
const dotenv = require("dotenv");
const { getBreadTable } = require('../database_scripts/getBreadTable');
const { subtractBreadTable } = require('../database_scripts/subtractBreadTable');
const { breadContractAbi } = require('./breadContractAbi');
const { validateAndResolveAddresses, checkAddressesExist } = require('./addressUtils');
const { basePublicClient } = require('./basePublicClient');

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

    // 3. Check remaining mint amounts from contract
    console.log('Checking remaining mint amounts...');
    
    const adjustedAmounts = [];
    const addressesToMint = [];
    const adjustedData = []; // For database updates
    
    for (let i = 0; i < finalAddresses.length; i++) {
      const address = finalAddresses[i];
      const requestedAmount = finalAmounts[i];
      
      try {
        const remainingMintAmount = await basePublicClient.readContract({
          address: breadContractAddress,
          abi: breadContractAbi,
          functionName: 'getRemainingMintAmount',
          args: [address],
        });
        
        // Convert from wei to regular units for comparison (contract returns in wei)
        const remainingAmount = Number(remainingMintAmount) / (10 ** 18);
        const amountToMint = Math.min(requestedAmount, remainingAmount);
        
        if (amountToMint > 0) {
          addressesToMint.push(address);
          adjustedAmounts.push(amountToMint);
          adjustedData.push({ address: originalAddresses[i], amount: amountToMint });
          
          if (amountToMint < requestedAmount) {
            console.log(`Address ${address}: requested ${requestedAmount}, but only ${remainingAmount} available. Minting ${amountToMint}`);
          }
        } else {
          console.log(`Address ${address}: no mint capacity available (${remainingAmount} remaining)`);
          // Don't add to mint list, but track for database update
          adjustedData.push({ address: originalAddresses[i], amount: 0 });
        }
        
      } catch (error) {
        console.log(`Failed to check remaining mint amount for ${address}:`, error.message);
        // Skip this address
      }
    }
    
    if (addressesToMint.length === 0) {
      console.log("No addresses have remaining mint capacity");
      return;
    }
    
    console.log(`Mint capacity check passed for ${addressesToMint.length}/${finalAddresses.length} addresses.`);
    
    // Update database to subtract the amounts we're about to mint
    const subtractionsToMake = adjustedData.filter(item => item.amount > 0);
    if (subtractionsToMake.length > 0) {
      await subtractBreadTable(subtractionsToMake);
    }
    
    console.log(`Pre-flight checks passed for ${addressesToMint.length}/${addresses.length} addresses.`);

    // Scale each amount to 18 decimals
    const scaledAmounts = adjustedAmounts.map(amount => BigInt(Math.floor(amount * (10 ** 18))));

    const account = privateKeyToAccount(key);
    const baseWalletClient = createWalletClient({
      account,
      chain: base,
      transport: http("https://base-rpc.publicnode.com"),
    });

    const hash = await baseWalletClient.writeContract({
      address: breadContractAddress,
      abi: breadContractAbi,
      functionName: "batchMint",
      args: [addressesToMint, scaledAmounts],
    });

    console.log("🍞 Minted Bread");
    console.log("Transaction hash:", hash);
    console.log(`Minted to ${addressesToMint.length} addresses:`, addressesToMint.map((addr, i) => `${addr}: ${adjustedAmounts[i]}`));

    // No need to reset bread table since we already subtracted the minted amounts
    
    if (addressesToMint.length < addresses.length) {
      console.log(`${addresses.length - addressesToMint.length} addresses were skipped and their pending bread remains in the database`);
    }
  } catch (error) {
    console.error("Error in mintBread:", error);
  }
}

module.exports = { mintBread };