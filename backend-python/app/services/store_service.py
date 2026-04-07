from typing import Optional
from app.models import Store


def get_store_by_token(conn, terminal_token: str) -> Optional[Store]:
    """Valida uma loja pelo seu token de terminal (case-insensitive)."""
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM stores WHERE terminal_token = ?", (terminal_token.upper(),))
    row = cursor.fetchone()
    if row:
        return Store(**dict(row))
    return None
