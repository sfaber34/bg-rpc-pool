const axios = require('axios');
const { spotCheckOnlyThreshold } = require('../config');

const host = process.env.HOST;

// Module-level variable to store timing data
let nodeTimingLastWeek = null;
let lastFetchTime = null;

/**
 * Fetches node timing data from the API
 * @returns {Promise<void>}
 */
async function fetchNodeTimingData() {
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
 * Gets the current node timing data
 * @returns {Object|null} The timing data object or null if not available
 */
function getNodeTimingData() {
  return nodeTimingLastWeek;
}

/**
 * Determines if a node is considered "fast" based on timing data
 * @param {Object} client - The client object with machine_id
 * @returns {boolean} True if the node is fast (timing undefined or <= threshold)
 */
function isFastNode(client) {
  if (!nodeTimingLastWeek || !client.machine_id || client.machine_id === "N/A") {
    return true; // Consider fast if no timing data or no machine_id
  }
  
  const timing = nodeTimingLastWeek[client.machine_id];
  // Consider fast if timing is undefined or <= threshold
  return timing === undefined || timing <= spotCheckOnlyThreshold;
}

/**
 * Filters an array of clients to return only fast nodes
 * @param {Array} clients - Array of client objects
 * @returns {Array} Array of fast clients
 */
function filterFastNodes(clients) {
  return clients.filter(client => isFastNode(client));
}

/**
 * Filters an array of clients to return only slow nodes
 * @param {Array} clients - Array of client objects
 * @returns {Array} Array of slow clients
 */
function filterSlowNodes(clients) {
  return clients.filter(client => !isFastNode(client));
}

module.exports = {
  fetchNodeTimingData,
  getNodeTimingData,
  isFastNode,
  filterFastNodes,
  filterSlowNodes,
  spotCheckOnlyThreshold
}; 