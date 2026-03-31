import sqlite3
from .config import settings

# Extraindo o caminho do db ignorando "sqlite:///"
DB_PATH = settings.database_url.replace("sqlite:///", "")

def get_db_connection() -> sqlite3.Connection:
    """Retorna uma conexão síncrona com os PRAGMAs configurados conforme ADR-002."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA journal_mode = WAL;")      # Habilita WAL mode
    conn.execute("PRAGMA synchronous = NORMAL;")    # Balanceia durabilidade/performance
    conn.execute("PRAGMA foreign_keys = ON;")       # Garante integridade referencial
    conn.execute("PRAGMA cache_size = -64000;")     # 64MB cache
    conn.row_factory = sqlite3.Row                  # Para poder acessar por chave como dict
    return conn
