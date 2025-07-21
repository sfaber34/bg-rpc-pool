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
const { sendTelegramAlert } = require('./telegramUtils');

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

    // Check if we're still in cooldown period
    console.log('Checking batch mint cooldown...');
    const remainingCooldown = await basePublicClient.readContract({
      address: breadContractAddress,
      abi: breadContractAbi,
      functionName: 'getRemainingBatchMintCooldown',
    });

    if (remainingCooldown > 0) {
      const cooldownHours = Math.ceil(Number(remainingCooldown) / 3600);
      console.log(`Batch minting is still in cooldown. ${cooldownHours} hours remaining.`);
      return;
    }

    console.log('✅ Cooldown period has passed, proceeding with mint');
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

    // 3. Check global remaining batch mint amount
    console.log('Checking global remaining batch mint amount...');
    
    const remainingBatchAmount = await basePublicClient.readContract({
      address: breadContractAddress,
      abi: breadContractAbi,
      functionName: 'getRemainingBatchMintAmount',
    });

    const remainingAmountTokens = Number(remainingBatchAmount) / (10 ** 18);
    const totalRequestedAmount = finalAmounts.reduce((sum, amount) => sum + amount, 0);

    console.log(`Total requested: ${totalRequestedAmount}, Available: ${remainingAmountTokens}`);

    let finalMintAmounts;
    let adjustedData; // For database updates
    let reductionApplied = false;

    if (totalRequestedAmount <= remainingAmountTokens) {
      // Can mint full amounts
      finalMintAmounts = finalAmounts;
      adjustedData = originalAddresses.map((addr, i) => ({ address: addr, amount: finalAmounts[i] }));
      console.log('✅ Sufficient batch capacity for all requested amounts');
    } else if (remainingAmountTokens > 0) {
      // Apply proportional reduction
      const reductionFactor = remainingAmountTokens / totalRequestedAmount;
      finalMintAmounts = finalAmounts.map(amount => amount * reductionFactor);
      adjustedData = originalAddresses.map((addr, i) => ({ address: addr, amount: finalMintAmounts[i] }));
      reductionApplied = true;
      
      console.log(`⚠️ Applying proportional reduction (${(reductionFactor * 100).toFixed(2)}%) due to limited batch capacity`);
      console.log(`Reduced total: ${finalMintAmounts.reduce((sum, amount) => sum + amount, 0).toFixed(6)} tokens`);
      
      // Send telegram alert about insufficient capacity
      await sendTelegramAlert(`
🚨 INSUFFICIENT BATCH MINT CAPACITY
Total requested: ${totalRequestedAmount} tokens
Available capacity: ${remainingAmountTokens} tokens
Applied ${(reductionFactor * 100).toFixed(2)}% proportional reduction to ${finalAddresses.length} addresses.
      `.trim());
    } else {
      console.log("❌ No batch mint capacity remaining");
      return;
    }

    const addressesToMint = finalAddresses;
    const adjustedAmounts = finalMintAmounts;
    
    console.log(`✅ Batch capacity check completed. Proceeding to mint to ${addressesToMint.length} addresses.`);
    
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

    console.log("🍞 Batch mint transaction submitted");
    console.log("Transaction hash:", hash);
    
    // Wait for transaction confirmation
    console.log("Waiting for transaction confirmation...");
    const receipt = await basePublicClient.waitForTransactionReceipt({ 
      hash: hash 
    });

    if (receipt.status === 'success') {
      console.log("✅ Batch mint transaction confirmed");
      
      // Now that minting is confirmed, subtract the amounts from the database
      console.log("Updating database to reflect minted amounts...");
      await subtractBreadTable(adjustedData);
      console.log("✅ Database updated successfully");
    } else {
      console.error("❌ Batch mint transaction failed");
      throw new Error("Batch mint transaction failed");
    }

    // Complete the batch minting period to reset cooldown
    console.log("Completing batch minting period...");
    const completionHash = await baseWalletClient.writeContract({
      address: breadContractAddress,
      abi: breadContractAbi,
      functionName: "completeBatchMintingPeriod",
    });

    console.log("Waiting for period completion confirmation...");
    const completionReceipt = await basePublicClient.waitForTransactionReceipt({ 
      hash: completionHash 
    });

    if (completionReceipt.status === 'success') {
      console.log("✅ Batch minting period completed. Cooldown reset for next period.");
    } else {
      console.error("❌ Period completion failed");
      // Don't throw here - the minting was successful even if period completion failed
    }

    console.log("🍞 Bread minting process completed successfully!");
    console.log(`Minted to ${addressesToMint.length} addresses:`, addressesToMint.map((addr, i) => `${addr}: ${adjustedAmounts[i].toFixed(6)}`));

    // No need to reset bread table since we already subtracted the minted amounts
    
    if (reductionApplied) {
      console.log(`⚠️ Proportional reduction was applied due to limited batch capacity. All ${addressesToMint.length} addresses received reduced amounts.`);
    }
    
    if (addressesToMint.length < addresses.length) {
      console.log(`${addresses.length - addressesToMint.length} addresses were excluded during pre-flight checks and their pending bread remains in the database`);
    }
  } catch (error) {
    console.error("Error in mintBread:", error);
  }
}

module.exports = { mintBread };