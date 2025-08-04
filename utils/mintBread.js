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
    if (!breadContractAddress) {
      console.error("No bread contract address found in environment variables");
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
    let remainingCooldown;
    try {
      remainingCooldown = await basePublicClient.readContract({
        address: breadContractAddress,
        abi: breadContractAbi,
        functionName: 'getRemainingBatchMintCooldown',
      });
    } catch (cooldownError) {
      console.error("Failed to check batch mint cooldown:", cooldownError.message);
      
      try {
        await sendTelegramAlert(`
          🚨 COOLDOWN CHECK FAILED - ABORTING MINT
          Error: ${cooldownError.message}
          
          Unable to check batch mint cooldown status.
          This may indicate a contract issue or network problem.
        `.trim());
      } catch (telegramError) {
        console.error("Failed to send telegram alert:", telegramError.message);
      }
      return;
    }

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
    const finalAmounts = finalValidIndices.map(i => parseFloat(amounts[i])); // Convert to numbers
    const originalAddresses = finalValidIndices.map(i => addresses[i]); // Keep track of original addresses for database reset
    
    if (finalAddresses.length === 0) {
      console.log("No addresses passed all validation checks");
      return;
    }

    // 3. Check global remaining batch mint amount
    console.log('Checking global remaining batch mint amount...');
    
    let remainingBatchAmount;
    try {
      remainingBatchAmount = await basePublicClient.readContract({
        address: breadContractAddress,
        abi: breadContractAbi,
        functionName: 'getRemainingBatchMintAmount',
      });
    } catch (batchAmountError) {
      console.error("Failed to check remaining batch mint amount:", batchAmountError.message);
      
      try {
        await sendTelegramAlert(`
          🚨 BATCH AMOUNT CHECK FAILED - ABORTING MINT
          Error: ${batchAmountError.message}
          
          Unable to check remaining batch mint amount.
          This may indicate a contract issue or network problem.
        `.trim());
      } catch (telegramError) {
        console.error("Failed to send telegram alert:", telegramError.message);
      }
      return;
    }

    const remainingAmountTokens = Number(remainingBatchAmount) / (10 ** 18);
    const totalRequestedAmount = finalAmounts.reduce((sum, amount) => sum + amount, 0);

    console.log(`Total requested: ${totalRequestedAmount}, Available: ${remainingAmountTokens}`);

    if (totalRequestedAmount <= remainingAmountTokens) {
      // Can mint full amounts
      console.log('✅ Sufficient batch capacity for all requested amounts');
    } else {
      // Insufficient capacity - send alert and abort
      console.log("❌ Insufficient batch mint capacity");
      try {
        await sendTelegramAlert(`
          🚨 INSUFFICIENT BATCH MINT CAPACITY - ABORTING
          Total requested: ${totalRequestedAmount} tokens
          Available capacity: ${remainingAmountTokens} tokens
          Shortfall: ${(totalRequestedAmount - remainingAmountTokens).toFixed(6)} tokens

          Minting aborted. Manual intervention required.
        `.trim());
      } catch (telegramError) {
        console.error("Failed to send telegram alert:", telegramError.message);
      }
      return;
    }

    console.log(`✅ Batch capacity check completed. Proceeding to mint to ${finalAddresses.length} addresses.`);
    
    console.log(`Pre-flight checks passed for ${finalAddresses.length}/${addresses.length} addresses.`);

    // Scale each amount to 18 decimals  
    const scaledAmounts = finalAmounts.map(amount => BigInt(Math.floor(amount * (10 ** 18))));

    const account = privateKeyToAccount(key);
    const baseWalletClient = createWalletClient({
      account,
      chain: base,
      transport: http("https://base-rpc.publicnode.com"),
    });

    let hash;
    try {
      hash = await baseWalletClient.writeContract({
        address: breadContractAddress,
        abi: breadContractAbi,
        functionName: "batchMint",
        args: [finalAddresses, scaledAmounts],
      });

      console.log("🍞 Batch mint transaction submitted");
      console.log("Transaction hash:", hash);
    } catch (mintError) {
      console.error("Batch mint transaction submission failed:", mintError.message);
      
      try {
        await sendTelegramAlert(`
          🚨 BATCH MINT TRANSACTION SUBMISSION FAILED
          Error: ${mintError.message}
          Contract: ${breadContractAddress}
          Function: batchMint
          Addresses: ${finalAddresses.length}
          Total Amount: ${totalRequestedAmount} tokens
          Account: ${account.address}

          Transaction failed to submit. Bread balances remain in database.
          This may indicate gas issues, custom contract error, or network issue.
        `.trim());
      } catch (telegramError) {
        console.error("Failed to send telegram alert:", telegramError.message);
      }
      return;
    }
    
    // Wait for transaction confirmation (5 minute timeout)
    console.log("Waiting for transaction confirmation...");
    const receipt = await basePublicClient.waitForTransactionReceipt({ 
      hash: hash,
      timeout: 300_000 // 5 minutes in milliseconds
    });

    if (receipt.status === 'success') {
      console.log("✅ Batch mint transaction confirmed");
      
      // Now that minting is confirmed, subtract the amounts from the database
      console.log("Updating database to reflect minted amounts...");
      const databaseData = originalAddresses.map((addr, i) => ({ address: addr, amount: finalAmounts[i] }));
      await subtractBreadTable(databaseData);
      console.log("✅ Database updated successfully");
    } else {
      console.error("❌ Batch mint transaction failed");
      
      try {
        await sendTelegramAlert(`
          🚨 BATCH MINT TRANSACTION FAILED
          Transaction Hash: ${hash}
          Status: Failed

          The batch mint transaction was submitted but failed on-chain. No tokens were minted.
          Manual investigation required.
        `.trim());
      } catch (telegramError) {
        console.error("Failed to send telegram alert:", telegramError.message);
      }
      
      throw new Error("Batch mint transaction failed");
    }

    // Complete the batch minting period to reset cooldown
    console.log("Completing batch minting period...");
    try {
      const completionHash = await baseWalletClient.writeContract({
        address: breadContractAddress,
        abi: breadContractAbi,
        functionName: "completeBatchMintingPeriod",
      });

      console.log("Waiting for period completion confirmation...");
      const completionReceipt = await basePublicClient.waitForTransactionReceipt({ 
        hash: completionHash,
        timeout: 300_000 // 5 minutes in milliseconds
      });

      if (completionReceipt.status === 'success') {
        console.log("✅ Batch minting period completed. Cooldown reset for next period.");
      } else {
        console.error("❌ Period completion transaction failed");
        
        try {
          await sendTelegramAlert(`
            🚨 PERIOD COMPLETION TRANSACTION FAILED
            Mint Hash: ${hash} (SUCCESS)
            Completion Hash: ${completionHash} (FAILED)

            Batch mint was successful, but period completion failed.
            Cooldown may not reset for next period - manual intervention required.
          `.trim());
        } catch (telegramError) {
          console.error("Failed to send telegram alert:", telegramError.message);
        }
      }
    } catch (completionError) {
      console.error("❌ Error during period completion:", completionError.message);
      
      try {
        await sendTelegramAlert(`
          🚨 PERIOD COMPLETION ERROR
          Mint Hash: ${hash} (SUCCESS)
          Error: ${completionError.message}
          Contract: ${breadContractAddress}
          Function: completeBatchMintingPeriod

          Batch mint was successful, but period completion encountered an error.
          This may be a custom contract error. Cooldown may not reset for next period - manual intervention required.
        `.trim());
      } catch (telegramError) {
        console.error("Failed to send telegram alert:", telegramError.message);
      }
      
      // Don't throw here - the minting was successful even if period completion failed
    }

    console.log("🍞 Bread minting process completed successfully!");
    console.log(`Minted to ${finalAddresses.length} addresses:`, finalAddresses.map((addr, i) => `${addr}: ${finalAmounts[i].toFixed(6)}`));

    // No need to reset bread table since we already subtracted the minted amounts
    
    if (finalAddresses.length < addresses.length) {
      console.log(`${addresses.length - finalAddresses.length} addresses were excluded during pre-flight checks and their pending bread remains in the database`);
    }
  } catch (error) {
    console.error("Error in mintBread:", error);
    
    // Send telegram alert for any unhandled errors
    try {
      await sendTelegramAlert(`
        🚨 UNHANDLED ERROR IN MINT BREAD PROCESS
        Error: ${error.message}
        Stack: ${error.stack}

        An unexpected error occurred during the bread minting process.
        Manual investigation required.
      `.trim());
    } catch (telegramError) {
      console.error("Failed to send telegram alert for unhandled error:", telegramError.message);
    }
  }
}

module.exports = { mintBread };