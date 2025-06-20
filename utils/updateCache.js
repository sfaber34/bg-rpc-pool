const WebSocket = require('ws');
const { handleRequestSingle } = require('./handleRequestSingle');
const { selectRandomClients } = require('./selectRandomClients');
const { getNodeTimingData, isFastNode } = require('./nodeTimingUtils');

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
    // Get a random node using selectRandomClients
    const selectedNodes = selectRandomClients(poolMap);
    if (!selectedNodes || selectedNodes.length === 0) {
      console.error('No nodes available in the pool');
      return null;
    }

    const selectedNode = selectedNodes[0];

    const rpcRequest = {
      jsonrpc: '2.0',
      method: 'eth_chainId',
      params: [],
      id: 1
    };

    const response = await handleRequestSingle(rpcRequest, [selectedNode], poolMap, io);
    
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
    // Get current timing data
    const nodeTimingLastWeek = getNodeTimingData();
    
    // Find the largest block number from fast nodes only (if timing data available)
    let maxBlockNumber = null;
    let fastNodesExist = false;

    for (const [nodeId, nodeData] of poolMap.entries()) {
      const blockNumber = nodeData.block_number;
      // Skip suspicious nodes when determining cache block number
      if (nodeData.suspicious || blockNumber === 'SUSPICIOUS') {
        continue;
      }
      
      if (isValidBlockNumber(blockNumber)) {
        const numBlockNumber = Number(blockNumber);
        
        // Check if this is a fast node (or if no timing data available, consider all nodes)
        const isNodeFast = isFastNode(nodeData);
        if (isNodeFast) {
          fastNodesExist = true;
        }
        
        // Only consider this node if it's fast (or if no timing data available)
        if (isNodeFast || !nodeTimingLastWeek) {
          if (maxBlockNumber === null || numBlockNumber > maxBlockNumber) {
            maxBlockNumber = numBlockNumber;
          }
        }
      }
    }

    // If no fast nodes exist but timing data is available, fall back to all nodes (excluding suspicious)
    if (nodeTimingLastWeek && !fastNodesExist) {
      console.log('No fast nodes available, falling back to all non-suspicious nodes for cache update');
      for (const [nodeId, nodeData] of poolMap.entries()) {
        const blockNumber = nodeData.block_number;
        // Skip suspicious nodes
        if (nodeData.suspicious || blockNumber === 'SUSPICIOUS') {
          continue;
        }
        
        if (isValidBlockNumber(blockNumber)) {
          const numBlockNumber = Number(blockNumber);
          if (maxBlockNumber === null || numBlockNumber > maxBlockNumber) {
            maxBlockNumber = numBlockNumber;
          }
        }
      }
    }

    // Only broadcast if we have valid data and it's different from last known
    if (maxBlockNumber !== null && (lastKnownBlockNumber === null || maxBlockNumber > lastKnownBlockNumber)) {
      lastKnownBlockNumber = maxBlockNumber;
      // Convert block number to hex string with 0x prefix
      const hexBlockNumber = '0x' + maxBlockNumber.toString(16);
      broadcastUpdate(wssCache, 'eth_blockNumber', [], hexBlockNumber);

      // If this is the first block number we've received and we haven't broadcast chain ID yet,
      // fetch and broadcast the chain ID
      if (!hasBroadcastChainId && lastKnownBlockNumber !== null) {
        const chainId = await fetchChainId(poolMap, io);
        if (chainId !== null) {
          broadcastUpdate(wssCache, 'eth_chainId', [], chainId);
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
