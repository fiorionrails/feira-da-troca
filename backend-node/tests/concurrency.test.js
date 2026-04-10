'use strict';

// Load .env BEFORE any module is required, so config.js captures the correct
// ADMIN_TOKEN instead of the fallback 'admin_token_change_me'.
require('dotenv').config();

/**
 * Concurrency tests — verifies that simultaneous debit_requests from multiple
 * store terminals never produce a negative balance or corrupt the event log.
 *
 * Node.js is single-threaded, but messages from different WebSocket connections
 * can arrive in rapid succession within the same event loop. SQLite's
 * db.transaction() serialises the balance-check + insert atomically, so
 * double-spends must be impossible regardless of arrival order.
 *
 * Helper note: the standard send() from ws.test.js uses ws.once('message'),
 * which would catch a balance_updated broadcast from a concurrent debit instead
 * of the socket's own debit response. waitForDebitResult() solves this by
 * filtering messages until debit_confirmed or debit_rejected arrives.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');

const { createTestDb } = require('./helpers/db');

// Override DB singleton BEFORE loading the app
const db0 = createTestDb();
require('../src/database')._overrideDb(db0);

const { server, wss } = require('../src/app');

let port;

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after((done) => {
  // Force-terminate any lingering WebSocket connections before closing the server,
  // otherwise wss.close() blocks waiting for clients to disconnect gracefully.
  for (const client of wss.clients) client.terminate();
  wss.close(() => server.close(done));
});

// ---------------------------------------------------------------------------
// DB helper
// ---------------------------------------------------------------------------

function useDb(seedFn) {
  before(() => {
    const db = createTestDb();
    if (seedFn) seedFn(db);
    require('../src/database')._overrideDb(db);
  });
}

// ---------------------------------------------------------------------------
// WebSocket helpers
// ---------------------------------------------------------------------------

function connectStore(token) {
  const url = `ws://127.0.0.1:${port}/ws/store?token=${encodeURIComponent(token)}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error('connectStore timeout')), 3000);
    ws.once('message', (data) => {
      clearTimeout(timer);
      try { resolve({ ws, connected: JSON.parse(data.toString()) }); }
      catch (e) { reject(e); }
    });
    ws.once('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

function closeWs(ws) {
  if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    ws.once('close', resolve);
    if (ws.readyState !== WebSocket.CLOSING) ws.close();
  });
}

/**
 * Wait for a debit_confirmed or debit_rejected message, skipping any
 * balance_updated broadcasts that arrive in between.
 * This is necessary in concurrent tests because a successful debit on another
 * connection triggers a balance_updated broadcast to ALL store sockets — it
 * would otherwise be mistaken for this socket's own debit response.
 */
function waitForDebitResult(ws, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timeout waiting for debit result')),
      timeout
    );
    const handler = (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); }
      catch (e) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        reject(e);
        return;
      }
      if (msg.type === 'debit_confirmed' || msg.type === 'debit_rejected') {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(msg);
      }
      // ignore balance_updated and any other broadcasts — keep waiting
    };
    ws.on('message', handler);
  });
}

/**
 * Standard single-message send — only safe when no concurrent activity on
 * the same socket could inject an unexpected broadcast between send and reply.
 */
function send(ws, msg) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS message timeout')), 3000);
    ws.once('message', (data) => {
      clearTimeout(timer);
      try { resolve(JSON.parse(data.toString())); }
      catch (e) { reject(e); }
    });
    ws.send(JSON.stringify(msg));
  });
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

function seedComanda(db, code, holder, balance) {
  const id = `cid-${code}`;
  db.prepare('INSERT INTO comandas (id, code, holder_name, created_at) VALUES (?,?,?,?)').run(
    id, code, holder, new Date().toISOString()
  );
  if (balance > 0) {
    db.prepare('INSERT INTO events (id, type, comanda_id, amount, note, timestamp) VALUES (?,?,?,?,?,?)').run(
      `eid-${code}`, 'credit', id, balance, 'Saldo inicial', new Date().toISOString()
    );
  }
  return id;
}

function seedStore(db, id, name, token) {
  db.prepare('INSERT INTO stores (id, name, theme, terminal_token) VALUES (?,?,?,?)').run(
    id, name, 'default', token
  );
  return id;
}

// ---------------------------------------------------------------------------
// Concurrency helpers
// ---------------------------------------------------------------------------

/** Connect N stores pre-seeded as store-1..N with tokens STR001..STRN. */
async function connectNStores(n) {
  return Promise.all(
    Array.from({ length: n }, (_, i) => connectStore(`STR00${i + 1}`))
  );
}

