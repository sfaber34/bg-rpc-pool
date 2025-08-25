const portPoolPublic = 48546;
const poolPort = 3003;
const wsHeartbeatInterval = 30000; // 30 seconds
const nodeDefaultTimeout = 500;

// Method-specific timeouts (in milliseconds)
const nodeMethodSpecificTimeouts = {
  'eth_getBlockReceipts': 1700,
  'eth_getBlockByNumber': 1500,
  'eth_getBlockByHash': 1100
};
const pointUpdateInterval = 10000;
// const requestSetChance = 5; // 1 in n requests will be a set request
const requestSetChance = 1000000000000; // 1 in n requests will be a set request
const spotCheckOnlyThreshold = 150; // The 75th percentile cuttoff for node response time (last week) that excludes nodes from handling single requests (milliseconds)
const nodeTimingFetchInterval = 24 * 60 * 60 * 1000; // Interval for a forced fetching of node timing data (24 hours)
const poolNodeStaleThreshold = 5 * 60 * 1000; // 5 minutes Timeout threshold for stale nodes in poolMap

const poolNodeLogPath = "/home/ubuntu/shared/poolNodes.log";
const compareResultsLogPath = "/home/ubuntu/shared/poolCompareResults.log";

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
};