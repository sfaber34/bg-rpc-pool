const { createWalletClient, http, isAddress } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { baseSepolia } = require("viem/chains");
const path = require("path");
const dotenv = require("dotenv");
const { getBreadTable } = require('../database_scripts/getBreadTable');
const { subtractBreadTable } = require('../database_scripts/subtractBreadTable');
const { baseSepoliaPublicClient } = require('./baseSepoliaPublicClient');
const { mainnetPublicClient } = require('./mainnetPublicClient');
const { breadContractAbi } = require('./breadContractAbi');
const { validateAndResolveAddresses, checkAddressesExist } = require('./addressUtils');

// const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function checkBreadBalances(addresses, amounts) {
  const validAddresses = [];
  const failedAddresses = [];
  const adjustedAmounts = [];
  const adjustedAddresses = [];
  const breadContractAddress = process.env.BREAD_CONTRACT_ADDRESS;
  
  for (let i = 0; i < addresses.length; i++) {
    const addr = addresses[i];
    const amount = amounts[i];
    try {
      // Check the bread balance of the address
      const balance = await baseSepoliaPublicClient.readContract({
        address: breadContractAddress,
        abi: breadContractAbi,
        functionName: 'balanceOf',
        args: [addr],
      });
      
      const scaledAmount = BigInt(amount) * 10n ** 18n;
      const balanceInTokens = Number(balance) / 1e18;
      
      if (balance === 0n) {
        console.error(`Address ${addr} has no bread balance to burn`);
        failedAddresses.push({ 
          index: i, 
          address: addr, 
          reason: `No bread balance to burn` 
        });
        continue;
      }
      
      if (balance < scaledAmount) {
        console.warn(`Address ${addr} has insufficient bread balance. Requested: ${amount}, Available: ${balanceInTokens}. Burning all available bread.`);
        adjustedAmounts.push(balanceInTokens);
        adjustedAddresses.push(addr);
      } else {
        adjustedAmounts.push(amount);
      }
      
      validAddresses.push(i);
    } catch (error) {
      console.error(`Could not check bread balance for address ${addr}:`, error.message);
      failedAddresses.push({ index: i, address: addr, reason: error.message });
    }
  }
  
  return { validAddresses, failedAddresses, adjustedAmounts, adjustedAddresses };
}

async function burnBread() {
  try {
    const key = process.env.RPC_BREAD_MINTER_KEY;
    const breadContractAddress = process.env.BREAD_CONTRACT_ADDRESS;
    if (!key) {
      console.error("No private key found in environment variables");
      return;
    }

    // Get pending bread amounts from database (assuming you have a similar function for burning)
    const { addresses, amounts } = await getBreadTable();
    
    if (addresses.length === 0) {
      console.log("No pending bread to burn");
      return;
    }

    console.log('Running pre-flight checks for bread burning...');
    
    // 1. Validate and resolve addresses (ENS support)
    const addressValidation = await validateAndResolveAddresses(addresses);
    
    if (addressValidation.failedAddresses.length > 0) {
      console.log(`${addressValidation.failedAddresses.length} addresses failed validation:`, 
        addressValidation.failedAddresses.map(f => `${f.address}: ${f.reason}`));
    }
    
    if (addressValidation.resolvedAddresses.length === 0) {
      console.log("No valid addresses to burn from");
      return;
    }
    
    // 2. Check address existence for resolved addresses
    const existenceCheck = await checkAddressesExist(addressValidation.resolvedAddresses);
    
    // Filter to only include addresses that passed validation and existence checks
    const validAfterExistence = addressValidation.validAddresses.filter(i => 
      existenceCheck.validAddresses.includes(addressValidation.validAddresses.indexOf(i))
    );
    
    const addressesAfterExistence = validAfterExistence.map(i => addressValidation.resolvedAddresses[addressValidation.validAddresses.indexOf(i)]);
    const amountsAfterExistence = validAfterExistence.map(i => amounts[i]);
    
    // 3. Check bread balances and adjust amounts if necessary
    const balanceCheck = await checkBreadBalances(addressesAfterExistence, amountsAfterExistence);
    
    // Filter to only include addresses that passed all checks
    const finalValidIndices = validAfterExistence.filter((originalIndex, localIndex) => 
      balanceCheck.validAddresses.includes(localIndex)
    );
    
    const finalAddresses = finalValidIndices.map(i => addressValidation.resolvedAddresses[addressValidation.validAddresses.indexOf(i)]);
    const finalAmounts = balanceCheck.adjustedAmounts; // Use adjusted amounts instead of original amounts
    const originalAddresses = finalValidIndices.map(i => addresses[i]); // Keep track of original addresses for database reset
    
    if (finalAddresses.length === 0) {
      console.log("No addresses passed all validation checks");
      return;
    }
    
    console.log(`Pre-flight checks passed for ${finalAddresses.length}/${addresses.length} addresses.`);
    
    if (balanceCheck.adjustedAddresses.length > 0) {
      console.log(`Adjusted burn amounts for ${balanceCheck.adjustedAddresses.length} addresses due to insufficient balance.`);
    }

    // Scale each amount to 18 decimals
    const scaledAmounts = finalAmounts.map(amount => BigInt(Math.floor(amount * 1e18)));

    const account = privateKeyToAccount(key);
    const baseWalletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(),
    });

    const hash = await baseWalletClient.writeContract({
      address: breadContractAddress,
      abi: breadContractAbi,
      functionName: "batchBurn",
      args: [finalAddresses, scaledAmounts],
    });

    console.log("🔥 Burned Bread");
    console.log("Transaction hash:", hash);
    console.log(`Burned from ${finalAddresses.length} addresses:`, finalAddresses.map((addr, i) => `${addr}: ${finalAmounts[i]}`));

    // Subtract the burned amounts from the bread table
    const subtractionsToMake = originalAddresses.map((addr, i) => ({ address: addr, amount: finalAmounts[i] }));
    await subtractBreadTable(subtractionsToMake);
    
    if (finalAddresses.length < addresses.length) {
      console.log(`${addresses.length - finalAddresses.length} addresses were skipped and their pending bread burn remains in the database`);
    }
  } catch (error) {
    console.error("Error in burnBread:", error);
  }
}

module.exports = { burnBread };