const { v4: uuidv4 } = require('uuid');
const { EventType } = require('../models');
const { getBalance } = require('./comandaService');
const { nowIso } = require('../utils');

class InsufficientBalanceError extends Error {}
class InvalidAmountError extends Error {}

function processDebit(db, comandaId, amount, storeId, note = null) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new InvalidAmountError('Debit amount must be a positive integer.');
  }

  const insertEvent = db.prepare(
    'INSERT INTO events (id, type, comanda_id, store_id, amount, note, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const doDebit = db.transaction(() => {
    const currentBalance = getBalance(db, comandaId);
    if (currentBalance < amount) {
      throw new InsufficientBalanceError(
        `Insufficient balance. Current: ${currentBalance}, Required: ${amount}`
      );
    }
    const eventId = uuidv4();
    const createdAt = nowIso();
    insertEvent.run(eventId, EventType.debit, comandaId, storeId, amount, note, createdAt);
    return db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  });

  return doDebit();
}

function processCredit(db, comandaId, amount, storeId = null, note = null) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new InvalidAmountError('Credit amount must be a positive integer.');
  }

  const eventId = uuidv4();
  const createdAt = nowIso();
  db.prepare(
    'INSERT INTO events (id, type, comanda_id, store_id, amount, note, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(eventId, EventType.credit, comandaId, storeId, amount, note, createdAt);

  return db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
}

module.exports = { processDebit, processCredit, InsufficientBalanceError, InvalidAmountError };
