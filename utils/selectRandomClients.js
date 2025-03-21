const axios = require('axios');

const host = process.env.HOST;

// Module-level variable to store timing data
let nodeTimingLastWeek = null;
let lastFetchTime = null;
const spotCheckOnlyThreshold = 150; // milliseconds

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
      if (client.node_id === machineId) {
        transformedData[socketId] = timing;
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
    console.log('Node timing data fetched:', nodeTimingLastWeek);
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
  // Log the timing data if available
  if (nodeTimingLastWeek) {
    console.log('Node timing data:', JSON.stringify(nodeTimingLastWeek, null, 2));
  }

  // Get all clients and filter those with valid block numbers
  const clients = Array.from(poolMap.values());
  const clientsWithBlocks = clients.filter(client => {
    const blockNum = client.block_number;
    return blockNum !== undefined && 
           blockNum !== null && 
           blockNum !== "N/A" && 
           !isNaN(parseInt(blockNum));
  });
  
  // If no clients have valid block numbers, return empty array
  if (clientsWithBlocks.length === 0) {
    return [];
  }

  // Find the highest block number
  const highestBlock = Math.max(...clientsWithBlocks.map(client => parseInt(client.block_number)));

  // Filter clients at the highest block
  const highestBlockClients = clientsWithBlocks.filter(
    client => parseInt(client.block_number) === highestBlock
  );

  // If no clients at highest block, return empty array
  if (highestBlockClients.length === 0) {
    return [];
  }

  // Randomly select up to 3 clients
  const selectedSocketIds = [];
  const availableClients = [...highestBlockClients];
  const numToSelect = Math.min(3, availableClients.length);

  while (selectedSocketIds.length < numToSelect && availableClients.length > 0) {
    const randomIndex = Math.floor(Math.random() * availableClients.length);
    const client = availableClients[randomIndex];
    selectedSocketIds.push(client.wsID);
    availableClients.splice(randomIndex, 1);
  }

  return selectedSocketIds;
}

module.exports = { selectRandomClients, fetchNodeTimingData }; 