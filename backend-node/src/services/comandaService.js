const { v4: uuidv4 } = require('uuid');
const { EventType } = require('../models');
const { nowIso } = require('../utils');
const config = require('../config');

// Validates the expected code format F001, F002, ..., F999, F1000, etc.
const CODE_REGEX = /^F(\d+)$/;

class MaxComandasReachedError extends Error {}
class DuplicateCodeError extends Error {}

function getNextCode(db) {
  const row = db.prepare('SELECT code FROM comandas ORDER BY created_at DESC LIMIT 1').get();
  if (!row) return 'F001';
  const match = CODE_REGEX.exec(row.code);
  if (!match) return 'F001';
  const number = parseInt(match[1], 10);
  return `F${String(number + 1).padStart(3, '0')}`;
}

function createComanda(db, holderName, initialBalance) {
  const trimmedName = holderName ? String(holderName).trim() : '';
  if (!trimmedName) throw new Error('holder_name is required');
  if (!Number.isInteger(initialBalance) || initialBalance < 0) {
    throw new Error('initial_balance must be a non-negative integer');
  }

  const count = db.prepare('SELECT COUNT(*) as c FROM comandas').get().c;
  if (count >= config.maxComandas) {
    throw new MaxComandasReachedError(
      `Maximum number of comandas (${config.maxComandas}) reached`
    );
  }

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
    insertComanda.run(comandaId, code, trimmedName, createdAt);
    if (initialBalance > 0) {
      insertEvent.run(eventId, EventType.credit, comandaId, initialBalance, 'Saldo inicial', createdAt);
    }
  });

  try {
    transaction();
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed: comandas.code')) {
      throw new DuplicateCodeError('Concurrent comanda creation conflict. Please retry.');
    }
    throw err;
  }

  return { comanda: { id: comandaId, code, holder_name: trimmedName, created_at: createdAt }, eventId };
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

module.exports = {
  getNextCode,
  createComanda,
  getComandaByCode,
  getBalance,
  getComandaEvents,
  MaxComandasReachedError,
  DuplicateCodeError,
};
