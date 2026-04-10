"""
Test database helper.
Creates a fresh in-memory SQLite database with the full Ouroboros schema.
Each call returns an independent isolated connection.
For concurrency tests that need multiple connections to the same DB,
use create_shared_test_db() which returns a file path for a temporary database.
"""

import sqlite3
import uuid
import tempfile
import os

SCHEMA_SQL = """
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

DROP VIEW IF EXISTS balance_view;
CREATE VIEW balance_view AS
SELECT
    comanda_id,
    SUM(CASE WHEN type='credit' THEN amount ELSE -amount END) AS balance
FROM events
GROUP BY comanda_id;

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
"""


def _connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.row_factory = sqlite3.Row
    return conn


def create_test_db() -> sqlite3.Connection:
    """Returns a fresh in-memory SQLite connection with the full schema initialized."""
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA_SQL)
    return conn


def create_shared_test_db() -> tuple:
    """
    Returns (db_path, conn) for a temporary file-based SQLite database.
    Multiple threads can open independent connections to the same file.
    Suitable for concurrency tests.
    The caller is responsible for deleting the file after the test.
    """
    fd, db_path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    conn = _connect(db_path)
    conn.executescript(SCHEMA_SQL)
    return db_path, conn


def open_shared_db(db_path: str) -> sqlite3.Connection:
    """Opens an additional connection to the shared test database file."""
    return _connect(db_path)
