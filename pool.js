const { Server } = require('socket.io');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const { incrementOwnerPoints } = require('./database_scripts/incrementOwnerPoints');
const { updateLocationTable } = require('./database_scripts/updateLocationTable');
const { getOwnerPoints } = require('./database_scripts/getOwnerPoints');
const { getEnodesObject } = require('./utils/getEnodesObject');
const { getPeerIdsObject } = require('./utils/getPeerIdsObject');
const { getConsensusPeerAddrObject } = require('./utils/getConsensusPeerAddrObject');
const { getPoolNodesObject } = require('./utils/getPoolNodesObject');
const { logNode } = require('./utils/logNode');

const { portPoolPublic, poolPort, wsHeartbeatInterval, socketTimeout, pointUpdateInterval } = require('./config');

const poolMap = new Map();
const seenNodes = new Set(); // Track nodes we've already processed

// Object to track pending points for each owner
const pendingOwnerPoints = {};

// Process pending points every 10 seconds
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

// Function to add points to pending queue
function addPendingPoints(owner, pointsToAdd) {
  if (!owner) return;
  pendingOwnerPoints[owner] = (pendingOwnerPoints[owner] || 0) + pointsToAdd;
  console.log(`Added ${pointsToAdd} pending points for owner: ${owner}. Total pending: ${pendingOwnerPoints[owner]}`);
}

// SSL configuration for Socket.IO server
const wsServer = https.createServer({
  key: fs.readFileSync('/home/ubuntu/shared/server.key'),
  cert: fs.readFileSync('/home/ubuntu/shared/server.cert')
}, async (req, res) => {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Handle /yourpoints endpoint
  if (req.url.startsWith('/yourpoints')) {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const owner = url.searchParams.get('owner');
    
    if (owner) {
      try {
        const points = await getOwnerPoints(owner);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ owner, points }));
      } catch (error) {
        console.error('Error retrieving points:', error);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ owner, points: 0 }));
      }
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ owner: '', points: 0 }));
    }
    return;
  }

  if (req.url === '/enodes') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getEnodesObject(poolMap)));
    return;
  }

  if (req.url === '/peerids') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getPeerIdsObject(poolMap)));
    return;
  }

  if (req.url === '/consensuspeeraddr') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getConsensusPeerAddrObject(poolMap)));
    return;
  }
  
  // For any other endpoints, return 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
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
const httpsServerInternal = https.createServer({
  key: fs.readFileSync('/home/ubuntu/shared/server.key'),
  cert: fs.readFileSync('/home/ubuntu/shared/server.cert')
}, async (req, res) => {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.url === '/poolNodes' && req.method === 'GET') {
    try {      
      const poolNodes = getPoolNodesObject(poolMap);
      
      const response = JSON.stringify(poolNodes, null, 2);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(response)
      });
      res.end(response);
    } catch (error) {
      console.error('Error in /poolNodes endpoint:', error);
      const errorResponse = JSON.stringify({
        error: 'Internal server error',
        message: error.message
      });
      res.writeHead(500, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(errorResponse)
      });
      res.end(errorResponse);
    }
    return;
  }

  if (req.url === '/nodeContinents' && req.method === 'GET') {
    try {
      const continentsData = {
        "continents": {
          "North America": 5,
          "South America": 1,
          "Europe": 0,
          "Asia": 0,
          "Africa": 2,
          "Australia": 0
        }
      };
      
      const response = JSON.stringify(continentsData);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(response)
      });
      res.end(response);
    } catch (error) {
      console.error('Error in /nodeContinents endpoint:', error);
      const errorResponse = JSON.stringify({
        error: 'Internal server error',
        message: error.message
      });
      res.writeHead(500, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(errorResponse)
      });
      res.end(errorResponse);
    }
    return;
  }

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

        try {
          const result = await handleRequestSet(rpcRequest);
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

async function handleRequest(socket, client, rpcRequest, timeout = socketTimeout) {
  return new Promise((resolve, reject) => {
    let hasResponded = false;  // Flag to track if we've already handled a response
    const startTime = Date.now();
    const utcTimestamp = new Date().toISOString();

    // Set up timeout for the acknowledgment
    const timeoutId = setTimeout(() => {
      if (!hasResponded) {
        hasResponded = true;
        console.log(`Request timed out after ${timeout/1000} seconds for client ${client.wsID}`);
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
        // Log error response
        logNode(
          { body: rpcRequest },
          startTime,
          utcTimestamp,
          Date.now() - startTime,
          response.error,
          client.id || 'unknown',
          client.owner || 'unknown'
        );
      } else {
        // console.log(`RPC success response: ${JSON.stringify(response.result)}`);
        
        // Log successful response
        logNode(
          { body: rpcRequest },
          startTime,
          utcTimestamp,
          Date.now() - startTime,
          'success',
          client.id || 'unknown',
          client.owner || 'unknown'
        );
        
        // Get the client's owner from poolMap and increment their points
        const clientData = poolMap.get(client.wsID);
        if (clientData && clientData.owner) {
          // Add points to pending queue instead of incrementing immediately
          addPendingPoints(clientData.owner, 10);
        } else {
          console.warn(`No owner found for client ${client.wsID}`);
        }
        
        resolve({ status: 'success', data: response.result });
      }
    });
  });
}

async function handleRequestSet(rpcRequest, timeout = socketTimeout) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`Handling RPC request set: ${JSON.stringify(rpcRequest)}`);

      // Select a random client
      const selectedClients = selectRandomClients(1);
      const clientId = selectedClients.socket_ids[0];
      const client = poolMap.get(clientId);
      
      if (!client || !client.socket || !client.socket.connected) {
        console.error('Client socket is not connected');
      }

      // Get the actual socket from io
      const socket = io.sockets.sockets.get(client.wsID);

      if (!socket) {
        console.error('Client socket is not connected');
      }

      return handleRequest(socket, client, rpcRequest, timeout);

    } catch (error) {
      console.error('Error in handleRequest:', error);
    }
  });
}

console.log("----------------------------------------------------------------------------------------------------------------");
console.log("----------------------------------------------------------------------------------------------------------------");
wsServer.listen(portPoolPublic, () => {
  console.log(`Socket.IO server listening on port ${portPoolPublic}...`);
});

httpsServerInternal.listen(poolPort, () => {
  console.log(`HTTP server (poolPort) listening on port ${poolPort}...`);
});

io.on('connection', (socket) => {
  console.log(`Socket.IO client ${socket.id} connected`);

  const client = { socket, wsID: socket.id };
  poolMap.set(socket.id, client);
  socket.emit('init', { id: socket.id });

  // Handle checkin messages
  socket.on('checkin', async (message) => {
    try {
      // Handle both old and new format
      const params = message.params || message;
      // console.log(`Received checkin message: ${JSON.stringify(params)}`);
      const existingClient = poolMap.get(socket.id);
      poolMap.set(socket.id, { ...existingClient, ...params });
      console.log(`Updated client ${socket.id} in pool. id: ${params.id}, block_number: ${params.block_number}`);
      
      // Only call updateLocationTable for new nodes
      if (params.enode && !seenNodes.has(params.enode)) {
        seenNodes.add(params.enode);
        // Run updateLocationTable in the background without blocking
        updateLocationTable(params.enode).catch(err => {
          console.error('Error in background updateLocationTable:', err);
        });
      }
    } catch (error) {
      console.error('Error processing checkin message:', error, message);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Socket.IO client ${socket.id} disconnected`);
    poolMap.delete(socket.id);
  });
});