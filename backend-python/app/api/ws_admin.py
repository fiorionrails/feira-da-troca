from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import List
import json
import logging
import os
from datetime import datetime, timezone

from app.database import get_db_connection
from app.config import settings
from app.services.comanda_service import create_comanda, get_next_code, get_comanda_by_code, get_balance
from app.services.transaction_service import process_credit
from app.services.product_service import create_or_update_category
from app.utils import parse_positive_int, parse_non_negative_int
import app.logger as log

router = APIRouter()
logger = logging.getLogger("uvicorn.error")

MAX_ADMIN_CONNECTIONS = int(os.environ.get("MAX_ADMIN_CONNECTIONS", "10"))
# STRESS_NO_RATELIMIT=true bypasses WS rate limiting for load testing only
WS_RATE_LIMIT_MAX = float('inf') if os.environ.get("STRESS_NO_RATELIMIT") else 300

class AdminConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        # We handle any dead connections to prevent crashes
        dead_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead_connections.append(connection)
        for dc in dead_connections:
            self.disconnect(dc)

manager = AdminConnectionManager()

def _maybe_flag_recalc(conn):
    """Se há distribuição ativa, marca que o inventário mudou e ela precisa de recálculo."""
    from app.services.box_service import flag_needs_recalc
    row = conn.execute("SELECT id FROM distributions WHERE status = 'active'").fetchone()
    if row:
        flag_needs_recalc(row["id"], conn)

@router.websocket("/ws/admin")
async def websocket_admin(websocket: WebSocket, token: str):
    if token != settings.admin_token:
        await websocket.accept()
        await websocket.close(code=1008, reason="Unauthorized")
        return

    if len(manager.active_connections) >= MAX_ADMIN_CONNECTIONS:
        await websocket.accept()
        await websocket.close(code=1008, reason="Max connections reached")
        return

    await manager.connect(websocket)

    with get_db_connection() as conn:
        next_code = get_next_code(conn)

    await websocket.send_json({
        "type": "connected",
        "role": "admin",
        "next_code": next_code
    })

    rate_count = 0
    rate_window_start = datetime.now(timezone.utc).timestamp()

    try:
        while True:
            data_str = await websocket.receive_text()

            now = datetime.now(timezone.utc).timestamp()
            if now - rate_window_start > 60:
                rate_count = 0
                rate_window_start = now
            rate_count += 1
            if rate_count > WS_RATE_LIMIT_MAX:
                await websocket.send_json({"type": "error", "reason": "rate_limit_exceeded"})
                continue

            try:
                data = json.loads(data_str)
            except json.JSONDecodeError:
                continue

            msg_type = data.get("type")

            if msg_type == "create_comanda":
                holder_name = data.get("holder_name")
                holder_name = holder_name.strip() if isinstance(holder_name, str) else ''
                if not holder_name:
                    await websocket.send_json({"type": "error", "reason": "holder_name is required"})
                    continue

                initial_balance = parse_non_negative_int(data.get("initial_balance", 0))
                if initial_balance is None:
                    await websocket.send_json({"type": "error", "reason": "invalid_amount"})
                    continue

                cart_items = data.get("cart_items", [])
                if not isinstance(cart_items, list):
                    cart_items = []

                try:
                    with get_db_connection() as conn:
                        comanda, event_id = create_comanda(conn, holder_name, initial_balance)

                        added_items = False
                        for item in cart_items:
                            item_name = item.get("name", "").strip() if isinstance(item.get("name"), str) else ''
                            item_qty = parse_positive_int(item.get("quantity"))
                            if item_name and item_qty:
                                create_or_update_category(conn, item_name, 0, item_qty)
                                added_items = True
                        if added_items:
                            _maybe_flag_recalc(conn)

                        next_code = get_next_code(conn)

                    log.comanda_criada(comanda.code, comanda.holder_name, initial_balance)

                    await manager.broadcast({
                        "type": "comanda_created",
                        "code": comanda.code,
                        "holder_name": comanda.holder_name,
                        "balance": initial_balance
                    })

                    await manager.broadcast({
                        "type": "update_next_code",
                        "next_code": next_code
                    })
                except Exception as err:
                    await websocket.send_json({"type": "error", "reason": str(err)})

            elif msg_type == "add_credit":
                raw_code = data.get("comanda_code", "")
                comanda_code = raw_code.strip().upper() if isinstance(raw_code, str) else ''
                if not comanda_code:
                    await websocket.send_json({"type": "error", "reason": "comanda_code is required"})
                    continue

                amount = parse_positive_int(data.get("amount"))
                if amount is None:
                    await websocket.send_json({"type": "error", "reason": "invalid_amount"})
                    continue

                cart_items = data.get("cart_items", [])
                if not isinstance(cart_items, list):
                    cart_items = []

                try:
                    with get_db_connection() as conn:
                        comanda = get_comanda_by_code(conn, comanda_code)
                        if not comanda:
                            await websocket.send_json({"type": "error", "reason": "comanda_not_found"})
                            continue

                        process_credit(conn, comanda.id, amount, note="Crédito adicional")

                        added_items = False
                        for item in cart_items:
                            item_name = item.get("name", "").strip() if isinstance(item.get("name"), str) else ''
                            item_qty = parse_positive_int(item.get("quantity"))
                            if item_name and item_qty:
                                create_or_update_category(conn, item_name, 0, item_qty)
                                added_items = True
                        if added_items:
                            _maybe_flag_recalc(conn)

                        new_balance = get_balance(conn, comanda.id)

                    log.credito_confirmado(comanda_code, comanda.holder_name, amount, new_balance)

                    await manager.broadcast({
                        "type": "credit_confirmed",
                        "code": comanda_code,
                        "holder_name": comanda.holder_name,
                        "amount": amount,
                        "new_balance": new_balance
                    })
                except Exception as err:
                    await websocket.send_json({"type": "error", "reason": str(err)})

            elif msg_type == "register_category":
                name = data.get("name")
                name = name.strip() if isinstance(name, str) else ''
                if not name:
                    await websocket.send_json({"type": "error", "reason": "category name is required"})
                    continue

                price = parse_non_negative_int(data.get("price", 0))
                if price is None:
                    await websocket.send_json({"type": "error", "reason": "invalid_amount"})
                    continue

                total_entries_inc = parse_non_negative_int(data.get("total_entries", 0))
                if total_entries_inc is None:
                    await websocket.send_json({"type": "error", "reason": "invalid_amount"})
                    continue

                try:
                    with get_db_connection() as conn:
                        cat = create_or_update_category(conn, name, price, total_entries_inc)
                        if total_entries_inc > 0:
                            _maybe_flag_recalc(conn)

                    await manager.broadcast({
                        "type": "category_updated",
                        "category": cat.model_dump()
                    })
                except Exception as err:
                    await websocket.send_json({"type": "error", "reason": str(err)})

            else:
                await websocket.send_json({"type": "error", "reason": "unknown_message_type"})

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"Erro inesperado no WS Admin: {e}")
        manager.disconnect(websocket)
