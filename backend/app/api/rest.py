from fastapi import APIRouter, Depends, HTTPException, Header
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

@router.get("/stores")
def get_stores(token: str = Depends(verify_admin)):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM stores ORDER BY name ASC")
        return [dict(row) for row in cursor.fetchall()]

@router.get("/categories")
def get_categories(token: str = Depends(verify_admin)):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM categories ORDER BY name ASC")
        return [dict(row) for row in cursor.fetchall()]
