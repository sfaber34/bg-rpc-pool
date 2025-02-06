const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const http = require('http');
const fs = require('fs');

const { portPoolPublic, poolPort, wsHeartbeatInterval } = require('./config');

// SSL configuration for WebSocket server
const wsServer = https.createServer({
  key: fs.readFileSync('/home/ubuntu/shared/server.key'),
  cert: fs.readFileSync('/home/ubuntu/shared/server.cert')
});

const wss = new WebSocket.Server({ server: wsServer });

// Create HTTP server for the API endpoint (no SSL)
const httpServer = http.createServer((req, res) => {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  if (req.url === '/poolMap' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    // Convert Map to array of objects for JSON serialization
    const poolData = Array.from(poolMap.entries()).map(([id, client]) => ({
      id,
      ...client,
      ws: undefined // Remove ws instance from response
    }));
    res.end(JSON.stringify(poolData));
  } else if (req.url === '/wsIdAtHighestBlock' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    
    // Get all entries with block numbers
    const entriesWithBlocks = Array.from(poolMap.entries())
      .map(([id, client]) => ({
        wsID: id,
        blockNumber: client.block_number ? parseInt(client.block_number) : -1
      }))
      .filter(entry => entry.blockNumber >= 0);

    if (entriesWithBlocks.length === 0) {
      res.end(JSON.stringify({ wsIDs: [], highestBlock: null }));
      return;
    }

    // Find the highest block
    const highestBlock = Math.max(...entriesWithBlocks.map(e => e.blockNumber));
    
    // Get all wsIDs at the highest block
    const wsIDsAtHighestBlock = entriesWithBlocks
      .filter(entry => entry.blockNumber === highestBlock)
      .map(entry => entry.wsID);

    res.end(JSON.stringify({
      wsIDs: wsIDsAtHighestBlock,
      highestBlock: highestBlock
    }));
  } else {
    res.statusCode = 404;
    res.end('Not Found');
  }
});

console.log("----------------------------------------------------------------------------------------------------------------");
console.log("----------------------------------------------------------------------------------------------------------------");
wsServer.listen(portPoolPublic, () => {
  console.log(`WebSocket (portPoolPublic) server listening on port ${portPoolPublic}...`);
});

httpServer.listen(poolPort, () => {
  console.log(`HTTP server (poolPort) listening on port ${poolPort}...`);
});

const poolMap = new Map();

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
        console.log(`Updated client ${wsID} in pool:`, parsedMessage.params);
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