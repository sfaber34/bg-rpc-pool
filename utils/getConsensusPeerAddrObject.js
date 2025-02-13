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
