const { v4: uuidv4 } = require('uuid');
const { EventType } = require('../models');
const { nowIso } = require('../utils');

function getNextCode(db) {
  const row = db.prepare('SELECT code FROM comandas ORDER BY created_at DESC LIMIT 1').get();
  if (!row) return 'F001';
  try {
    const number = parseInt(row.code.slice(1), 10);
    return `F${String(number + 1).padStart(3, '0')}`;
  } catch {
    return 'F001';
  }
}

function createComanda(db, holderName, initialBalance) {
  const comandaId = uuidv4();
  const code = getNextCode(db);
  const createdAt = nowIso();
  const eventId = uuidv4();

  const insertComanda = db.prepare(
    'INSERT INTO comandas (id, code, holder_name, created_at) VALUES (?, ?, ?, ?)'
  );
  const insertEvent = db.prepare(
    'INSERT INTO events (id, type, comanda_id, amount, note, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const transaction = db.transaction(() => {
    insertComanda.run(comandaId, code, holderName, createdAt);
    insertEvent.run(eventId, EventType.credit, comandaId, initialBalance, 'Saldo inicial', createdAt);
  });
  transaction();

  return { comanda: { id: comandaId, code, holder_name: holderName, created_at: createdAt }, eventId };
}

function getComandaByCode(db, code) {
  return db.prepare('SELECT * FROM comandas WHERE code = ?').get(code) || null;
}

function getBalance(db, comandaId) {
  const row = db.prepare('SELECT balance FROM balance_view WHERE comanda_id = ?').get(comandaId);
  return row && row.balance !== null ? row.balance : 0;
}

function getComandaEvents(db, comandaId) {
  return db.prepare('SELECT * FROM events WHERE comanda_id = ? ORDER BY timestamp ASC').all(comandaId);
}

module.exports = { getNextCode, createComanda, getComandaByCode, getBalance, getComandaEvents };
