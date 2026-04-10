'use strict';

// Load .env BEFORE any module is required, so config.js captures the correct
// ADMIN_TOKEN instead of the fallback 'admin_token_change_me'.
require('dotenv').config();

/**
 * WebSocket integration tests — covers both /ws/admin and /ws/store channels.
 *
 * The HTTP server is started on a random port once for the whole file.
 * The DB singleton is overridden before loading the app and can be swapped
 * between describe blocks using `useDb()`.
 */

const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');

const { createTestDb } = require('./helpers/db');

// Override DB singleton BEFORE loading the app
const db0 = createTestDb();
require('../src/database')._overrideDb(db0);

const { server, wss } = require('../src/app');

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin_token_change_me';
const WRONG_TOKEN = 'wrong-token-xyz';

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

/**
 * Wait for the next message on the socket.
 * The listener is registered synchronously when this function is called,
 * so call this BEFORE sending the triggering message to avoid race conditions.
 */
function waitForMessage(ws, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS message timeout')), timeout);
    ws.once('message', (data) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(data.toString()));
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * Collect up to `count` messages or wait `timeout` ms, whichever comes first.
 * Call this BEFORE the action that triggers the messages.
 */
function collectMessages(ws, count, timeout = 2000) {
  return new Promise((resolve) => {
    const msgs = [];
    const finish = () => resolve(msgs);
    const timer = setTimeout(finish, timeout);
    const handler = (data) => {
      try { msgs.push(JSON.parse(data.toString())); } catch {}
      if (msgs.length >= count) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        finish();
      }
    };
    ws.on('message', handler);
  });
}

/**
 * Create a WebSocket and wait for the first message (the server greeting).
 * The 'message' listener is registered before any I/O can fire, avoiding the
 * race condition where the greeting arrives before the listener is attached.
 */
function connectAdmin(token = ADMIN_TOKEN) {
  const url = `ws://127.0.0.1:${port}/ws/admin?token=${encodeURIComponent(token)}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error('connectAdmin timeout')), 3000);
    ws.once('message', (data) => {
      clearTimeout(timer);
      try {
        resolve({ ws, connected: JSON.parse(data.toString()) });
      } catch (e) {
        reject(e);
      }
    });
    ws.once('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

function connectStore(token) {
  const url = `ws://127.0.0.1:${port}/ws/store?token=${encodeURIComponent(token)}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error('connectStore timeout')), 3000);
    ws.once('message', (data) => {
      clearTimeout(timer);
      try {
        resolve({ ws, connected: JSON.parse(data.toString()) });
      } catch (e) {
        reject(e);
      }
    });
    ws.once('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/** Close a WS and wait for the close event. */
function closeWs(ws) {
  if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    ws.once('close', resolve);
    if (ws.readyState !== WebSocket.CLOSING) ws.close();
  });
}

/** Wait for the server to close a connection (close code arrives on client). */
function waitForClose(ws, timeout = 3000) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.CLOSED) { resolve({ code: ws._closeCode }); return; }
    const timer = setTimeout(() => reject(new Error('WS close timeout')), timeout);
    ws.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

/**
 * Register the reply listener FIRST, then send, to avoid losing a fast response.
 */
async function send(ws, msg) {
  const reply = waitForMessage(ws);  // listener registered before sending
  ws.send(JSON.stringify(msg));
  return reply;
}

// Seed helpers
function seedComanda(db, code = 'F001', holder = 'Test User', balance = 5000) {
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

function seedStore(db, id = 'store-1', name = 'Test Store', token = 'STRTK1') {
  db.prepare('INSERT INTO stores (id, name, theme, terminal_token) VALUES (?,?,?,?)').run(
    id, name, 'default', token
  );
  return id;
}

// ============================================================================
// Admin WebSocket — authentication
// ============================================================================
describe('Admin WS — authentication', () => {
  useDb();

  test('connects successfully with valid admin token', async () => {
    const { ws, connected } = await connectAdmin();
    assert.strictEqual(connected.type, 'connected');
    assert.strictEqual(connected.role, 'admin');
    assert.ok(typeof connected.next_code === 'string');
    await closeWs(ws);
  });

  test('server closes with code 1008 for invalid token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/admin?token=${WRONG_TOKEN}`);
    const { code } = await waitForClose(ws);
    assert.strictEqual(code, 1008);
  });

  test('server closes with code 1008 for missing token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/admin`);
    const { code } = await waitForClose(ws);
    assert.strictEqual(code, 1008);
  });

  test('next_code is F001 on empty DB', async () => {
    const { ws, connected } = await connectAdmin();
    assert.strictEqual(connected.next_code, 'F001');
    await closeWs(ws);
  });
});

