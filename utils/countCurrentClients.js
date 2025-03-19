function countCurrentClients(poolMap) {
  // Early return if no clients
  if (poolMap.size === 0) {
    return 0;
  }

  const clients = Array.from(poolMap.values());
  
  // Get only clients that have reported a block number
  const clientsWithBlocks = clients.filter(client => client.block_number !== undefined);
  if (clientsWithBlocks.length === 0) {
    return 0;
  }

  // Find the highest block number
  const highestBlock = Math.max(...clientsWithBlocks.map(client => parseInt(client.block_number)));
  
  // Count clients at the highest block
  const highestBlockClients = clients.filter(
    client => parseInt(client.block_number) === highestBlock
  );
  
  return highestBlockClients.length;
}

module.exports = { countCurrentClients }; 