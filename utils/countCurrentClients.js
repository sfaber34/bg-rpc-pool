function countCurrentClients(poolMap) {
  // Early return if no clients
  if (poolMap.size === 0) {
    return 0;
  }

  const clients = Array.from(poolMap.values());
  
  // Get only clients that have reported a valid block number (not undefined or "N/A")
  const clientsWithBlocks = clients.filter(client => 
    client.block_number !== undefined && 
    client.block_number !== "N/A" &&
    !isNaN(parseInt(client.block_number))
  );
  if (clientsWithBlocks.length === 0) {
    return 0;
  }

  // Find the highest block number
  const highestBlock = Math.max(...clientsWithBlocks.map(client => parseInt(client.block_number)));
  
  // Count clients at the highest block
  const highestBlockClients = clientsWithBlocks.filter(
    client => parseInt(client.block_number) === highestBlock
  );
  
  return highestBlockClients.length;
}

module.exports = { countCurrentClients }; 