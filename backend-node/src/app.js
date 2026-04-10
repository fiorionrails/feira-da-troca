const path = require('path');
const fs = require('fs');

// OUROBOROS_DATA_DIR permite que o launcher Tauri defina onde ficam .env e .db.
// Fallback: ao lado do .exe (pkg) ou cwd (dev).
const envDir = process.env.OUROBOROS_DATA_DIR ||
  (process.pkg ? path.dirname(process.execPath) : process.cwd());
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
const log = require('./logger');
const restRouter = require('./api/rest');
const { handleAdminConnection } = require('./api/wsAdmin');
const { handleStoreConnection } = require('./api/wsStore');
const { handlePackingConnection } = require('./api/wsPacking');

const app = express();

// Allow all origins — local-first design (private LAN, no external exposure)
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['*'] }));
app.use(express.json({ limit: '10kb' }));

// REST request logger
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => log.rest(req.method, req.path, res.statusCode, Date.now() - t0));
  next();
});

// Basic rate limiting — prevents abuse; generous limits for a local fair event
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

// Em modo dev (sem FRONTEND_DIST) mantém o endpoint raiz para conveniência
const staticDir = process.env.FRONTEND_DIST ||
  (process.pkg ? path.join(path.dirname(process.execPath), 'public') : null);

if (!staticDir) {
  app.get('/', (req, res) => {
    res.json({ status: 'online', mode: 'local-first', event: config.eventName });
  });
}

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

// Serve frontend estático (modo launcher/pkg). Deve vir após todas as rotas de API.
if (staticDir && fs.existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'));
  });
}

// Only start listening when executed directly (not when imported by tests)
if (require.main === module) {
  server.listen(config.port, '0.0.0.0', () => log.banner(config));
}

module.exports = { app, server, wss };
