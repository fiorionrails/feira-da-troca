'use strict';

/**
 * Unit tests for all service modules.
 *
 * Services receive a `db` parameter directly, so we pass a fresh in-memory
 * database to each describe block for full isolation.
 */

const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');

const { createTestDb } = require('./helpers/db');

const {
  getNextCode,
  createComanda,
  getComandaByCode,
  getBalance,
  getComandaEvents,
  MaxComandasReachedError,
  DuplicateCodeError,
} = require('../src/services/comandaService');

const {
  processCredit,
  processDebit,
  InsufficientBalanceError,
  InvalidAmountError,
} = require('../src/services/transactionService');

const {
  createOrUpdateCategory,
  getCategoryByName,
  listCategories,
} = require('../src/services/productService');

const { getStoreByToken } = require('../src/services/storeService');

// Helper: insert a store row directly
function insertStore(db, id = 's1', token = 'TOKEN1') {
  db.prepare('INSERT INTO stores (id, name, theme, terminal_token) VALUES (?,?,?,?)').run(
    id, 'Test Store', 'default', token
  );
}

// ---------------------------------------------------------------------------
// getNextCode
// ---------------------------------------------------------------------------
describe('getNextCode', () => {
  test('returns F001 on empty database', () => {
    assert.strictEqual(getNextCode(createTestDb()), 'F001');
  });

  test('increments from existing last code', () => {
    const db = createTestDb();
    createComanda(db, 'Alice', 0);
    assert.strictEqual(getNextCode(db), 'F002');
  });

  test('pads numbers below 3 digits', () => {
    const db = createTestDb();
    // Insert directly with a known code to avoid timestamp ordering ambiguity
    db.prepare('INSERT INTO comandas (id, code, holder_name, created_at) VALUES (?,?,?,?)').run(
      'x', 'F009', 'X', new Date().toISOString()
    );
    assert.strictEqual(getNextCode(db), 'F010');
  });

  test('goes beyond F999 without padding', () => {
    const db = createTestDb();
    db.prepare('INSERT INTO comandas (id, code, holder_name, created_at) VALUES (?,?,?,?)').run(
      'x', 'F999', 'X', new Date().toISOString()
    );
    assert.strictEqual(getNextCode(db), 'F1000');
  });

  test('falls back to F001 if most recent code is corrupted', () => {
    const db = createTestDb();
    db.prepare('INSERT INTO comandas (id, code, holder_name, created_at) VALUES (?,?,?,?)').run(
      'x', 'CORRUPTED', 'X', new Date().toISOString()
    );
    assert.strictEqual(getNextCode(db), 'F001');
  });
});

// ---------------------------------------------------------------------------
// createComanda
// ---------------------------------------------------------------------------
describe('createComanda', () => {
  test('creates comanda with positive initial balance and a credit event', () => {
    const db = createTestDb();
    const { comanda } = createComanda(db, 'João', 1000);
    assert.strictEqual(comanda.code, 'F001');
    assert.strictEqual(comanda.holder_name, 'João');
    assert.strictEqual(getBalance(db, comanda.id), 1000);
    const events = db.prepare("SELECT * FROM events WHERE comanda_id = ?").all(comanda.id);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'credit');
    assert.strictEqual(events[0].amount, 1000);
    assert.strictEqual(events[0].note, 'Saldo inicial');
  });

  test('creates comanda with initial_balance = 0 and NO credit event', () => {
    const db = createTestDb();
    const { comanda } = createComanda(db, 'Maria', 0);
    assert.strictEqual(getBalance(db, comanda.id), 0);
    const events = db.prepare('SELECT COUNT(*) as c FROM events').get().c;
    assert.strictEqual(events, 0);
  });

  test('trims whitespace from holder_name', () => {
    const db = createTestDb();
    const { comanda } = createComanda(db, '  Ana  ', 500);
    assert.strictEqual(comanda.holder_name, 'Ana');
  });

  test('assigns sequential codes', () => {
    const db = createTestDb();
    // Use direct inserts with deterministic timestamps to avoid timestamp-ordering flakiness
    const base = Date.now();
    db.prepare('INSERT INTO comandas (id, code, holder_name, created_at) VALUES (?,?,?,?)').run('c1', 'F001', 'A', new Date(base).toISOString());
    db.prepare('INSERT INTO comandas (id, code, holder_name, created_at) VALUES (?,?,?,?)').run('c2', 'F002', 'B', new Date(base + 1).toISOString());
    db.prepare('INSERT INTO comandas (id, code, holder_name, created_at) VALUES (?,?,?,?)').run('c3', 'F003', 'C', new Date(base + 2).toISOString());
    assert.strictEqual(getNextCode(db), 'F004');
  });

  test('throws if holder_name is empty string', () => {
    assert.throws(() => createComanda(createTestDb(), '', 0), /holder_name is required/);
  });

  test('throws if holder_name is only whitespace', () => {
    assert.throws(() => createComanda(createTestDb(), '   ', 0), /holder_name is required/);
  });

  test('throws if initial_balance is negative', () => {
    assert.throws(() => createComanda(createTestDb(), 'X', -1), /non-negative integer/);
  });

  test('throws if initial_balance is a float', () => {
    assert.throws(() => createComanda(createTestDb(), 'X', 1.5), /non-negative integer/);
  });

  test('throws if initial_balance is NaN', () => {
    assert.throws(() => createComanda(createTestDb(), 'X', NaN), /non-negative integer/);
  });

  test('throws MaxComandasReachedError when limit is reached', () => {
    const db = createTestDb();
    const config = require('../src/config');
    const orig = config.maxComandas;
    config.maxComandas = 2;
    try {
      createComanda(db, 'A', 0);
      createComanda(db, 'B', 0);
      assert.throws(() => createComanda(db, 'C', 0), MaxComandasReachedError);
    } finally {
      config.maxComandas = orig;
    }
  });
});

