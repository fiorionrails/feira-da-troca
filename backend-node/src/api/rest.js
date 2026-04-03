const express = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { getDb } = require('../database');
const config = require('../config');
const { getComandaByCode, getBalance } = require('../services/comandaService');
const { createOrUpdateCategory } = require('../services/productService');
const { broadcastToAdmins } = require('./wsRegistry');
const { broadcastToPacking } = require('./wsPacking');
const { distributeItems, suggestBoxCount } = require('../services/distributionService');
const { claimBox, completeBox, cancelBox, flagNeedsRecalc } = require('../services/boxService');

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
  const { name } = req.body;
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
  const { name } = req.body;
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
  res.json({ id: req.params.storeId, new_token: newToken });
});

// --- Categories ---
router.get('/categories', (req, res) => {
  const db = getDb();
  const categories = db.prepare('SELECT * FROM categories ORDER BY name ASC').all();
  res.json(categories);
});

router.post('/categories', adminAuth, (req, res) => {
  const { name, price } = req.body;
  if (!name || price === undefined) return res.status(400).json({ detail: 'name and price are required' });
  const db = getDb();
  const existing = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)').get(name);
  if (existing) return res.status(400).json({ detail: 'Categoria já existe' });
  const newId = uuidv4();
  db.prepare('INSERT INTO categories (id, name, price) VALUES (?, ?, ?)').run(newId, name, price);
  
  const newCat = { id: newId, name, price, total_entries: 0, total_exits: 0 };
  console.log(`[API REST] Categoria criada: ${name}. Iniciando broadcast...`);
  broadcastToAdmins({ type: 'category_updated', category: newCat });

  res.status(201).json(newCat);
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

// --- Distribuição Admin ---

router.get('/distribution', adminAuth, (req, res) => {
  const db = getDb();
  const distributions = db.prepare('SELECT * FROM distributions ORDER BY created_at DESC').all();
  res.json(distributions);
});

router.post('/distribution', adminAuth, (req, res) => {
  const { name, num_boxes } = req.body;
  if (!name || !num_boxes) return res.status(400).json({ detail: 'name and num_boxes are required' });
  
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    'INSERT INTO distributions (id, name, num_boxes, status, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, name, num_boxes, 'planning', new Date().toISOString());
  
  res.status(201).json({ id, name, num_boxes, status: 'planning' });
});

router.get('/distribution/suggest', adminAuth, (req, res) => {
  const db = getDb();
  const categories = db.prepare('SELECT total_entries FROM categories WHERE total_entries > 0').all();
  const stores = db.prepare('SELECT COUNT(*) as c FROM stores').get().c;
  res.json(suggestBoxCount(categories, stores));
});

router.get('/distribution/:id', adminAuth, (req, res) => {
  const db = getDb();
  const dist = db.prepare('SELECT * FROM distributions WHERE id = ?').get(req.params.id);
  if (!dist) return res.status(404).json({ detail: 'Distribution not found' });
  
  const boxes = db.prepare(`
    SELECT b.*, s.name as store_name
    FROM boxes b
    JOIN stores s ON b.assigned_store_id = s.id
    WHERE b.distribution_id = ?
    ORDER BY b.box_number ASC
  `).all(req.params.id);

  for (const box of boxes) {
    box.items = db.prepare(`
      SELECT bi.target_quantity, c.name as category_name
      FROM box_items bi
      JOIN categories c ON bi.category_id = c.id
      WHERE bi.box_id = ?
    `).all(box.id);
  }

  res.json({ distribution: dist, boxes });
});

router.post('/distribution/:id/calculate', adminAuth, (req, res) => {
  const db = getDb();
  const dist = db.prepare('SELECT * FROM distributions WHERE id = ?').get(req.params.id);
  if (!dist) return res.status(404).json({ detail: 'Distribution not found' });
  
  const categories = db.prepare('SELECT id, name, total_entries FROM categories WHERE total_entries > 0').all();
  const stores = db.prepare('SELECT id, name FROM stores ORDER BY name ASC').all();
  
  if (stores.length === 0) return res.status(400).json({ detail: 'Nenhuma loja cadastrada para receber caixas.' });

  try {
    const { boxes: calcBoxes, warnings } = distributeItems(categories, dist.num_boxes, stores);
    
    // Persistir no banco em uma transação
    db.transaction(() => {
      // Limpar anterior se houver
      const oldBoxes = db.prepare('SELECT id FROM boxes WHERE distribution_id = ?').all(dist.id);
      if (oldBoxes.length > 0) {
        const oldBoxIds = oldBoxes.map(b => b.id);
        const placeholders = oldBoxIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM box_items WHERE box_id IN (${placeholders})`).run(...oldBoxIds);
        db.prepare(`DELETE FROM boxes WHERE distribution_id = ?`).run(dist.id);
      }

      const insertBox = db.prepare('INSERT INTO boxes (id, distribution_id, box_number, assigned_store_id, status) VALUES (?, ?, ?, ?, ?)');
      const insertItem = db.prepare('INSERT INTO box_items (id, box_id, category_id, target_quantity) VALUES (?, ?, ?, ?)');

      calcBoxes.forEach(b => {
        const boxId = uuidv4();
        insertBox.run(boxId, dist.id, b.box_number, b.assigned_store_id, 'pending');
        Object.entries(b.items).forEach(([catId, qty]) => {
          insertItem.run(uuidv4(), boxId, catId, qty);
        });
      });
    })();

    res.json({ message: 'Distribuição calculada com sucesso', warnings });
  } catch (err) {
    console.error(err);
    res.status(400).json({ detail: err.message });
  }
});

router.put('/distribution/:id/activate', adminAuth, (req, res) => {
  const db = getDb();
  db.prepare("UPDATE distributions SET status = 'active' WHERE id = ?").run(req.params.id);
  broadcastToPacking({ type: 'distribution_status_changed', status: 'active' });
  res.json({ status: 'active' });
});

// --- Packing API (Voluntários logados) ---

router.get('/packing/active', adminAuth, (req, res) => {
  const db = getDb();
  const dist = db.prepare("SELECT * FROM distributions WHERE status = 'active'").get();
  if (!dist) return res.status(404).json({ detail: 'Nenhuma distribuição ativa no momento.' });

  const boxes = db.prepare(`
    SELECT b.*, s.name as store_name
    FROM boxes b
    JOIN stores s ON b.assigned_store_id = s.id
    WHERE b.distribution_id = ?
    ORDER BY b.box_number ASC
  `).all(dist.id);

  for (const box of boxes) {
    box.items = db.prepare(`
      SELECT bi.target_quantity, c.name as category_name
      FROM box_items bi
      JOIN categories c ON bi.category_id = c.id
      WHERE bi.box_id = ?
    `).all(box.id);
  }

  const stats = {
    total_boxes: boxes.length,
    pending: boxes.filter(b => b.status === 'pending').length,
    in_progress: boxes.filter(b => b.status === 'in_progress').length,
    done: boxes.filter(b => b.status === 'done').length
  };

  res.json({ distribution: dist, boxes, stats });
});

router.post('/packing/boxes/:boxId/claim', adminAuth, (req, res) => {
  const { responsible_name } = req.body;
  if (!responsible_name) return res.status(400).json({ detail: 'O seu nome é obrigatório para assumir a caixa.' });

  try {
    claimBox(req.params.boxId, responsible_name);
    broadcastToPacking({ type: 'box_claimed', box_id: req.params.boxId, responsible_name });
    res.json({ message: 'Caixa assumida com sucesso!' });
  } catch (err) {
    res.status(409).json({ detail: err.message });
  }
});

router.post('/packing/boxes/:boxId/complete', adminAuth, (req, res) => {
  try {
    const recalcTriggered = completeBox(req.params.boxId);
    broadcastToPacking({ type: 'box_completed', box_id: req.params.boxId });
    if (recalcTriggered) {
      broadcastToPacking({ type: 'distribution_recalculated' });
    }
    res.json({ message: 'Caixa concluída com sucesso!', recalc_triggered: recalcTriggered });
  } catch (err) {
    res.status(400).json({ detail: err.message });
  }
});

router.post('/packing/boxes/:boxId/cancel', adminAuth, (req, res) => {
  try {
    const recalcTriggered = cancelBox(req.params.boxId);
    broadcastToPacking({ type: 'box_released', box_id: req.params.boxId });
    if (recalcTriggered) {
      broadcastToPacking({ type: 'distribution_recalculated' });
    }
    res.json({ message: 'Caixa liberada para outros voluntários.', recalc_triggered: recalcTriggered });
  } catch (err) {
    res.status(400).json({ detail: err.message });
  }
});

module.exports = router;
