from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from typing import List
import json
import logging

from app.database import get_db_connection
from app.config import settings
from app.services.comanda_service import create_comanda, get_next_code
from app.services.product_service import create_or_update_category

router = APIRouter()
logger = logging.getLogger("uvicorn.error")

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

@router.websocket("/ws/admin")
async def websocket_admin(websocket: WebSocket, token: str):
    if token != settings.admin_token:
        await websocket.close(code=1008, reason="Unauthorized")
        return

    await manager.connect(websocket)
    
    # Invia estado inicial ao conectar
    with get_db_connection() as conn:
        next_code = get_next_code(conn)
        
    await websocket.send_json({
        "type": "connected",
        "role": "admin",
        "next_code": next_code
    })

    try:
        while True:
            data_str = await websocket.receive_text()
            try:
                data = json.loads(data_str)
            except json.JSONDecodeError:
                continue

            msg_type = data.get("type")

            if msg_type == "create_comanda":
                holder_name = data.get("holder_name")
                initial_balance = int(data.get("initial_balance", 0))
                
                with get_db_connection() as conn:
                    # Gera a criar comanda (o code gerado será Fxxx)
                    comanda, event_id = create_comanda(conn, holder_name, initial_balance)
                    
                    # Identifica qual será o *próximo* código depois dessa criação
                    next_code = get_next_code(conn)
                
                # Broadcast: Comanda criada
                await manager.broadcast({
                    "type": "comanda_created",
                    "code": comanda.code,
                    "holder_name": comanda.holder_name,
                    "balance": initial_balance
                })
                
                # Broadcast: Atualização do próximo código disponível para as outras telas do Banco
                await manager.broadcast({
                    "type": "update_next_code",
                    "next_code": next_code
                })
                
            elif msg_type == "register_category":
                name = data.get("name")
                price = int(data.get("price", 0))
                total_entries_inc = int(data.get("total_entries", 0))
                
                with get_db_connection() as conn:
                    cat = create_or_update_category(conn, name, price, total_entries_inc)
                
                # Notifica os admins que a categoria atualizou
                await manager.broadcast({
                    "type": "category_updated",
                    "category": cat.model_dump()
                })

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"Erro inesperado no WS Admin: {e}")
        manager.disconnect(websocket)
