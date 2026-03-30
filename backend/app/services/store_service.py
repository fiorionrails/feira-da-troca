import uuid
from typing import Optional
from app.models import Store

def get_store_by_token(conn, terminal_token: str) -> Optional[Store]:
    """Valida uma loja Pelo seu token de terminal"""
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM stores WHERE terminal_token = ?", (terminal_token,))
    row = cursor.fetchone()
    if row:
        return Store(**dict(row))
    return None

def create_store(conn, name: str, theme: str, terminal_token: str) -> Store:
    store_id = str(uuid.uuid4())
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO stores (id, name, theme, terminal_token) VALUES (?, ?, ?, ?)",
        (store_id, name, theme, terminal_token)
    )
    conn.commit()
    return Store(id=store_id, name=name, theme=theme, terminal_token=terminal_token)
