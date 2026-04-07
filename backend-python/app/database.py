import sqlite3
import os
import sys
from .config import settings

# Extraindo o caminho do db ignorando "sqlite:///"
_db_rel = settings.database_url.replace("sqlite:///", "")

if getattr(sys, 'frozen', False):
    # Rodando como Executável compilado via PyInstaller
    base_dir = os.path.dirname(sys.executable)
else:
    # Rodando em dev
    base_dir = os.getcwd()

if os.path.isabs(_db_rel):
    DB_PATH = _db_rel
else:
    DB_PATH = os.path.join(base_dir, _db_rel.replace("./", ""))

_SCHEMA_SQL = """
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

-- Índices para queries críticas de performance
CREATE INDEX IF NOT EXISTS idx_events_comanda_id ON events(comanda_id);
CREATE INDEX IF NOT EXISTS idx_events_store_id ON events(store_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_boxes_distribution_id ON boxes(distribution_id);
CREATE INDEX IF NOT EXISTS idx_boxes_status ON boxes(status);
CREATE INDEX IF NOT EXISTS idx_box_items_box_id ON box_items(box_id);
CREATE INDEX IF NOT EXISTS idx_box_items_category_id ON box_items(category_id);
"""

_initialized = False

def _init_schema(conn: sqlite3.Connection) -> None:
    """Creates all tables and views if they don't exist (auto-init like Node.js getDb)."""
    conn.executescript(_SCHEMA_SQL)

def get_db_connection() -> sqlite3.Connection:
    """Retorna uma conexão síncrona com os PRAGMAs configurados conforme ADR-002.
    Auto-inicializa o schema na primeira chamada (sem precisar rodar manage.py).
    """
    global _initialized
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA journal_mode = WAL;")      # Habilita WAL mode
    conn.execute("PRAGMA synchronous = NORMAL;")    # Balanceia durabilidade/performance
    conn.execute("PRAGMA foreign_keys = ON;")       # Garante integridade referencial
    conn.execute("PRAGMA cache_size = -64000;")     # 64MB cache
    conn.row_factory = sqlite3.Row                  # Para poder acessar por chave como dict
    if not _initialized:
        _init_schema(conn)
        _initialized = True
    return conn
