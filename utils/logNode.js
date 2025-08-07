const { poolNodeLogPath } = require('../config');
const { createBufferedFileLogger } = require('./bufferedFileLogger');

// Create a module-level buffered logger for node logs
const nodeLogger = createBufferedFileLogger({
  filePath: poolNodeLogPath,
  formatRecord: (r) => r, // already formatted string lines
  flushIntervalMs: 25,
  maxBatchSize: 1000,
  highWatermark: 1000,
  maxBufferedRecords: 20000,
});

/**
 * Logs information about a node's RPC request and response
 * @param {Object} req - The request object containing the RPC method and parameters
 * @param {number} startTime - Unix timestamp when the request started
 * @param {string} utcTimestamp - ISO formatted UTC timestamp
 * @param {number} duration - Request duration in milliseconds
 * @param {string|Object} status - Response status or error object
 * @param {string} [machineId='unknown'] - ID of the node machine
 * @param {string} [owner='unknown'] - Owner of the node
 */
function logNode(req, startTime, utcTimestamp, duration, status, machineId = 'unknown', owner = 'unknown') {
  const { method, params } = req.body;

  // Format the UTC timestamp to YYYY-MM-DD HH:mm:ss
  const date = new Date(utcTimestamp);
  const formattedDate = date.toISOString()
    .replace('T', ' ')      // Replace T with space
    .replace(/\.\d+Z$/, ''); // Remove milliseconds and Z

  // Lightweight status formatting; defer heavy stringify to the flusher
  const cleanStatus = (status && typeof status === 'object')
    ? safeStringify(status)
    : (status ? String(status).replace(/[\r\n\s]+/g, ' ').trim() : 'unknown');

  let logEntry = `${formattedDate}|${startTime}|${machineId}|${owner}|${method}|`;
  
  if (params && Array.isArray(params)) {
    logEntry += params.map(param => {
      if (param && typeof param === 'object') {
        return safeStringify(param);
      }
      return param;
    }).join(',');
  }
  
  logEntry += `|${duration}|${cleanStatus}\n`;
  nodeLogger.enqueue(logEntry);
}

function safeStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    try {
      return JSON.stringify(String(obj));
    } catch {
      return 'unstringifiable';
    }
  }
}

module.exports = { logNode };