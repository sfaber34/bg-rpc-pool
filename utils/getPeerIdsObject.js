/**
 * Extracts peer IDs and related information from a pool of clients
 * @param {Map<string, Object>} poolMap - Map of client IDs to client objects
 * @returns {{peerids: Array<{peerid: string, ipPort: string, consensusClient: string}>}} Object containing array of peer information
 * @throws {Error} Logs error and continues if processing individual client fails
 */
function getPeerIdsObject(poolMap) {
  const peerids = [];
  
  // Iterate through all clients in the poolMap
  for (const [clientId, client] of poolMap) {
    // Skip if required fields are missing
    if (!client.peerid || !client.enode || !client.consensus_client) {
      continue;
    }

    try {
      // Extract IP:Port from enode URL
      const enodeMatch = client.enode.match(/@([^:]+):(\d+)/);
      if (!enodeMatch) continue;

      const ipPort = `${enodeMatch[1]}:${enodeMatch[2]}`;

      // Extract base consensus client name (before version)
      const consensusClient = client.consensus_client.split(' ')[0].toLowerCase();

      peerids.push({
        peerid: client.peerid,
        ipPort,
        consensusClient
      });
    } catch (error) {
      console.error(`Error processing client ${clientId}:`, error);
      continue;
    }
  }

  return { peerids };
}

module.exports = { getPeerIdsObject };
