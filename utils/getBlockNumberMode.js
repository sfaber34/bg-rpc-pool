/**
 * Calculates the mode of block numbers from the pool map.
 * @param {Map} poolMap - The map containing pool client data
 * @returns {string|null} - The mode of block numbers, or null if no valid block numbers
 */
function getBlockNumberMode(poolMap) {
  const blockNumbers = Array.from(poolMap.values())
    .filter(client => !client.suspicious && client.block_number !== 'SUSPICIOUS') // Exclude suspicious nodes
    .map(client => client.block_number)
    .filter(num => num != null);
  
  const blockNumberCounts = blockNumbers.reduce((acc, num) => {
    acc[num] = (acc[num] || 0) + 1;
    return acc;
  }, {});

  const mode = Object.entries(blockNumberCounts)
    .reduce((a, b) => b[1] > a[1] ? b : a, [null, 0])[0];

  return mode;
}

module.exports = { getBlockNumberMode }; 