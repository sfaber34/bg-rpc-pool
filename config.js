const portPoolPublic = 48546;
const poolPort = 3003;
const wsHeartbeatInterval = 30000; // 30 seconds
const socketTimeout = 500;

const poolNodeLogPath = "/home/ubuntu/shared/poolNodes.log";

module.exports = {
  portPoolPublic,
  poolPort,
  wsHeartbeatInterval,
  socketTimeout,

  poolNodeLogPath,
};