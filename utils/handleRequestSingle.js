/**
 * Handles a single JSON-RPC request by sending it to one client
 * @param {Object} rpcRequest - The JSON-RPC request object
 * @param {Array} selectedSocketIds - Array of socket IDs to send the request to
 * @param {Map} poolMap - Map containing all connected clients 
 * @param {Object} io - Socket.IO instance
 * @returns {Promise<Object>} - Promise resolving to the result of the RPC request
 */
const { logNode } = require('./logNode');
const { addPendingPoints } = require('./pendingPointsManager');

const { socketTimeout } = require('../config');

async function handleRequestSingle(rpcRequest, selectedSocketIds, poolMap, io) {
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

  // Get the single client ID
  const clientId = selectedSocketIds[0];

  // Create a promise that will resolve with the response or error if it times out
  return new Promise((resolve, reject) => {
    let hasResolved = false; // Flag to track if we've resolved with a response
    const client = poolMap.get(clientId);
    const socket = io.sockets.sockets.get(client.wsID);
    let hasReceivedResponse = false; // Track if the client has responded

    // Set up timeout for the client
    const timeoutId = setTimeout(() => {
      if (!hasReceivedResponse) { // Only timeout if we haven't received a response
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

        // Resolve with a timeout error
        hasResolved = true;
        console.error('RPC response timed out for client:', clientId);
        resolve({ 
          status: 'error', 
          data: {
            code: -69005,
            message: "Node timed out"
          }
        });
      }
    }, socketTimeout);

    // Send the request to the client
    socket.emit('rpc_request', rpcRequest, async (response) => {
      if (hasResolved) { // If already resolved (e.g., by timeout), ignore this response
        console.warn(`Ignoring response from node ${client.id} as the request already timed out.`);
        return;
      }

      if (hasReceivedResponse) {
        console.error(`Ignoring duplicate response from node ${client.id}`);
        return;
      }

      // Mark as received immediately to prevent race conditions
      hasReceivedResponse = true;
      clearTimeout(timeoutId);

      // Now process the response
      const responseTime = Date.now() - startTime;

      // Validate response format first
      if (!response || typeof response !== 'object' || response.jsonrpc !== '2.0') {
        console.error(`Invalid JSON-RPC response format from node ${client.id}:`, response);
        logNode(
          { body: rpcRequest },
          startTime,
          utcTimestamp,
          responseTime,
          'invalid_format',
          client.id || 'unknown',
          client.owner || 'unknown'
        );
        
        if (!hasResolved) {
          hasResolved = true;
          resolve({ 
            status: 'error', 
            data: {
              code: -69007,
              message: "Invalid response format from node"
            }
          });
        }
      } else if (response.error) {
        logNode(
          { body: rpcRequest },
          startTime,
          utcTimestamp,
          responseTime,
          response.error,
          client.id || 'unknown',
          client.owner || 'unknown'
        );
        
        if (!hasResolved) {
          hasResolved = true;
          resolve({ 
            status: 'error', 
            data: response.error
          });
        }
      } else if (response.result !== undefined) {
        logNode(
          { body: rpcRequest },
          startTime,
          utcTimestamp,
          responseTime,
          'success',
          client.id || 'unknown',
          client.owner || 'unknown'
        );
        
        // Resolve with the successful response
        if (!hasResolved) {
          hasResolved = true;
          // Award points to the owner for a successful response
          if (client.owner) {
            addPendingPoints(client.owner, 10);
          }
          resolve({ status: 'success', data: response.result });
        }
      } else {
        // Handle case where response is valid JSON-RPC but missing both error and result
        console.error(`Invalid JSON-RPC response from node ${client.id}: neither error nor result present:`, response);
        logNode(
          { body: rpcRequest },
          startTime,
          utcTimestamp,
          responseTime,
          'invalid_response',
          client.id || 'unknown',
          client.owner || 'unknown'
        );
        
        if (!hasResolved) {
          hasResolved = true;
          resolve({ 
            status: 'error', 
            data: {
              code: -70002,
              message: "Invalid response from node (missing result and error)"
            }
          });
        }
      }
      
      console.log('👍 Response received from single node');
    });
  });
}

module.exports = { handleRequestSingle }; 