const fs = require('fs');
const { poolNodeLogPath } = require('../config');

function logNode(req, startTime, utcTimestamp, duration, status, machineId = 'unknown', owner = 'unknown') {
  const { method, params } = req.body;

  // Format the UTC timestamp to YYYY-MM-DD HH:mm:ss
  const date = new Date(utcTimestamp);
  const formattedDate = date.toISOString()
    .replace('T', ' ')      // Replace T with space
    .replace(/\.\d+Z$/, ''); // Remove milliseconds and Z

  // Format status properly - if it's an object, stringify it, otherwise use as is
  let cleanStatus;
  if (typeof status === 'object' && status !== null) {
    cleanStatus = JSON.stringify(status);
  } else {
    cleanStatus = status ? status.toString().replace(/[\r\n\s]+/g, ' ').trim() : 'unknown';
  }

  let logEntry = `${formattedDate}|${startTime}|${machineId}|${owner}|${method}|`;
  
  if (params && Array.isArray(params)) {
    logEntry += params.map(param => {
      if (typeof param === 'object' && param !== null) {
        return JSON.stringify(param);
      }
      return param;
    }).join(',');
  }
  
  logEntry += `|${duration}|${cleanStatus}\n`;
  
  fs.appendFile(poolNodeLogPath, logEntry, (err) => {
    if (err) {
      console.error('Error writing to log file:', err);
    }
  });
}

module.exports = { logNode };