from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import List, Dict
import json
import logging
import os
from datetime import datetime, timezone

from app.database import get_db_connection
from app.services.store_service import get_store_by_token
from app.services.comanda_service import get_comanda_by_code, get_balance
from app.services.transaction_service import process_debit, InsufficientBalanceError, InvalidAmountError
from app.utils import parse_positive_int
from app.api.ws_admin import manager as admin_manager  # Importa para notificar admins

router = APIRouter()
logger = logging.getLogger("uvicorn.error")

MAX_STORE_CONNECTIONS = int(os.environ.get("MAX_STORE_CONNECTIONS", "100"))
# STRESS_NO_RATELIMIT=true bypasses WS rate limiting for load testing only
WS_RATE_LIMIT_MAX = float('inf') if os.environ.get("STRESS_NO_RATELIMIT") else 300

class StoreConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        # Maps websocket -> store_id for disconnectStoreById
        self._store_ids: Dict[WebSocket, str] = {}

    async def connect(self, websocket: WebSocket, store_id: str):
        await websocket.accept()
        self.active_connections.append(websocket)
        self._store_ids[websocket] = store_id

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        self._store_ids.pop(websocket, None)

    async def broadcast(self, message: dict):
        dead = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead.append(connection)
        for c in dead:
            self.disconnect(c)

    async def disconnect_store_by_id(self, store_id: str):
        """Closes all active WebSocket connections for a specific store (token revoked)."""
        to_close = [ws for ws, sid in self._store_ids.items() if sid == store_id]
        for ws in to_close:
            try:
                await ws.close(code=1008, reason="Token revoked")
            except Exception:
                pass
            self.disconnect(ws)

store_manager = StoreConnectionManager()

@router.websocket("/ws/store")
async def websocket_store(websocket: WebSocket, token: str):
    with get_db_connection() as conn:
        store = get_store_by_token(conn, token)

    if not store:
        await websocket.accept()
        await websocket.close(code=1008, reason="Store Token Unauthorized")
        return

    if len(store_manager.active_connections) >= MAX_STORE_CONNECTIONS:
        await websocket.accept()
        await websocket.close(code=1008, reason="Max connections reached")
        return

    await store_manager.connect(websocket, store.id)

    await websocket.send_json({
        "type": "connected",
        "store_id": store.id,
        "store_name": store.name,
        "server_time": datetime.now(timezone.utc).isoformat()
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

            if msg_type == "debit_request":
                raw_code = data.get("comanda_code")
                code = raw_code.strip().upper() if isinstance(raw_code, str) else ''
                if not code:
                    await websocket.send_json({
                        "type": "debit_rejected",
                        "reason": "comanda_not_found",
                        "requested": 0
                    })
                    continue

                amount = parse_positive_int(data.get("amount"))
                if amount is None:
                    await websocket.send_json({
                        "type": "debit_rejected",
                        "reason": "invalid_amount",
                        "requested": data.get("amount")
                    })
                    continue

                with get_db_connection() as conn:
                    comanda = get_comanda_by_code(conn, code)
                    if not comanda:
                        await websocket.send_json({
                            "type": "debit_rejected",
                            "reason": "comanda_not_found",
                            "requested": amount
                        })
                        continue

                    try:
                        event = process_debit(conn, comanda.id, amount, store.id)
                        new_balance = get_balance(conn, comanda.id)

                        await websocket.send_json({
                            "type": "debit_confirmed",
                            "event_id": event.id,
                            "comanda_code": comanda.code,
                            "holder_name": comanda.holder_name,
                            "amount": amount,
                            "new_balance": new_balance
                        })

                        await store_manager.broadcast({
                            "type": "balance_updated",
                            "comanda_code": comanda.code,
                            "new_balance": new_balance,
                            "event_type": "debit",
                            "store_id": store.id
                        })

                        await admin_manager.broadcast({
                            "type": "admin_balance_updated",
                            "comanda_code": comanda.code,
                            "new_balance": new_balance,
                            "amount": amount,
                            "store_name": store.name
                        })

                    except InsufficientBalanceError:
                        current_balance = get_balance(conn, comanda.id)
                        await websocket.send_json({
                            "type": "debit_rejected",
                            "reason": "insufficient_balance",
                            "current_balance": current_balance,
                            "requested": amount
                        })
                    except InvalidAmountError:
                        await websocket.send_json({
                            "type": "debit_rejected",
                            "reason": "invalid_amount",
                            "requested": amount
                        })
                    except Exception as e:
                        logger.error(f"Erro no debit_request: {e}")
                        await websocket.send_json({
                            "type": "debit_rejected",
                            "reason": "server_error",
                            "requested": amount
                        })

            elif msg_type == "balance_query":
                raw_code = data.get("comanda_code")
                code = raw_code.strip().upper() if isinstance(raw_code, str) else ''
                if not code:
                    await websocket.send_json({"type": "error", "reason": "comanda_not_found"})
                    continue

                with get_db_connection() as conn:
                    comanda = get_comanda_by_code(conn, code)
                    if not comanda:
                        await websocket.send_json({"type": "error", "reason": "comanda_not_found"})
                        continue

                    balance = get_balance(conn, comanda.id)
                    await websocket.send_json({
                        "type": "balance_response",
                        "comanda_code": comanda.code,
                        "holder_name": comanda.holder_name,
                        "balance": balance
                    })

            else:
                await websocket.send_json({"type": "error", "reason": "unknown_message_type"})

    except WebSocketDisconnect:
        store_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"Erro no WS Store: {e}")
        store_manager.disconnect(websocket)
