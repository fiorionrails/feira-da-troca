const config = require('../config');

// Registro compartilhado para conexões de Packing (Semelhante ao wsRegistry.js)
if (!global.packingConnections) {
  global.packingConnections = new Set();
}

const connections = global.packingConnections;

function broadcastToPacking(message) {
  const data = JSON.stringify(message);
  console.log(`[WS Packing] Broadcasting type: ${message.type} to ${connections.size} connection(s).`);
  
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
  // Autenticação exigida conforme nova decisão do usuário
  if (token !== config.adminToken) {
    console.log('[WS Packing] Conexão negada: Token inválido.');
    ws.close(4001, 'Unauthorized');
    return;
  }

  connections.add(ws);
  console.log(`[WS Packing] Nova conexão aceita. Total: ${connections.size}`);

  ws.send(JSON.stringify({ 
    type: 'connected', 
    role: 'packer',
    message: 'Bem-vindo ao canal de distribuição Ouroboros.' 
  }));

  ws.on('close', () => {
    connections.delete(ws);
    console.log(`[WS Packing] Conexão encerrada. Total: ${connections.size}`);
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
