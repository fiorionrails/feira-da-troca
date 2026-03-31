from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
import uuid
import secrets
from app.database import get_db_connection
from app.config import settings

router = APIRouter(prefix="/api")

def verify_admin(token: str = Header(None)):
    if token != settings.admin_token:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return token

@router.get("/reports/economy_state")
def get_economy_state(token: str = Depends(verify_admin)):
    """Visão macro da feira: Total Emitido (Créditos Iniciais) e Saldo Circulante"""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        # Total Initial Credits emitted by the standard initial note "Saldo inicial"
        cursor.execute("SELECT SUM(amount) as issued FROM events WHERE type='credit' AND note='Saldo inicial'")
        issued = cursor.fetchone()["issued"] or 0
        
        cursor.execute("SELECT SUM(balance) as circulating FROM balance_view")
        circulating = cursor.fetchone()["circulating"] or 0

        cursor.execute("SELECT COUNT(*) as cmd_count FROM comandas")
        comandas_count = cursor.fetchone()["cmd_count"] or 0

        cursor.execute("SELECT COUNT(*) as st_count FROM stores")
        stores_count = cursor.fetchone()["st_count"] or 0

        return {
            "total_issued": issued,
            "total_circulating": circulating,
            "comandas_active": comandas_count,
            "stores_registered": stores_count
        }

@router.get("/comanda/{code}")
def get_comanda_by_code_endpoint(code: str, token: str = Depends(verify_admin)):
    from app.services.comanda_service import get_comanda_by_code, get_balance
    with get_db_connection() as conn:
        comanda = get_comanda_by_code(conn, code.upper())
        if not comanda:
            raise HTTPException(status_code=404, detail="Comanda não encontrada")
        balance = get_balance(conn, comanda.id)
        return {
            "id": comanda.id,
            "code": comanda.code, 
            "holder_name": comanda.holder_name,
            "balance": balance,
            "created_at": comanda.created_at
        }
@router.get("/stores")
def get_stores(token: str = Depends(verify_admin)):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM stores ORDER BY name ASC")
        return [dict(row) for row in cursor.fetchall()]

@router.get("/categories")
def get_categories(token: str = Header(None)):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM categories ORDER BY name ASC")
        return [dict(row) for row in cursor.fetchall()]

class CategoryCreate(BaseModel):
    name: str
    price: int

@router.post("/categories")
def create_category(category: CategoryCreate, token: str = Depends(verify_admin)):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM categories WHERE LOWER(name) = LOWER(?)", (category.name,))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="Categoria já existe")
            
        new_id = str(uuid.uuid4())
        cursor.execute(
            "INSERT INTO categories (id, name, price) VALUES (?, ?, ?)",
            (new_id, category.name, category.price)
        )
        conn.commit()
        return {"id": new_id, "name": category.name, "price": category.price}

class StoreCreate(BaseModel):
    name: str

class StoreUpdate(BaseModel):
    name: str

@router.post("/stores")
def create_store(store: StoreCreate, token: str = Depends(verify_admin)):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        new_id = str(uuid.uuid4())
        terminal_token = f"st_{secrets.token_hex(8)}"
        cursor.execute(
            "INSERT INTO stores (id, name, theme, terminal_token) VALUES (?, ?, ?, ?)",
            (new_id, store.name, "default", terminal_token)
        )
        conn.commit()
        return {"id": new_id, "name": store.name, "terminal_token": terminal_token}

@router.put("/stores/{store_id}")
def update_store(store_id: str, store: StoreUpdate, token: str = Depends(verify_admin)):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE stores SET name = ? WHERE id = ?", (store.name, store_id))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Store not found")
        conn.commit()
        return {"id": store_id, "name": store.name}

@router.post("/stores/{store_id}/revoke_token")
def revoke_store_token(store_id: str, token: str = Depends(verify_admin)):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        new_token = f"st_{secrets.token_hex(8)}"
        cursor.execute("UPDATE stores SET terminal_token = ? WHERE id = ?", (new_token, store_id))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Store not found")
        conn.commit()
        
        # O ideal seria desconectar o websocket ativamente aqui, 
        # mas por isolamento, o token muda no DB. O lojista nao consegue autenticar mais.
        return {"id": store_id, "new_token": new_token}

@router.get("/reports/analytics")
def get_analytics():
    """Dashboard analítico público — projetado para telão do evento."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # === KPIs ===
        cursor.execute("SELECT COUNT(*) as v FROM comandas")
        total_comandas = cursor.fetchone()["v"] or 0

        cursor.execute("SELECT SUM(amount) as v FROM events WHERE type='credit' AND note='Saldo inicial'")
        total_emitido = cursor.fetchone()["v"] or 0

        cursor.execute("SELECT SUM(amount) as v FROM events WHERE type='debit'")
        total_gasto = cursor.fetchone()["v"] or 0

        cursor.execute("SELECT SUM(balance) as v FROM balance_view")
        total_circulante = cursor.fetchone()["v"] or 0

        cursor.execute("SELECT COUNT(*) as v FROM events WHERE type='debit'")
        total_transacoes = cursor.fetchone()["v"] or 0

        cursor.execute("SELECT COUNT(*) as v FROM stores")
        lojas_ativas = cursor.fetchone()["v"] or 0

        # === Transações por minuto (últimas 2 horas) ===
        cursor.execute("""
            SELECT 
                strftime('%H:%M', timestamp) as minute,
                SUM(CASE WHEN type='credit' THEN 1 ELSE 0 END) as credits,
                SUM(CASE WHEN type='debit' THEN 1 ELSE 0 END) as debits,
                COUNT(*) as total
            FROM events
            WHERE timestamp >= datetime('now', '-2 hours')
            GROUP BY minute
            ORDER BY minute ASC
        """)
        transactions_per_minute = [dict(r) for r in cursor.fetchall()]

        # === Top Lojas por faturamento ===
        cursor.execute("""
            SELECT s.name, SUM(e.amount) as total, COUNT(e.id) as count
            FROM events e
            JOIN stores s ON e.store_id = s.id
            WHERE e.type = 'debit'
            GROUP BY s.id
            ORDER BY total DESC
            LIMIT 10
        """)
        top_stores = [dict(r) for r in cursor.fetchall()]

        # === Distribuição por categoria (baseado em events + notes futuras, por ora retorna categorias cadastradas) ===
        cursor.execute("""
            SELECT name, 
                   CASE WHEN total_entries > 0 THEN total_entries ELSE 1 END as count,
                   price
            FROM categories
            ORDER BY total_entries DESC, name ASC
        """)
        category_distribution = [dict(r) for r in cursor.fetchall()]

        return {
            "kpis": {
                "total_comandas": total_comandas,
                "total_emitido": total_emitido,
                "total_gasto": total_gasto,
                "total_circulante": total_circulante,
                "total_transacoes": total_transacoes,
                "lojas_ativas": lojas_ativas
            },
            "transactions_per_minute": transactions_per_minute,
            "top_stores": top_stores,
            "category_distribution": category_distribution
        }
