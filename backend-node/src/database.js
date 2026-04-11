const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const config = require('./config');
const log = require('./logger');

// OUROBOROS_DATA_DIR permite que o launcher Tauri defina onde fica o .db.
// Fallback: ao lado do .exe (pkg) ou raiz do projeto (dev).
const basePath = process.env.OUROBOROS_DATA_DIR ||
  (process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..'));

const DB_PATH = path.isAbsolute(config.databaseUrl)
  ? config.databaseUrl
  : path.resolve(basePath, config.databaseUrl);

/**
 * Thin wrapper over node:sqlite (built into Node.js v22+, no native compilation)
 * that adds .pragma() and .transaction() to match the better-sqlite3 API used
 * throughout the codebase.
 */
class SqliteDb {
  constructor(dbPath) {
    this._db = new DatabaseSync(dbPath);
  }

  pragma(str) {
    try {
      this._db.exec(`PRAGMA ${str}`);
    } catch (_) {
      // Ignore unsupported pragmas (e.g. journal_mode = WAL on :memory:)
    }
  }

  exec(sql) {
    this._db.exec(sql);
  }

  prepare(sql) {
    return this._db.prepare(sql);
  }

  transaction(fn) {
    return (...args) => {
      this._db.exec('BEGIN');
      try {
        const result = fn(...args);
        this._db.exec('COMMIT');
        return result;
      } catch (e) {
        try { this._db.exec('ROLLBACK'); } catch (_) {}
        throw e;
      }
    };
  }
}

let _db = null;

function getDb() {
  if (!_db) {
    log.dbConnect(DB_PATH);

    _db = new SqliteDb(DB_PATH);

    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    _db.pragma('foreign_keys = ON');
    _db.pragma('cache_size = -64000');

    _db.exec(`
      CREATE TABLE IF NOT EXISTS comandas (
        id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, holder_name TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stores (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, theme TEXT, terminal_token TEXT UNIQUE NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, comanda_id TEXT NOT NULL, store_id TEXT, amount INTEGER NOT NULL,
        note TEXT, timestamp TEXT NOT NULL, synced_to_firebase INTEGER DEFAULT 0,
        FOREIGN KEY(comanda_id) REFERENCES comandas(id), FOREIGN KEY(store_id) REFERENCES stores(id)
      );
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, price INTEGER NOT NULL,
        total_entries INTEGER DEFAULT 0, total_exits INTEGER DEFAULT 0
      );
      DROP VIEW IF EXISTS balance_view;
      CREATE VIEW balance_view AS
        SELECT comanda_id, SUM(CASE WHEN type='credit' THEN amount ELSE -amount END) AS balance
        FROM events GROUP BY comanda_id;

      CREATE TABLE IF NOT EXISTS distributions (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, num_boxes INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'planning', needs_recalc INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS boxes (
        id TEXT PRIMARY KEY, distribution_id TEXT NOT NULL, box_number INTEGER NOT NULL,
        assigned_store_id TEXT NOT NULL, responsible_name TEXT,
        status TEXT NOT NULL DEFAULT 'pending', claimed_at TEXT, completed_at TEXT,
        FOREIGN KEY(distribution_id) REFERENCES distributions(id),
        FOREIGN KEY(assigned_store_id) REFERENCES stores(id)
      );
      CREATE TABLE IF NOT EXISTS box_items (
        id TEXT PRIMARY KEY, box_id TEXT NOT NULL, category_id TEXT NOT NULL, target_quantity INTEGER NOT NULL,
        FOREIGN KEY(box_id) REFERENCES boxes(id), FOREIGN KEY(category_id) REFERENCES categories(id)
      );
      DROP VIEW IF EXISTS store_box_count;
      CREATE VIEW store_box_count AS
        SELECT s.id as store_id, s.name as store_name,
               COUNT(CASE WHEN b.status IN ('done', 'in_progress', 'pending') THEN 1 END) as boxes_total,
               COUNT(CASE WHEN b.status = 'done' THEN 1 END) as boxes_done
        FROM stores s LEFT JOIN boxes b ON b.assigned_store_id = s.id
        GROUP BY s.id;

      CREATE INDEX IF NOT EXISTS idx_events_comanda_id ON events(comanda_id);
      CREATE INDEX IF NOT EXISTS idx_events_store_id ON events(store_id);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_boxes_distribution_id ON boxes(distribution_id);
      CREATE INDEX IF NOT EXISTS idx_boxes_status ON boxes(status);
      CREATE INDEX IF NOT EXISTS idx_box_items_box_id ON box_items(box_id);
      CREATE INDEX IF NOT EXISTS idx_box_items_category_id ON box_items(category_id);
    `);
  }
  return _db;
}

/** FOR TESTING ONLY. Replaces the DB singleton. Never call in production code. */
function _overrideDb(testDb) {
  _db = testDb;
}

module.exports = { getDb, _overrideDb, SqliteDb };
