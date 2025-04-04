const WebSocket = require('ws');
const { handleRequestSingle } = require('./handleRequestSingle');

// Track last known block number to avoid duplicate updates
let lastKnownBlockNumber = null;
let hasBroadcastChainId = false;

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

// Fetch chain ID from a node
async function fetchChainId(poolMap, io) {
  try {
    // Get the first available node
    const firstNode = Array.from(poolMap.values())[0];
    if (!firstNode) {
      console.error('No nodes available in the pool');
      return null;
    }

    // Ensure we have a valid client with the correct structure
    if (!firstNode.wsID) {
      console.error('Invalid client structure: missing wsID');
      return null;
    }

    const rpcRequest = {
      jsonrpc: '2.0',
      method: 'eth_chainId',
      params: [],
      id: 1
    };

    const response = await handleRequestSingle(rpcRequest, [firstNode.wsID], poolMap, io);
    
    if (response.status === 'success') {
      // Validate that the chainId is a valid hex string
      const chainId = response.data;
      if (typeof chainId === 'string' && chainId.startsWith('0x')) {
        return chainId;
      }
      console.error('Invalid chain ID format received:', chainId);
      return null;
    }

    console.error('Failed to fetch chain ID:', response.data);
    return null;
  } catch (error) {
    console.error('Error fetching chain ID:', error);
    return null;
  }
}

// Broadcast cache updates to proxy.js
function broadcastUpdate(wssCache, method, params, value, timestamp = Date.now()) {
  const message = JSON.stringify({ 
    type: 'cacheUpdate',
    method, 
    params: params || [],
    value: serializeValue(value), 
    timestamp 
  });

  // Log the update with params for better debugging
  console.log(`Updated local cache for ${method} with params ${JSON.stringify(params)}: ${serializeValue(value)}`);

  wssCache.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Update cache based on pool map
async function updateCache(wssCache, poolMap, io) {
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
      const timestamp = Date.now();
      broadcastUpdate(wssCache, 'eth_blockNumber', [], maxBlockNumber, timestamp);

      // If this is the first block number we've received and we haven't broadcast chain ID yet,
      // fetch and broadcast the chain ID
      if (!hasBroadcastChainId && lastKnownBlockNumber !== null) {
        const chainId = await fetchChainId(poolMap, io);
        if (chainId !== null) {
          broadcastUpdate(wssCache, 'eth_chainId', [], chainId, null);
          hasBroadcastChainId = true;
        }
      }
    }
  } catch (error) {
    console.error('Error in updateCache:', error);
  }
}

module.exports = {
  updateCache,
  broadcastUpdate
};
