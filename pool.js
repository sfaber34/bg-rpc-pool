const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const fs = require('fs');

const { poolPort, wsHeartbeatInterval } = require('./config');
// const { handleWebSocketCheckin } = require('./handleWebSocketCheckin');

// SSL configuration
const server = https.createServer({
  key: fs.readFileSync('server.key'),
  cert: fs.readFileSync('server.cert')
});

const wss = new WebSocket.Server({ server });

server.listen(poolPort);

const poolMap = new Map();

console.log("----------------------------------------------------------------------------------------------------------------");
console.log("----------------------------------------------------------------------------------------------------------------");
console.log(`WebSocket server listening on port ${poolPort}...`);

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