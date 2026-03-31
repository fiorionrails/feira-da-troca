const { getDb } = require('../database');
const { getStoreByToken } = require('../services/storeService');
const { getComandaByCode, getBalance } = require('../services/comandaService');
const { processDebit, InsufficientBalanceError, InvalidAmountError } = require('../services/transactionService');
const { broadcastToAdmins } = require('./wsAdmin');

const storeConnections = new Set();

function broadcastToStores(message) {
  const data = JSON.stringify(message);
  for (const ws of storeConnections) {
    try {
      if (ws.readyState === ws.OPEN) ws.send(data);
    } catch {
      storeConnections.delete(ws);
    }
  }
}

function handleStoreConnection(ws, token) {
  const db = getDb();
  const store = getStoreByToken(db, token);

  if (!store) {
    ws.close(1008, 'Store Token Unauthorized');
    return;
  }

  storeConnections.add(ws);

  ws.send(JSON.stringify({
    type: 'connected',
    store_id: store.id,
    store_name: store.name,
    server_time: new Date().toISOString(),
  }));

  ws.on('message', (rawData) => {
    let data;
    try {
      data = JSON.parse(rawData.toString());
    } catch {
      return;
    }

    const db = getDb();
    const msgType = data.type;

    if (msgType === 'debit_request') {
      const code = data.comanda_code;
      const amount = parseInt(data.amount || 0, 10);

      const comanda = getComandaByCode(db, code);
      if (!comanda) {
        ws.send(JSON.stringify({ type: 'debit_rejected', reason: 'comanda_not_found', requested: amount }));
        return;
      }

      try {
        const event = processDebit(db, comanda.id, amount, store.id);
        const newBalance = getBalance(db, comanda.id);

        ws.send(JSON.stringify({
          type: 'debit_confirmed',
          event_id: event.id,
          comanda_code: comanda.code,
          holder_name: comanda.holder_name,
          amount,
          new_balance: newBalance,
        }));

        broadcastToStores({
          type: 'balance_updated',
          comanda_code: comanda.code,
          new_balance: newBalance,
          event_type: 'debit',
          store_id: store.id,
        });

        broadcastToAdmins({
          type: 'admin_balance_updated',
          comanda_code: comanda.code,
          new_balance: newBalance,
          amount,
          store_name: store.name,
        });

      } catch (err) {
        if (err instanceof InsufficientBalanceError) {
          const currentBalance = getBalance(db, comanda.id);
          ws.send(JSON.stringify({
            type: 'debit_rejected',
            reason: 'insufficient_balance',
            current_balance: currentBalance,
            requested: amount,
          }));
        } else if (err instanceof InvalidAmountError) {
          ws.send(JSON.stringify({ type: 'debit_rejected', reason: 'invalid_amount', requested: amount }));
        } else {
          ws.send(JSON.stringify({ type: 'debit_rejected', reason: 'server_error', requested: amount }));
        }
      }

    } else if (msgType === 'balance_query') {
      const code = data.comanda_code;
      const comanda = getComandaByCode(db, code);
      if (!comanda) {
        ws.send(JSON.stringify({ type: 'error', reason: 'comanda_not_found' }));
        return;
      }
      const balance = getBalance(db, comanda.id);
      ws.send(JSON.stringify({
        type: 'balance_response',
        comanda_code: comanda.code,
        holder_name: comanda.holder_name,
        balance,
      }));
    }
  });

  ws.on('close', () => {
    storeConnections.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('Store WS error:', err.message);
    storeConnections.delete(ws);
  });
}

module.exports = { handleStoreConnection };
