/**
 * manage.js – Inicializa o banco de dados SQLite do Ouroboros.
 * Execute com: node manage.js
 */
require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const config = require('./src/config');

const DB_PATH = path.isAbsolute(config.databaseUrl)
  ? config.databaseUrl
  : path.resolve(__dirname, config.databaseUrl);

console.log(`Inicializando banco de dados em: ${DB_PATH}`);

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

db.exec(`
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
`);

// Create balance_view (DROP and re-CREATE to ensure it is up to date)
db.exec(`
  DROP VIEW IF EXISTS balance_view;
  CREATE VIEW balance_view AS
  SELECT
    comanda_id,
    SUM(CASE WHEN type='credit' THEN amount ELSE -amount END) AS balance
  FROM events
  GROUP BY comanda_id;
`);

db.close();
console.log('Banco de dados inicializado com sucesso!');
