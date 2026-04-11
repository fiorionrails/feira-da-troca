'use strict';

/**
 * Test database helper.
 * Creates a fresh in-memory SQLite database with the full Ouroboros schema.
 * Each call returns an independent, isolated instance.
 */

const { SqliteDb } = require('../../src/database');

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS comandas (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    holder_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stores (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    theme TEXT,
    terminal_token TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    comanda_id TEXT NOT NULL,
    store_id TEXT,
    amount INTEGER NOT NULL,
    note TEXT,
    timestamp TEXT NOT NULL,
    synced_to_firebase INTEGER DEFAULT 0,
    FOREIGN KEY(comanda_id) REFERENCES comandas(id),
    FOREIGN KEY(store_id) REFERENCES stores(id)
  );

  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    price INTEGER NOT NULL,
    total_entries INTEGER DEFAULT 0,
    total_exits INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS distributions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    num_boxes INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'planning',
    needs_recalc INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS boxes (
    id TEXT PRIMARY KEY,
    distribution_id TEXT NOT NULL,
    box_number INTEGER NOT NULL,
    assigned_store_id TEXT NOT NULL,
    responsible_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    claimed_at TEXT,
    completed_at TEXT,
    FOREIGN KEY(distribution_id) REFERENCES distributions(id),
    FOREIGN KEY(assigned_store_id) REFERENCES stores(id)
  );

  CREATE TABLE IF NOT EXISTS box_items (
    id TEXT PRIMARY KEY,
    box_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    target_quantity INTEGER NOT NULL,
    FOREIGN KEY(box_id) REFERENCES boxes(id),
    FOREIGN KEY(category_id) REFERENCES categories(id)
  );
`;

const VIEW_SQL = `
  DROP VIEW IF EXISTS balance_view;
  CREATE VIEW balance_view AS
  SELECT
    comanda_id,
    SUM(CASE WHEN type='credit' THEN amount ELSE -amount END) AS balance
  FROM events
  GROUP BY comanda_id;

  DROP VIEW IF EXISTS store_box_count;
  CREATE VIEW store_box_count AS
    SELECT s.id as store_id, s.name as store_name,
           COUNT(CASE WHEN b.status IN ('done', 'in_progress', 'pending') THEN 1 END) as boxes_total,
           COUNT(CASE WHEN b.status = 'done' THEN 1 END) as boxes_done
    FROM stores s LEFT JOIN boxes b ON b.assigned_store_id = s.id
    GROUP BY s.id;
`;

function createTestDb() {
  const db = new SqliteDb(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  db.exec(VIEW_SQL);
  return db;
}

module.exports = { createTestDb };
