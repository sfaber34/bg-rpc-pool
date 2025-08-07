const { compareResultsLogPath } = require('../config');
const { createBufferedFileLogger } = require('./bufferedFileLogger');

// Module-level buffered logger for compare results
const compareLogger = createBufferedFileLogger({
    filePath: compareResultsLogPath,
    formatRecord: (r) => r,
    flushIntervalMs: 25,
    maxBatchSize: 1000,
    highWatermark: 1000,
    maxBufferedRecords: 20000,
});

/**
 * Logs the results of comparing RPC responses from multiple nodes
 * @param {boolean} resultsMatch - Whether all node responses matched
 * @param {string} mismatchedNode - ID of the node with mismatched response
 * @param {string} mismatchedOwner - Owner of the node with mismatched response
 * @param {Array<string>} mismatchedResults - Array of mismatched results details
 * @param {Map<string, Object>} responseMap - Map of client IDs to their responses
 * @param {Map<string, Object>} poolMap - Map of client IDs to their node information
 * @param {string} method - The RPC method that was called
 * @param {Array<*>} params - The parameters that were passed to the RPC method
 */
function logCompareResults(resultsMatch, mismatchedNode, mismatchedOwner, mismatchedResults, responseMap, poolMap, method, params) {
    // Get current timestamp in UTC
    const now = new Date();
    const dateTime = now.toISOString()
        .replace('T', ' ')      // Replace T with space
        .replace(/\.\d+Z$/, ''); // Remove milliseconds and Z
    const epochMs = now.getTime();

    // Extract results for each node from responseMap, using machine IDs from poolMap
    const nodeResults = Array.from(responseMap.entries()).map(([wsId, data]) => {
        const client = poolMap.get(wsId);
        const machineId = client?.id || 'unknown';
        let result;
        
        if (data.status === 'timeout') {
            result = 'timeout';
        } else if (data.status === 'invalid') {
            result = 'invalid';
        } else if (data.status === 'error') {
            result = data.response?.error ? safeStringify(data.response.error).replace(/\|/g, ',') : 'unknown_error';
        } else if (data.status === 'success' && data.response?.result !== undefined) {
            result = safeStringify(data.response.result).replace(/\|/g, ',');
        } else {
            result = 'unknown';
        }

        return {
            wsId,
            machineId,
            result
        };
    });

    // Ensure we have exactly 3 results, pad with empty values if needed
    while (nodeResults.length < 3) {
        nodeResults.push({ wsId: 'none', machineId: 'none', result: 'none' });
    }

    // Format the log line
    const logLine = [
        dateTime,
        epochMs,
        resultsMatch,
        mismatchedNode,
        mismatchedOwner,
        mismatchedResults ? safeStringify(mismatchedResults).replace(/\|/g, ',') : 'none',
        nodeResults[0].machineId,
        nodeResults[0].result,
        nodeResults[1].machineId,
        nodeResults[1].result,
        nodeResults[2].machineId,
        nodeResults[2].result,
        method || 'unknown',
        params ? safeStringify(params).replace(/\|/g, ',') : 'none'
    ].join('|') + '\n';

    // Enqueue line for batched async flush
    compareLogger.enqueue(logLine);
}

function safeStringify(obj) {
    try {
        return JSON.stringify(obj);
    } catch (e) {
        try {
            return JSON.stringify(String(obj));
        } catch {
            return 'unstringifiable';
        }
    }
}

module.exports = { logCompareResults };
