function selectRandomClients(poolMap) {
  // Get all clients and filter those with valid block numbers
  const clients = Array.from(poolMap.values());
  const clientsWithBlocks = clients.filter(client => {
    const blockNum = client.block_number;
    return blockNum !== undefined && 
           blockNum !== null && 
           blockNum !== "N/A" && 
           !isNaN(parseInt(blockNum));
  });
  
  // If no clients have valid block numbers, return empty array
  if (clientsWithBlocks.length === 0) {
    return [];
  }

  // Find the highest block number
  const highestBlock = Math.max(...clientsWithBlocks.map(client => parseInt(client.block_number)));

  // Filter clients at the highest block
  const highestBlockClients = clientsWithBlocks.filter(
    client => parseInt(client.block_number) === highestBlock
  );

  // If no clients at highest block, return empty array
  if (highestBlockClients.length === 0) {
    return [];
  }

  // Randomly select up to 3 clients
  const selectedSocketIds = [];
  const availableClients = [...highestBlockClients];
  const numToSelect = Math.min(3, availableClients.length);

  while (selectedSocketIds.length < numToSelect && availableClients.length > 0) {
    const randomIndex = Math.floor(Math.random() * availableClients.length);
    const client = availableClients[randomIndex];
    selectedSocketIds.push(client.wsID);
    availableClients.splice(randomIndex, 1);
  }

  return selectedSocketIds;
}

module.exports = { selectRandomClients }; 