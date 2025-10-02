/**
 * Retrieves RPC site statistics from the pool map
 * @param {Map<string, Object>} poolMap - Map of client IDs to their node information
 * @returns {Object} Object containing:
 *   - nodesOnline: number of active nodes
 *   - executionClients: object with counts for each execution client type (without version)
 *   - consensusClients: object with counts for each consensus client type (without version)
 */
function getRpcSiteStatsObject(poolMap) {
    try {
        const stats = {
            nodesOnline: 0,
            executionClients: {},
            consensusClients: {}
        };

        if (!poolMap || poolMap.size === 0) {
            return stats;
        }

        // Count only non-suspicious nodes with valid execution and consensus clients
        for (const [_, nodeData] of poolMap) {
            // Skip suspicious nodes
            if (nodeData.suspicious) {
                continue;
            }

            // Check if both execution and consensus clients are valid (not N/A, null, or empty)
            const hasValidExecutionClient = nodeData.execution_client && 
                nodeData.execution_client !== 'N/A' && 
                nodeData.execution_client.trim() !== '';
            
            const hasValidConsensusClient = nodeData.consensus_client && 
                nodeData.consensus_client !== 'N/A' && 
                nodeData.consensus_client.trim() !== '';

            // Only count as online if both clients are valid
            if (hasValidExecutionClient && hasValidConsensusClient) {
                stats.nodesOnline++;
            }

            // Process execution client (only if valid)
            if (hasValidExecutionClient) {
                const executionClientName = stripVersion(nodeData.execution_client);
                if (executionClientName) {
                    stats.executionClients[executionClientName] = 
                        (stats.executionClients[executionClientName] || 0) + 1;
                }
            }

            // Process consensus client (only if valid)
            if (hasValidConsensusClient) {
                const consensusClientName = stripVersion(nodeData.consensus_client);
                if (consensusClientName) {
                    stats.consensusClients[consensusClientName] = 
                        (stats.consensusClients[consensusClientName] || 0) + 1;
                }
            }
        }

        return stats;
    } catch (error) {
        console.error('Error in getRpcSiteStatsObject:', error);
        return {
            nodesOnline: 0,
            executionClients: {},
            consensusClients: {}
        };
    }
}

/**
 * Strips version information from client names
 * Examples:
 *   "reth v1.8.1" -> "reth"
 *   "geth/v1.13.0" -> "geth"
 *   "lighthouse v5.3.0" -> "lighthouse"
 *   "Nethermind/v1.25.4" -> "Nethermind"
 * @param {string} clientString - The client string with version info
 * @returns {string} The client name without version
 */
function stripVersion(clientString) {
    if (!clientString || typeof clientString !== 'string') {
        return '';
    }

    // Trim whitespace
    let clientName = clientString.trim();

    // Remove version patterns like "v1.8.1", "/v1.13.0", " v5.3.0", etc.
    // This regex handles: space or slash, optional 'v', version numbers
    clientName = clientName.replace(/[\s\/]v?\d+\.\d+.*$/i, '');

    // Also handle cases where version comes after a dash
    clientName = clientName.replace(/[-_]v?\d+\.\d+.*$/i, '');

    // Remove any trailing slashes or spaces
    clientName = clientName.replace(/[\s\/]+$/, '');

    return clientName;
}

module.exports = { getRpcSiteStatsObject };
