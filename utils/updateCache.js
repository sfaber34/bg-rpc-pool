const WebSocket = require('ws');

// Track last known block number to avoid duplicate updates
let lastKnownBlockNumber = null;

// Convert BigInt to string if needed
function serializeValue(value) {
  return typeof value === 'bigint' ? value.toString() : value;
}

// Validate if a value is a valid block number
function isValidBlockNumber(value) {
  // Check for null, undefined, or non-string/number values
  if (value === null || value === undefined || value === 'N/A') {
    return false;
  }

  // Convert to number and check if it's valid
  const num = Number(value);
  return !isNaN(num) && num >= 0 && Number.isInteger(num);
}

// Broadcast cache updates to all connected clients
function broadcastUpdate(wss, method, value, timestamp = Date.now()) {
  const message = JSON.stringify({ 
    method, 
    value: serializeValue(value), 
    timestamp 
  });

  // Log the update
  console.log(`Updated local cache for ${method}: ${serializeValue(value)}`);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Update cache based on pool map
async function updateCache(wss, poolMap) {
  try {
    // Find the largest block number from all nodes in the pool
    let maxBlockNumber = null;

    for (const [nodeId, nodeData] of poolMap.entries()) {
      const blockNumber = nodeData.block_number;
      if (isValidBlockNumber(blockNumber)) {
        const numBlockNumber = Number(blockNumber);
        if (maxBlockNumber === null || numBlockNumber > maxBlockNumber) {
          maxBlockNumber = numBlockNumber;
        }
      }
    }

    // Only broadcast if we have valid data and it's different from last known
    if (maxBlockNumber !== null && (lastKnownBlockNumber === null || maxBlockNumber > lastKnownBlockNumber)) {
      lastKnownBlockNumber = maxBlockNumber;
      broadcastUpdate(wss, 'eth_blockNumber', maxBlockNumber);
    }
  } catch (error) {
    console.error('Error in updateCache:', error);
  }
}

module.exports = {
  updateCache,
  broadcastUpdate
};
