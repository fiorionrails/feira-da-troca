from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware
from contextlib import asynccontextmanager
from app.api.ws_admin import router as admin_ws_router
from app.api.ws_store import router as store_ws_router
from app.api.ws_packing import router as packing_ws_router
from app.api.rest import router as rest_router
from app.config import settings
import app.logger as log
import logging
import time
from collections import defaultdict

# Configura logs do uvicorn
logging.basicConfig(level=logging.INFO)

# ---------------------------------------------------------------------------
# Rate limiting middleware — 300 requests/min per IP on /api/ routes
# ---------------------------------------------------------------------------
class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, max_requests: int = 300, window_seconds: int = 60):
        super().__init__(app)
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._counts: dict = defaultdict(list)

    async def dispatch(self, request: Request, call_next):
        if not request.url.path.startswith("/api/"):
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        now = time.time()

        timestamps = self._counts[client_ip]
        self._counts[client_ip] = [t for t in timestamps if now - t < self.window_seconds]

        if len(self._counts[client_ip]) >= self.max_requests:
            return JSONResponse(
                status_code=429,
                headers={
                    "RateLimit-Limit": str(self.max_requests),
                    "RateLimit-Remaining": "0",
                },
                content={"detail": "Too Many Requests"},
            )

        self._counts[client_ip].append(now)
        return await call_next(request)

# ---------------------------------------------------------------------------
# Body size limit middleware — 10kb limit on POST/PUT/PATCH
# ---------------------------------------------------------------------------
class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, max_bytes: int = 10 * 1024):
        super().__init__(app)
        self.max_bytes = max_bytes

    async def dispatch(self, request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH"):
            content_length = request.headers.get("content-length")
            if content_length and int(content_length) > self.max_bytes:
                return Response(status_code=413, content=b"Request Entity Too Large")
        return await call_next(request)

# ---------------------------------------------------------------------------
# REST request logging middleware
# ---------------------------------------------------------------------------
class RestLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not request.url.path.startswith("/api/"):
            return await call_next(request)
        start = time.time()
        response = await call_next(request)
        ms = round((time.time() - start) * 1000)
        log.rest(request.method, request.url.path, response.status_code, ms)
        return response

@asynccontextmanager
async def lifespan(app):
    # Clear WS manager connection pools on every startup.
    # Critical for test isolation: Starlette TestClient creates a new app instance per
    # test, but module-level WS manager singletons persist across instances. Stale
    # half-closed connections cause broadcast() to hang waiting for TCP acknowledgment.
    from app.api.ws_admin import manager as admin_manager
    from app.api.ws_store import store_manager
    from app.api.ws_packing import manager as packing_manager
    admin_manager.active_connections.clear()
    store_manager.active_connections.clear()
    packing_manager.active_connections.clear()
    log.banner({
        "port": 8000,
        "database_url": settings.database_url,
        "admin_token": settings.admin_token,
        "max_comandas": settings.max_comandas,
        "event_name": settings.event_name,
    })
    yield

app = FastAPI(
    title=settings.event_name,
    description="Backend de Sincronização e Ledger do Ouroboros (Local-First)",
    version="1.0.0",
    lifespan=lifespan,
)

# Na rede local, o CORS pode ser mais permissivo, pois é um ambiente controlado sem exposição externa.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(BodySizeLimitMiddleware)
app.add_middleware(RestLogMiddleware)

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
