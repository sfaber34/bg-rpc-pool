/**
 * Creates an object containing enode information for all execution clients
 * @param {Map<string, Object>} poolMap - Map of client IDs to their node information
 * @returns {Object} Object containing array of enode information with:
 *   - enode: Node's enode address
 *   - executionClient: Type of execution client being used
 */
function getEnodesObject(poolMap) {
  const enodes = [];
  
  // Iterate through all clients in the poolMap
  for (const [clientId, client] of poolMap) {
    
    // Check if client has enode information
    if (client.enode && client.execution_client) {
      enodes.push({
        enode: client.enode,
        executionClient: client.execution_client.split(' ')[0] // Take only the first part before space
      });
    } else {
      console.log(`Client ${clientId} missing required properties:`, {
        hasEnode: !!client.enode,
        hasExecutionClient: !!client.execution_client
      });
    }
  }

  return { enodes };
}

module.exports = { getEnodesObject };
