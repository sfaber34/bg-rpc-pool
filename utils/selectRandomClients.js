const axios = require('axios');

const host = process.env.HOST;
const { spotCheckOnlyThreshold } = require('../config');

// Module-level variable to store timing data
let nodeTimingLastWeek = null;
let lastFetchTime = null;


/**
 * Transforms nodeTimingLastWeek keys from machine IDs to socket IDs
 * @param {Object} timingData - The original timing data with machine IDs as keys
 * @param {Map<string, Object>} poolMap - Map of client IDs to their node information
 * @returns {Object} Transformed timing data with socket IDs as keys
 */
function transformTimingDataKeys(timingData, poolMap) {
  if (!timingData) return null;
    
  const transformedData = {};
  for (const [machineId, timing] of Object.entries(timingData)) {
    // Find the socket ID associated with this machine ID
    for (const [socketId, client] of poolMap.entries()) {
      // Match using machine_id instead of node_id
      if (client.machine_id === machineId) {
        transformedData[socketId] = timing;
        console.log(`Matched machine ID ${machineId} to socket ID ${socketId}`);
        break;
      }
    }
  }
  return transformedData;
}

/**
 * Checks if a node has both a socket ID and a valid node ID
 * @param {Object} client - The client object from poolMap
 * @returns {boolean} True if the node has both IDs
 */
function hasValidNodeId(client) {
  return client && 
         client.wsID && 
         client.node_id && 
         client.node_id !== "N/A" && 
         client.node_id !== null && 
         client.node_id !== undefined;
}

/**
 * Fetches node timing data from the API
 * @param {Map<string, Object>} poolMap - Map of client IDs to their node information
 * @returns {Promise<void>}
 */
async function fetchNodeTimingData(poolMap) {
  try {
    const response = await axios.get(`https://${host}:3001/nodeTimingLastWeek`);
  
    // Transform the timing data to use socket IDs as keys
    nodeTimingLastWeek = transformTimingDataKeys(response.data, poolMap);
    lastFetchTime = Date.now();
    
    // Log the timing data without quotes in keys
    console.log('Node timing data fetched:');
    Object.entries(nodeTimingLastWeek).forEach(([key, value]) => {
      console.log(`  ${key}: ${value}`);
    });
  } catch (error) {
    console.error('Error fetching node timing data:', error.message);
  }
}

/**
 * Selects up to 3 random clients from the pool that are at the highest block number
 * @param {Map<string, Object>} poolMap - Map of client IDs to their node information
 * @returns {Array<string>} Array of selected client socket IDs (can range in length from 0 to 3 depending on the number of clients at the highest block)
 * @description
 * The function:
 * 1. Filters clients with valid block numbers
 * 2. Identifies the highest block number among all clients
 * 3. Selects only clients at the highest block
 * 4. Randomly chooses up to 3 clients from those at the highest block
 */