// ============================================================================
// Admin WS — create_comanda
// ============================================================================
describe('Admin WS — create_comanda', () => {
  useDb();

  test('creates comanda with positive balance → receives comanda_created + update_next_code', async () => {
    const { ws } = await connectAdmin();

    const broadcast = collectMessages(ws, 2);
    ws.send(JSON.stringify({ type: 'create_comanda', holder_name: 'Maria', initial_balance: 1000 }));
    const msgs = await broadcast;

    const created = msgs.find((m) => m.type === 'comanda_created');
    const nextCode = msgs.find((m) => m.type === 'update_next_code');

    assert.ok(created, 'should receive comanda_created');
    assert.strictEqual(created.holder_name, 'Maria');
    assert.strictEqual(created.balance, 1000);
    assert.match(created.code, /^F\d+$/);

    assert.ok(nextCode, 'should receive update_next_code');
    assert.match(nextCode.next_code, /^F\d+$/);

    await closeWs(ws);
  });

  test('creates comanda with balance = 0 → balance in message is 0', async () => {
    const { ws } = await connectAdmin();
    const broadcast = collectMessages(ws, 2);
    ws.send(JSON.stringify({ type: 'create_comanda', holder_name: 'Zero', initial_balance: 0 }));
    const msgs = await broadcast;
    const created = msgs.find((m) => m.type === 'comanda_created');
    assert.ok(created);
    assert.strictEqual(created.balance, 0);
    await closeWs(ws);
  });

  test('creates comanda when initial_balance is absent (defaults to 0)', async () => {
    const { ws } = await connectAdmin();
    const broadcast = collectMessages(ws, 2);
    ws.send(JSON.stringify({ type: 'create_comanda', holder_name: 'NoBalance' }));
    const msgs = await broadcast;
    const created = msgs.find((m) => m.type === 'comanda_created');
    assert.ok(created);
    assert.strictEqual(created.balance, 0);
    await closeWs(ws);
  });

  test('rejects empty holder_name → error: holder_name is required', async () => {
    const { ws } = await connectAdmin();
    const reply = await send(ws, { type: 'create_comanda', holder_name: '', initial_balance: 500 });
    assert.strictEqual(reply.type, 'error');
    assert.strictEqual(reply.reason, 'holder_name is required');
    await closeWs(ws);
  });

  test('rejects whitespace-only holder_name', async () => {
    const { ws } = await connectAdmin();
    const reply = await send(ws, { type: 'create_comanda', holder_name: '   ', initial_balance: 500 });
    assert.strictEqual(reply.type, 'error');
    assert.strictEqual(reply.reason, 'holder_name is required');
    await closeWs(ws);
  });

  test('rejects float initial_balance → error: invalid_amount', async () => {
    const { ws } = await connectAdmin();
    const reply = await send(ws, { type: 'create_comanda', holder_name: 'X', initial_balance: 1.5 });
    assert.strictEqual(reply.type, 'error');
    assert.strictEqual(reply.reason, 'invalid_amount');
    await closeWs(ws);
  });

  test('rejects negative initial_balance → error: invalid_amount', async () => {
    const { ws } = await connectAdmin();
    const reply = await send(ws, { type: 'create_comanda', holder_name: 'X', initial_balance: -10 });
    assert.strictEqual(reply.type, 'error');
    assert.strictEqual(reply.reason, 'invalid_amount');
    await closeWs(ws);
  });

  test('cart_items with valid entries increment category total_entries', async () => {
    const { ws } = await connectAdmin();
    const broadcast = collectMessages(ws, 2);
    ws.send(JSON.stringify({
      type: 'create_comanda',
      holder_name: 'CartTest',
      initial_balance: 500,
      cart_items: [{ name: 'Jaqueta', quantity: 3 }],
    }));
    await broadcast;
    // Verify the category was created/updated in DB
    const db = require('../src/database').getDb();
    const cat = db.prepare('SELECT * FROM categories WHERE name = ?').get('Jaqueta');
    assert.ok(cat, 'category Jaqueta should exist');
    assert.ok(cat.total_entries >= 3);
    await closeWs(ws);
  });

  test('cart_items with invalid quantity are silently ignored', async () => {
    const { ws } = await connectAdmin();
    const broadcast = collectMessages(ws, 2);
    ws.send(JSON.stringify({
      type: 'create_comanda',
      holder_name: 'BadCart',
      initial_balance: 500,
      cart_items: [{ name: 'Item', quantity: 'not-a-number' }],
    }));
    const msgs = await broadcast;
    // Should still succeed
    assert.ok(msgs.find((m) => m.type === 'comanda_created'));
    await closeWs(ws);
  });
});

