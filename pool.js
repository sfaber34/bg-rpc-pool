const { Server } = require('socket.io');
const https = require('https');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const { incrementOwnerPoints } = require('./database_scripts/incrementOwnerPoints');

const { portPoolPublic, poolPort, wsHeartbeatInterval, socketTimeout } = require('./config');

const poolMap = new Map();

// SSL configuration for Socket.IO server
const wsServer = https.createServer({
  key: fs.readFileSync('/home/ubuntu/shared/server.key'),
  cert: fs.readFileSync('/home/ubuntu/shared/server.cert')
});

// Initialize Socket.IO with CORS and ping configurations
const io = new Server(wsServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingInterval: wsHeartbeatInterval,
  pingTimeout: wsHeartbeatInterval * 2
});

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
    
    // Handle request errors
    req.on('error', (err) => {
      console.error('Error in request:', err);
      res.statusCode = 500;
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal error",
          data: err.message
        },
        id: null
      }));
    });

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const rpcRequest = JSON.parse(body);
        console.log('Received RPC request:', JSON.stringify(rpcRequest, null, 2));
        
        // Validate RPC request format
        if (!rpcRequest.jsonrpc || rpcRequest.jsonrpc !== "2.0" || !rpcRequest.method || rpcRequest.id === undefined) {
          console.error('Invalid RPC request format:', JSON.stringify(rpcRequest, null, 2));
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
        
        if (!client || !client.socket) {
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
          const result = await handleRequest(rpcRequest, client);
          if (result.status === 'success') {
            res.statusCode = 200;
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              result: result.data,
              id: rpcRequest.id
            }));
          } else {
            res.statusCode = 500;
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              error: result.data,
              id: rpcRequest.id
            }));
          }
        } catch (error) {
          console.error('Error handling request:', error);
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

function selectRandomClients(nClients, failedClients = new Set()) {
  // Get all clients and their block numbers
  const clients = Array.from(poolMap.values());
  console.log(`Total connected clients: ${clients.length}`);
  
  if (clients.length === 0) {
    console.log('No clients connected to the pool');
    return { error: "No clients connected to the pool" };
  }

  // Find the highest block number
  const clientsWithBlocks = clients.filter(client => client.block_number !== undefined);
  console.log(`Clients with block numbers: ${clientsWithBlocks.length}`);
  
  if (clientsWithBlocks.length === 0) {
    console.log('No clients have reported their block number yet');
    return { error: "No clients have reported their block number yet" };
  }

  const highestBlock = Math.max(...clientsWithBlocks.map(client => parseInt(client.block_number)));
  console.log(`Highest block number: ${highestBlock}`);

  // Filter clients at the highest block and exclude failed clients
  const highestBlockClients = clients.filter(
    client => parseInt(client.block_number) === highestBlock && !failedClients.has(client.wsID)
  );
  console.log(`Clients at highest block (excluding failed): ${highestBlockClients.length}`);

  if (highestBlockClients.length < nClients) {
    console.log(`Not enough clients at highest block. Requested: ${nClients}, Available: ${highestBlockClients.length}`);
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

  console.log(`Selected ${selectedClients.size} clients at block ${highestBlock}`);
  console.log('Selected client IDs:', Array.from(selectedClients).join(', '));
  return {
    socket_ids: Array.from(selectedClients),
    block_number: highestBlock
  };
}

async function handleRequest(rpcRequest, client, timeout = socketTimeout, failedClients = new Set()) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`Handling RPC request: ${JSON.stringify(rpcRequest)}`);
      
      if (!client || !client.socket || !client.socket.connected) {
        console.log('Client socket is not connected');
        return retryWithDifferentClient(rpcRequest, client, failedClients, timeout, resolve);
      }

      // Get the actual socket from io
      const socket = io.sockets.sockets.get(client.wsID);

      if (!socket) {
        return retryWithDifferentClient(rpcRequest, client, failedClients, timeout, resolve);
      }

      let hasResponded = false;  // Flag to track if we've already handled a response

      // Set up timeout for the acknowledgment
      const timeoutId = setTimeout(() => {
        if (!hasResponded) {
          hasResponded = true;
          console.log(`Request timed out after ${timeout/1000} seconds for client ${client.wsID}`);
          retryWithDifferentClient(rpcRequest, client, failedClients, timeout, resolve);
        }
      }, timeout);

      // Send the request with an acknowledgment callback
      socket.emit('rpc_request', rpcRequest, async (response) => {
        if (hasResponded) {
          // If we've already handled a response (e.g., due to timeout), ignore this one
          return;
        }
        
        clearTimeout(timeoutId);
        hasResponded = true;
        
        if (response.error) {
          console.log(`RPC error response from client ${client.wsID}: ${JSON.stringify(response.error)}`);
          retryWithDifferentClient(rpcRequest, client, failedClients, timeout, resolve);
        } else {
          console.log(`RPC success response: ${JSON.stringify(response.result)}`);
          
          // Get the client's owner from poolMap and increment their points
          const clientData = poolMap.get(client.wsID);
          if (clientData && clientData.owner) {
            try {
              await incrementOwnerPoints(clientData.owner);
              console.log(`Incremented points for owner: ${clientData.owner}`);
            } catch (err) {
              console.error(`Failed to increment points for owner ${clientData.owner}:`, err);
            }
          } else {
            console.warn(`No owner found for client ${client.wsID}`);
          }
          
          resolve({ status: 'success', data: response.result });
        }
      });

    } catch (error) {
      console.error('Error in handleRequest:', error);
      retryWithDifferentClient(rpcRequest, client, failedClients, timeout, resolve);
    }
  });
}

