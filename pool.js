const { Server } = require('socket.io');
const https = require('https');
const fs = require('fs');

const { updateLocationTable } = require('./database_scripts/updateLocationTable');
const { getOwnerPoints } = require('./database_scripts/getOwnerPoints');
const { getEnodesObject } = require('./utils/getEnodesObject');
const { getPeerIdsObject } = require('./utils/getPeerIdsObject');
const { getConsensusPeerAddrObject } = require('./utils/getConsensusPeerAddrObject');
const { getPoolNodesObject } = require('./utils/getPoolNodesObject');
const { constructNodeContinentsObject, getNodeContinentsObject } = require('./utils/getNodeContinentsObject');
const { countCurrentClients } = require('./utils/countCurrentClients');
const { handleRequestSingle } = require('./utils/handleRequestSingle');
const { handleRequestSet } = require('./utils/handleRequestSet');

const { portPoolPublic, poolPort, wsHeartbeatInterval } = require('./config');

const poolMap = new Map();
const seenNodes = new Set(); // Track nodes we've already processed

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
const httpServerInternal = require('https').createServer(
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

          const currentClients = countCurrentClients(poolMap);
          console.log(`Current clients: ${currentClients}`);

          if (currentClients === 0) {
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
          } else if (currentClients < 3) {
            result = await handleRequestSingle(rpcRequest, poolMap, io);
          } else {
            result = await handleRequestSet(rpcRequest, poolMap, io);
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

console.log("----------------------------------------------------------------------------------------------------------------");
console.log("----------------------------------------------------------------------------------------------------------------");
wsServer.listen(portPoolPublic, () => {
  console.log(`Socket.IO server listening on port ${portPoolPublic}...`);
});

httpServerInternal.listen(poolPort, () => {
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