// ============================================================================
// Admin WS — add_credit
// ============================================================================
describe('Admin WS — add_credit', () => {
  useDb((db) => {
    seedComanda(db, 'F001', 'Alice', 1000);
  });

  test('adds credit to existing comanda → credit_confirmed broadcast', async () => {
    const { ws } = await connectAdmin();
    const reply = await send(ws, { type: 'add_credit', comanda_code: 'F001', amount: 500 });
    assert.strictEqual(reply.type, 'credit_confirmed');
    assert.strictEqual(reply.code, 'F001');
    assert.strictEqual(reply.amount, 500);
    assert.strictEqual(reply.new_balance, 1500);
    await closeWs(ws);
  });

  test('accepts lowercase comanda_code (normalizes to uppercase)', async () => {
    const { ws } = await connectAdmin();
    const reply = await send(ws, { type: 'add_credit', comanda_code: 'f001', amount: 100 });
    assert.strictEqual(reply.type, 'credit_confirmed');
    await closeWs(ws);
  });

  test('rejects missing comanda_code → error: comanda_code is required', async () => {
    const { ws } = await connectAdmin();
    const reply = await send(ws, { type: 'add_credit', amount: 500 });
    assert.strictEqual(reply.type, 'error');
    assert.strictEqual(reply.reason, 'comanda_code is required');
    await closeWs(ws);
  });

  test('rejects zero amount → error: invalid_amount', async () => {
    const { ws } = await connectAdmin();
    const reply = await send(ws, { type: 'add_credit', comanda_code: 'F001', amount: 0 });
    assert.strictEqual(reply.type, 'error');
    assert.strictEqual(reply.reason, 'invalid_amount');
    await closeWs(ws);
  });

  test('rejects negative amount', async () => {
    const { ws } = await connectAdmin();
    const reply = await send(ws, { type: 'add_credit', comanda_code: 'F001', amount: -100 });
    assert.strictEqual(reply.type, 'error');
    assert.strictEqual(reply.reason, 'invalid_amount');
    await closeWs(ws);
  });

  test('rejects float amount', async () => {
    const { ws } = await connectAdmin();
    const reply = await send(ws, { type: 'add_credit', comanda_code: 'F001', amount: 1.5 });
    assert.strictEqual(reply.type, 'error');
    assert.strictEqual(reply.reason, 'invalid_amount');
    await closeWs(ws);
  });

  test('rejects non-existent comanda → error: comanda_not_found', async () => {
    const { ws } = await connectAdmin();
    const reply = await send(ws, { type: 'add_credit', comanda_code: 'ZZZZ', amount: 100 });
    assert.strictEqual(reply.type, 'error');
    assert.strictEqual(reply.reason, 'comanda_not_found');
    await closeWs(ws);
  });
});