// ---------------------------------------------------------------------------
// getComandaByCode
// ---------------------------------------------------------------------------
describe('getComandaByCode', () => {
  test('returns comanda for a known code', () => {
    const db = createTestDb();
    createComanda(db, 'Bob', 500);
    const c = getComandaByCode(db, 'F001');
    assert.ok(c);
    assert.strictEqual(c.holder_name, 'Bob');
    assert.strictEqual(c.code, 'F001');
  });

  test('returns null for unknown code', () => {
    assert.strictEqual(getComandaByCode(createTestDb(), 'ZZZZ'), null);
  });

  test('returns null for empty DB', () => {
    assert.strictEqual(getComandaByCode(createTestDb(), 'F001'), null);
  });
});

// ---------------------------------------------------------------------------
// getBalance
// ---------------------------------------------------------------------------
describe('getBalance', () => {
  test('returns 0 for a comanda with no events', () => {
    const db = createTestDb();
    db.prepare('INSERT INTO comandas (id, code, holder_name, created_at) VALUES (?,?,?,?)').run(
      'x', 'F001', 'X', new Date().toISOString()
    );
    assert.strictEqual(getBalance(db, 'x'), 0);
  });

  test('returns initial balance after creation', () => {
    const db = createTestDb();
    const { comanda } = createComanda(db, 'T', 2000);
    assert.strictEqual(getBalance(db, comanda.id), 2000);
  });

  test('reflects debits correctly', () => {
    const db = createTestDb();
    insertStore(db);
    const { comanda } = createComanda(db, 'T', 1000);
    processDebit(db, comanda.id, 300, 's1');
    assert.strictEqual(getBalance(db, comanda.id), 700);
  });

  test('reflects multiple credits and debits', () => {
    const db = createTestDb();
    insertStore(db);
    const { comanda } = createComanda(db, 'T', 1000);
    processCredit(db, comanda.id, 500, null, 'extra');
    processDebit(db, comanda.id, 200, 's1');
    processDebit(db, comanda.id, 100, 's1');
    assert.strictEqual(getBalance(db, comanda.id), 1200);
  });

  test('returns 0 for non-existent comanda id', () => {
    assert.strictEqual(getBalance(createTestDb(), 'nonexistent-id'), 0);
  });
});

// ---------------------------------------------------------------------------
// getComandaEvents
// ---------------------------------------------------------------------------
describe('getComandaEvents', () => {
  test('returns events in chronological order', () => {
    const db = createTestDb();
    insertStore(db);
    const { comanda } = createComanda(db, 'T', 1000);
    processCredit(db, comanda.id, 500, null, 'extra');
    processDebit(db, comanda.id, 200, 's1');
    const events = getComandaEvents(db, comanda.id);
    assert.strictEqual(events.length, 3);
    assert.strictEqual(events[0].type, 'credit');
    assert.strictEqual(events[1].type, 'credit');
    assert.strictEqual(events[2].type, 'debit');
  });

  test('returns empty array for comanda with no events', () => {
    const db = createTestDb();
    db.prepare('INSERT INTO comandas (id, code, holder_name, created_at) VALUES (?,?,?,?)').run(
      'x', 'F001', 'X', new Date().toISOString()
    );
    assert.deepStrictEqual(getComandaEvents(db, 'x'), []);
  });
});

