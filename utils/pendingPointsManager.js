/**
 * @fileoverview Manages the queuing and processing of points awarded to node owners
 * Points are accumulated in memory and periodically processed in batches
 * to reduce database load
 */

const { incrementOwnerPoints } = require('../database_scripts/incrementOwnerPoints');
const { pointUpdateInterval } = require('../config');

// Object to track pending points for each owner
const pendingOwnerPoints = {};

// Process pending points every specified interval
setInterval(async () => {
  for (const [owner, points] of Object.entries(pendingOwnerPoints)) {
    if (points > 0) {
      try {
        await incrementOwnerPoints(owner, points);
        // Reset points after successful processing
        delete pendingOwnerPoints[owner];
      } catch (err) {
        console.error(`Failed to process pending points for owner ${owner}:`, err);
      }
    }
  }
}, pointUpdateInterval);

/**
 * Adds points to the pending queue for a node owner
 * Points are accumulated and processed in batches to optimize database operations
 * @param {string} owner - Owner's address or identifier
 * @param {number} pointsToAdd - Number of points to add to the owner's pending total
 */
function addPendingPoints(owner, pointsToAdd) {
  if (!owner) return;
  pendingOwnerPoints[owner] = (pendingOwnerPoints[owner] || 0) + pointsToAdd;
  console.log(`Added ${pointsToAdd} pending points for owner: ${owner}. Total pending: ${pendingOwnerPoints[owner]}`);
}

module.exports = { addPendingPoints }; 