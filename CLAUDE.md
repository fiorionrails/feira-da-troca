# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Ouroboros** is a local-first digital economy system for school fair events. It replaces physical currency (tokens, cardboard) with a digital layer that operates 100% offline within a LAN. The system processes transactions in <10ms latency using SQLite with WAL mode and WebSocket for real-time updates.

**Core Philosophy**: Internet is optional, not infrastructure. The system prioritizes reliability over convenience, designed to handle WiFi failures, power outages, and rate limiting by running entirely on a single notebook server.

## Architecture

### Three-component system:
1. **Backend** (Node.js + Express OR Python + FastAPI) — REST API + WebSocket server + SQLite database
2. **Terminal Banco** (React) — Admin interface for creating "comandas" (accounts), adding credit, managing stores
3. **Terminal Loja** (React) — Store interface for debiting comandas via 6-character tokens (e.g., XJ92KF)

### Key Design Decisions:
- **Event Sourcing**: All transactions are immutable events. Balance is derived via SQL view `balance_view`
- **SQLite WAL mode**: Enables concurrent reads during writes, preserves state during crashes
- **Local-first**: No external dependencies required during operation. Firebase sync is optional/eventual
- **Token-based auth**: Admin uses `ADMIN_TOKEN` from `.env`, stores use auto-generated 6-char tokens

## Development Commands

### Backend (Node.js)
```bash
cd backend-node
npm install
cp .env.example .env          # Configure ADMIN_TOKEN
npm run db:init               # Initialize SQLite database (creates ouroboros.db)
npm start                     # Start server on port 8000
npm run dev                   # Start with auto-reload
```

### Backend (Python)
```bash
cd backend-python
python -m venv .venv
source .venv/bin/activate     # Linux/Mac
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
cp .env.example .env          # Configure ADMIN_TOKEN
python manage.py              # Initialize SQLite database
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev                   # Start Vite dev server on port 5173
npm run build                 # Build for production
npm run lint                  # Run ESLint
```

### Testing
```bash
# Python backend includes stress tests
cd backend-python
python stress_test.py         # Simulate 5 stores bombarding server
python test_api_flow.py       # Test complete API flow
```

## Database Schema

### Tables:
- `comandas`: Account records (id, code, holder_name, created_at)
- `stores`: Store records (id, name, theme, terminal_token)
- `events`: Immutable transaction log (id, type, comanda_id, store_id, amount, note, timestamp)
- `categories`: Product categories with pricing (id, name, price, total_entries, total_exits)

### Views:
- `balance_view`: Derived balances via `SUM(CASE WHEN type='credit' THEN amount ELSE -amount END)`

### Event Types:
- `credit`: Add funds (from Banco terminal, initial balance = "Saldo inicial")
- `debit`: Subtract funds (from Loja terminal, includes store_id)

**CRITICAL**: Never directly modify balances. Always create events with proper `type`.

## Backend API Structure

### REST Endpoints (require `token` header or query param):
- `GET /api/reports/economy_state` (admin) — Total issued, circulating, comanda/store counts
- `GET /api/comanda/:code` (admin) — Fetch comanda details + balance by code
- `GET /api/stores` (admin) — List all stores
- `POST /api/stores` (admin) — Create store (auto-generates 6-char token)
- `PUT /api/stores/:storeId` (admin) — Update store name
- `POST /api/stores/:storeId/revoke_token` (admin) — Regenerate store token
- `GET /api/categories` (public) — List product categories
- `POST /api/categories` (admin) — Create/update category

### WebSocket Endpoints:
- `ws/admin?token=<ADMIN_TOKEN>` — Banco terminal connection
  - Messages: `create_comanda`, `credit_confirmed`, `register_category`, `update_next_code`, `admin_balance_updated`
- `ws/store?token=<STORE_TOKEN>` — Loja terminal connection
  - Messages: `debit_request`, `debit_confirmed`, `debit_rejected`, `balance_query`, `balance_response`, `balance_updated`

## Code Architecture

### Backend (Node.js) Structure:
```
backend-node/src/
├── api/
│   ├── rest.js        # REST route handlers
│   ├── wsAdmin.js     # Admin WebSocket logic + broadcast to all admin clients
│   └── wsStore.js     # Store WebSocket logic + store connections map
├── services/
│   ├── comandaService.js      # getNextCode, createComanda, getComandaByCode, getBalance
│   ├── storeService.js        # getStoreByToken
│   ├── transactionService.js  # processCredit, processDebit
│   └── productService.js      # createOrUpdateCategory
├── app.js             # Express app + WebSocket upgrade handler
├── config.js          # Environment variables via dotenv
├── database.js        # SQLite connection singleton with WAL pragma
├── models.js          # EventType enum
└── utils.js           # nowIso() helper
```

### Frontend Structure:
```
frontend/src/
├── pages/
│   ├── Login.jsx                  # Role selection (Banco/Loja)
│   ├── admin/Dashboard.jsx        # Banco interface (dual mode: new comanda / add credit)
│   ├── admin/Analytics.jsx        # Public analytics dashboard (live feed via polling + WebSocket)
│   └── store/Terminal.jsx         # Loja interface (search comanda, debit cart)
├── hooks/
│   ├── useAdminWebSocket.js       # Admin WebSocket connection manager
│   └── useStoreWebSocket.js       # Store WebSocket connection manager
├── config.js                      # API base URL configuration
└── App.jsx                        # React Router setup
```