// ---------------------------------------------------------------------------
// processCredit
// ---------------------------------------------------------------------------
describe('processCredit', () => {
  test('inserts a credit event and increases balance', () => {
    const db = createTestDb();
    const { comanda } = createComanda(db, 'T', 0);
    const event = processCredit(db, comanda.id, 500, null, 'Test');
    assert.ok(event);
    assert.strictEqual(event.type, 'credit');
    assert.strictEqual(event.amount, 500);
    assert.strictEqual(getBalance(db, comanda.id), 500);
  });

  test('throws InvalidAmountError for zero', () => {
    const db = createTestDb();
    const { comanda } = createComanda(db, 'T', 0);
    assert.throws(() => processCredit(db, comanda.id, 0), InvalidAmountError);
  });

  test('throws InvalidAmountError for negative amount', () => {
    const db = createTestDb();
    const { comanda } = createComanda(db, 'T', 0);
    assert.throws(() => processCredit(db, comanda.id, -100), InvalidAmountError);
  });

  test('throws InvalidAmountError for float', () => {
    const db = createTestDb();
    const { comanda } = createComanda(db, 'T', 0);
    assert.throws(() => processCredit(db, comanda.id, 1.5), InvalidAmountError);
  });

  test('does not modify balance when it throws', () => {
    const db = createTestDb();
    const { comanda } = createComanda(db, 'T', 100);
    assert.throws(() => processCredit(db, comanda.id, -50), InvalidAmountError);
    assert.strictEqual(getBalance(db, comanda.id), 100);
  });
});

// ---------------------------------------------------------------------------
// processDebit
// ---------------------------------------------------------------------------
describe('processDebit', () => {
  test('inserts a debit event and decreases balance', () => {
    const db = createTestDb();
    insertStore(db);
    const { comanda } = createComanda(db, 'T', 1000);
    const event = processDebit(db, comanda.id, 300, 's1');
    assert.ok(event);
    assert.strictEqual(event.type, 'debit');
    assert.strictEqual(event.amount, 300);
    assert.strictEqual(event.store_id, 's1');
    assert.strictEqual(getBalance(db, comanda.id), 700);
  });

  test('allows debit for exact balance (drains to zero)', () => {
    const db = createTestDb();
    insertStore(db);
    const { comanda } = createComanda(db, 'T', 500);
    processDebit(db, comanda.id, 500, 's1');
    assert.strictEqual(getBalance(db, comanda.id), 0);
  });

  test('throws InsufficientBalanceError when balance is too low', () => {
    const db = createTestDb();
    insertStore(db);
    const { comanda } = createComanda(db, 'T', 200);
    assert.throws(() => processDebit(db, comanda.id, 500, 's1'), InsufficientBalanceError);
  });

  test('does not modify balance when InsufficientBalanceError is thrown', () => {
    const db = createTestDb();
    insertStore(db);
    const { comanda } = createComanda(db, 'T', 200);
    assert.throws(() => processDebit(db, comanda.id, 500, 's1'), InsufficientBalanceError);
    assert.strictEqual(getBalance(db, comanda.id), 200);
  });

  test('throws InsufficientBalanceError when balance is zero', () => {
    const db = createTestDb();
    insertStore(db);
    const { comanda } = createComanda(db, 'T', 0);
    assert.throws(() => processDebit(db, comanda.id, 1, 's1'), InsufficientBalanceError);
  });

  test('throws InvalidAmountError for zero amount', () => {
    const db = createTestDb();
    insertStore(db);
    const { comanda } = createComanda(db, 'T', 1000);
    assert.throws(() => processDebit(db, comanda.id, 0, 's1'), InvalidAmountError);
  });

  test('throws InvalidAmountError for negative amount', () => {
    const db = createTestDb();
    insertStore(db);
    const { comanda } = createComanda(db, 'T', 1000);
    assert.throws(() => processDebit(db, comanda.id, -100, 's1'), InvalidAmountError);
  });

  test('throws InvalidAmountError for float amount', () => {
    const db = createTestDb();
    insertStore(db);
    const { comanda } = createComanda(db, 'T', 1000);
    assert.throws(() => processDebit(db, comanda.id, 1.5, 's1'), InvalidAmountError);
  });
});

