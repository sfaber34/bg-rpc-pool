const portPoolPublic = 48546;
const poolPort = 3003;
const wsHeartbeatInterval = 30000; // 30 seconds
const nodeDefaultTimeout = 500;

// Method-specific timeouts (in milliseconds)
const nodeMethodSpecificTimeouts = {
  'eth_getBlockReceipts': 2000,
  'eth_getBlockByNumber': 1500,
  'eth_getBlockByHash': 1500,
  'eth_getLogs': 2000,
  'eth_getTransactionReceipt': 2000,
};
const pointUpdateInterval = 10000;
// const requestSetChance = 5; // 1 in n requests will be a set request
const requestSetChance = 20; // 1 in n requests will be a set request
const spotCheckOnlyThreshold = 0.02; // The timeout percentage threshold (0-1) that excludes nodes from handling single requests (e.g., 0.5 = 50% timeout rate)
const nodeTimingFetchInterval = 60 * 60 * 1000; // Interval for fetching node timeout data (1 hour)
const poolNodeStaleThreshold = 5 * 60 * 1000; // 5 minutes Timeout threshold for stale nodes in poolMap

const poolNodeLogPath = "/home/ubuntu/shared/poolNodes.log";
const compareResultsLogPath = "/home/ubuntu/shared/poolCompareResults.log";

// Methods that should skip comparison and always use handleRequestSingle
// These fall into two categories:
// 1. Constant/informational methods that don't need consensus checking
// 2. Time-sensitive methods that query current state and can legitimately differ between nodes on different blocks
const methodsToSkipComparison = [
  // Constant network information
  'eth_chainId',              // Always returns 0x1 for mainnet
  'net_version',              // Always returns "1" for mainnet
  'eth_protocolVersion',      // Protocol version
  
  // Node-specific state (not consensus data)
  'eth_accounts',             // Local accounts (typically empty on public nodes)
  'eth_syncing',              // Node sync status
  'eth_mining',               // Node mining status
  'eth_hashrate',             // Node hashrate
  'eth_coinbase',             // Node coinbase address
  'net_listening',            // Node listening status
  'net_peerCount',            // Node peer count
  'web3_clientVersion',       // Client software version
  'web3_sha3',                // Pure function, not state
  
  // Time-sensitive methods that query "latest" state without block specification
  // These can legitimately differ if nodes are on different blocks
  'eth_blockNumber',          // Current block number (varies by node sync state)
  'eth_gasPrice',             // Current gas price (varies by block)
  'eth_maxPriorityFeePerGas', // Current priority fee (varies by block)
  'eth_feeHistory',           // Fee history (can show different latest blocks)
  
  // Methods that might have transient differences
  'eth_getFilterChanges',     // Filter-specific, stateful
  'eth_getFilterLogs',        // Filter-specific, stateful
  'eth_uninstallFilter',      // Filter-specific, stateful
  'eth_newFilter',            // Filter-specific, stateful
  'eth_newBlockFilter',       // Filter-specific, stateful
  'eth_newPendingTransactionFilter', // Filter-specific, stateful
  
  // Methods that query mempool (inherently node-specific)
  'eth_pendingTransactions',  // Node's local mempool
  'txpool_status',            // Node's transaction pool
  'txpool_content',           // Node's transaction pool
  'txpool_inspect',           // Node's transaction pool
];

// Map of RPC methods that can be cached with their block number parameter positions
const cacheableMethods = new Map([  
  // Methods with block number at position 0 (first parameter)
  ['eth_getBlockByNumber', 0],
  ['eth_getBlockTransactionCountByNumber', 0],
  ['eth_getUncleCountByBlockNumber', 0],
  ['eth_getUncleByBlockNumberAndIndex', 0],
  ['eth_getTransactionByBlockNumberAndIndex', 0],
  ['eth_getBlockReceipts', 0],
  
  // Methods with block number at position 1 (second parameter)
  ['eth_getBalance', 1],
  ['eth_getTransactionCount', 1],
  ['eth_getCode', 1],
  ['eth_call', 1],
  ['eth_estimateGas', 1],
  ['eth_feeHistory', 1],
  
  // Methods with block number at position 2 (third parameter)
  ['eth_getStorageAt', 2],
  
  // Methods with no block number parameter (hash-based or transaction-based)
  ['eth_getBlockByHash', null],
  ['eth_getBlockTransactionCountByHash', null],
  ['eth_getUncleCountByBlockHash', null],
  ['eth_getUncleByBlockHashAndIndex', null],
  ['eth_getTransactionByHash', null],
  ['eth_getTransactionByBlockHashAndIndex', null],
  ['eth_getTransactionReceipt', null],
]);

module.exports = {
  portPoolPublic,
  poolPort,
  wsHeartbeatInterval,
  nodeDefaultTimeout,
  nodeMethodSpecificTimeouts,
  pointUpdateInterval,
  requestSetChance,
  spotCheckOnlyThreshold,
  nodeTimingFetchInterval,
  poolNodeStaleThreshold,

  poolNodeLogPath,
  compareResultsLogPath,
  methodsToSkipComparison,
  cacheableMethods,
};