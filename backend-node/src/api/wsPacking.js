const config = require('../config');
const log = require('../logger');

// Registro compartilhado para conexões de Packing (Semelhante ao wsRegistry.js)
if (!global.packingConnections) {
  global.packingConnections = new Set();
}

const connections = global.packingConnections;

function broadcastToPacking(message) {
  const data = JSON.stringify(message);
  log.broadcast(message.type, connections.size);

  for (const ws of connections) {
    try {
      if (ws.readyState === 1) { // 1 = OPEN
        ws.send(data);
      }
    } catch (e) {
      connections.delete(ws);
    }
  }
}

function handlePackingConnection(ws, token) {
  if (token !== config.adminToken) {
    log.wsAuthFail('packing');
    ws.close(4001, 'Unauthorized');
    return;
  }

  connections.add(ws);
  log.wsConnect('packing', 'packing', connections.size);

  ws.send(JSON.stringify({ 
    type: 'connected', 
    role: 'packer',
    message: 'Bem-vindo ao canal de distribuição Ouroboros.' 
  }));

  ws.on('close', () => {
    connections.delete(ws);
    log.wsDisconnect('packing', 'packing', connections.size);
  });

  ws.on('error', () => {
    connections.delete(ws);
  });

  // Este canal é somente de broadcast para o cliente. 
  // As ações (claim, complete, etc) são via REST para garantir atomicidade.
}

module.exports = {
  handlePackingConnection,
  broadcastToPacking
};