// ============================================================================
// Admin WS — register_category
// ============================================================================
describe('Admin WS — register_category', () => {
  useDb();

  test('creates a new category → category_updated broadcast', async () => {
    const { ws } = await connectAdmin();
    const reply = await send(ws, { type: 'register_category', name: 'Bolsa', price: 1200, total_entries: 5 });
    assert.strictEqual(reply.type, 'category_updated');
    assert.ok(reply.category);
    assert.strictEqual(reply.category.name, 'Bolsa');
    assert.strictEqual(reply.category.price, 1200);
    assert.strictEqual(reply.category.total_entries, 5);
    await closeWs(ws);
  });

  test('updates existing category price', async () => {
    const { ws } = await connectAdmin();
    await send(ws, { type: 'register_category', name: 'Sapato', price: 800, total_entries: 0 });
    const reply = await send(ws, { type: 'register_category', name: 'Sapato', price: 1000, total_entries: 2 });
    assert.strictEqual(reply.type, 'category_updated');
    assert.strictEqual(reply.category.price, 1000);
    assert.strictEqual(reply.category.total_entries, 2);
    await closeWs(ws);
  });

  test('price = 0 does not update existing price (only entries)', async () => {
    const { ws } = await connectAdmin();
    await send(ws, { type: 'register_category', name: 'Calca', price: 700, total_entries: 0 });
    const reply = await send(ws, { type: 'register_category', name: 'Calca', price: 0, total_entries: 3 });
    assert.strictEqual(reply.category.price, 700); // unchanged
    assert.strictEqual(reply.category.total_entries, 3);
    await closeWs(ws);
  });

  test('rejects missing name → error: category name is required', async () => {
    const { ws } = await connectAdmin();
    const reply = await send(ws, { type: 'register_category', price: 500 });
    assert.strictEqual(reply.type, 'error');
    assert.strictEqual(reply.reason, 'category name is required');
    await closeWs(ws);
  });

  test('rejects float price → error: invalid_amount', async () => {
    const { ws } = await connectAdmin();
    const reply = await send(ws, { type: 'register_category', name: 'X', price: 1.5 });
    assert.strictEqual(reply.type, 'error');
    assert.strictEqual(reply.reason, 'invalid_amount');
    await closeWs(ws);
  });

  test('rejects negative price → error: invalid_amount', async () => {
    const { ws } = await connectAdmin();
    const reply = await send(ws, { type: 'register_category', name: 'X', price: -100 });
    assert.strictEqual(reply.type, 'error');
    assert.strictEqual(reply.reason, 'invalid_amount');
    await closeWs(ws);
  });

  test('rejects float total_entries → error: invalid_amount', async () => {
    const { ws } = await connectAdmin();
    const reply = await send(ws, { type: 'register_category', name: 'X', price: 100, total_entries: 1.5 });
    assert.strictEqual(reply.type, 'error');
    assert.strictEqual(reply.reason, 'invalid_amount');
    await closeWs(ws);
  });
});

// ============================================================================
// Admin WS — invalid / unknown messages
// ============================================================================
describe('Admin WS — malformed messages', () => {
  useDb();

  test('invalid JSON is silently ignored (no crash, no response)', async () => {
    const { ws } = await connectAdmin();
    // Send invalid JSON; wait briefly to confirm no message comes back
    ws.send('{ this is not json }');
    const result = await Promise.race([
      waitForMessage(ws).then(() => 'got-message'),
      new Promise((r) => setTimeout(() => r('timeout'), 300)),
    ]);
    assert.strictEqual(result, 'timeout', 'should not receive a response for invalid JSON');
    await closeWs(ws);
  });

  test('unknown message type returns error: unknown_message_type', async () => {
    const { ws } = await connectAdmin();
    const reply = await send(ws, { type: 'unknown_type', foo: 'bar' });
    assert.strictEqual(reply.type, 'error');
    assert.strictEqual(reply.reason, 'unknown_message_type');
    await closeWs(ws);
  });
});

