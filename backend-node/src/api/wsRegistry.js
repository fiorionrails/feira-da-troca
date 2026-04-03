// Centralizar conexões para garantir Singleton mesmo em ambientes de empacotamento (pkg)
if (!global.adminConnections) {
  global.adminConnections = new Set();
}

function broadcastToAdmins(message) {
  const data = JSON.stringify(message);
  const connections = global.adminConnections;
  console.log(`[WS Admin Share] Broadcasting type: ${message.type} to ${connections.size} connection(s).`);
  
  for (const ws of connections) {
    try {
      if (ws.readyState === 1) { // 1 = OPEN
        ws.send(data);
      }
    } catch (e) {
      console.log(`[WS Admin Share] Error: ${e.message}`);
      connections.delete(ws);
    }
  }
}

module.exports = { 
  adminConnections: global.adminConnections, 
  broadcastToAdmins 
};
