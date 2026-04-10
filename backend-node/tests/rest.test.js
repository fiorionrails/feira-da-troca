'use strict';

// Load .env BEFORE any module is required, so config.js captures the correct
// ADMIN_TOKEN instead of the fallback 'admin_token_change_me'.
require('dotenv').config();

/**
 * REST API integration tests.
 *
 * Each describe block calls `useDb()` in a `before` hook to get a fresh
 * in-memory database. The HTTP server is shared across all tests but routes
 * always call `getDb()` at request time, so overriding the singleton between
 * describe blocks is safe.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { createTestDb } = require('./helpers/db');

// Override the DB singleton BEFORE loading the app
const db0 = createTestDb();
require('../src/database')._overrideDb(db0);

const { server } = require('../src/app');

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin_token_change_me';
const WRONG_TOKEN = 'wrong-token';

let BASE;

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
});

// --- helper to swap the active DB -------------------------------------------
function useDb(seedFn) {
  before(() => {
    const db = createTestDb();
    if (seedFn) seedFn(db);
    require('../src/database')._overrideDb(db);
  });
}

// --- HTTP helper ------------------------------------------------------------
async function req(method, path, body, headers = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return fetch(`${BASE}${path}`, opts);
}

function adminHeaders() {
  return { token: ADMIN_TOKEN };
}

// --- seed helpers -----------------------------------------------------------
function seedComanda(db, code = 'F001', holder = 'Test User', balance = 2000) {
  const id = `comanda-${code}`;
  db.prepare('INSERT INTO comandas (id, code, holder_name, created_at) VALUES (?,?,?,?)').run(
    id, code, holder, new Date().toISOString()
  );
  if (balance > 0) {
    db.prepare('INSERT INTO events (id, type, comanda_id, amount, note, timestamp) VALUES (?,?,?,?,?,?)').run(
      `evt-${code}`, 'credit', id, balance, 'Saldo inicial', new Date().toISOString()
    );
  }
  return id;
}

function seedStore(db, id = 'store-1', name = 'Test Store', token = 'TESTST') {
  db.prepare('INSERT INTO stores (id, name, theme, terminal_token) VALUES (?,?,?,?)').run(
    id, name, 'default', token
  );
  return id;
}

function seedCategory(db, name = 'Jaqueta', price = 1500) {
  const id = `cat-${name.toLowerCase()}`;
  db.prepare('INSERT INTO categories (id, name, price) VALUES (?,?,?)').run(id, name, price);
  return id;
}

// ============================================================================
// GET /
// ============================================================================
describe('GET /', () => {
  useDb();

  test('returns 200 with status online', async () => {
    const res = await fetch(`${BASE}/`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'online');
    assert.strictEqual(body.mode, 'local-first');
    assert.ok(typeof body.event === 'string');
  });
});

// ============================================================================
// GET /api/reports/economy_state
// ============================================================================
describe('GET /api/reports/economy_state', () => {
  useDb((db) => {
    const cid = seedComanda(db, 'F001', 'Alice', 1500);
    seedStore(db);
  });

  test('returns 401 without token', async () => {
    const res = await fetch(`${BASE}/api/reports/economy_state`);
    assert.strictEqual(res.status, 401);
  });

  test('returns 401 with wrong token', async () => {
    const res = await req('GET', '/api/reports/economy_state', undefined, { token: WRONG_TOKEN });
    assert.strictEqual(res.status, 401);
  });

  test('returns economy state shape with valid token', async () => {
    const res = await req('GET', '/api/reports/economy_state', undefined, adminHeaders());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok('total_issued' in body);
    assert.ok('total_circulating' in body);
    assert.ok('comandas_active' in body);
    assert.ok('stores_registered' in body);
  });

  test('economy state reflects seeded data', async () => {
    const res = await req('GET', '/api/reports/economy_state', undefined, adminHeaders());
    const body = await res.json();
    assert.strictEqual(body.comandas_active, 1);
    assert.strictEqual(body.stores_registered, 1);
    assert.strictEqual(body.total_issued, 1500);
  });
});

// ============================================================================
// GET /api/reports/analytics
// ============================================================================
describe('GET /api/reports/analytics', () => {
  useDb((db) => {
    seedComanda(db, 'F001', 'Alice', 2000);
    seedStore(db);
    seedCategory(db);
  });

  test('returns 200 without authentication (public)', async () => {
    const res = await fetch(`${BASE}/api/reports/analytics`);
    assert.strictEqual(res.status, 200);
  });

  test('response has the expected shape', async () => {
    const res = await fetch(`${BASE}/api/reports/analytics`);
    const body = await res.json();
    assert.ok('kpis' in body);
    assert.ok('transactions_per_minute' in body);
    assert.ok('top_stores' in body);
    assert.ok('category_distribution' in body);
    const k = body.kpis;
    assert.ok('total_comandas' in k);
    assert.ok('total_emitido' in k);
    assert.ok('total_gasto' in k);
    assert.ok('total_circulante' in k);
    assert.ok('total_transacoes' in k);
    assert.ok('lojas_ativas' in k);
  });

  test('kpis reflect seeded data', async () => {
    const res = await fetch(`${BASE}/api/reports/analytics`);
    const body = await res.json();
    assert.strictEqual(body.kpis.total_comandas, 1);
    assert.strictEqual(body.kpis.lojas_ativas, 1);
    assert.strictEqual(body.kpis.total_emitido, 2000);
  });
});

// ============================================================================
// GET /api/comanda/:code
// ============================================================================
describe('GET /api/comanda/:code', () => {
  useDb((db) => {
    seedComanda(db, 'F001', 'Test User', 3000);
  });

  test('returns 401 without token', async () => {
    const res = await fetch(`${BASE}/api/comanda/F001`);
    assert.strictEqual(res.status, 401);
  });

  test('returns 404 for unknown code', async () => {
    const res = await req('GET', '/api/comanda/ZZZZ', undefined, adminHeaders());
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.ok(body.detail);
  });

  test('returns 200 with correct shape for known code', async () => {
    const res = await req('GET', '/api/comanda/F001', undefined, adminHeaders());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.id);
    assert.strictEqual(body.code, 'F001');
    assert.strictEqual(body.holder_name, 'Test User');
    assert.strictEqual(body.balance, 3000);
    assert.ok(body.created_at);
  });

  test('normalizes code to uppercase (f001 → finds F001)', async () => {
    const res = await req('GET', '/api/comanda/f001', undefined, adminHeaders());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.code, 'F001');
  });
});

// ============================================================================
// GET /api/stores
// ============================================================================
describe('GET /api/stores', () => {
  useDb((db) => {
    seedStore(db, 'store-a', 'Store A', 'TOKENA1');
    seedStore(db, 'store-b', 'Store B', 'TOKENB1');
  });

  test('returns 401 without token', async () => {
    const res = await fetch(`${BASE}/api/stores`);
    assert.strictEqual(res.status, 401);
  });

  test('returns array of stores', async () => {
    const res = await req('GET', '/api/stores', undefined, adminHeaders());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
    assert.strictEqual(body.length, 2);
  });

  test('each store has required fields', async () => {
    const res = await req('GET', '/api/stores', undefined, adminHeaders());
    const body = await res.json();
    for (const s of body) {
      assert.ok(s.id);
      assert.ok(s.name);
      assert.ok(s.terminal_token);
    }
  });
});

// ============================================================================
// POST /api/stores
// ============================================================================
describe('POST /api/stores', () => {
  useDb();

  test('returns 401 without token', async () => {
    const res = await req('POST', '/api/stores', { name: 'Loja X' });
    assert.strictEqual(res.status, 401);
  });

  test('returns 400 when name is missing', async () => {
    const res = await req('POST', '/api/stores', {}, adminHeaders());
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.detail, 'name is required');
  });

  test('returns 400 when name is only whitespace', async () => {
    const res = await req('POST', '/api/stores', { name: '   ' }, adminHeaders());
    assert.strictEqual(res.status, 400);
  });

  test('returns 201 with correct shape on success', async () => {
    const res = await req('POST', '/api/stores', { name: 'Cantina' }, adminHeaders());
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.ok(body.id);
    assert.strictEqual(body.name, 'Cantina');
    assert.ok(typeof body.terminal_token === 'string');
    assert.strictEqual(body.terminal_token.length, 6);
  });

  test('generated token contains only uppercase alphanumeric (no ambiguous chars)', async () => {
    const res = await req('POST', '/api/stores', { name: 'Loja Token Test' }, adminHeaders());
    const body = await res.json();
    assert.match(body.terminal_token, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });

  test('trims whitespace from name', async () => {
    const res = await req('POST', '/api/stores', { name: '  Padaria  ' }, adminHeaders());
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.name, 'Padaria');
  });
});

// ============================================================================
// PUT /api/stores/:storeId
// ============================================================================
describe('PUT /api/stores/:storeId', () => {
  useDb((db) => {
    seedStore(db, 'store-edit', 'Old Name', 'EDITTK');
  });

  test('returns 401 without token', async () => {
    const res = await req('PUT', '/api/stores/store-edit', { name: 'New' });
    assert.strictEqual(res.status, 401);
  });

  test('returns 400 when name is missing', async () => {
    const res = await req('PUT', '/api/stores/store-edit', {}, adminHeaders());
    assert.strictEqual(res.status, 400);
  });

  test('returns 404 for unknown store id', async () => {
    const res = await req('PUT', '/api/stores/nonexistent', { name: 'X' }, adminHeaders());
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.strictEqual(body.detail, 'Store not found');
  });

  test('returns 200 and updates the name', async () => {
    const res = await req('PUT', '/api/stores/store-edit', { name: 'New Name' }, adminHeaders());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.name, 'New Name');
  });

  test('persisted name is visible in GET /api/stores', async () => {
    await req('PUT', '/api/stores/store-edit', { name: 'Updated Store' }, adminHeaders());
    const res = await req('GET', '/api/stores', undefined, adminHeaders());
    const stores = await res.json();
    assert.ok(stores.some((s) => s.name === 'Updated Store'));
  });
});

// ============================================================================
// POST /api/stores/:storeId/revoke_token
// ============================================================================
describe('POST /api/stores/:storeId/revoke_token', () => {
  useDb((db) => {
    seedStore(db, 'store-rev', 'Revoke Store', 'REVOKE');
  });

  test('returns 401 without token', async () => {
    const res = await req('POST', '/api/stores/store-rev/revoke_token', {});
    assert.strictEqual(res.status, 401);
  });

  test('returns 404 for unknown store id', async () => {
    const res = await req('POST', '/api/stores/nonexistent/revoke_token', {}, adminHeaders());
    assert.strictEqual(res.status, 404);
  });

  test('returns 200 with new token', async () => {
    const res = await req('POST', '/api/stores/store-rev/revoke_token', {}, adminHeaders());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.id, 'store-rev');
    assert.ok(typeof body.new_token === 'string');
    assert.strictEqual(body.new_token.length, 6);
  });

  test('new token differs from old token', async () => {
    // Store was seeded with 'REVOKE'
    const res = await req('POST', '/api/stores/store-rev/revoke_token', {}, adminHeaders());
    const body = await res.json();
    assert.notStrictEqual(body.new_token, 'REVOKE');
  });
});

// ============================================================================
// GET /api/categories
// ============================================================================
describe('GET /api/categories', () => {
  useDb((db) => {
    seedCategory(db, 'Jaqueta', 1500);
    seedCategory(db, 'Bolsa', 1200);
  });

  test('returns 200 without authentication (public)', async () => {
    const res = await fetch(`${BASE}/api/categories`);
    assert.strictEqual(res.status, 200);
  });

  test('returns array of categories', async () => {
    const res = await fetch(`${BASE}/api/categories`);
    const body = await res.json();
    assert.ok(Array.isArray(body));
    assert.strictEqual(body.length, 2);
  });

  test('each category has required fields', async () => {
    const res = await fetch(`${BASE}/api/categories`);
    const body = await res.json();
    for (const c of body) {
      assert.ok(c.id);
      assert.ok(c.name);
      assert.ok(typeof c.price === 'number');
      assert.ok(typeof c.total_entries === 'number');
      assert.ok(typeof c.total_exits === 'number');
    }
  });
});

// ============================================================================
// POST /api/categories
// ============================================================================
describe('POST /api/categories', () => {
  useDb((db) => {
    seedCategory(db, 'Jaqueta', 1500); // used for duplicate test
  });

  test('returns 401 without token', async () => {
    const res = await req('POST', '/api/categories', { name: 'Bolsa', price: 1200 });
    assert.strictEqual(res.status, 401);
  });

  test('returns 400 when name is missing', async () => {
    const res = await req('POST', '/api/categories', { price: 1200 }, adminHeaders());
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.detail, 'name is required');
  });

  test('returns 400 when price is 0', async () => {
    const res = await req('POST', '/api/categories', { name: 'Nova', price: 0 }, adminHeaders());
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.detail, 'price must be a positive integer');
  });

  test('returns 400 when price is negative', async () => {
    const res = await req('POST', '/api/categories', { name: 'Nova', price: -100 }, adminHeaders());
    assert.strictEqual(res.status, 400);
  });

  test('returns 400 when price is a float', async () => {
    const res = await req('POST', '/api/categories', { name: 'Nova', price: 1.5 }, adminHeaders());
    assert.strictEqual(res.status, 400);
  });

  test('returns 400 when price is a non-numeric string', async () => {
    const res = await req('POST', '/api/categories', { name: 'Nova', price: 'abc' }, adminHeaders());
    assert.strictEqual(res.status, 400);
  });

  test('returns 400 for duplicate name (exact match)', async () => {
    const res = await req('POST', '/api/categories', { name: 'Jaqueta', price: 1500 }, adminHeaders());
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.detail, 'Categoria já existe');
  });

  test('returns 400 for duplicate name (case insensitive)', async () => {
    const res = await req('POST', '/api/categories', { name: 'jaqueta', price: 1500 }, adminHeaders());
    assert.strictEqual(res.status, 400);
  });

  test('returns 201 with correct shape on success', async () => {
    const res = await req('POST', '/api/categories', { name: 'Calça', price: 900 }, adminHeaders());
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.ok(body.id);
    assert.strictEqual(body.name, 'Calça');
    assert.strictEqual(body.price, 900);
  });

  test('trims name whitespace before saving', async () => {
    const res = await req('POST', '/api/categories', { name: '  Tênis  ', price: 2000 }, adminHeaders());
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.name, 'Tênis');
  });
});

// ============================================================================
// Body size limit
// ============================================================================
describe('Body size limit', () => {
  useDb();

  test('returns 413 for body larger than 10kb', async () => {
    const bigBody = JSON.stringify({ name: 'X'.repeat(11 * 1024) });
    const res = await fetch(`${BASE}/api/stores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token: ADMIN_TOKEN },
      body: bigBody,
    });
    assert.strictEqual(res.status, 413);
  });
});

// ============================================================================
// Distribution seed helpers
// ============================================================================
function seedDistribution(db, id = 'dist-1', name = 'Rodada 1', numBoxes = 2, status = 'planning') {
  db.prepare(
    'INSERT INTO distributions (id, name, num_boxes, status, needs_recalc, created_at) VALUES (?,?,?,?,?,?)'
  ).run(id, name, numBoxes, status, 0, new Date().toISOString());
  return id;
}

function seedBox(db, id, distributionId, boxNumber, storeId, status = 'pending', responsibleName = null) {
  db.prepare(
    'INSERT INTO boxes (id, distribution_id, box_number, assigned_store_id, status, responsible_name) VALUES (?,?,?,?,?,?)'
  ).run(id, distributionId, boxNumber, storeId, status, responsibleName);
  return id;
}

function seedCategoryWithEntries(db, id, name, price, entries) {
  db.prepare('INSERT INTO categories (id, name, price, total_entries) VALUES (?,?,?,?)').run(id, name, price, entries);
  return id;
}

// ============================================================================
// GET /api/distribution
// ============================================================================
describe('GET /api/distribution — empty', () => {
  useDb();

  test('returns 401 without token', async () => {
    const res = await fetch(`${BASE}/api/distribution`);
    assert.strictEqual(res.status, 401);
  });

  test('returns empty array when no distributions exist', async () => {
    const res = await req('GET', '/api/distribution', undefined, adminHeaders());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
    assert.strictEqual(body.length, 0);
  });
});

describe('GET /api/distribution — with data', () => {
  useDb((db) => {
    seedDistribution(db, 'dist-1', 'Rodada 1', 2, 'planning');
    seedDistribution(db, 'dist-2', 'Rodada 2', 3, 'active');
  });

  test('returns all distributions', async () => {
    const body = await (await req('GET', '/api/distribution', undefined, adminHeaders())).json();
    assert.strictEqual(body.length, 2);
  });

  test('each distribution has required fields', async () => {
    const body = await (await req('GET', '/api/distribution', undefined, adminHeaders())).json();
    for (const d of body) {
      assert.ok(d.id);
      assert.ok(d.name);
      assert.ok(typeof d.num_boxes === 'number');
      assert.ok(d.status);
      assert.ok(d.created_at);
    }
  });
});

// ============================================================================
// POST /api/distribution
// ============================================================================
describe('POST /api/distribution', () => {
  useDb();

  test('returns 401 without token', async () => {
    const res = await req('POST', '/api/distribution', { name: 'Rodada 1', num_boxes: 2 });
    assert.strictEqual(res.status, 401);
  });

  test('returns 400 when name is missing', async () => {
    const res = await req('POST', '/api/distribution', { num_boxes: 2 }, adminHeaders());
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).detail, 'name and num_boxes are required');
  });

  test('returns 400 when num_boxes is missing', async () => {
    const res = await req('POST', '/api/distribution', { name: 'Rodada 1' }, adminHeaders());
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).detail, 'name and num_boxes are required');
  });

  test('returns 400 when num_boxes is 0', async () => {
    const res = await req('POST', '/api/distribution', { name: 'Rodada 1', num_boxes: 0 }, adminHeaders());
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).detail, 'name and num_boxes are required');
  });

  test('returns 400 when num_boxes is negative', async () => {
    const res = await req('POST', '/api/distribution', { name: 'Rodada 1', num_boxes: -1 }, adminHeaders());
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).detail, 'num_boxes must be a positive integer');
  });

  test('returns 400 when num_boxes is a float', async () => {
    const res = await req('POST', '/api/distribution', { name: 'Rodada 1', num_boxes: 1.5 }, adminHeaders());
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).detail, 'num_boxes must be a positive integer');
  });

  test('returns 201 with correct shape on success', async () => {
    const res = await req('POST', '/api/distribution', { name: 'Rodada 1', num_boxes: 2 }, adminHeaders());
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.ok(body.id);
    assert.strictEqual(body.name, 'Rodada 1');
    assert.strictEqual(body.num_boxes, 2);
    assert.strictEqual(body.status, 'planning');
  });

  test('created distribution appears in GET /api/distribution', async () => {
    await req('POST', '/api/distribution', { name: 'Nova Rodada', num_boxes: 3 }, adminHeaders());
    const list = await (await req('GET', '/api/distribution', undefined, adminHeaders())).json();
    assert.ok(list.some((d) => d.name === 'Nova Rodada'));
  });
});

// ============================================================================
// GET /api/distribution/suggest
// ============================================================================
describe('GET /api/distribution/suggest', () => {
  useDb((db) => {
    seedCategoryWithEntries(db, 'cat-1', 'Jaqueta', 1500, 10);
    seedStore(db, 'store-1', 'Loja 1', 'STRTK1');
  });

  test('returns 401 without token', async () => {
    const res = await fetch(`${BASE}/api/distribution/suggest`);
    assert.strictEqual(res.status, 401);
  });

  test('returns 200 with suggested and reasoning fields', async () => {
    const res = await req('GET', '/api/distribution/suggest', undefined, adminHeaders());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body.suggested === 'number');
    assert.ok(typeof body.reasoning === 'string');
  });
});

// ============================================================================
// GET /api/distribution/:id
// ============================================================================
describe('GET /api/distribution/:id', () => {
  useDb((db) => {
    seedDistribution(db, 'dist-detail', 'Rodada Detalhe', 2, 'planning');
  });

  test('returns 401 without token', async () => {
    const res = await fetch(`${BASE}/api/distribution/dist-detail`);
    assert.strictEqual(res.status, 401);
  });

  test('returns 404 for unknown distribution id', async () => {
    const res = await req('GET', '/api/distribution/nonexistent', undefined, adminHeaders());
    assert.strictEqual(res.status, 404);
    assert.strictEqual((await res.json()).detail, 'Distribution not found');
  });

  test('returns 200 with distribution and boxes array', async () => {
    const res = await req('GET', '/api/distribution/dist-detail', undefined, adminHeaders());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.distribution);
    assert.strictEqual(body.distribution.id, 'dist-detail');
    assert.ok(Array.isArray(body.boxes));
  });
});

// ============================================================================
// POST /api/distribution/:id/calculate
// ============================================================================
describe('POST /api/distribution/:id/calculate', () => {
  useDb((db) => {
    seedStore(db, 'store-1', 'Loja 1', 'STRTK1');
    seedCategoryWithEntries(db, 'cat-1', 'Jaqueta', 1500, 10);
    seedDistribution(db, 'dist-calc', 'Para Calcular', 2, 'planning');
  });

  test('returns 401 without token', async () => {
    const res = await req('POST', '/api/distribution/dist-calc/calculate', {});
    assert.strictEqual(res.status, 401);
  });

  test('returns 404 for unknown distribution id', async () => {
    const res = await req('POST', '/api/distribution/nonexistent/calculate', {}, adminHeaders());
    assert.strictEqual(res.status, 404);
  });

  test('returns 200 with message and warnings array on success', async () => {
    const res = await req('POST', '/api/distribution/dist-calc/calculate', {}, adminHeaders());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body.message === 'string');
    assert.ok(Array.isArray(body.warnings));
  });

  test('boxes are created in DB after calculate', async () => {
    await req('POST', '/api/distribution/dist-calc/calculate', {}, adminHeaders());
    const detail = await (await req('GET', '/api/distribution/dist-calc', undefined, adminHeaders())).json();
    assert.strictEqual(detail.boxes.length, 2);
  });
});

describe('POST /api/distribution/:id/calculate — no stores', () => {
  useDb((db) => {
    seedCategoryWithEntries(db, 'cat-1', 'Jaqueta', 1500, 10);
    seedDistribution(db, 'dist-no-stores', 'Sem Lojas', 2, 'planning');
  });

  test('returns 400 when no stores are registered', async () => {
    const res = await req('POST', '/api/distribution/dist-no-stores/calculate', {}, adminHeaders());
    assert.strictEqual(res.status, 400);
    assert.ok((await res.json()).detail);
  });
});

// ============================================================================
// DELETE /api/distribution/:id
// ============================================================================
describe('DELETE /api/distribution/:id', () => {
  useDb((db) => {
    seedDistribution(db, 'dist-del', 'Para Excluir', 2, 'planning');
  });

  test('returns 401 without token', async () => {
    const res = await req('DELETE', '/api/distribution/dist-del');
    assert.strictEqual(res.status, 401);
  });

  test('returns 404 for unknown distribution', async () => {
    const res = await req('DELETE', '/api/distribution/nonexistent', undefined, adminHeaders());
    assert.strictEqual(res.status, 404);
  });

  test('returns 200 and distribution is gone afterwards', async () => {
    const res = await req('DELETE', '/api/distribution/dist-del', undefined, adminHeaders());
    assert.strictEqual(res.status, 200);
    assert.ok((await res.json()).message);
    const check = await req('GET', '/api/distribution/dist-del', undefined, adminHeaders());
    assert.strictEqual(check.status, 404);
  });
});

describe('DELETE /api/distribution/:id — active with in_progress boxes', () => {
  useDb((db) => {
    seedStore(db, 'store-1', 'Loja 1', 'STRTK1');
    seedDistribution(db, 'dist-active', 'Rodada Ativa', 1, 'active');
    seedBox(db, 'box-ip', 'dist-active', 1, 'store-1', 'in_progress', 'João');
  });

  test('returns 409 when active distribution has in_progress boxes', async () => {
    const res = await req('DELETE', '/api/distribution/dist-active', undefined, adminHeaders());
    assert.strictEqual(res.status, 409);
    assert.ok((await res.json()).detail);
  });
});

// ============================================================================
// PUT /api/distribution/:id/activate
// ============================================================================
describe('PUT /api/distribution/:id/activate', () => {
  useDb((db) => {
    seedDistribution(db, 'dist-act', 'Para Ativar', 2, 'planning');
  });

  test('returns 401 without token', async () => {
    const res = await req('PUT', '/api/distribution/dist-act/activate', {});
    assert.strictEqual(res.status, 401);
  });

  test('returns 404 for unknown distribution', async () => {
    const res = await req('PUT', '/api/distribution/nonexistent/activate', {}, adminHeaders());
    assert.strictEqual(res.status, 404);
  });

  test('returns 200 with status active', async () => {
    const res = await req('PUT', '/api/distribution/dist-act/activate', {}, adminHeaders());
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).status, 'active');
  });
});

describe('PUT /api/distribution/:id/activate — archives previous active', () => {
  useDb((db) => {
    seedDistribution(db, 'dist-old', 'Anterior', 2, 'active');
    seedDistribution(db, 'dist-new', 'Nova', 2, 'planning');
  });

  test('sets previous active distribution to complete', async () => {
    await req('PUT', '/api/distribution/dist-new/activate', {}, adminHeaders());
    const list = await (await req('GET', '/api/distribution', undefined, adminHeaders())).json();
    const old = list.find((d) => d.id === 'dist-old');
    assert.strictEqual(old.status, 'complete');
  });
});

// ============================================================================
// GET /api/packing/active
// ============================================================================
describe('GET /api/packing/active — no active distribution', () => {
  useDb();

  test('returns 401 without token', async () => {
    const res = await fetch(`${BASE}/api/packing/active`);
    assert.strictEqual(res.status, 401);
  });

  test('returns 404 when no active distribution exists', async () => {
    const res = await req('GET', '/api/packing/active', undefined, adminHeaders());
    assert.strictEqual(res.status, 404);
  });
});

describe('GET /api/packing/active — with active distribution', () => {
  useDb((db) => {
    seedStore(db, 'store-1', 'Loja 1', 'STRTK1');
    seedDistribution(db, 'dist-active', 'Rodada Ativa', 1, 'active');
    seedBox(db, 'box-1', 'dist-active', 1, 'store-1', 'pending');
  });

  test('returns 200 with distribution, boxes and stats', async () => {
    const res = await req('GET', '/api/packing/active', undefined, adminHeaders());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.distribution);
    assert.strictEqual(body.distribution.status, 'active');
    assert.ok(Array.isArray(body.boxes));
    assert.ok(body.stats);
    assert.ok(typeof body.stats.total_boxes === 'number');
    assert.ok(typeof body.stats.pending === 'number');
    assert.ok(typeof body.stats.in_progress === 'number');
    assert.ok(typeof body.stats.done === 'number');
  });
});

// ============================================================================
// POST /api/packing/boxes/:boxId/claim
// ============================================================================
describe('POST /api/packing/boxes/:boxId/claim', () => {
  useDb((db) => {
    seedStore(db, 'store-1', 'Loja 1', 'STRTK1');
    seedDistribution(db, 'dist-1', 'Rodada 1', 1, 'active');
    seedBox(db, 'box-claim', 'dist-1', 1, 'store-1', 'pending');
  });

  test('returns 401 without token', async () => {
    const res = await req('POST', '/api/packing/boxes/box-claim/claim', { responsible_name: 'João' });
    assert.strictEqual(res.status, 401);
  });

  test('returns 400 when responsible_name is missing', async () => {
    const res = await req('POST', '/api/packing/boxes/box-claim/claim', {}, adminHeaders());
    assert.strictEqual(res.status, 400);
    assert.ok((await res.json()).detail);
  });

  test('returns 409 when box is not found', async () => {
    const res = await req('POST', '/api/packing/boxes/nonexistent-box/claim', { responsible_name: 'João' }, adminHeaders());
    assert.strictEqual(res.status, 409);
  });

  test('returns 200 on successful claim', async () => {
    const res = await req('POST', '/api/packing/boxes/box-claim/claim', { responsible_name: 'Maria' }, adminHeaders());
    assert.strictEqual(res.status, 200);
    assert.ok((await res.json()).message);
  });

  test('returns 409 when box is already claimed', async () => {
    await req('POST', '/api/packing/boxes/box-claim/claim', { responsible_name: 'Maria' }, adminHeaders());
    const res = await req('POST', '/api/packing/boxes/box-claim/claim', { responsible_name: 'João' }, adminHeaders());
    assert.strictEqual(res.status, 409);
  });
});

// ============================================================================
// POST /api/packing/boxes/:boxId/complete
// ============================================================================
describe('POST /api/packing/boxes/:boxId/complete', () => {
  useDb((db) => {
    seedStore(db, 'store-1', 'Loja 1', 'STRTK1');
    seedDistribution(db, 'dist-1', 'Rodada 1', 1, 'active');
    seedBox(db, 'box-complete', 'dist-1', 1, 'store-1', 'in_progress', 'João');
  });

  test('returns 401 without token', async () => {
    const res = await req('POST', '/api/packing/boxes/box-complete/complete', {});
    assert.strictEqual(res.status, 401);
  });

  test('returns 400 when box is not found', async () => {
    const res = await req('POST', '/api/packing/boxes/nonexistent/complete', {}, adminHeaders());
    assert.strictEqual(res.status, 400);
  });

  test('returns 200 with recalc_triggered on success', async () => {
    const res = await req('POST', '/api/packing/boxes/box-complete/complete', {}, adminHeaders());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.message);
    assert.ok(typeof body.recalc_triggered === 'boolean');
  });
});

// ============================================================================
// POST /api/packing/boxes/:boxId/cancel
// ============================================================================
describe('POST /api/packing/boxes/:boxId/cancel', () => {
  useDb((db) => {
    seedStore(db, 'store-1', 'Loja 1', 'STRTK1');
    seedDistribution(db, 'dist-1', 'Rodada 1', 1, 'active');
    seedBox(db, 'box-cancel', 'dist-1', 1, 'store-1', 'in_progress', 'João');
  });

  test('returns 401 without token', async () => {
    const res = await req('POST', '/api/packing/boxes/box-cancel/cancel', {});
    assert.strictEqual(res.status, 401);
  });

  test('returns 400 when box is not found', async () => {
    const res = await req('POST', '/api/packing/boxes/nonexistent/cancel', {}, adminHeaders());
    assert.strictEqual(res.status, 400);
  });

  test('returns 200 with recalc_triggered on success', async () => {
    const res = await req('POST', '/api/packing/boxes/box-cancel/cancel', {}, adminHeaders());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.message);
    assert.ok(typeof body.recalc_triggered === 'boolean');
  });
});
