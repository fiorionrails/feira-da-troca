'use strict';

/**
 * Test database helper.
 * Creates a fresh in-memory SQLite database with the full Ouroboros schema.
 * Each call returns an independent, isolated instance.
 */

const Database = require('better-sqlite3');

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
`;

const VIEW_SQL = `
  DROP VIEW IF EXISTS balance_view;
  CREATE VIEW balance_view AS
  SELECT
    comanda_id,
    SUM(CASE WHEN type='credit' THEN amount ELSE -amount END) AS balance
  FROM events
  GROUP BY comanda_id;
`;

function createTestDb() {
  const db = new Database(':memory:');
  // WAL mode is silently ignored on :memory: databases (no-op); production uses it on disk.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  db.exec(VIEW_SQL);
  return db;
}

module.exports = { createTestDb };
