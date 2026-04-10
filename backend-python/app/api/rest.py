from fastapi import APIRouter, Depends, HTTPException, Header, BackgroundTasks, Request
from pydantic import BaseModel
from typing import Optional, Any
import uuid
import secrets
from datetime import datetime, timezone
from app.database import get_db_connection
from app.config import settings

router = APIRouter(prefix="/api")

def verify_admin(request: Request):
    token = request.headers.get('token') or request.query_params.get('token')
    if not token or token != settings.admin_token:
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
    name: Optional[str] = None
    price: Optional[int] = None

@router.post("/categories", status_code=201)
def create_category(category: CategoryCreate, background_tasks: BackgroundTasks, token: str = Depends(verify_admin)):
    name = category.name.strip() if category.name else ''
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    price = category.price
    if price is None or not isinstance(price, int) or isinstance(price, bool) or price <= 0:
        raise HTTPException(status_code=400, detail="price must be a positive integer")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM categories WHERE LOWER(name) = LOWER(?)", (name,))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="Categoria já existe")
            
        new_id = str(uuid.uuid4())
        cursor.execute(
            "INSERT INTO categories (id, name, price) VALUES (?, ?, ?)",
            (new_id, name, price)
        )
        conn.commit()
        
        new_cat = {"id": new_id, "name": name, "price": price, "total_entries": 0, "total_exits": 0}
        
        from app.api.ws_admin import manager
        background_tasks.add_task(manager.broadcast, {"type": "category_updated", "category": new_cat})
        
        return new_cat

class StoreCreate(BaseModel):
    name: Optional[str] = None

class StoreUpdate(BaseModel):
    name: Optional[str] = None

@router.post("/stores", status_code=201)
def create_store(store: StoreCreate, token: str = Depends(verify_admin)):
    name = store.name.strip() if store.name else ''
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        new_id = str(uuid.uuid4())
        # Token mais amigável: 6 caracteres alfanuméricos maiúsculos (ex: XJ92KF)
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" # Removemos 0, O, 1, I para evitar confusão
        terminal_token = "".join(secrets.choice(alphabet) for _ in range(6))
        cursor.execute(
            "INSERT INTO stores (id, name, theme, terminal_token) VALUES (?, ?, ?, ?)",
            (new_id, name, "default", terminal_token)
        )
        conn.commit()
        return {"id": new_id, "name": name, "terminal_token": terminal_token}

@router.put("/stores/{store_id}")
def update_store(store_id: str, store: StoreUpdate, token: str = Depends(verify_admin)):
    name = store.name.strip() if store.name else ''
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE stores SET name = ? WHERE id = ?", (name, store_id))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Store not found")
        conn.commit()
        return {"id": store_id, "name": name}

@router.post("/stores/{store_id}/revoke_token")
def revoke_store_token(store_id: str, background_tasks: BackgroundTasks, token: str = Depends(verify_admin)):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        new_token = "".join(secrets.choice(alphabet) for _ in range(6))
        cursor.execute("UPDATE stores SET terminal_token = ? WHERE id = ?", (new_token, store_id))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Store not found")
        conn.commit()

    from app.api.ws_store import store_manager
    background_tasks.add_task(store_manager.disconnect_store_by_id, store_id)
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
                strftime('%H:%M', datetime(timestamp, 'localtime')) as minute,
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

# --- Distribuição Admin ---

class DistributionCreate(BaseModel):
    name: Optional[str] = None
    num_boxes: Optional[Any] = None

@router.get("/distribution")
def list_distributions(token: str = Depends(verify_admin)):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM distributions ORDER BY created_at DESC")
        return [dict(r) for r in cursor.fetchall()]

@router.post("/distribution", status_code=201)
def create_distribution(dist: DistributionCreate, token: str = Depends(verify_admin)):
    name = dist.name.strip() if dist.name else ''
    num_boxes = dist.num_boxes
    # mirrors Node.js: if (!name || !num_boxes) → 400
    if not name or not num_boxes:
        raise HTTPException(status_code=400, detail="name and num_boxes are required")
    # mirrors Node.js: if (!Number.isInteger(num_boxes) || num_boxes <= 0) → 400
    if not isinstance(num_boxes, int) or isinstance(num_boxes, bool) or num_boxes <= 0:
        raise HTTPException(status_code=400, detail="num_boxes must be a positive integer")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        new_id = str(uuid.uuid4())
        cursor.execute(
            "INSERT INTO distributions (id, name, num_boxes, status, created_at) VALUES (?, ?, ?, ?, ?)",
            (new_id, name, num_boxes, 'planning', datetime.now(timezone.utc).isoformat())
        )
        conn.commit()
        return {"id": new_id, "name": name, "num_boxes": num_boxes, "status": "planning"}