## Key Implementation Patterns

### Transaction Processing:
All credit/debit operations use SQLite transactions to ensure atomicity:
```javascript
const transaction = db.transaction(() => {
  insertEvent.run(eventId, type, comandaId, amount, note, timestamp);
  // Other operations...
});
transaction();
```

### WebSocket Broadcasting:
- Admin connections are tracked in a `Set` and receive all economy updates
- Store connections are tracked in a `Map` keyed by connection object
- Both use try-catch to handle closed connections gracefully

### Comanda Code Generation:
Codes follow pattern `F001`, `F002`, etc. The `getNextCode()` function queries the most recent code and increments.

### Balance Calculation:
Always derive balance from `balance_view` — never store balance as a column. This ensures audit trail integrity.

### Frontend Real-time Updates:
- Admin/Analytics: WebSocket connections receive `admin_balance_updated` events with live transaction feed
- Store: WebSocket receives `balance_updated` when the searched comanda's balance changes at another terminal

## Important Constraints

1. **All amounts are integers** — No decimal handling. The system uses "ETC" (Etec Token Coin) as whole units
2. **Comanda codes are case-sensitive in DB** — Always uppercase before querying
3. **Store tokens are case-insensitive** — Frontend uppercases, backend compares uppercase
4. **WAL mode files** — `.db-wal` and `.db-shm` are working files, never commit to git
5. **Event immutability** — Never UPDATE or DELETE from `events` table. Always INSERT new events
6. **Firebase sync is optional** — The `synced_to_firebase` flag exists but sync logic is not yet implemented
7. **No external internet required** — All components communicate via LAN only

## Configuration Files

### Backend .env:
```
ADMIN_TOKEN=<strong-secret-token>
DATABASE_URL=ouroboros.db
PORT=8000                          # Node.js only — Python usa --port via CLI
EVENT_NAME=Feira da Troca 2024
MAX_COMANDAS=1000                  # Opcional — limite de comandas (padrão: 1000)
```

### Variáveis de ambiente opcionais (apenas Node.js):
```
MAX_STORE_CONNECTIONS=100          # Limite de conexões WebSocket simultâneas de loja
STRESS_NO_RATELIMIT=true           # Desativa rate limiting de WS (apenas testes de carga)
FRONTEND_DIST=./public             # Caminho do build do frontend (modo launcher/pkg)
```

### Frontend config.js:
```javascript
export const API_BASE_URL = "http://localhost:8000";
export const WS_BASE_URL = "ws://localhost:8000";
```

For production deployment, update these to the server's LAN IP (e.g., `192.168.1.10`).

## Testing Strategy

When making changes:
1. Initialize a fresh database with `npm run db:init` or `python manage.py`
2. Start the backend
3. Test via frontend:
   - Create comandas in Banco terminal
   - Create stores in Admin panel
   - Debit comandas in Loja terminal (open in incognito)
4. Verify WebSocket real-time updates work across multiple browser tabs
5. For load testing, use `python stress_test.py` in backend-python

## Common Workflows

### Adding a new REST endpoint:
1. Add route handler in `backend-node/src/api/rest.js` or `backend-python/app/api/rest.py`
2. Use `adminAuth` middleware for admin-only endpoints
3. Get database connection: `const db = getDb()` (Node) or `db = get_db()` (Python)
4. Update API reference documentation in `docs/api/reference.md`

### Adding a new WebSocket message type:
1. Update handler in `wsAdmin.js` or `wsStore.js`
2. Add corresponding message in frontend hook (`useAdminWebSocket.js` or `useStoreWebSocket.js`)
3. Ensure proper error handling and connection state checks
4. Update API reference documentation

### Adding a database table:
1. Update schema in `manage.js` (Node) or `manage.py` (Python)
2. Add service functions in `backend-node/src/services/` or `backend-python/app/services/`
3. Drop and recreate database (data loss acceptable in dev)
4. Update this CLAUDE.md with schema changes

## Documentation

Full documentation is in `docs/` (MkDocs format):
- `docs/architecture/adr-001.md` — Why local-first
- `docs/architecture/adr-002.md` — Why SQLite
- `docs/architecture/adr-003.md` — Why event sourcing
- `docs/api/reference.md` — Complete API specification
- `docs/guides/resilience.md` — Failure recovery strategies
- `docs/guides/setup.md` — Deployment guide

## Deployment Notes

For a school fair event:
1. Run backend on a notebook with static LAN IP
2. Serve frontend build from backend's static file handler or separate HTTP server
3. Communicate server IP to all terminal operators (Banco + Lojas)
4. Backup `ouroboros.db` periodically (e.g., every 30 minutes)
5. If server crashes, restart — WAL mode preserves committed transactions
6. Post-event: Query `events` table for complete audit trail

## Frontend Design Philosophy

The included frontend is a **functional demonstration**, not a final design. It implements all required flows but prioritizes functionality over aesthetics. Schools are encouraged to customize/redesign the UI while keeping the backend API contract stable.
