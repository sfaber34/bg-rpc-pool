const { mintBread } = require('./mintBread');

function processNodesForBread(poolMap) {
  try {
    // Convert poolMap values to array
    const nodes = Array.from(poolMap.values());

    // Find the highest block_number (as number), ignoring null, undefined, empty, or 'N/A'
    const maxBlockNumber = nodes.reduce((max, node) => {
      const bnRaw = node.block_number;
      if (
        bnRaw === null ||
        bnRaw === undefined ||
        bnRaw === '' ||
        bnRaw === 'N/A'
      ) {
        return max;
      }
      const bn = Number(bnRaw);
      return isNaN(bn) ? max : Math.max(max, bn);
    }, -Infinity);

    // Filter nodes within 2 of the highest block_number, ignoring invalid block_numbers
    const closeNodes = nodes.filter(node => {
      const bnRaw = node.block_number;
      if (
        bnRaw === null ||
        bnRaw === undefined ||
        bnRaw === '' ||
        bnRaw === 'N/A'
      ) {
        return false;
      }
      const bn = Number(bnRaw);
      return !isNaN(bn) && maxBlockNumber - bn <= 2;
    });

    // Count nodes per owner
    const ownerCounts = {};
    for (const node of closeNodes) {
      const owner = node.owner || 'unknown';
      ownerCounts[owner] = (ownerCounts[owner] || 0) + 1;
    }

    // Prepare result array
    const result = Object.entries(ownerCounts).map(([owner, count]) => ({ owner, count }));

    console.log('Owners of nodes within 2 of the highest block_number:', result);

    if (result.length > 0) {
      const owners = result.map(r => r.owner);
      const counts = result.map(r => r.count);
      mintBread(owners, counts);
    }
  } catch (error) {
    console.error('Error in processNodesForBread:', error);
  }
}

module.exports = { processNodesForBread };