@router.get("/distribution/suggest")
def get_distribution_suggestion(token: str = Depends(verify_admin)):
    from app.services.distribution_service import suggest_box_count
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT total_entries FROM categories WHERE total_entries > 0")
        categories = [dict(r) for r in cursor.fetchall()]
        cursor.execute("SELECT COUNT(*) as c FROM stores")
        stores_count = cursor.fetchone()["c"]
        return suggest_box_count(categories, stores_count)

@router.get("/distribution/{dist_id}")
def get_distribution_detail(dist_id: str, token: str = Depends(verify_admin)):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM distributions WHERE id = ?", (dist_id,))
        dist = cursor.fetchone()
        if not dist:
            raise HTTPException(status_code=404, detail="Distribution not found")
        
        cursor.execute("""
            SELECT b.*, s.name as store_name
            FROM boxes b
            JOIN stores s ON b.assigned_store_id = s.id
            WHERE b.distribution_id = ?
            ORDER BY b.box_number ASC
        """, (dist_id,))
        boxes = [dict(r) for r in cursor.fetchall()]

        for box in boxes:
            cursor.execute("""
                SELECT bi.target_quantity, c.name as category_name
                FROM box_items bi
                JOIN categories c ON bi.category_id = c.id
                WHERE bi.box_id = ?
            """, (box["id"],))
            box["items"] = [dict(r) for r in cursor.fetchall()]

        return {"distribution": dict(dist), "boxes": boxes}

@router.post("/distribution/{dist_id}/calculate")
def calculate_distribution_endpoint(dist_id: str, token: str = Depends(verify_admin)):
    from app.services.distribution_service import distribute_items
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM distributions WHERE id = ?", (dist_id,))
        dist = cursor.fetchone()
        if not dist:
            raise HTTPException(status_code=404, detail="Distribution not found")
        
        cursor.execute("SELECT id, name, total_entries FROM categories WHERE total_entries > 0")
        categories = [dict(r) for r in cursor.fetchall()]
        cursor.execute("SELECT id, name FROM stores ORDER BY name ASC")
        stores = [dict(r) for r in cursor.fetchall()]
        
        if not stores:
            raise HTTPException(status_code=400, detail="Nenhuma loja cadastrada para receber caixas.")

        try:
            result = distribute_items(categories, dist["num_boxes"], stores)
            
            # Limpar anterior
            cursor.execute("SELECT id FROM boxes WHERE distribution_id = ?", (dist_id,))
            old_boxes = cursor.fetchall()
            if old_boxes:
                old_ids = [b["id"] for b in old_boxes]
                placeholders = ",".join("?" * len(old_ids))
                cursor.execute(f"DELETE FROM box_items WHERE box_id IN ({placeholders})", tuple(old_ids))
                cursor.execute("DELETE FROM boxes WHERE distribution_id = ?", (dist_id,))

            for b in result["boxes"]:
                new_box_id = str(uuid.uuid4())
                cursor.execute(
                    "INSERT INTO boxes (id, distribution_id, box_number, assigned_store_id, status) VALUES (?, ?, ?, ?, ?)",
                    (new_box_id, dist_id, b["box_number"], b["assigned_store_id"], "pending")
                )
                for cat_id, qty in b["items"].items():
                    cursor.execute(
                        "INSERT INTO box_items (id, box_id, category_id, target_quantity) VALUES (?, ?, ?, ?)",
                        (str(uuid.uuid4()), new_box_id, cat_id, qty)
                    )
            
            conn.commit()
            return {"message": "Distribuição calculada com sucesso", "warnings": result["warnings"]}
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

@router.put("/distribution/{dist_id}/activate")
def activate_distribution(dist_id: str, background_tasks: BackgroundTasks, token: str = Depends(verify_admin)):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM distributions WHERE id = ?", (dist_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Distribution not found")
        # Archive any previously active distribution
        cursor.execute(
            "UPDATE distributions SET status = 'complete' WHERE status = 'active' AND id != ?",
            (dist_id,)
        )
        cursor.execute("UPDATE distributions SET status = 'active' WHERE id = ?", (dist_id,))
        conn.commit()

    from app.api.ws_packing import manager as packing_manager
    background_tasks.add_task(packing_manager.broadcast, {"type": "distribution_status_changed", "status": "active"})
    return {"status": "active"}

