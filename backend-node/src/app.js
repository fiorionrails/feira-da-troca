require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const url = require('url');

const config = require('./config');
const restRouter = require('./api/rest');
const { handleAdminConnection } = require('./api/wsAdmin');
const { handleStoreConnection } = require('./api/wsStore');

const app = express();

// Allow all origins — local-first design (private LAN, no external exposure)
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['*'] }));
app.use(express.json());

// Basic rate limiting — prevents abuse; generous limits for a local fair event
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

app.get('/', (req, res) => {
  res.json({ status: 'online', mode: 'local-first', event: config.eventName });
});

app.use('/api', restRouter);

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const { pathname, query } = url.parse(request.url, true);
  const token = query.token || '';

  if (pathname === '/ws/admin') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleAdminConnection(ws, token);
    });
  } else if (pathname === '/ws/store') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleStoreConnection(ws, token);
    });
  } else {
    socket.destroy();
  }
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`Ouroboros backend (Node.js) running at http://0.0.0.0:${config.port}`);
  console.log(`Event: ${config.eventName}`);
});

module.exports = { app, server };
