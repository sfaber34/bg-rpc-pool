const axios = require('axios');

const host = process.env.HOST;
const { spotCheckOnlyThreshold } = require('../config');

// Module-level variable to store timing data
let nodeTimingLastWeek = null;
let lastFetchTime = null;

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
    nodeTimingLastWeek = response.data; // Store by machine_id
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
 * 1. Filters clients that have properly checked in (have required properties)
 * 2. Filters clients with valid block numbers
 * 3. Identifies the highest block number among all clients
 * 4. Selects only clients at the highest block
 * 5. Randomly chooses up to 3 clients from those at the highest block
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

  // Get all clients and filter those that have properly checked in
  const clients = Array.from(poolMap.values());
  console.log('Total clients in pool:', clients.length);
  
  const checkedInClients = clients.filter(client => {
    const hasRequiredProps = client.id && 
                           client.owner && 
                           client.wsID && 
                           client.machine_id &&
                           client.machine_id !== "N/A" &&
                           client.machine_id !== null &&
                           client.machine_id !== undefined;
    if (!hasRequiredProps) {
      console.log(`Client ${client.wsID} skipped: missing required properties`);
    }
    return hasRequiredProps;
  });
  
  console.log('Clients properly checked in:', checkedInClients.length);
  
  // If no clients have checked in properly, return empty array
  if (checkedInClients.length === 0) {
    console.log('No properly checked-in clients found');
    return [];
  }
  
  const clientsWithBlocks = checkedInClients.filter(client => {
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

  // ---> NEW CODE TO HANDLE RECENT TIMEOUTS <---
  const MAX_RECENT_TIMEOUTS = 2; // Deprioritize if more than 2 timeouts in last 5 mins
  const TIMEOUT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

  let viableHighestBlockClients = highestBlockClients.filter(client => {
    const now = Date.now();
    let recentTimeouts = 0;
    if (client.timeouts && client.timeouts.length > 0) {
      // Ensure client.timeouts is filtered for the relevant window,
      // though handleRequestSingle also does this, a check here is robust.
      client.timeouts = client.timeouts.filter(timestamp => (now - timestamp) < TIMEOUT_WINDOW_MS);
      recentTimeouts = client.timeouts.length;
    }

    if (recentTimeouts > MAX_RECENT_TIMEOUTS) {
      console.log(`Client ${client.wsID} (machine: ${client.machine_id}) deprioritized due to ${recentTimeouts} recent timeouts.`);
      return false; // Exclude this client
    }
    return true;
  });

  console.log('Clients at highest block (after timeout filter):', viableHighestBlockClients.length);

  // If all clients at the highest block were deprioritized, we might still want to try them as a last resort.
  // For now, if viableHighestBlockClients is empty, the existing downstream logic will handle returning [].
  if (viableHighestBlockClients.length === 0 && highestBlockClients.length > 0) {
    console.log("All clients at highest block had too many recent timeouts. Proceeding with empty selection.");
  }
  // ---> END OF NEW CODE <---

  // Create the selection pool - MODIFIED to use viableHighestBlockClients
  let selectionPool = [...viableHighestBlockClients];
  console.log('Initial selection pool size (from viable clients):', selectionPool.length);
  
  if (nodeTimingLastWeek) {
    // Check if all nodes in the viable list are slow - MODIFIED
    const allNodesSlow = viableHighestBlockClients.every(client => {
      const timing = nodeTimingLastWeek[client.machine_id];
      return timing === undefined || timing > spotCheckOnlyThreshold;
    });

    if (allNodesSlow && viableHighestBlockClients.length > 0) { // check viableHighestBlockClients.length
      console.log('All viable nodes are slow based on spotCheckOnlyThreshold, returning empty array');
      return [];
    } else if (viableHighestBlockClients.length === 0 && highestBlockClients.length > 0) {
      // This case is when all were filtered by timeouts; already logged.
      // If highestBlockClients was also 0, then initial pool was empty anyway.
    }


    // Identify all slow nodes from the viable list - MODIFIED
    const slowNodes = viableHighestBlockClients.filter(client => {
      const timing = nodeTimingLastWeek[client.machine_id];
      const isSlow = timing === undefined || timing > spotCheckOnlyThreshold;
      // console.log(`Client ${client.wsID} timing: ${timing}, isSlow: ${isSlow}`); // This can be verbose
      return isSlow;
    });
    // console.log('Slow nodes count (from viable list):', slowNodes.length); // This can be verbose

    // Create selection pool starting with non-slow nodes from the viable list - MODIFIED
    selectionPool = viableHighestBlockClients.filter(client => {
      const timing = nodeTimingLastWeek[client.machine_id];
      return timing !== undefined && timing <= spotCheckOnlyThreshold;
    });
    console.log('Selection pool after removing spotCheck-slow nodes (from viable list):', selectionPool.length);

    // If we have more than 2 slow nodes (from the viable list), randomly select 2 to add to the pool
    // MODIFIED to use slowNodes identified from viableHighestBlockClients
    if (slowNodes.length > 2) {
      const availableSlowNodes = [...slowNodes];
      for (let i = 0; i < 2; i++) {
        const randomIndex = Math.floor(Math.random() * availableSlowNodes.length);
        selectionPool.push(availableSlowNodes[randomIndex]);
        availableSlowNodes.splice(randomIndex, 1);
      }
    } else {
      // If 2 or fewer slow nodes, add them all
      selectionPool.push(...slowNodes);
    }
    console.log('Final selection pool size:', selectionPool.length);
  }

  // If we have no nodes in the selection pool, return empty array
  if (selectionPool.length === 0) {
    console.log('Selection pool is empty');
    return [];
  }

  // Select up to 3 random nodes from the pool
  const numToSelect = Math.min(3, selectionPool.length);
  console.log('Number of clients to select:', numToSelect);
  
  const selectedNodes = [];
  const availableNodes = [...selectionPool];
  
  // Randomly select nodes
  for (let i = 0; i < numToSelect; i++) {
    const randomIndex = Math.floor(Math.random() * availableNodes.length);
    selectedNodes.push(availableNodes[randomIndex]);
    availableNodes.splice(randomIndex, 1);
  }

  // Rearrange selected nodes to ensure a fast node is first
  if (nodeTimingLastWeek) {
    // Find first fast node - operates on selectedNodes which are derived from selectionPool
    const fastNodeIndex = selectedNodes.findIndex(node => {
      const timing = nodeTimingLastWeek[node.machine_id];
      return timing !== undefined && timing <= spotCheckOnlyThreshold;
    });

    if (fastNodeIndex !== -1) {
      // Move fast node to front
      const fastNode = selectedNodes[fastNodeIndex];
      selectedNodes.splice(fastNodeIndex, 1);
      selectedNodes.unshift(fastNode);
    }
  }

  return selectedNodes.map(node => node.wsID);
}

module.exports = { selectRandomClients, fetchNodeTimingData }; 