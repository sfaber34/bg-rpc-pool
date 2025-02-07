const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const { portPoolPublic, poolPort, wsHeartbeatInterval } = require('./config');

const poolMap = new Map();

// SSL configuration for WebSocket server
const wsServer = https.createServer({
  key: fs.readFileSync('/home/ubuntu/shared/server.key'),
  cert: fs.readFileSync('/home/ubuntu/shared/server.cert')
});

const wss = new WebSocket.Server({ server: wsServer });

// Create HTTP server for the API endpoint (no SSL)
const httpServer = https.createServer({
  key: fs.readFileSync('/home/ubuntu/shared/server.key'),
  cert: fs.readFileSync('/home/ubuntu/shared/server.cert')
}, async (req, res) => {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.url === '/requestPool' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const rpcRequest = JSON.parse(body);
        
        // Validate RPC request format
        if (!rpcRequest.jsonrpc || !rpcRequest.method || !rpcRequest.id) {
          res.statusCode = 400;
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32600,
              message: "Invalid request"
            },
            id: rpcRequest.id || null
          }));
          return;
        }

        // Select a random client
        const selectedClients = selectRandomClients(1);
        if (selectedClients.error) {
          res.statusCode = 503;
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: selectedClients.error
            },
            id: rpcRequest.id
          }));
          return;
        }

        const clientId = selectedClients.socket_ids[0];
        const client = poolMap.get(clientId);
        
        if (!client || !client.ws) {
          res.statusCode = 503;
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Selected client is no longer connected"
            },
            id: rpcRequest.id
          }));
          return;
        }

        try {
          const result = await handleRequest(rpcRequest, client.ws);
          if (result.status === 'success') {
            res.statusCode = 200;
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              result: result.data,
              id: rpcRequest.id
            }));
          } else {
            // For error responses, pass through the error message
            res.statusCode = 500;
            const errorResponse = {
              jsonrpc: "2.0",
              error: {
                code: -32603,
                message: result.data.message || result.data || "Internal error"
              },
              id: rpcRequest.id
            };
            console.error('[Pool] Error response:', JSON.stringify(errorResponse));
            res.end(JSON.stringify(errorResponse));
          }
        } catch (error) {
          console.error('[Pool] Caught error:', error);
          res.statusCode = 500;
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: error.message || "Internal error"
            },
            id: rpcRequest.id
          }));
        }
      } catch (error) {
        res.statusCode = 400;
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32700,
            message: "Parse error"
          },
          id: null
        }));
      }
    });
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32601,
        message: "Method not found"
      },
      id: null
    }));
  }
});

function generateMessageId(message, clientIp) {
  const hash = crypto.createHash('sha256');
  const timestamp = Date.now();
  hash.update(JSON.stringify(message) + clientIp + timestamp);
  return hash.digest('hex');
}