@router.delete("/distribution/{dist_id}")
def delete_distribution(dist_id: str, token: str = Depends(verify_admin)):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM distributions WHERE id = ?", (dist_id,))
        dist = cursor.fetchone()
        if not dist:
            raise HTTPException(status_code=404, detail="Distribution not found")

        if dist["status"] == "active":
            cursor.execute(
                "SELECT COUNT(*) as c FROM boxes WHERE distribution_id = ? AND status = 'in_progress'",
                (dist_id,)
            )
            in_progress = cursor.fetchone()["c"]
            if in_progress > 0:
                raise HTTPException(
                    status_code=409,
                    detail=f"Não é possível excluir: {in_progress} caixa(s) estão sendo montadas agora."
                )

        cursor.execute("SELECT id FROM boxes WHERE distribution_id = ?", (dist_id,))
        boxes = cursor.fetchall()
        if boxes:
            box_ids = [b["id"] for b in boxes]
            placeholders = ",".join("?" * len(box_ids))
            cursor.execute(f"DELETE FROM box_items WHERE box_id IN ({placeholders})", tuple(box_ids))
            cursor.execute("DELETE FROM boxes WHERE distribution_id = ?", (dist_id,))
        cursor.execute("DELETE FROM distributions WHERE id = ?", (dist_id,))
        conn.commit()

    return {"message": "Rodada excluída."}

# --- Packing API ---

@router.get("/packing/active")
def get_active_packing(token: str = Depends(verify_admin)):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM distributions WHERE status = 'active' ORDER BY created_at DESC")
        dist = cursor.fetchone()
        if not dist:
            raise HTTPException(status_code=404, detail="Nenhuma distribuição ativa no momento.")

        cursor.execute("""
            SELECT b.*, s.name as store_name
            FROM boxes b
            JOIN stores s ON b.assigned_store_id = s.id
            WHERE b.distribution_id = ?
            ORDER BY b.box_number ASC
        """, (dist["id"],))
        boxes = [dict(r) for r in cursor.fetchall()]

        for box in boxes:
            cursor.execute("""
                SELECT bi.target_quantity, c.name as category_name
                FROM box_items bi
                JOIN categories c ON bi.category_id = c.id
                WHERE bi.box_id = ?
            """, (box["id"],))
            box["items"] = [dict(r) for r in cursor.fetchall()]

        stats = {
            "total_boxes": len(boxes),
            "pending": len([b for b in boxes if b["status"] == "pending"]),
            "in_progress": len([b for b in boxes if b["status"] == "in_progress"]),
            "done": len([b for b in boxes if b["status"] == "done"])
        }

        return {"distribution": dict(dist), "boxes": boxes, "stats": stats}

class ClaimRequest(BaseModel):
    responsible_name: Optional[str] = None

@router.post("/packing/boxes/{box_id}/claim")
def claim_box_endpoint(box_id: str, req: ClaimRequest, background_tasks: BackgroundTasks, token: str = Depends(verify_admin)):
    from app.services.box_service import claim_box
    responsible_name = req.responsible_name.strip() if req.responsible_name else ''
    if not responsible_name:
        raise HTTPException(status_code=400, detail="O seu nome é obrigatório para assumir a caixa.")
    try:
        claim_box(box_id, responsible_name)
        from app.api.ws_packing import manager as packing_manager
        background_tasks.add_task(packing_manager.broadcast, {
            "type": "box_claimed",
            "box_id": box_id,
            "responsible_name": responsible_name
        })
        return {"message": "Caixa assumida com sucesso!"}
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

@router.post("/packing/boxes/{box_id}/complete")
def complete_box_endpoint(box_id: str, background_tasks: BackgroundTasks, token: str = Depends(verify_admin)):
    from app.services.box_service import complete_box
    try:
        recalc_triggered = complete_box(box_id)
        from app.api.ws_packing import manager as packing_manager
        background_tasks.add_task(packing_manager.broadcast, {"type": "box_completed", "box_id": box_id})
        if recalc_triggered:
            background_tasks.add_task(packing_manager.broadcast, {"type": "distribution_recalculated"})
        return {"message": "Caixa concluída com sucesso!", "recalc_triggered": recalc_triggered}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/packing/boxes/{box_id}/cancel")
def cancel_box_endpoint(box_id: str, background_tasks: BackgroundTasks, token: str = Depends(verify_admin)):
    from app.services.box_service import cancel_box
    try:
        recalc_triggered = cancel_box(box_id)
        from app.api.ws_packing import manager as packing_manager
        background_tasks.add_task(packing_manager.broadcast, {"type": "box_released", "box_id": box_id})
        if recalc_triggered:
            background_tasks.add_task(packing_manager.broadcast, {"type": "distribution_recalculated"})
        return {"message": "Caixa liberada para outros voluntários.", "recalc_triggered": recalc_triggered}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
