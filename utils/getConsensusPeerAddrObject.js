/**
 * Creates an object containing consensus peer addresses and related information for all clients
 * @param {Map<string, Object>} poolMap - Map of client IDs to their node information
 * @returns {Object} Object containing array of consensus peer addresses with:
 *   - machineID: Node machine identifier
 *   - consensusPeerAddr: Node's ENR address
 *   - consensusClient: Type of consensus client being used (lowercase)
 */
function getConsensusPeerAddrObject(poolMap) {
  const consensusPeerAddr = [];
  
  // Iterate through all clients in the poolMap
  for (const [clientId, client] of poolMap) {
    // Skip if client or required fields are missing
    if (!client || !client.id || !client.enr) continue;

    // Create the peer address object for each client
    const peerAddrObj = {
      machineID: client.id,
      consensusPeerAddr: client.enr,
      consensusClient: client.consensus_client ? client.consensus_client.split(' ')[0].toLowerCase() : 'unknown'
    };
    
    consensusPeerAddr.push(peerAddrObj);
  }

  return { consensusPeerAddr };
}

module.exports = { getConsensusPeerAddrObject };
