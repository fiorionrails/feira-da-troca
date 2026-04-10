from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from typing import List
import json
import logging
from app.config import settings

router = APIRouter()
logger = logging.getLogger("uvicorn.error")

class PackingConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        dead_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead_connections.append(connection)
        for dc in dead_connections:
            self.disconnect(dc)

manager = PackingConnectionManager()

@router.websocket("/ws/packing")
async def websocket_packing(websocket: WebSocket, token: str = Query(...)):
    # Autenticação obrigatória com token admin
    if token != settings.admin_token:
        await websocket.accept() # Precisamos aceitar para poder fechar com código
        await websocket.close(code=4001, reason="Unauthorized")
        return

    await manager.connect(websocket)
    
    await websocket.send_json({
        "type": "connected",
        "role": "packer",
        "message": "Conectado ao canal de distribuição Ouroboros (Python)"
    })

    try:
        while True:
            # Mantém conexão aberta. Somente recebe broadcast.
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"Erro no WS Packing (Python): {e}")
        manager.disconnect(websocket)
