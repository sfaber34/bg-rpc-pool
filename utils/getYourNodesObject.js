/**
 * Extracts the node name (part before the MAC address)
 * Example: "nuc-M26147-406-48:21:0b:36:43:4b-linux-x64" -> "nuc-M26147-406"
 * @param {string} fullNodeId - The full node ID string
 * @returns {string} The node name
 */
function extractNodeIdPrefix(fullNodeId) {
  if (!fullNodeId || typeof fullNodeId !== 'string') {
    return '';
  }
  
  // MAC address pattern: 6 groups of 2 hex digits separated by colons
  // Pattern: XX:XX:XX:XX:XX:XX where X is a hex digit (0-9, a-f, A-F)
  const macAddressPattern = /[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}/;
  
  const macMatch = fullNodeId.match(macAddressPattern);
  if (!macMatch) {
    // If no MAC address found, fall back to original behavior (before first dash)
    const firstDashIndex = fullNodeId.indexOf('-');
    if (firstDashIndex === -1) {
      return fullNodeId;
    }
    return fullNodeId.substring(0, firstDashIndex);
  }
  
  // Find the start of the MAC address
  const macStartIndex = macMatch.index;
  
  // Look for the dash immediately before the MAC address
  let nodeNameEndIndex = macStartIndex;
  if (nodeNameEndIndex > 0 && fullNodeId[nodeNameEndIndex - 1] === '-') {
    nodeNameEndIndex--;
  }
  
  return fullNodeId.substring(0, nodeNameEndIndex);
}

/**
 * Finds the maximum block number in the pool map (excluding suspicious nodes)
 * @param {Map<string, Object>} poolMap - Map of client IDs to their node information
 * @returns {number} The maximum block number, or 0 if none found
 */
function getMaxBlockNumber(poolMap) {
  let maxBlockNumber = 0;
  
  for (const [_, client] of poolMap) {
    // Skip suspicious nodes and invalid block numbers
    if (client.suspicious || !client.block_number || client.block_number === 'SUSPICIOUS') {
      continue;
    }
    
    const blockNum = parseInt(client.block_number);
    if (!isNaN(blockNum) && blockNum > maxBlockNumber) {
      maxBlockNumber = blockNum;
    }
  }
  
  return maxBlockNumber;
}

/**
 * Retrieves node information for a specific owner address or ENS names
 * @param {Map<string, Object>} poolMap - Map of client IDs to their node information
 * @param {string} ownerAddress - Ethereum address of the node owner
 * @param {string[]} ensNames - Array of ENS names associated with the address
 * @returns {Object} Object containing:
 *   - nodesOnline: number of nodes owned by this address
 *   - nodes: array of node objects with details
 */
function getYourNodesObject(poolMap, ownerAddress, ensNames = []) {
  try {
    const result = {
      nodesOnline: 0,
      nodes: []
    };

    if (!poolMap || poolMap.size === 0) {
      return result;
    }

    if (!ownerAddress || typeof ownerAddress !== 'string') {
      return result;
    }

    // Get the maximum block number for isFollowingHead calculation
    const maxBlockNumber = getMaxBlockNumber(poolMap);

    // Create a set of all possible owner identifiers (address + ENS names) for efficient lookup
    const ownerIdentifiers = new Set();
    ownerIdentifiers.add(ownerAddress.toLowerCase());
    ensNames.forEach(name => ownerIdentifiers.add(name.toLowerCase()));

    // Filter nodes by owner address or ENS name
    for (const [_, client] of poolMap) {
      // Match owner by address or any associated ENS name (case-insensitive comparison)
      if (!client.owner || !ownerIdentifiers.has(client.owner.toLowerCase())) {
        continue;
      }

      // Parse block number
      const blockNumber = client.block_number && client.block_number !== 'SUSPICIOUS' 
        ? parseInt(client.block_number) 
        : null;

      // Determine if node is following head (within 2 blocks of max)
      const isFollowingHead = blockNumber !== null && maxBlockNumber > 0
        ? (maxBlockNumber - blockNumber) <= 2
        : false;

      // Build node object
      const nodeInfo = {
        nodeId: extractNodeIdPrefix(client.id),
        executionClient: client.execution_client || '',
        consensusClient: client.consensus_client || '',
        blockNumber: blockNumber,
        isFollowingHead: isFollowingHead,
        nExecutionPeers: client.execution_peers || 0,
        nConsensusPeers: client.consensus_peers || 0
      };

      result.nodes.push(nodeInfo);
      result.nodesOnline++;
    }

    return result;
  } catch (error) {
    console.error('Error in getYourNodesObject:', error);
    return {
      nodesOnline: 0,
      nodes: []
    };
  }
}

module.exports = { getYourNodesObject };

