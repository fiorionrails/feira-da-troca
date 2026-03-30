import sqlite3
from app.database import get_db_connection

def init_db():
    print("Iniciando configuração do banco de dados Ouroboros...")
    
    with get_db_connection() as conn:
        print("Criando tabela 'comandas'...")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS comandas (
                id TEXT PRIMARY KEY,
                code TEXT UNIQUE NOT NULL,
                holder_name TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)

        print("Criando tabela 'stores'...")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS stores (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                theme TEXT,
                terminal_token TEXT UNIQUE NOT NULL
            )
        """)

        print("Criando tabela 'events' (Event Store)...")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL CHECK(type IN ('credit', 'debit')),
                comanda_id TEXT NOT NULL,
                store_id TEXT,
                amount INTEGER NOT NULL CHECK(amount > 0),
                note TEXT,
                timestamp TEXT NOT NULL,
                synced_to_firebase INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(comanda_id) REFERENCES comandas(id),
                FOREIGN KEY(store_id) REFERENCES stores(id)
            )
        """)

        print("Criando tabela 'categories'...")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS categories (
                id TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                price INTEGER NOT NULL CHECK(price >= 0),
                total_entries INTEGER NOT NULL DEFAULT 0,
                total_exits INTEGER NOT NULL DEFAULT 0
            )
        """)

        print("Criando VIEW 'balance_view'...")
        conn.execute("""
            CREATE VIEW IF NOT EXISTS balance_view AS
            SELECT 
                comanda_id,
                SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END) AS balance
            FROM events
            GROUP BY comanda_id;
        """)

        conn.commit()
        print("Banco de dados pronto! (Tabelas e View criadas com sucesso)")

if __name__ == "__main__":
    init_db()
