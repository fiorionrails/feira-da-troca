const { getDb } = require('../database');
const config = require('../config');
const { getNextCode, createComanda, getComandaByCode, getBalance } = require('../services/comandaService');
const { processCredit } = require('../services/transactionService');
const { createOrUpdateCategory } = require('../services/productService');

const { adminConnections, broadcastToAdmins } = require('./wsRegistry');

function handleAdminConnection(ws, token) {
  if (token !== config.adminToken) {
    ws.close(1008, 'Unauthorized');
    return;
  }

  adminConnections.add(ws);

  const db = getDb();
  const nextCode = getNextCode(db);
  ws.send(JSON.stringify({ type: 'connected', role: 'admin', next_code: nextCode }));

  ws.on('message', (rawData) => {
    let data;
    try {
      data = JSON.parse(rawData.toString());
    } catch {
      return;
    }

    const db = getDb();
    const msgType = data.type;

    if (msgType === 'create_comanda') {
      const holderName = data.holder_name;
      const initialBalance = parseInt(data.initial_balance || 0, 10);
      const cartItems = data.cart_items || [];

      try {
        const { comanda } = createComanda(db, holderName, initialBalance);

        for (const item of cartItems) {
          const itemName = item.name || '';
          const itemQty = parseInt(item.quantity || 0, 10);
          if (itemName && itemQty > 0) {
            createOrUpdateCategory(db, itemName, 0, itemQty);
          }
        }

        const nextCode = getNextCode(db);

        broadcastToAdmins({
          type: 'comanda_created',
          code: comanda.code,
          holder_name: comanda.holder_name,
          balance: initialBalance,
        });

        broadcastToAdmins({ type: 'update_next_code', next_code: nextCode });
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', reason: err.message }));
      }

    } else if (msgType === 'add_credit') {
      const comandaCode = (data.comanda_code || '').toUpperCase();
      const amount = parseInt(data.amount || 0, 10);
      const cartItems = data.cart_items || [];

      const comanda = getComandaByCode(db, comandaCode);
      if (!comanda) {
        ws.send(JSON.stringify({ type: 'error', reason: 'comanda_not_found' }));
        return;
      }

      try {
        processCredit(db, comanda.id, amount, null, 'Crédito adicional');

        for (const item of cartItems) {
          const itemName = item.name || '';
          const itemQty = parseInt(item.quantity || 0, 10);
          if (itemName && itemQty > 0) {
            createOrUpdateCategory(db, itemName, 0, itemQty);
          }
        }

        const newBalance = getBalance(db, comanda.id);

        broadcastToAdmins({
          type: 'credit_confirmed',
          code: comandaCode,
          holder_name: comanda.holder_name,
          amount,
          new_balance: newBalance,
        });
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', reason: err.message }));
      }

    } else if (msgType === 'register_category') {
      const name = data.name;
      const price = parseInt(data.price || 0, 10);
      const totalEntriesInc = parseInt(data.total_entries || 0, 10);

      try {
        const cat = createOrUpdateCategory(db, name, price, totalEntriesInc);
        broadcastToAdmins({ type: 'category_updated', category: cat });
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', reason: err.message }));
      }
    }
  });

  ws.on('close', () => {
    adminConnections.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('Admin WS error:', err.message);
    adminConnections.delete(ws);
  });
}

module.exports = { handleAdminConnection, broadcastToAdmins };
