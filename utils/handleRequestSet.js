/**
 * Handles a JSON-RPC request by sending it to multiple randomly selected clients
 * and returning the first successful response
 * 
 * @param {Object} rpcRequest - The JSON-RPC request object
 * @param {Array} selectedSocketIds - Array of socket IDs to send the request to
 * @param {Map} poolMap - Map containing all connected clients 
 * @param {Object} io - Socket.IO instance
 * @returns {Promise<Object>} - Promise resolving to the result of the RPC request
 */
const { logNode } = require('./logNode');
const { compareResults } = require('./compareResults');
const { logCompareResults } = require('./logCompareResults');
const { addPendingPoints } = require('./pendingPointsManager');

const { socketTimeout } = require('../config');

async function handleRequestSet(rpcRequest, selectedSocketIds, poolMap, io) {
  const startTime = Date.now();
  const utcTimestamp = new Date().toISOString();

  if (!Array.isArray(selectedSocketIds) || selectedSocketIds.length === 0) {
    return { 
      status: 'error', 
      data: {
        code: -69000,
        message: "No clients selected"
      }
    };
  }

  // Map to store responses from each client
  const responseMap = new Map();

  // Create a promise that will resolve with the fastest successful response or error if all timeout
  return new Promise((resolve, reject) => {
    let hasResolved = false;  // Flag to track if we've resolved with a response
    let pendingResponses = selectedSocketIds.length;  // Track remaining responses

    selectedSocketIds.forEach(clientId => {
      const client = poolMap.get(clientId);
      const socket = io.sockets.sockets.get(client.wsID);
      let hasReceivedResponse = false;  // Track if this specific client has responded

      // Set up timeout for each client
      const timeoutId = setTimeout(() => {
        if (!hasReceivedResponse) {  // Only timeout if we haven't received a response
          pendingResponses--;
          responseMap.set(clientId, { status: 'timeout', time: Date.now() - startTime });
          
          // Log timeout error
          logNode(
            { body: rpcRequest },
            startTime,
            utcTimestamp,
            Date.now() - startTime,
            'timeout_error',
            client.id || 'unknown',
            client.owner || 'unknown'
          );

          // Remove the message handler for this client
          socket.removeAllListeners('rpc_request');

          // If all responses have timed out and we haven't resolved yet, resolve with an error
          if (pendingResponses === 0 && !hasResolved) {
            hasResolved = true;
            console.error('All RPC responses timed out:', JSON.stringify(Object.fromEntries(responseMap), null, 2));
            resolve({ 
              status: 'error', 
              data: {
                code: -69006,
                message: "All nodes timed out"
              }
            });
          }
        }
      }, socketTimeout);

      // Send the request to each client
      socket.emit('rpc_request', rpcRequest, async (response) => {
        if (hasReceivedResponse) {
          console.error(`Ignoring duplicate response from node ${client.id}`);
          return;
        }

        // Mark as received immediately to prevent race conditions
        hasReceivedResponse = true;
        clearTimeout(timeoutId);
        pendingResponses--;

        // Now process the response
        const responseTime = Date.now() - startTime;

        // Validate response format first
        if (!response || typeof response !== 'object' || response.jsonrpc !== '2.0') {
          console.error(`Invalid JSON-RPC response format from node ${client.id}:`, response);
          responseMap.set(clientId, { status: 'invalid', time: responseTime });
          logNode(
            { body: rpcRequest },
            startTime,
            utcTimestamp,
            responseTime,
            'invalid_format',
            client.id || 'unknown',
            client.owner || 'unknown'
          );
        } else if (response.error) {
          responseMap.set(clientId, { 
            status: 'error',
            response: response,
            time: responseTime 
          });
          logNode(
            { body: rpcRequest },
            startTime,
            utcTimestamp,
            responseTime,
            response.error,
            client.id || 'unknown',
            client.owner || 'unknown'
          );
        } else if (response.result !== undefined) {
          responseMap.set(clientId, { 
            status: 'success',
            response: response,
            time: responseTime 
          });
          logNode(
            { body: rpcRequest },
            startTime,
            utcTimestamp,
            responseTime,
            'success',
            client.id || 'unknown',
            client.owner || 'unknown'
          );
          
          // Resolve with the first successful response if we haven't already
          if (!hasResolved) {
            hasResolved = true;
            // Award 10 points to the owner of the fastest response
            if (client.owner) {
              addPendingPoints(client.owner, 10);
            }
            resolve({ status: 'success', data: response.result });
          } else {
            // Award 5 points to subsequent successful responders
            if (client.owner) {
              addPendingPoints(client.owner, 5);
            }
          }
        } else {
          // Handle case where response is valid JSON-RPC but missing both error and result
          console.error(`Invalid JSON-RPC response from node ${client.id}: neither error nor result present:`, response);
          responseMap.set(clientId, { status: 'invalid', time: responseTime });
          logNode(
            { body: rpcRequest },
            startTime,
            utcTimestamp,
            responseTime,
            'invalid_response',
            client.id || 'unknown',
            client.owner || 'unknown'
          );
        }

        // If this was the last pending response, log all responses and resolve if we haven't already
        if (pendingResponses === 0) {
          console.log('👍 All responses received');

          const { resultsMatch, mismatchedNode, mismatchedOwner, mismatchedResults } = compareResults(responseMap, poolMap);
          console.log('Results match:', resultsMatch);
          console.log('Mismatched node:', mismatchedNode);
          console.log('Mismatched owner:', mismatchedOwner);
          
          logCompareResults(resultsMatch, mismatchedNode, mismatchedOwner, mismatchedResults, responseMap, poolMap, rpcRequest.method, rpcRequest.params);
          
          if (!hasResolved) {
            // If we get here and haven't resolved, it means all responses were errors
            hasResolved = true;
            resolve({ 
              status: 'error', 
              data: {
                code: -69003,
                message: "All nodes failed to respond successfully"
              }
            });
          }
        }
      });
    });
  });
}

module.exports = { handleRequestSet }; 