function selectRandomClients(nClients) {
  // Get all clients and their block numbers
  const clients = Array.from(poolMap.values());
  console.log(`[Pool] Total connected clients: ${clients.length}`);
  
  if (clients.length === 0) {
    console.log('[Pool] No clients connected to the pool');
    return { error: "No clients connected to the pool" };
  }

  // Find the highest block number
  const clientsWithBlocks = clients.filter(client => client.block_number !== undefined);
  console.log(`[Pool] Clients with block numbers: ${clientsWithBlocks.length}`);
  
  if (clientsWithBlocks.length === 0) {
    console.log('[Pool] No clients have reported their block number yet');
    return { error: "No clients have reported their block number yet" };
  }

  const highestBlock = Math.max(...clientsWithBlocks.map(client => parseInt(client.block_number)));
  console.log(`[Pool] Highest block number: ${highestBlock}`);

  // Filter clients at the highest block
  const highestBlockClients = clients.filter(
    client => parseInt(client.block_number) === highestBlock
  );
  console.log(`[Pool] Clients at highest block: ${highestBlockClients.length}`);

  if (highestBlockClients.length < nClients) {
    console.log(`[Pool] Not enough clients at highest block. Requested: ${nClients}, Available: ${highestBlockClients.length}`);
    return {
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

  console.log(`[Pool] Selected ${selectedClients.size} clients at block ${highestBlock}`);
  return {
    socket_ids: Array.from(selectedClients),
    block_number: highestBlock
  };
}

async function handleRequest(rpcRequest, clientSocket, timeout = 15000) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`[Pool] Handling RPC request: ${JSON.stringify(rpcRequest)}`);
      
      if (!clientSocket || !clientSocket.readyState === WebSocket.OPEN) {
        console.log('[Pool] Client socket is not connected');
        return resolve({ 
          status: 'error', 
          data: {
            code: -32603,
            message: 'WebSocket connection is not open'
          }
        });
      }

      // Set up response handler
      const responseHandler = (response) => {
        try {
          console.log(`[Pool] Received WebSocket response: ${response}`);
          const parsedResponse = JSON.parse(response);
          
          // Check if this response matches our request ID
          if (parsedResponse.jsonrpc === '2.0' && parsedResponse.id === rpcRequest.id) {
            // Remove the message listener to prevent memory leaks
            clientSocket.removeListener('message', responseHandler);
            clearTimeout(timeoutId);
            
            if (parsedResponse.error) {
              console.log(`[Pool] RPC error response: ${JSON.stringify(parsedResponse.error)}`);
              resolve({ status: 'error', data: parsedResponse.error });
            } else {
              console.log(`[Pool] RPC success response: ${JSON.stringify(parsedResponse.result)}`);
              resolve({ status: 'success', data: parsedResponse.result });
            }
          } else {
            console.log(`[Pool] Response ID mismatch. Expected ${rpcRequest.id}, got ${parsedResponse.id}`);
          }
        } catch (error) {
          console.error('[Pool] Error parsing response:', error);
          // Don't resolve here, let the timeout handle it
        }
      };

      // Set up timeout
      const timeoutId = setTimeout(() => {
        console.log(`[Pool] Request timed out after ${timeout/1000} seconds`);
        clientSocket.removeListener('message', responseHandler);
        resolve({ 
          status: 'error', 
          data: {
            code: -32603,
            message: `Request timed out after ${timeout/1000} seconds`
          }
        });
      }, timeout);

      // Add message listener
      clientSocket.on('message', responseHandler);

      // Send the request as is - maintaining JSON-RPC format
      console.log(`[Pool] Sending request to WebSocket client: ${JSON.stringify(rpcRequest)}`);
      clientSocket.send(JSON.stringify(rpcRequest));
    } catch (error) {
      console.error('[Pool] Error in handleRequest:', error);
      resolve({ 
        status: 'error', 
        data: {
          code: -32603,
          message: error.message || 'Internal error'
        }
      });
    }
  });
}

console.log("----------------------------------------------------------------------------------------------------------------");
console.log("----------------------------------------------------------------------------------------------------------------");
wsServer.listen(portPoolPublic, () => {
  console.log(`WebSocket (portPoolPublic) server listening on port ${portPoolPublic}...`);
});

httpServer.listen(poolPort, () => {
  console.log(`HTTP server (poolPort) listening on port ${poolPort}...`);
});

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');

  const wsID = uuidv4();
  console.log(`Client ID: ${wsID}`);

  const client = {ws, wsID};
  poolMap.set(wsID, client);
  ws.send(JSON.stringify({id: wsID}));

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('ping', () => {
    ws.pong();
  });

  // Set up the persistent message listener
  ws.on('message', async (message) => {
    try {
      const parsedMessage = JSON.parse(message);

      if (parsedMessage.type === 'checkin') {
        // Update the client info in poolMap with the checkin params
        const existingClient = poolMap.get(wsID);
        poolMap.set(wsID, { ...existingClient, ...parsedMessage.params });
        console.log(`Updated client ${wsID} in pool. id: ${parsedMessage.params.id}, block_number: ${parsedMessage.params.block_number}`);
      } else if (parsedMessage.jsonrpc === '2.0') {
        // This is an RPC response, handle it through the handleRequest utility
        console.log('Received RPC response:', parsedMessage);
      } else {
        console.log('Received message with unknown type:', parsedMessage);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    poolMap.delete(wsID);
  });
});

// Set up an interval to check for dead connections
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('Terminating inactive WebSocket connection');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, wsHeartbeatInterval);

wss.on('close', () => {
  clearInterval(interval);
});