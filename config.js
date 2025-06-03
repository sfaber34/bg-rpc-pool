const portPoolPublic = 48546;
const poolPort = 3003;
const wsHeartbeatInterval = 30000; // 30 seconds
const socketTimeout = 500;
const pointUpdateInterval = 10000;
const requestSetChance = 5; // 1 in n requests will be a set request
// const requestSetChance = 1000000000000; // 1 in n requests will be a set request
const spotCheckOnlyThreshold = 250; // The 75th percentile cuttoff for node response time (last week) that excludes nodes from handling single requests (milliseconds)
const nodeTimingFetchInterval = 24 * 60 * 60 * 1000; // Interval for a forced fetching of node timing data (24 hours)
const cacheUpdateInterval = 1000; // Interval for updating the cache (1 second)

const poolNodeLogPath = "/home/ubuntu/shared/poolNodes.log";
const compareResultsLogPath = "/home/ubuntu/shared/poolCompareResults.log";

module.exports = {
  portPoolPublic,
  poolPort,
  wsHeartbeatInterval,
  socketTimeout,
  pointUpdateInterval,
  requestSetChance,
  spotCheckOnlyThreshold,
  nodeTimingFetchInterval,
  cacheUpdateInterval,

  poolNodeLogPath,
  compareResultsLogPath,
};