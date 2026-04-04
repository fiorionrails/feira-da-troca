const path = require('path');
const fs = require('fs');

// Se estiver rodando como executável (PKG), busca o .env ao lado do .exe físico!
const envDir = process.pkg ? path.dirname(process.execPath) : process.cwd();
const envPath = path.join(envDir, '.env');

if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  require('dotenv').config(); // Fallback padrão
}
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');

const config = require('./config');
const restRouter = require('./api/rest');
const { handleAdminConnection } = require('./api/wsAdmin');
const { handleStoreConnection } = require('./api/wsStore');
const { handlePackingConnection } = require('./api/wsPacking');

const app = express();

// Allow all origins — local-first design (private LAN, no external exposure)
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['*'] }));
app.use(express.json({ limit: '10kb' }));

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
  const parsedUrl = new URL(request.url, `http://localhost:${config.port}`);
  const { pathname } = parsedUrl;
  const token = parsedUrl.searchParams.get('token') || '';

  if (pathname === '/ws/admin') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleAdminConnection(ws, token);
    });
  } else if (pathname === '/ws/store') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleStoreConnection(ws, token);
    });
  } else if (pathname === '/ws/packing') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      handlePackingConnection(ws, token);
    });
  } else {
    socket.destroy();
  }
});

// Only start listening when executed directly (not when imported by tests)
if (require.main === module) {
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Ouroboros backend (Node.js) running at http://0.0.0.0:${config.port}`);
    console.log(`Event: ${config.eventName}`);
  });
}

module.exports = { app, server };
