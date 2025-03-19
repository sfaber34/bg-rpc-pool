function selectRandomClients(poolMap, nClients) {
  // Get all clients and their block numbers
  const clients = Array.from(poolMap.values());
  console.log(`Total connected clients: ${clients.length}`);
  
  if (clients.length === 0) {
    console.error('No clients connected to the pool');
    return { 
      code: -69000,
      error: "No clients connected to the pool" 
    };
  }

  // Find the highest block number
  const clientsWithBlocks = clients.filter(client => client.block_number !== undefined);
  console.log(`Clients with block numbers: ${clientsWithBlocks.length}`);
  
  if (clientsWithBlocks.length === 0) {
    console.error('No clients have reported their block number yet');
    return { 
      code: -69001,
      error: "No clients have reported their block number yet"
    };
  }

  const highestBlock = Math.max(...clientsWithBlocks.map(client => parseInt(client.block_number)));
  console.log(`Highest block number: ${highestBlock}`);

  // Filter clients at the highest block
  const highestBlockClients = clients.filter(
    client => parseInt(client.block_number) === highestBlock
  );
  console.log(`Clients at highest block: ${highestBlockClients.length}`);

  if (highestBlockClients.length < nClients) {
    console.error(`Not enough clients at highest block. Requested: ${nClients}, Available: ${highestBlockClients.length}`);
    return {
      code: -69002,
      error: `Not enough clients at highest block ${highestBlock}. Requested: ${nClients}, Available: ${highestBlockClients.length}`
    };
  }

  // Randomly select unique clients
  const selectedClients = new Set();
  const availableClients = [...highestBlockClients];

  while (selectedClients.size < nClients && availableClients.length > 0) {
    const randomIndex = Math.floor(Math.random() * availableClients.length);
    const client = availableClients[randomIndex];
    selectedClients.add(client.wsID);
    availableClients.splice(randomIndex, 1);
  }

  console.log(`Selected ${selectedClients.size} clients at block ${highestBlock}`);
  console.log('Selected client IDs:', Array.from(selectedClients).join(', '));
  return {
    socket_ids: Array.from(selectedClients),
    block_number: highestBlock
  };
}

module.exports = { selectRandomClients }; 