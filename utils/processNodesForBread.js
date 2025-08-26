const { updateBreadTable } = require('../database_scripts/updateBreadTable');
const { getNodeTimingData, isFastNode, fetchNodeTimingData } = require('./nodeTimingUtils');
const { resolveMultipleEnsToAddresses } = require('./ensResolver');

async function processNodesForBread(poolMap) {
  try {
    // Ensure we have node timing data
    const nodeTimingData = getNodeTimingData();
    if (!nodeTimingData) {
      console.log('No node timing data available, fetching...');
      await fetchNodeTimingData();
    }

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

    // Calculate bread per owner based on node speed
    const ownerBread = {};
    for (const node of closeNodes) {
      const owner = node.owner || 'unknown';
      
      // Determine bread amount based on node speed
      const breadAmount = isFastNode(node) ? 1 : 0.25;
      
      ownerBread[owner] = (ownerBread[owner] || 0) + breadAmount;
    }

    // Get unique owner names for ENS resolution
    const uniqueOwners = Object.keys(ownerBread);
    
    console.log('Resolving ENS names to addresses...');
    // Resolve all ENS names to addresses in batch
    const ownerAddressMap = await resolveMultipleEnsToAddresses(uniqueOwners);

    // Prepare result array with resolved addresses
    const result = Object.entries(ownerBread).map(([owner, count]) => ({ 
      owner: ownerAddressMap[owner] || owner, // Use resolved address or fallback to original
      count 
    }));

    console.log('Bread distribution based on node speed (fast nodes: 1 bread/hour, slow nodes: 0.25 bread/hour):');
    result.forEach(({ owner, count }) => {
      console.log(`  ${owner}: ${count} bread`);
    });

    if (result.length > 0) {
      // Update the bread table and wait for completion
      await updateBreadTable(result);
    }
  } catch (error) {
    console.error('Error in processNodesForBread:', error);
  }
}

module.exports = { processNodesForBread };