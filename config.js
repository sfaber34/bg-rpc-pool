const portPoolPublic = 48546;
const poolPort = 3003;
const wsHeartbeatInterval = 30000; // 30 seconds
const socketTimeout = 500;
const pointUpdateInterval = 10000;

const poolNodeLogPath = "/home/ubuntu/shared/poolNodes.log";
const compareResultsLogPath = "/home/ubuntu/shared/poolCompareResults.log";

module.exports = {
  portPoolPublic,
  poolPort,
  wsHeartbeatInterval,
  socketTimeout,
  pointUpdateInterval,

  poolNodeLogPath,
  compareResultsLogPath,
};