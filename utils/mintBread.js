const { createWalletClient, http, isAddress } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { baseSepolia } = require("viem/chains");
const path = require("path");
const dotenv = require("dotenv");
const { getBreadTable } = require('../database_scripts/getBreadTable');
const { resetBreadTable } = require('../database_scripts/resetBreadTable');
const { baseSepoliaPublicClient } = require('./baseSepoliaPublicClient');
const { mainnetPublicClient } = require('./mainnetPublicClient');

// const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const contractAbi = [
  {
    inputs: [
      { internalType: "address", name: "rpcBreadMinterAddress_", type: "address" },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [
      { internalType: "address", name: "spender", type: "address" },
      { internalType: "uint256", name: "allowance", type: "uint256" },
      { internalType: "uint256", name: "needed", type: "uint256" },
    ],
    name: "ERC20InsufficientAllowance",
    type: "error",
  },
  {
    inputs: [
      { internalType: "address", name: "sender", type: "address" },
      { internalType: "uint256", name: "balance", type: "uint256" },
      { internalType: "uint256", name: "needed", type: "uint256" },
    ],
    name: "ERC20InsufficientBalance",
    type: "error",
  },
  {
    inputs: [{ internalType: "address", name: "approver", type: "address" }],
    name: "ERC20InvalidApprover",
    type: "error",
  },
  {
    inputs: [{ internalType: "address", name: "receiver", type: "address" }],
    name: "ERC20InvalidReceiver",
    type: "error",
  },
  {
    inputs: [{ internalType: "address", name: "sender", type: "address" }],
    name: "ERC20InvalidSender",
    type: "error",
  },
  {
    inputs: [{ internalType: "address", name: "spender", type: "address" }],
    name: "ERC20InvalidSpender",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "owner", type: "address" },
      { indexed: true, internalType: "address", name: "spender", type: "address" },
      { indexed: false, internalType: "uint256", name: "value", type: "uint256" },
    ],
    name: "Approval",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "Mint",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "from", type: "address" },
      { indexed: true, internalType: "address", name: "to", type: "address" },
      { indexed: false, internalType: "uint256", name: "value", type: "uint256" },
    ],
    name: "Transfer",
    type: "event",
  },
  {
    inputs: [
      { internalType: "address", name: "owner", type: "address" },
      { internalType: "address", name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "spender", type: "address" },
      { internalType: "uint256", name: "value", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address[]", name: "addresses", type: "address[]" },
      { internalType: "uint256[]", name: "amounts", type: "uint256[]" },
    ],
    name: "batchMint",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "mint",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "name",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "rpcBreadMinterAddress",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalSupply",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "value", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "from", type: "address" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "value", type: "uint256" },
    ],
    name: "transferFrom",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
];

// Pre-flight check functions
async function validateAndResolveAddresses(addresses) {
  const resolvedAddresses = [];
  const validAddresses = [];
  const failedAddresses = [];
  
  for (let i = 0; i < addresses.length; i++) {
    const addr = addresses[i];
    try {
      if (addr.endsWith('.eth')) {
        // Resolve ENS name using Ethereum mainnet
        const resolved = await mainnetPublicClient.getEnsAddress({ name: addr });
        if (!resolved) {
          console.error(`Could not resolve ENS name: ${addr}`);
          failedAddresses.push({ index: i, address: addr, reason: 'ENS resolution failed' });
          continue;
        }
        resolvedAddresses.push(resolved);
        validAddresses.push(i);
      } else {
        // Validate address format
        if (!isAddress(addr)) {
          console.error(`Invalid address format: ${addr}`);
          failedAddresses.push({ index: i, address: addr, reason: 'Invalid address format' });
          continue;
        }
        resolvedAddresses.push(addr);
        validAddresses.push(i);
      }
    } catch (error) {
      console.error(`Error validating address ${addr}:`, error.message);
      failedAddresses.push({ index: i, address: addr, reason: error.message });
    }
  }
  
  return { resolvedAddresses, validAddresses, failedAddresses };
}

async function checkAddressesExist(addresses) {
  const validAddresses = [];
  const failedAddresses = [];
  
  for (let i = 0; i < addresses.length; i++) {
    const addr = addresses[i];
    try {
      const code = await baseSepoliaPublicClient.getBytecode({ address: addr });
      const balance = await baseSepoliaPublicClient.getBalance({ address: addr });
      
      // Check if it's a valid address (has been used or is a contract)
      if (code === '0x' && balance === 0n) {
        console.warn(`Address ${addr} appears to be unused (no balance or code)`);
        // For now, we'll still consider these valid but warn
      }
      validAddresses.push(i);
    } catch (error) {
      console.error(`Could not check address ${addr}:`, error.message);
      failedAddresses.push({ index: i, address: addr, reason: error.message });
    }
  }
  
  return { validAddresses, failedAddresses };
}

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
      abi: contractAbi,
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