// ============================================================================
// Admin WS — broadcast to multiple clients
// ============================================================================
describe('Admin WS — broadcasts to all connected admins', () => {
  useDb();

  test('comanda_created is broadcast to a second admin terminal', async () => {
    const { ws: ws1 } = await connectAdmin();
    const { ws: ws2 } = await connectAdmin();

    const ws2Msg = waitForMessage(ws2);
    ws1.send(JSON.stringify({ type: 'create_comanda', holder_name: 'BroadcastTest', initial_balance: 100 }));

    const msg = await ws2Msg;
    // ws2 should receive comanda_created or update_next_code
    assert.ok(msg.type === 'comanda_created' || msg.type === 'update_next_code');

    await closeWs(ws1);
    await closeWs(ws2);
  });
});

// ============================================================================
// Store WS — authentication
// ============================================================================
describe('Store WS — authentication', () => {
  useDb((db) => {
    seedStore(db, 'store-1', 'My Store', 'STRTK1');
  });

  test('connects successfully with valid store token', async () => {
    const { ws, connected } = await connectStore('STRTK1');
    assert.strictEqual(connected.type, 'connected');
    assert.strictEqual(connected.store_id, 'store-1');
    assert.strictEqual(connected.store_name, 'My Store');
    assert.ok(connected.server_time);
    await closeWs(ws);
  });

  test('server closes with code 1008 for invalid token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/store?token=BADTOKEN`);
    const { code } = await waitForClose(ws);
    assert.strictEqual(code, 1008);
  });

  test('server closes with code 1008 for missing token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/store`);
    const { code } = await waitForClose(ws);
    assert.strictEqual(code, 1008);
  });
});

// ============================================================================
// Store WS — balance_query
// ============================================================================
describe('Store WS — balance_query', () => {
  useDb((db) => {
    seedComanda(db, 'F001', 'João Silva', 1350);
    seedStore(db, 'store-1', 'My Store', 'STRTK1');
  });

  test('returns balance_response for a known comanda', async () => {
    const { ws } = await connectStore('STRTK1');
    const reply = await send(ws, { type: 'balance_query', comanda_code: 'F001' });
    assert.strictEqual(reply.type, 'balance_response');
    assert.strictEqual(reply.comanda_code, 'F001');
    assert.strictEqual(reply.holder_name, 'João Silva');
    assert.strictEqual(reply.balance, 1350);
    await closeWs(ws);
  });

  test('normalizes comanda_code to uppercase', async () => {
    const { ws } = await connectStore('STRTK1');
    const reply = await send(ws, { type: 'balance_query', comanda_code: 'f001' });
    assert.strictEqual(reply.type, 'balance_response');
    assert.strictEqual(reply.comanda_code, 'F001');
    await closeWs(ws);
  });

  test('trims whitespace from comanda_code', async () => {
    const { ws } = await connectStore('STRTK1');
    const reply = await send(ws, { type: 'balance_query', comanda_code: '  F001  ' });
    assert.strictEqual(reply.type, 'balance_response');
    await closeWs(ws);
  });

  test('returns error comanda_not_found for unknown code', async () => {
    const { ws } = await connectStore('STRTK1');
    const reply = await send(ws, { type: 'balance_query', comanda_code: 'ZZZZ' });
    assert.strictEqual(reply.type, 'error');
    assert.strictEqual(reply.reason, 'comanda_not_found');
    await closeWs(ws);
  });

  test('returns error comanda_not_found for empty comanda_code', async () => {
    const { ws } = await connectStore('STRTK1');
    const reply = await send(ws, { type: 'balance_query', comanda_code: '' });
    assert.strictEqual(reply.type, 'error');
    assert.strictEqual(reply.reason, 'comanda_not_found');
    await closeWs(ws);
  });
});

