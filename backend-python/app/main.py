from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.ws_admin import router as admin_ws_router
from app.api.ws_store import router as store_ws_router
from app.api.ws_packing import router as packing_ws_router
from app.api.rest import router as rest_router
from app.config import settings
import logging

# Configura logs do uvicorn
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ouroboros")

app = FastAPI(
    title=settings.event_name,
    description="Backend de Sincronização e Ledger do Ouroboros (Local-First)",
    version="1.0.0"
)

# Na rede local, o CORS pode ser mais permissivo, pois é um ambiente controlado sem exposição externa.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin_ws_router)
app.include_router(store_ws_router)
app.include_router(packing_ws_router)
app.include_router(rest_router)

@app.get("/")
def read_root():
    return {
        "status": "online", 
        "mode": "local-first", 
        "event": settings.event_name
    }
