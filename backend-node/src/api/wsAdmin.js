const { getDb } = require('../database');
const config = require('../config');
const log = require('../logger');
const { getNextCode, createComanda, getComandaByCode, getBalance } = require('../services/comandaService');
const { processCredit } = require('../services/transactionService');
const { createOrUpdateCategory } = require('../services/productService');
const { flagNeedsRecalc } = require('../services/boxService');
const { parsePositiveInt, parseNonNegativeInt } = require('../utils');

/**
 * Se há uma distribuição ativa, marca que o inventário mudou e ela precisa de recálculo.
 * O recálculo real só ocorre quando não houver caixas em progresso (boxService.checkAndTriggerRecalc).
 */
function maybeFlagRecalc(db) {
  const activeDist = db.prepare("SELECT id FROM distributions WHERE status = 'active'").get();
  if (activeDist) flagNeedsRecalc(activeDist.id);
}

const MAX_ADMIN_CONNECTIONS = 10;
// STRESS_NO_RATELIMIT=true bypasses WS rate limiting for load testing only
const WS_RATE_LIMIT_MAX = process.env.STRESS_NO_RATELIMIT ? Infinity : 300;

const { adminConnections, broadcastToAdmins } = require('./wsRegistry');

function handleAdminConnection(ws, token) {
  if (token !== config.adminToken) {
    log.wsAuthFail('admin');
    ws.close(1008, 'Unauthorized');
    return;
  }

  if (adminConnections.size >= MAX_ADMIN_CONNECTIONS) {
    ws.close(1008, 'Max connections reached');
    return;
  }

  adminConnections.add(ws);
  log.wsConnect('admin', 'admin', adminConnections.size);

  let rateCount = 0;
  let rateWindowStart = Date.now();

  const db = getDb();
  const nextCode = getNextCode(db);
  ws.send(JSON.stringify({ type: 'connected', role: 'admin', next_code: nextCode }));

  ws.on('message', (rawData) => {
    const now = Date.now();
    if (now - rateWindowStart > 60000) {
      rateCount = 0;
      rateWindowStart = now;
    }
    if (++rateCount > WS_RATE_LIMIT_MAX) {
      log.rateLimited('admin', null);
      ws.send(JSON.stringify({ type: 'error', reason: 'rate_limit_exceeded' }));
      return;
    }

    let data;
    try {
      data = JSON.parse(rawData.toString());
    } catch (err) {
      log.serverError('wsAdmin', `parse error: ${err.message}`);
      return;
    }

    const db = getDb();
    const msgType = data.type;

    if (msgType === 'create_comanda') {
      const holderName = typeof data.holder_name === 'string' ? data.holder_name.trim() : '';
      if (!holderName) {
        ws.send(JSON.stringify({ type: 'error', reason: 'holder_name is required' }));
        return;
      }

      const initialBalance = parseNonNegativeInt(data.initial_balance ?? 0);
      if (initialBalance === null) {
        ws.send(JSON.stringify({ type: 'error', reason: 'invalid_amount' }));
        return;
      }

      const cartItems = Array.isArray(data.cart_items) ? data.cart_items : [];

      try {
        const { comanda } = createComanda(db, holderName, initialBalance);

        let addedItems = false;
        for (const item of cartItems) {
          const itemName = typeof item.name === 'string' ? item.name.trim() : '';
          const itemQty = parsePositiveInt(item.quantity);
          if (itemName && itemQty) {
            createOrUpdateCategory(db, itemName, 0, itemQty);
            addedItems = true;
          }
        }
        if (addedItems) maybeFlagRecalc(db);

        const nextCode = getNextCode(db);

        log.comandaCriada(comanda.code, comanda.holder_name, initialBalance);

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
      const comandaCode = typeof data.comanda_code === 'string'
        ? data.comanda_code.trim().toUpperCase()
        : '';
      if (!comandaCode) {
        ws.send(JSON.stringify({ type: 'error', reason: 'comanda_code is required' }));
        return;
      }

      const amount = parsePositiveInt(data.amount);
      if (amount === null) {
        ws.send(JSON.stringify({ type: 'error', reason: 'invalid_amount' }));
        return;
      }

      const cartItems = Array.isArray(data.cart_items) ? data.cart_items : [];

      const comanda = getComandaByCode(db, comandaCode);
      if (!comanda) {
        ws.send(JSON.stringify({ type: 'error', reason: 'comanda_not_found' }));
        return;
      }

      try {
        processCredit(db, comanda.id, amount, null, 'Crédito adicional');

        let addedItems = false;
        for (const item of cartItems) {
          const itemName = typeof item.name === 'string' ? item.name.trim() : '';
          const itemQty = parsePositiveInt(item.quantity);
          if (itemName && itemQty) {
            createOrUpdateCategory(db, itemName, 0, itemQty);
            addedItems = true;
          }
        }
        if (addedItems) maybeFlagRecalc(db);

        const newBalance = getBalance(db, comanda.id);

        log.creditoConfirmado(comandaCode, comanda.holder_name, amount, newBalance);

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
      const name = typeof data.name === 'string' ? data.name.trim() : '';
      if (!name) {
        ws.send(JSON.stringify({ type: 'error', reason: 'category name is required' }));
        return;
      }

      const price = parseNonNegativeInt(data.price ?? 0);
      if (price === null) {
        ws.send(JSON.stringify({ type: 'error', reason: 'invalid_amount' }));
        return;
      }

      const totalEntriesInc = parseNonNegativeInt(data.total_entries ?? 0);
      if (totalEntriesInc === null) {
        ws.send(JSON.stringify({ type: 'error', reason: 'invalid_amount' }));
        return;
      }

      try {
        const cat = createOrUpdateCategory(db, name, price, totalEntriesInc);
        if (totalEntriesInc > 0) maybeFlagRecalc(db);
        broadcastToAdmins({ type: 'category_updated', category: cat });
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', reason: err.message }));
      }

    } else {
      ws.send(JSON.stringify({ type: 'error', reason: 'unknown_message_type' }));
    }
  });

  ws.on('close', () => {
    adminConnections.delete(ws);
    log.wsDisconnect('admin', 'admin', adminConnections.size);
  });

  ws.on('error', (err) => {
    log.serverError('wsAdmin', err.message);
    adminConnections.delete(ws);
  });
}

module.exports = { handleAdminConnection, broadcastToAdmins };