// ============================================================================
// Store WS — debit_request
// ============================================================================
describe('Store WS — debit_request', () => {
  useDb((db) => {
    seedComanda(db, 'F001', 'Alice', 2000);
    seedStore(db, 'store-1', 'My Store', 'STRTK1');
  });

  test('successful debit returns debit_confirmed with new balance', async () => {
    const { ws } = await connectStore('STRTK1');
    const reply = await send(ws, { type: 'debit_request', comanda_code: 'F001', amount: 600 });
    assert.strictEqual(reply.type, 'debit_confirmed');
    assert.strictEqual(reply.comanda_code, 'F001');
    assert.strictEqual(reply.holder_name, 'Alice');
    assert.strictEqual(reply.amount, 600);
    assert.strictEqual(reply.new_balance, 1400);
    assert.ok(reply.event_id);
    await closeWs(ws);
  });

  test('accepts lowercase comanda_code', async () => {
    const { ws } = await connectStore('STRTK1');
    const reply = await send(ws, { type: 'debit_request', comanda_code: 'f001', amount: 100 });
    assert.strictEqual(reply.type, 'debit_confirmed');
    await closeWs(ws);
  });

  test('insufficient balance returns debit_rejected with current_balance', async () => {
    const { ws } = await connectStore('STRTK1');
    const reply = await send(ws, { type: 'debit_request', comanda_code: 'F001', amount: 99999 });
    assert.strictEqual(reply.type, 'debit_rejected');
    assert.strictEqual(reply.reason, 'insufficient_balance');
    assert.ok(typeof reply.current_balance === 'number');
    assert.strictEqual(reply.requested, 99999);
    await closeWs(ws);
  });

  test('insufficient balance does NOT persist an event (balance unchanged)', async () => {
    const { ws } = await connectStore('STRTK1');
    // Query balance before
    const before = await send(ws, { type: 'balance_query', comanda_code: 'F001' });
    // Attempt debit over balance
    await send(ws, { type: 'debit_request', comanda_code: 'F001', amount: before.balance + 1 });
    // Query balance after
    const after = await send(ws, { type: 'balance_query', comanda_code: 'F001' });
    assert.strictEqual(before.balance, after.balance);
    await closeWs(ws);
  });

  test('unknown comanda returns debit_rejected: comanda_not_found', async () => {
    const { ws } = await connectStore('STRTK1');
    const reply = await send(ws, { type: 'debit_request', comanda_code: 'ZZZZ', amount: 100 });
    assert.strictEqual(reply.type, 'debit_rejected');
    assert.strictEqual(reply.reason, 'comanda_not_found');
    await closeWs(ws);
  });

  test('zero amount returns debit_rejected: invalid_amount', async () => {
    const { ws } = await connectStore('STRTK1');
    const reply = await send(ws, { type: 'debit_request', comanda_code: 'F001', amount: 0 });
    assert.strictEqual(reply.type, 'debit_rejected');
    assert.strictEqual(reply.reason, 'invalid_amount');
    await closeWs(ws);
  });

  test('negative amount returns debit_rejected: invalid_amount', async () => {
    const { ws } = await connectStore('STRTK1');
    const reply = await send(ws, { type: 'debit_request', comanda_code: 'F001', amount: -50 });
    assert.strictEqual(reply.type, 'debit_rejected');
    assert.strictEqual(reply.reason, 'invalid_amount');
    await closeWs(ws);
  });

  test('float amount returns debit_rejected: invalid_amount', async () => {
    const { ws } = await connectStore('STRTK1');
    const reply = await send(ws, { type: 'debit_request', comanda_code: 'F001', amount: 1.5 });
    assert.strictEqual(reply.type, 'debit_rejected');
    assert.strictEqual(reply.reason, 'invalid_amount');
    await closeWs(ws);
  });

  test('non-numeric amount string returns debit_rejected: invalid_amount', async () => {
    const { ws } = await connectStore('STRTK1');
    const reply = await send(ws, { type: 'debit_request', comanda_code: 'F001', amount: 'abc' });
    assert.strictEqual(reply.type, 'debit_rejected');
    assert.strictEqual(reply.reason, 'invalid_amount');
    await closeWs(ws);
  });

  test('empty comanda_code returns debit_rejected: comanda_not_found', async () => {
    const { ws } = await connectStore('STRTK1');
    const reply = await send(ws, { type: 'debit_request', comanda_code: '', amount: 100 });
    assert.strictEqual(reply.type, 'debit_rejected');
    assert.strictEqual(reply.reason, 'comanda_not_found');
    await closeWs(ws);
  });
});