function selectRandomClients(poolMap) {
  console.log('Starting selectRandomClients with pool size:', poolMap.size);
  
  // Log the timing data if available
  if (nodeTimingLastWeek) {
    console.log('Node timing data:');
    Object.entries(nodeTimingLastWeek).forEach(([key, value]) => {
      console.log(`  ${key}: ${value}`);
    });
  }

  // Get all clients and filter those with valid block numbers
  const clients = Array.from(poolMap.values());
  console.log('Total clients in pool:', clients.length);
  
  const clientsWithBlocks = clients.filter(client => {
    const blockNum = client.block_number;
    const isValid = blockNum !== undefined && 
           blockNum !== null && 
           blockNum !== "N/A" && 
           !isNaN(parseInt(blockNum));
    console.log(`Client ${client.wsID} block number: ${blockNum}, valid: ${isValid}`);
    return isValid;
  });
  
  console.log('Clients with valid blocks:', clientsWithBlocks.length);
  
  // If no clients have valid block numbers, return empty array
  if (clientsWithBlocks.length === 0) {
    console.log('No clients with valid block numbers found');
    return [];
  }

  // Find the highest block number
  const highestBlock = Math.max(...clientsWithBlocks.map(client => parseInt(client.block_number)));
  console.log('Highest block number:', highestBlock);

  // Filter clients at the highest block
  const highestBlockClients = clientsWithBlocks.filter(
    client => parseInt(client.block_number) === highestBlock
  );
  console.log('Clients at highest block:', highestBlockClients.length);

  // If no clients at highest block, return empty array
  if (highestBlockClients.length === 0) {
    console.log('No clients at highest block');
    return [];
  }

  // Create the selection pool
  let selectionPool = [...highestBlockClients];
  console.log('Initial selection pool size:', selectionPool.length);
  
  if (nodeTimingLastWeek) {
    // Check if all nodes are slow
    const allNodesSlow = highestBlockClients.every(client => {
      const timing = nodeTimingLastWeek[client.wsID];
      return timing && timing > spotCheckOnlyThreshold;
    });

    if (allNodesSlow) {
      console.log('All nodes are slow, returning empty array');
      return [];
    }

    // Identify all slow nodes
    const slowNodes = highestBlockClients.filter(client => {
      const timing = nodeTimingLastWeek[client.wsID];
      const isSlow = timing && timing > spotCheckOnlyThreshold;
      console.log(`Client ${client.wsID} timing: ${timing}, isSlow: ${isSlow}`);
      return isSlow;
    });
    console.log('Slow nodes count:', slowNodes.length);

    // If we have more than 2 slow nodes, randomly select only 2 to include
    if (slowNodes.length > 2) {
      console.log('More than 2 slow nodes, filtering selection pool');
      // Remove all slow nodes from the selection pool
      selectionPool = selectionPool.filter(client => {
        const timing = nodeTimingLastWeek[client.wsID];
        return !timing || timing <= spotCheckOnlyThreshold;
      });
      console.log('Selection pool after removing slow nodes:', selectionPool.length);

      // Randomly select 2 slow nodes to add back
      const availableSlowNodes = [...slowNodes];
      for (let i = 0; i < 2; i++) {
        const randomIndex = Math.floor(Math.random() * availableSlowNodes.length);
        selectionPool.push(availableSlowNodes[randomIndex]);
        availableSlowNodes.splice(randomIndex, 1);
      }
      console.log('Final selection pool size after adding back slow nodes:', selectionPool.length);
    }
  }

  // If we have no nodes in the selection pool, return empty array
  if (selectionPool.length === 0) {
    console.log('Selection pool is empty');
    return [];
  }

  const selectedSocketIds = [];
  const numToSelect = Math.min(3, selectionPool.length);
  console.log('Number of clients to select:', numToSelect);

  // First, select from fast nodes
  const availableNodes = [...selectionPool];
  const numFastToSelect = Math.min(numToSelect, availableNodes.length);
  console.log('Starting selection loop with', availableNodes.length, 'available nodes');

  while (selectedSocketIds.length < numFastToSelect && availableNodes.length > 0) {
    const randomIndex = Math.floor(Math.random() * availableNodes.length);
    const client = availableNodes[randomIndex];
    
    // Only add the node if it's not a slow node or if we already have a fast node
    const timing = nodeTimingLastWeek ? nodeTimingLastWeek[client.wsID] : null;
    const isSlowNode = timing && timing > spotCheckOnlyThreshold;
    
    console.log(`Attempting to select client ${client.wsID}, isSlow: ${isSlowNode}, current selection size: ${selectedSocketIds.length}`);
    
    if (!isSlowNode || selectedSocketIds.length > 0) {
      selectedSocketIds.push(client.wsID);
      availableNodes.splice(randomIndex, 1);
      console.log(`Selected client ${client.wsID}, new selection size: ${selectedSocketIds.length}`);
    }
  }

  return selectedSocketIds;
}

module.exports = { selectRandomClients, fetchNodeTimingData }; 