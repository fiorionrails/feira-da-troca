from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import List
import json
import logging
from datetime import datetime, timezone

from app.database import get_db_connection
from app.services.store_service import get_store_by_token
from app.services.comanda_service import get_comanda_by_code, get_balance
from app.services.transaction_service import process_debit, InsufficientBalanceError, InvalidAmountError
from app.api.ws_admin import manager as admin_manager  # Importa para notificar admins

router = APIRouter()
logger = logging.getLogger("uvicorn.error")

class StoreConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        dead = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead.append(connection)
        for c in dead:
            self.disconnect(c)

store_manager = StoreConnectionManager()

@router.websocket("/ws/store")
async def websocket_store(websocket: WebSocket, token: str):
    await store_manager.connect(websocket)
    
    with get_db_connection() as conn:
        store = get_store_by_token(conn, token)
        
    if not store:
        await websocket.close(code=1008, reason="Store Token Unauthorized")
        store_manager.disconnect(websocket)
        return
    
    await websocket.send_json({
        "type": "connected",
        "store_id": store.id,
        "store_name": store.name,
        "server_time": datetime.now(timezone.utc).isoformat()
    })

    try:
        while True:
            data_str = await websocket.receive_text()
            try:
                data = json.loads(data_str)
            except json.JSONDecodeError:
                continue

            msg_type = data.get("type")

            if msg_type == "debit_request":
                code = data.get("comanda_code")
                amount = int(data.get("amount", 0))
                
                with get_db_connection() as conn:
                    # 1. Checar se a comanda existe (pelo ID curto Fxxx)
                    comanda = get_comanda_by_code(conn, code)
                    if not comanda:
                        await websocket.send_json({
                            "type": "debit_rejected",
                            "reason": "comanda_not_found",
                            "requested": amount
                        })
                        continue
                        
                    # 2. Tentar o débito atômico
                    try:
                        event = process_debit(conn, comanda.id, amount, store.id)
                        new_balance = get_balance(conn, comanda.id)
                        
                        # 3. Sucesso para o terminal da loja
                        await websocket.send_json({
                            "type": "debit_confirmed",
                            "event_id": event.id,
                            "comanda_code": comanda.code,
                            "holder_name": comanda.holder_name,
                            "amount": amount,
                            "new_balance": new_balance
                        })
                        
                        # 4. Broadcast para *todas* as outras lojas se atualizarem caso estejam na mesma tela de comanda
                        await store_manager.broadcast({
                            "type": "balance_updated",
                            "comanda_code": comanda.code,
                            "new_balance": new_balance,
                            "event_type": "debit",
                            "store_id": store.id
                        })
                        
                        # 5. Broadcast para o painel de ADMIN ver a grana girando
                        await admin_manager.broadcast({
                            "type": "admin_balance_updated",
                            "comanda_code": comanda.code,
                            "new_balance": new_balance,
                            "amount": amount,
                            "store_name": store.name
                        })
                        
                    except InsufficientBalanceError as e:
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
                        
            elif msg_type == "balance_query":
                code = data.get("comanda_code")
                with get_db_connection() as conn:
                    comanda = get_comanda_by_code(conn, code)
                    if not comanda:
                         await websocket.send_json({
                            "type": "error",
                            "reason": "comanda_not_found"
                        })
                         continue
                         
                    balance = get_balance(conn, comanda.id)
                    await websocket.send_json({
                        "type": "balance_response",
                        "comanda_code": comanda.code,
                        "holder_name": comanda.holder_name,
                        "balance": balance
                    })

    except WebSocketDisconnect:
        store_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"Erro no WS Store: {e}")
        store_manager.disconnect(websocket)