// ============================================================================
// Store WS — broadcasts after debit
// ============================================================================
describe('Store WS — broadcast after debit', () => {
  useDb((db) => {
    seedComanda(db, 'F001', 'Bob', 3000);
    seedStore(db, 'store-1', 'My Store', 'STRTK1');
  });

  test('debit broadcasts balance_updated to all connected store terminals', async () => {
    const { ws: ws1 } = await connectStore('STRTK1');
    const { ws: ws2 } = await connectStore('STRTK1');

    // Register listeners BEFORE the send that triggers them
    const ws1Confirmed = waitForMessage(ws1);
    const ws2Broadcast = waitForMessage(ws2);

    ws1.send(JSON.stringify({ type: 'debit_request', comanda_code: 'F001', amount: 500 }));

    const [confirmed, broadcast] = await Promise.all([ws1Confirmed, ws2Broadcast]);

    assert.strictEqual(confirmed.type, 'debit_confirmed');
    assert.strictEqual(broadcast.type, 'balance_updated');
    assert.strictEqual(broadcast.comanda_code, 'F001');
    assert.strictEqual(broadcast.new_balance, 2500);
    assert.strictEqual(broadcast.event_type, 'debit');

    await closeWs(ws1);
    await closeWs(ws2);
  });

  test('debit broadcasts admin_balance_updated to connected admin', async () => {
    const { ws: adminWs } = await connectAdmin();
    const { ws: storeWs } = await connectStore('STRTK1');

    // Register listeners BEFORE sending
    const adminNext = waitForMessage(adminWs);
    const storeNext = waitForMessage(storeWs);

    storeWs.send(JSON.stringify({ type: 'debit_request', comanda_code: 'F001', amount: 200 }));

    const [adminMsg] = await Promise.all([adminNext, storeNext]);

    assert.strictEqual(adminMsg.type, 'admin_balance_updated');
    assert.strictEqual(adminMsg.comanda_code, 'F001');
    assert.strictEqual(adminMsg.amount, 200);
    assert.ok(typeof adminMsg.new_balance === 'number');
    assert.strictEqual(adminMsg.store_name, 'My Store');

    await closeWs(adminWs);
    await closeWs(storeWs);
  });
});

// ============================================================================
// Store WS — token revocation via REST disconnects active session
// ============================================================================
describe('Store WS — token revocation disconnects active session', () => {
  useDb((db) => {
    seedStore(db, 'store-rev', 'Revoke Me', 'REVTK1');
  });

  test('revoke_token via REST closes active WebSocket with code 1008', async () => {
    const { ws } = await connectStore('REVTK1');

    // Call revoke_token via REST
    const res = await fetch(`http://127.0.0.1:${port}/api/stores/store-rev/revoke_token`, {
      method: 'POST',
      headers: { token: ADMIN_TOKEN },
    });
    assert.strictEqual(res.status, 200);

    // WS should be closed by the server
    const { code } = await waitForClose(ws);
    assert.strictEqual(code, 1008);
  });
});

// ============================================================================
// Store WS — rate limiting
// ============================================================================
describe('Store WS — rate limiting', () => {
  useDb((db) => {
    seedStore(db, 'store-1', 'My Store', 'STRTK1');
  });

  test('exceeding 300 messages per minute triggers rate_limit_exceeded', async () => {
    const { ws } = await connectStore('STRTK1');

    // Collect responses; send 305 messages (first 300 normal, then rate limited)
    const received = collectMessages(ws, 305, 5000);
    for (let i = 0; i < 305; i++) {
      ws.send(JSON.stringify({ type: 'balance_query', comanda_code: 'ZZZZ' }));
    }
    const msgs = await received;

    const rateLimited = msgs.filter((m) => m.reason === 'rate_limit_exceeded');
    assert.ok(rateLimited.length > 0, 'should receive at least one rate_limit_exceeded message');

    await closeWs(ws);
  });
});