/** Close all sockets in an array. */
function closeAll(connections) {
  return Promise.all(connections.map(({ ws }) => closeWs(ws)));
}

// ============================================================================
// Concorrência — double-spend (2 lojas, saldo exato)
// ============================================================================
describe('Concorrência — double-spend: ambas debitam o saldo exato', () => {
  useDb((db) => {
    seedComanda(db, 'F001', 'Alice', 1000);
    seedStore(db, 'store-1', 'Loja 1', 'STR001');
    seedStore(db, 'store-2', 'Loja 2', 'STR002');
  });

  test('apenas uma loja confirma quando ambas debitam o saldo exato ao mesmo tempo', async () => {
    const [s1, s2] = await connectNStores(2);

    // Register both listeners BEFORE any send to avoid missing fast responses
    const p1 = waitForDebitResult(s1.ws);
    const p2 = waitForDebitResult(s2.ws);

    s1.ws.send(JSON.stringify({ type: 'debit_request', comanda_code: 'F001', amount: 1000 }));
    s2.ws.send(JSON.stringify({ type: 'debit_request', comanda_code: 'F001', amount: 1000 }));

    const [r1, r2] = await Promise.all([p1, p2]);

    const confirmed = [r1, r2].filter((r) => r.type === 'debit_confirmed');
    const rejected  = [r1, r2].filter((r) => r.type === 'debit_rejected');

    assert.strictEqual(confirmed.length, 1, 'exactly one debit must be confirmed');
    assert.strictEqual(rejected.length,  1, 'exactly one debit must be rejected');
    assert.strictEqual(rejected[0].reason, 'insufficient_balance');

    // Final balance must be 0, not negative
    const balanceReply = await send(s1.ws, { type: 'balance_query', comanda_code: 'F001' });
    assert.strictEqual(balanceReply.balance, 0);

    await closeAll([s1, s2]);
  });
});

describe('Concorrência — double-spend: new_balance da resposta bate com o banco', () => {
  useDb((db) => {
    seedComanda(db, 'F001', 'Alice', 1000);
    seedStore(db, 'store-1', 'Loja 1', 'STR001');
    seedStore(db, 'store-2', 'Loja 2', 'STR002');
  });

  test('o saldo confirmado da resposta bate com o saldo real após o double-spend', async () => {
    const [s1, s2] = await connectNStores(2);

    const p1 = waitForDebitResult(s1.ws);
    const p2 = waitForDebitResult(s2.ws);

    s1.ws.send(JSON.stringify({ type: 'debit_request', comanda_code: 'F001', amount: 600 }));
    s2.ws.send(JSON.stringify({ type: 'debit_request', comanda_code: 'F001', amount: 600 }));

    const [r1, r2] = await Promise.all([p1, p2]);

    const winner = [r1, r2].find((r) => r.type === 'debit_confirmed');
    assert.ok(winner, 'one debit must succeed');

    // The new_balance reported in the confirmation must match what the DB says
    const balanceReply = await send(s1.ws, { type: 'balance_query', comanda_code: 'F001' });
    assert.strictEqual(balanceReply.balance, winner.new_balance);

    await closeAll([s1, s2]);
  });
});

