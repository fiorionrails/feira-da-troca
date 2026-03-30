import uuid
from typing import Optional
from app.models import Category

def get_category_by_name(conn, name: str) -> Optional[Category]:
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM categories WHERE name = ?", (name,))
    row = cursor.fetchone()
    if row:
        return Category(**dict(row))
    return None

def create_or_update_category(conn, name: str, price: int, initial_entries: int = 0) -> Category:
    cursor = conn.cursor()
    
    existing = get_category_by_name(conn, name)
    
    if existing:
        cursor.execute(
            "UPDATE categories SET price = ?, total_entries = total_entries + ? WHERE id = ?",
            (price, initial_entries, existing.id)
        )
        conn.commit()
        return get_category_by_name(conn, name)
    else:
        cat_id = str(uuid.uuid4())
        cursor.execute(
            "INSERT INTO categories (id, name, price, total_entries, total_exits) VALUES (?, ?, ?, ?, ?)",
            (cat_id, name, price, initial_entries, 0)
        )
        conn.commit()
        return Category(id=cat_id, name=name, price=price, total_entries=initial_entries, total_exits=0)

def list_categories(conn) -> list[Category]:
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM categories ORDER BY name ASC")
    return [Category(**dict(row)) for row in cursor.fetchall()]
