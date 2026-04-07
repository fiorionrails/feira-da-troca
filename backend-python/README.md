# Ouroboros – Backend Python

Backend do sistema **Ouroboros** para a Feira da Troca, implementado em **Python + FastAPI**.

Mantém total compatibilidade de API com a versão Node.js/Express: mesmos endpoints REST, mesmos contratos de WebSocket e o mesmo banco de dados SQLite.

---

## Tecnologias

| Componente      | Tecnologia         |
|-----------------|--------------------|
| Linguagem       | Python 3.11+       |
| HTTP Framework  | FastAPI            |
| WebSocket       | FastAPI WebSocket  |
| Banco de Dados  | SQLite (WAL mode)  |
| Driver SQLite   | sqlite3 (stdlib)   |
| Variáveis de Ambiente | python-dotenv |
| Servidor ASGI   | Uvicorn            |

---

## Instalação e Execução

```bash
# 1. Criar e ativar ambiente virtual
python -m venv .venv
source .venv/bin/activate   # Linux/Mac
.venv\Scripts\activate      # Windows

# 2. Instalar dependências
pip install -r requirements.txt

# 3. Copiar e configurar variáveis de ambiente
cp .env.example .env
# Edite o arquivo .env com seu ADMIN_TOKEN etc.

# 4. Inicializar o banco de dados (cria tabelas e views)
python manage.py

# 5. Iniciar o servidor
uvicorn app.main:app --host 0.0.0.0 --port 8000

# Modo desenvolvimento (reinicia ao salvar arquivos)
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

O servidor sobe em `http://0.0.0.0:8000` por padrão.

---

## Endpoints REST

| Método | Rota                                    | Auth  | Descrição                               |
|--------|-----------------------------------------|-------|-----------------------------------------|
| GET    | `/`                                     | —     | Status do servidor                      |
| GET    | `/api/reports/economy_state`            | Admin | Visão macro da economia do evento       |
| GET    | `/api/comanda/{code}`                   | Admin | Detalhes de uma comanda pelo código     |
| GET    | `/api/stores`                           | Admin | Listar lojas                            |
| POST   | `/api/stores`                           | Admin | Criar loja (gera token automaticamente) |
| PUT    | `/api/stores/{store_id}`               | Admin | Renomear loja                           |
| POST   | `/api/stores/{store_id}/revoke_token`  | Admin | Revogar/regenerar token da loja         |
| GET    | `/api/categories`                       | —     | Listar categorias                       |
| POST   | `/api/categories`                       | Admin | Criar categoria                         |
| GET    | `/api/reports/analytics`               | —     | Dashboard analítico público             |

**Autenticação Admin:** envie o token no header `token: <ADMIN_TOKEN>`.

---

## WebSocket

### Admin — `ws://localhost:8000/ws/admin?token=<ADMIN_TOKEN>`

**Mensagens enviadas pelo cliente:**

```json
{ "type": "create_comanda", "holder_name": "Maria", "initial_balance": 50, "cart_items": [] }
{ "type": "add_credit", "comanda_code": "F001", "amount": 20, "cart_items": [] }
{ "type": "register_category", "name": "Brigadeiro", "price": 5, "total_entries": 0 }
```

**Mensagens recebidas:**

```json
{ "type": "connected", "role": "admin", "next_code": "F001" }
{ "type": "comanda_created", "code": "F001", "holder_name": "Maria", "balance": 50 }
{ "type": "update_next_code", "next_code": "F002" }
{ "type": "credit_confirmed", "code": "F001", "holder_name": "Maria", "amount": 20, "new_balance": 70 }
{ "type": "admin_balance_updated", "comanda_code": "F001", "new_balance": 45, "amount": 5, "store_name": "Loja A" }
{ "type": "category_updated", "category": { ... } }
```

### Loja — `ws://localhost:8000/ws/store?token=<STORE_TOKEN>`

**Mensagens enviadas pelo cliente:**

```json
{ "type": "debit_request", "comanda_code": "F001", "amount": 10 }
{ "type": "balance_query", "comanda_code": "F001" }
```

**Mensagens recebidas:**

```json
{ "type": "connected", "store_id": "...", "store_name": "Loja A", "server_time": "..." }
{ "type": "debit_confirmed", "event_id": "...", "comanda_code": "F001", "holder_name": "Maria", "amount": 10, "new_balance": 40 }
{ "type": "debit_rejected", "reason": "insufficient_balance", "current_balance": 5, "requested": 10 }
{ "type": "balance_response", "comanda_code": "F001", "holder_name": "Maria", "balance": 40 }
{ "type": "balance_updated", "comanda_code": "F001", "new_balance": 35, "event_type": "debit", "store_id": "..." }
```

---

## Testes

```bash
# Teste do fluxo completo da API
python test_api_flow.py

# Teste de carga (simula 5 lojas em paralelo)
python stress_test.py
```

---

## Banco de Dados

O arquivo SQLite (`ouroboros.db`) é **100% compatível** com o banco gerado pela versão Node.js.  
Ao usar `python manage.py`, as tabelas e views são criadas caso ainda não existam.

---

## Compatibilidade com o Frontend

O frontend React (`../frontend/`) funciona sem nenhuma alteração — basta apontar para `http://localhost:8000`.