// ============================================================================
// Concorrência — bando de 5 lojas disputando saldo insuficiente
// ============================================================================
describe('Concorrência — 5 lojas disputando saldo insuficiente', () => {
  useDb((db) => {
    seedComanda(db, 'F001', 'Bob', 1000);
    for (let i = 1; i <= 5; i++) {
      seedStore(db, `store-${i}`, `Loja ${i}`, `STR00${i}`);
    }
  });

  test('saldo nunca fica negativo quando 5 lojas debitam 300 de um saldo de 1000', async () => {
    const stores = await connectNStores(5);

    const promises = stores.map(({ ws }) => {
      const p = waitForDebitResult(ws);
      ws.send(JSON.stringify({ type: 'debit_request', comanda_code: 'F001', amount: 300 }));
      return p;
    });
    const results = await Promise.all(promises);

    const confirmed = results.filter((r) => r.type === 'debit_confirmed');
    const rejected  = results.filter((r) => r.type === 'debit_rejected');

    // At most 3 can fit (3 × 300 = 900 ≤ 1000 < 1200 = 4 × 300)
    assert.ok(confirmed.length <= 3, `at most 3 debits of 300 fit in 1000 (got ${confirmed.length})`);
    assert.ok(confirmed.length + rejected.length === 5, 'every request must get a response');

    // All rejections must be due to insufficient balance, not server errors
    for (const r of rejected) {
      assert.strictEqual(r.reason, 'insufficient_balance');
    }

    // Sum of confirmed amounts must not exceed the initial balance
    const totalDebited = confirmed.reduce((sum, r) => sum + r.amount, 0);
    assert.ok(totalDebited <= 1000, `total debited (${totalDebited}) must not exceed initial balance`);

    // Final balance must equal initial minus total debited — never negative
    const balanceReply = await send(stores[0].ws, { type: 'balance_query', comanda_code: 'F001' });
    assert.strictEqual(balanceReply.balance, 1000 - totalDebited);
    assert.ok(balanceReply.balance >= 0, 'balance must never go negative');

    await closeAll(stores);
  });

  test('todas as respostas chegam — nenhuma loja fica sem resposta', async () => {
    const stores = await connectNStores(5);

    const promises = stores.map(({ ws }) => {
      const p = waitForDebitResult(ws);
      ws.send(JSON.stringify({ type: 'debit_request', comanda_code: 'F001', amount: 400 }));
      return p;
    });
    const results = await Promise.all(promises);

    assert.strictEqual(results.length, 5, 'all 5 stores must receive a response');
    for (const r of results) {
      assert.ok(
        r.type === 'debit_confirmed' || r.type === 'debit_rejected',
        `unexpected message type: ${r.type}`
      );
    }

    await closeAll(stores);
  });
});

// ============================================================================
// Concorrência — total cabe no saldo, todos devem ser confirmados
// ============================================================================
describe('Concorrência — total solicitado cabe no saldo', () => {
  useDb((db) => {
    seedComanda(db, 'F001', 'Carol', 5000);
    for (let i = 1; i <= 5; i++) {
      seedStore(db, `store-${i}`, `Loja ${i}`, `STR00${i}`);
    }
  });

  test('5 lojas debitam 200 cada em saldo de 5000 → todas confirmadas', async () => {
    const stores = await connectNStores(5);

    const promises = stores.map(({ ws }) => {
      const p = waitForDebitResult(ws);
      ws.send(JSON.stringify({ type: 'debit_request', comanda_code: 'F001', amount: 200 }));
      return p;
    });
    const results = await Promise.all(promises);

    const confirmed = results.filter((r) => r.type === 'debit_confirmed');
    assert.strictEqual(confirmed.length, 5, 'all 5 debits must be confirmed when total fits');

    const balanceReply = await send(stores[0].ws, { type: 'balance_query', comanda_code: 'F001' });
    assert.strictEqual(balanceReply.balance, 4000);

    await closeAll(stores);
  });
});

// ============================================================================
// Concorrência — integridade do log de eventos
// ============================================================================
describe('Concorrência — integridade do log de eventos', () => {
  useDb((db) => {
    seedComanda(db, 'F001', 'David', 1000);
    for (let i = 1; i <= 5; i++) {
      seedStore(db, `store-${i}`, `Loja ${i}`, `STR00${i}`);
    }
  });

  test('número de eventos de débito no banco = número de debit_confirmed recebidos', async () => {
    const stores = await connectNStores(5);

    const promises = stores.map(({ ws }) => {
      const p = waitForDebitResult(ws);
      ws.send(JSON.stringify({ type: 'debit_request', comanda_code: 'F001', amount: 300 }));
      return p;
    });
    const results = await Promise.all(promises);

    const confirmedCount = results.filter((r) => r.type === 'debit_confirmed').length;

    // Query the DB directly — only confirmed debits should generate events
    const db = require('../src/database').getDb();
    const { debit_count } = db.prepare(
      "SELECT COUNT(*) as debit_count FROM events WHERE type = 'debit'"
    ).get();

    assert.strictEqual(debit_count, confirmedCount,
      'every confirmed debit must have exactly one event in the log — no phantom events');

    await closeAll(stores);
  });

  test('event_id em debit_confirmed é único para cada transação', async () => {
    const stores = await connectNStores(5);

    const promises = stores.map(({ ws }) => {
      const p = waitForDebitResult(ws);
      ws.send(JSON.stringify({ type: 'debit_request', comanda_code: 'F001', amount: 200 }));
      return p;
    });
    const results = await Promise.all(promises);

    const eventIds = results
      .filter((r) => r.type === 'debit_confirmed')
      .map((r) => r.event_id);

    const uniqueIds = new Set(eventIds);
    assert.strictEqual(uniqueIds.size, eventIds.length,
      'each confirmed debit must have a distinct event_id');

    await closeAll(stores);
  });
});
