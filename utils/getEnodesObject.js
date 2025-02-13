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
