const { Server } = require('socket.io');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');

const { updateLocationTable } = require('./database_scripts/updateLocationTable');
const { getOwnerPoints } = require('./database_scripts/getOwnerPoints');
const { getEnodesObject } = require('./utils/getEnodesObject');
const { getPeerIdsObject } = require('./utils/getPeerIdsObject');
const { getConsensusPeerAddrObject } = require('./utils/getConsensusPeerAddrObject');
const { getPoolNodesObject } = require('./utils/getPoolNodesObject');
const { constructNodeContinentsObject, getNodeContinentsObject } = require('./utils/getNodeContinentsObject');
const { selectRandomClients, fetchNodeTimingData } = require('./utils/selectRandomClients');
const { handleRequestSingle } = require('./utils/handleRequestSingle');
const { handleRequestSet } = require('./utils/handleRequestSet');
const { updateCache } = require('./utils/updateCache');

const { portPoolPublic, poolPort, wsHeartbeatInterval, requestSetChance, nodeTimingFetchInterval, cacheUpdateInterval } = require('./config');

const poolMap = new Map();
const seenNodes = new Set(); // Track nodes we've already processed
const processedTimingNodes = new Set(); // Track nodes we've already processed for timing data
const pendingTimingSockets = new Set(); // Track socket IDs that need timing data once they get a valid node ID

// Set up daily fetch
setInterval(() => {
  fetchNodeTimingData(poolMap).catch(error => {
    console.error('Error in daily fetchNodeTimingData:', error.message);
  });
}, nodeTimingFetchInterval);

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
const wsServerInternal = require('https').createServer(
  {
    key: fs.readFileSync('/home/ubuntu/shared/server.key'),
    cert: fs.readFileSync('/home/ubuntu/shared/server.cert'),
  },
  async (req, res) => {  
  // Add CORS headers and security headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
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
      const continentsData = await getNodeContinentsObject(poolMap);
      
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
        console.log("-----------------------------------------------------------------------------------------");
        console.log('❔Received RPC request:', JSON.stringify(rpcRequest, null, 2));

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
          let result;

          const selectedClients = selectRandomClients(poolMap);
          console.log(`Selected clients: ${selectedClients}`);

          if (selectedClients.length === 0) {
            console.log("No clients connected to pool");
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -69000,
                message: "No clients connected to pool"
              },
              id: rpcRequest.id
            }));
            return;
          } else if (selectedClients.length < 3) {
            result = await handleRequestSingle(rpcRequest, selectedClients, poolMap, io);
          } else {
            const useSetHandler = Math.floor(Math.random() * requestSetChance) === 0;
            
            if (useSetHandler) {
              console.log(`Randomly selected handleRequestSet (1/${requestSetChance} probability)`);
              result = await handleRequestSet(rpcRequest, selectedClients, poolMap, io);
            } else {
              console.log(`Randomly selected handleRequestSingle (${requestSetChance-1}/${requestSetChance} probability)`);
              result = await handleRequestSingle(rpcRequest, selectedClients, poolMap, io);
            }
          }
          
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

// Create WebSocket server attached to the HTTPS server
const wss = new WebSocket.Server({ server: wsServerInternal });

// Don't delete this
// Set up cache update interval
// setInterval(() => {
//   updateCache(wss, poolMap, io).catch(error => {
//     console.error('Error in cache update interval:', error.message);
//   });
// }, cacheUpdateInterval);

// Handle WebSocket connections
wss.on('connection', (ws) => {
  console.log('Proxy.js WebSocket connected');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received WebSocket message:', data);
      
      // Echo back the message for testing
      ws.send(JSON.stringify({
        type: 'response',
        data: data
      }));
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });

  // Send initial connection message
  ws.send(JSON.stringify({
    type: 'connected',
    message: 'Successfully connected to WebSocket server'
  }));
});

console.log("----------------------------------------------------------------------------------------------------------------");
console.log("----------------------------------------------------------------------------------------------------------------");
wsServer.listen(portPoolPublic, () => {
  console.log(`Socket.IO server listening on port ${portPoolPublic}...`);
});

wsServerInternal.listen(poolPort, () => {
  console.log(`WS server (poolPort) listening on port ${poolPort}...`);
});

io.on('connection', (socket) => {
  console.log(`Socket.IO client ${socket.id} connected`);

  const client = { socket, wsID: socket.id };
  poolMap.set(socket.id, client);
  socket.emit('init', { id: socket.id });
  
  // Add socket to pending timing set when it first connects
  pendingTimingSockets.add(socket.id);

  // Handle checkin messages
  socket.on('checkin', async (message) => {
    try {
      // Handle both old and new format
      const params = message.params || message;
      const existingClient = poolMap.get(socket.id);
      
      // Extract machine ID from the node ID if it's in the format "bgnodeX-..."
      let machineId = params.id;
      if (params.id && typeof params.id === 'string' && params.id.startsWith('bgnode')) {
        machineId = params.id;
      }
      
      poolMap.set(socket.id, { 
        ...existingClient, 
        ...params,
        machine_id: machineId // Set the machine_id field
      });
      console.log(`Updated client ${socket.id}, id: ${params.id}, block_number: ${params.block_number}`);
      
      // Update cache immediately when a node checks in with new block number
      if (params.block_number) {
        updateCache(wss, poolMap, io).catch(error => {
          console.error('Error updating cache after checkin:', error.message);
        });
      }
      
      // Check if this socket was pending timing data and now has a valid machine ID
      if (pendingTimingSockets.has(socket.id) && 
          machineId && 
          machineId !== "N/A" && 
          machineId !== null && 
          machineId !== undefined) {
        pendingTimingSockets.delete(socket.id);
        if (!processedTimingNodes.has(machineId)) {
          processedTimingNodes.add(machineId);
          fetchNodeTimingData(poolMap).catch(err => {
            console.error('Error updating node timing data:', err);
          });
        }
      }
      
      // Only call updateLocationTable for new nodes
      if (params.enode && !seenNodes.has(params.enode)) {
        seenNodes.add(params.enode);
        // Run updateLocationTable in the background without blocking
        updateLocationTable(params.enode).catch(err => {
          console.error('Error in background updateLocationTable:', err);
        });

        // If this is the first checkin for a node, update the continents data
        constructNodeContinentsObject(poolMap).catch(err => {
          console.error('Error updating node continents:', err);
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