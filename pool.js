const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const { portPoolPublic, poolPort, wsHeartbeatInterval } = require('./config');

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
            console.error('Error response:', JSON.stringify(errorResponse));
            res.end(JSON.stringify(errorResponse));
          }
        } catch (error) {
          console.error('Caught error:', error);
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

  // Filter clients at the highest block
  const highestBlockClients = clients.filter(
    client => parseInt(client.block_number) === highestBlock
  );
  console.log(`Clients at highest block: ${highestBlockClients.length}`);

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
  return {
    socket_ids: Array.from(selectedClients),
    block_number: highestBlock
  };
}

async function handleRequest(rpcRequest, client, timeout = 15000) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`Handling RPC request: ${JSON.stringify(rpcRequest)}`);
      
      if (!client || !client.socket || !client.socket.connected) {
        console.log('Client socket is not connected');
        return resolve({ 
          status: 'error', 
          data: {
            code: -32603,
            message: 'Socket.IO connection is not open'
          }
        });
      }

      // Use Socket.IO's acknowledgment system
      client.socket.timeout(timeout).emit('rpc', rpcRequest, (err, response) => {
        if (err) {
          console.log(`Request timed out after ${timeout/1000} seconds`);
          resolve({ 
            status: 'error', 
            data: {
              code: -32603,
              message: `Request timed out after ${timeout/1000} seconds`
            }
          });
          return;
        }

        try {
          if (response.error) {
            console.log(`RPC error response: ${JSON.stringify(response.error)}`);
            resolve({ status: 'error', data: response.error });
          } else {
            console.log(`RPC success response: ${JSON.stringify(response.result)}`);
            resolve({ status: 'success', data: response.result });
          }
        } catch (error) {
          console.error('Error processing response:', error);
          resolve({ 
            status: 'error', 
            data: {
              code: -32603,
              message: error.message || 'Internal error'
            }
          });
        }
      });
    } catch (error) {
      console.error('Error in handleRequest:', error);
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

  // Handle RPC messages
  socket.on('rpc', async (request, callback) => {
    try {
      console.log('Received RPC request:', request);
      if (request.jsonrpc === '2.0') {
        callback(request); // Send back the response using Socket.IO's acknowledgment
      } else {
        console.log('Received message with unknown format:', request);
        callback({ error: { code: -32600, message: "Invalid request format" } });
      }
    } catch (error) {
      console.error('Error processing RPC message:', error);
      callback({ error: { code: -32603, message: error.message || "Internal error" } });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Socket.IO client ${socket.id} disconnected`);
    poolMap.delete(socket.id);
  });
});