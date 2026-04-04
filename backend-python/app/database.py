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

def get_db_connection() -> sqlite3.Connection:
    """Retorna uma conexão síncrona com os PRAGMAs configurados conforme ADR-002."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA journal_mode = WAL;")      # Habilita WAL mode
    conn.execute("PRAGMA synchronous = NORMAL;")    # Balanceia durabilidade/performance
    conn.execute("PRAGMA foreign_keys = ON;")       # Garante integridade referencial
    conn.execute("PRAGMA cache_size = -64000;")     # 64MB cache
    conn.row_factory = sqlite3.Row                  # Para poder acessar por chave como dict
    return conn