// ---------------------------------------------------------------------------
// createOrUpdateCategory
// ---------------------------------------------------------------------------
describe('createOrUpdateCategory', () => {
  test('creates a new category with price and entries', () => {
    const db = createTestDb();
    const cat = createOrUpdateCategory(db, 'Jaqueta', 1500, 10);
    assert.strictEqual(cat.name, 'Jaqueta');
    assert.strictEqual(cat.price, 1500);
    assert.strictEqual(cat.total_entries, 10);
    assert.strictEqual(cat.total_exits, 0);
  });

  test('creates category with zero entries', () => {
    const db = createTestDb();
    const cat = createOrUpdateCategory(db, 'Camiseta', 800, 0);
    assert.strictEqual(cat.total_entries, 0);
  });

  test('updates price when new price > 0', () => {
    const db = createTestDb();
    createOrUpdateCategory(db, 'Jaqueta', 1500, 0);
    const updated = createOrUpdateCategory(db, 'Jaqueta', 2000, 5);
    assert.strictEqual(updated.price, 2000);
    assert.strictEqual(updated.total_entries, 5);
  });

  test('does NOT update price when new price = 0', () => {
    const db = createTestDb();
    createOrUpdateCategory(db, 'Jaqueta', 1500, 0);
    const updated = createOrUpdateCategory(db, 'Jaqueta', 0, 5);
    assert.strictEqual(updated.price, 1500);
    assert.strictEqual(updated.total_entries, 5);
  });

  test('increments total_entries cumulatively', () => {
    const db = createTestDb();
    createOrUpdateCategory(db, 'Jaqueta', 1500, 3);
    createOrUpdateCategory(db, 'Jaqueta', 0, 2);
    createOrUpdateCategory(db, 'Jaqueta', 0, 7);
    const cat = getCategoryByName(db, 'Jaqueta');
    assert.strictEqual(cat.total_entries, 12);
  });
});

// ---------------------------------------------------------------------------
// getCategoryByName
// ---------------------------------------------------------------------------
describe('getCategoryByName', () => {
  test('returns the category for a known name', () => {
    const db = createTestDb();
    createOrUpdateCategory(db, 'Bolsa', 1200, 0);
    const cat = getCategoryByName(db, 'Bolsa');
    assert.ok(cat);
    assert.strictEqual(cat.price, 1200);
  });

  test('returns null for unknown name', () => {
    assert.strictEqual(getCategoryByName(createTestDb(), 'Inexistente'), null);
  });
});

// ---------------------------------------------------------------------------
// listCategories
// ---------------------------------------------------------------------------
describe('listCategories', () => {
  test('returns empty array for empty DB', () => {
    assert.deepStrictEqual(listCategories(createTestDb()), []);
  });

  test('returns categories sorted alphabetically', () => {
    const db = createTestDb();
    createOrUpdateCategory(db, 'Jaqueta', 1500, 0);
    createOrUpdateCategory(db, 'Bolsa', 1200, 0);
    createOrUpdateCategory(db, 'Camiseta', 800, 0);
    const cats = listCategories(db);
    assert.strictEqual(cats[0].name, 'Bolsa');
    assert.strictEqual(cats[1].name, 'Camiseta');
    assert.strictEqual(cats[2].name, 'Jaqueta');
  });
});

// ---------------------------------------------------------------------------
// getStoreByToken
// ---------------------------------------------------------------------------
describe('getStoreByToken', () => {
  test('returns store for a valid token', () => {
    const db = createTestDb();
    db.prepare('INSERT INTO stores (id, name, theme, terminal_token) VALUES (?,?,?,?)').run(
      's1', 'Loja A', 'default', 'ABC123'
    );
    const store = getStoreByToken(db, 'ABC123');
    assert.ok(store);
    assert.strictEqual(store.name, 'Loja A');
    assert.strictEqual(store.id, 's1');
  });

  test('returns null for unknown token', () => {
    assert.strictEqual(getStoreByToken(createTestDb(), 'XXXXXX'), null);
  });

  test('returns null for empty DB', () => {
    assert.strictEqual(getStoreByToken(createTestDb(), 'TOKEN'), null);
  });
});
