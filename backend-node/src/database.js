const Database = require('better-sqlite3');
const path = require('path');
const config = require('./config');
const log = require('./logger');

// OUROBOROS_DATA_DIR permite que o launcher Tauri defina onde ficam .db e better_sqlite3.node.
// Fallback: ao lado do .exe (pkg) ou raiz do projeto (dev).
const basePath = process.env.OUROBOROS_DATA_DIR ||
  (process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..'));

const DB_PATH = path.isAbsolute(config.databaseUrl)
  ? config.databaseUrl
  : path.resolve(basePath, config.databaseUrl);

let _db = null;

function getDb() {
  if (!_db) {
    log.dbConnect(DB_PATH);
    
    const dbOptions = {};
    if (process.pkg) {
      // BETTER_SQLITE3_BINDING pode ser passado pelo launcher para apontar
      // para o .node nativo extraído nos recursos do Tauri.
      dbOptions.nativeBinding = process.env.BETTER_SQLITE3_BINDING ||
        path.join(basePath, 'better_sqlite3.node');
    }

    _db = new Database(DB_PATH, dbOptions);
    
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    _db.pragma('foreign_keys = ON');
    _db.pragma('cache_size = -64000');

    // Inicialização automática de todas as Tabelas caso não existam no .exe!
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

      -- Novas Tabelas de Distribuição (v2)
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
    `);
  }
  return _db;
}

/** FOR TESTING ONLY. Replaces the DB singleton. Never call in production code. */
function _overrideDb(testDb) {
  _db = testDb;
}

module.exports = { getDb, _overrideDb };
