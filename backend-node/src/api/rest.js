const express = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { getDb } = require('../database');
const config = require('../config');
const { getComandaByCode, getBalance } = require('../services/comandaService');
const { createOrUpdateCategory } = require('../services/productService');
const { disconnectStoreById } = require('./wsStore');

const router = express.Router();

// --- Auth middleware ---
function adminAuth(req, res, next) {
  const token = req.headers['token'] || req.query.token;
  if (token !== config.adminToken) {
    return res.status(401).json({ detail: 'Unauthorized' });
  }
  next();
}

function generateStoreToken() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
}

// --- Economy State ---
router.get('/reports/economy_state', adminAuth, (req, res) => {
  const db = getDb();
  const issued = db.prepare(
    "SELECT SUM(amount) as issued FROM events WHERE type='credit' AND note='Saldo inicial'"
  ).get().issued || 0;
  const circulating = db.prepare('SELECT SUM(balance) as circulating FROM balance_view').get().circulating || 0;
  const comandasCount = db.prepare('SELECT COUNT(*) as cmd_count FROM comandas').get().cmd_count || 0;
  const storesCount = db.prepare('SELECT COUNT(*) as st_count FROM stores').get().st_count || 0;

  res.json({
    total_issued: issued,
    total_circulating: circulating,
    comandas_active: comandasCount,
    stores_registered: storesCount,
  });
});

// --- Get comanda by code ---
router.get('/comanda/:code', adminAuth, (req, res) => {
  const db = getDb();
  const comanda = getComandaByCode(db, req.params.code.toUpperCase());
  if (!comanda) return res.status(404).json({ detail: 'Comanda não encontrada' });
  const balance = getBalance(db, comanda.id);
  res.json({ id: comanda.id, code: comanda.code, holder_name: comanda.holder_name, balance, created_at: comanda.created_at });
});

// --- Stores ---
router.get('/stores', adminAuth, (req, res) => {
  const db = getDb();
  const stores = db.prepare('SELECT * FROM stores ORDER BY name ASC').all();
  res.json(stores);
});

router.post('/stores', adminAuth, (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ detail: 'name is required' });
  const db = getDb();
  const newId = uuidv4();
  const terminalToken = generateStoreToken();
  db.prepare(
    "INSERT INTO stores (id, name, theme, terminal_token) VALUES (?, ?, ?, ?)"
  ).run(newId, name, 'default', terminalToken);
  res.status(201).json({ id: newId, name, terminal_token: terminalToken });
});

router.put('/stores/:storeId', adminAuth, (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ detail: 'name is required' });
  const db = getDb();
  const info = db.prepare('UPDATE stores SET name = ? WHERE id = ?').run(name, req.params.storeId);
  if (info.changes === 0) return res.status(404).json({ detail: 'Store not found' });
  res.json({ id: req.params.storeId, name });
});

router.post('/stores/:storeId/revoke_token', adminAuth, (req, res) => {
  const db = getDb();
  const newToken = generateStoreToken();
  const info = db.prepare('UPDATE stores SET terminal_token = ? WHERE id = ?').run(newToken, req.params.storeId);
  if (info.changes === 0) return res.status(404).json({ detail: 'Store not found' });
  disconnectStoreById(req.params.storeId);
  res.json({ id: req.params.storeId, new_token: newToken });
});

// --- Categories ---
router.get('/categories', (req, res) => {
  const db = getDb();
  const categories = db.prepare('SELECT * FROM categories ORDER BY name ASC').all();
  res.json(categories);
});

router.post('/categories', adminAuth, (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const price = Number(req.body.price);
  if (!name) return res.status(400).json({ detail: 'name is required' });
  if (!Number.isInteger(price) || price <= 0) return res.status(400).json({ detail: 'price must be a positive integer' });
  const db = getDb();
  const existing = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)').get(name);
  if (existing) return res.status(400).json({ detail: 'Categoria já existe' });
  const newId = uuidv4();
  db.prepare('INSERT INTO categories (id, name, price) VALUES (?, ?, ?)').run(newId, name, price);
  res.status(201).json({ id: newId, name, price });
});

// --- Analytics ---
router.get('/reports/analytics', (req, res) => {
  const db = getDb();

  const totalComandas = db.prepare('SELECT COUNT(*) as v FROM comandas').get().v || 0;
  const totalEmitido = db.prepare("SELECT SUM(amount) as v FROM events WHERE type='credit' AND note='Saldo inicial'").get().v || 0;
  const totalGasto = db.prepare("SELECT SUM(amount) as v FROM events WHERE type='debit'").get().v || 0;
  const totalCirculante = db.prepare('SELECT SUM(balance) as v FROM balance_view').get().v || 0;
  const totalTransacoes = db.prepare("SELECT COUNT(*) as v FROM events WHERE type='debit'").get().v || 0;
  const lojasAtivas = db.prepare('SELECT COUNT(*) as v FROM stores').get().v || 0;

  const transactionsPerMinute = db.prepare(`
    SELECT
      strftime('%H:%M', datetime(timestamp, 'localtime')) as minute,
      SUM(CASE WHEN type='credit' THEN 1 ELSE 0 END) as credits,
      SUM(CASE WHEN type='debit' THEN 1 ELSE 0 END) as debits,
      COUNT(*) as total
    FROM events
    WHERE timestamp >= datetime('now', '-2 hours')
    GROUP BY minute
    ORDER BY minute ASC
  `).all();

  const topStores = db.prepare(`
    SELECT s.name, SUM(e.amount) as total, COUNT(e.id) as count
    FROM events e
    JOIN stores s ON e.store_id = s.id
    WHERE e.type = 'debit'
    GROUP BY s.id
    ORDER BY total DESC
    LIMIT 10
  `).all();

  const categoryDistribution = db.prepare(`
    SELECT name,
           CASE WHEN total_entries > 0 THEN total_entries ELSE 1 END as count,
           price
    FROM categories
    ORDER BY total_entries DESC, name ASC
  `).all();

  res.json({
    kpis: {
      total_comandas: totalComandas,
      total_emitido: totalEmitido,
      total_gasto: totalGasto,
      total_circulante: totalCirculante,
      total_transacoes: totalTransacoes,
      lojas_ativas: lojasAtivas,
    },
    transactions_per_minute: transactionsPerMinute,
    top_stores: topStores,
    category_distribution: categoryDistribution,
  });
});

module.exports = router;