async function retryWithDifferentClient(rpcRequest, failedClient, failedClients, timeout, resolve) {
  // Add the failed client to the set of failed clients
  if (failedClient) {
    failedClients.add(failedClient.wsID);
  }

  console.log(`🤞 Retrying request with different client. Failed clients so far: ${Array.from(failedClients).join(', ')}`);

  // Get a new client, excluding the failed ones
  const selectedClients = selectRandomClients(1, failedClients);
  
  if (selectedClients.error) {
    // If we can't find any more clients, return the error
    console.log('No more available clients to retry with');
    return resolve({ 
      status: 'error', 
      data: {
        code: -32603,
        message: 'All available clients failed to process the request'
      }
    });
  }

  const newClientId = selectedClients.socket_ids[0];
  const newClient = poolMap.get(newClientId);

  if (!newClient) {
    return resolve({ 
      status: 'error', 
      data: {
        code: -32603,
        message: 'Selected client is no longer connected'
      }
    });
  }

  // Retry the request with the new client
  const result = await handleRequest(rpcRequest, newClient, timeout, failedClients);
  resolve(result);
}

console.log("----------------------------------------------------------------------------------------------------------------");
console.log("----------------------------------------------------------------------------------------------------------------");
wsServer.listen(portPoolPublic, () => {
  console.log(`Socket.IO server listening on port ${portPoolPublic}...`);
});

httpServer.listen(poolPort, () => {
  console.log(`HTTP server (poolPort) listening on port ${poolPort}...`);
});

io.on('connection', (socket) => {
  console.log(`Socket.IO client ${socket.id} connected`);

  const client = { socket, wsID: socket.id };
  poolMap.set(socket.id, client);
  socket.emit('init', { id: socket.id });

  // Handle checkin messages
  socket.on('checkin', (message) => {
    try {
      // Handle both old and new format
      const params = message.params || message;
      const existingClient = poolMap.get(socket.id);
      poolMap.set(socket.id, { ...existingClient, ...params });
      console.log(`Updated client ${socket.id} in pool. id: ${params.id}, block_number: ${params.block_number}`);
    } catch (error) {
      console.error('Error processing checkin message:', error, message);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Socket.IO client ${socket.id} disconnected`);
    poolMap.delete(socket.id);
  });
});