# Referência da API

A API REST do Ouroboros é construída com FastAPI e exposta na porta `8000`. A documentação interativa está disponível em `/docs` (Swagger UI) e `/redoc` (ReDoc) quando o servidor está rodando.

---

## Base URL

```
http://localhost:8000/api/v1
```

Em produção (rede local do evento), substituir `localhost` pelo IP da máquina servidora.

---

## Autenticação

A API usa dois níveis de autenticação:

| Nível | Header | Usado por |
|---|---|---|
| Admin | `Authorization: Bearer <admin_token>` | Painel administrativo |
| Store | `Authorization: Bearer <store_token>` | Terminais de loja |

Os tokens são gerados no setup inicial e armazenados no `.env`.

!!! note
    WebSocket endpoints usam autenticação via query string: `ws://host/ws?token=<store_token>`

---

## Comandas

### `POST /comandas`

Cria uma nova comanda e emite o saldo inicial.

**Auth:** Admin

**Request body:**
```json
{
  "holder_name": "João Silva",
  "initial_balance": 2000
}
```

| Campo | Tipo | Descrição |
|---|---|---|
| `holder_name` | string | Nome do portador da comanda |
| `initial_balance` | integer | Saldo inicial em centavos fictícios |

**Response `201`:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "holder_name": "João Silva",
  "code": "F104",
  "balance": 2000,
  "created_at": "2024-11-15T09:00:00Z"
}
```

---

### `GET /comandas/{comanda_id}`

Retorna detalhes e saldo atual de uma comanda.

**Auth:** Admin ou Store

**Response `200`:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "holder_name": "João Silva",
  "balance": 1350,
  "created_at": "2024-11-15T09:00:00Z"
}
```

**Response `404`:**
```json
{
  "error": "comanda_not_found",
  "message": "Comanda não encontrada"
}
```

---

### `GET /comandas/{comanda_id}/events`

Lista todos os eventos (transações) de uma comanda em ordem cronológica.

**Auth:** Admin

**Response `200`:**
```json
{
  "comanda_id": "550e8400-...",
  "holder_name": "João Silva",
  "events": [
    {
      "id": "evt_001",
      "type": "credit",
      "amount": 2000,
      "store_id": null,
      "note": "Saldo inicial",
      "created_at": "2024-11-15T09:00:00Z"
    },
    {
      "id": "evt_002",
      "type": "debit",
      "amount": 650,
      "store_id": "store_loja_italiana",
      "note": null,
      "created_at": "2024-11-15T10:23:15Z"
    }
  ],
  "current_balance": 1350
}
```

---

## Transações (Admin)

### `POST /transactions/credit`

Credita manualmente uma comanda (operação administrativa, ex: reembolso).

**Auth:** Admin

**Request body:**
```json
{
  "comanda_id": "550e8400-...",
  "amount": 300,
  "note": "Reembolso - produto indisponível"
}
```

**Response `201`:**
```json
{
  "event_id": "evt_003",
  "type": "credit",
  "amount": 300,
  "new_balance": 1650
}
```

---

## WebSocket — Terminal de Loja

O canal principal de operação das lojas. Cada terminal mantém uma conexão WebSocket persistente.

### Conexão

```
ws://localhost:8000/ws/store?token=<store_token>
```

Após conectar, o servidor envia o estado atual:

```json
{
  "type": "connected",
  "store_id": "store_loja_italiana",
  "store_name": "Cantina Italiana",
  "server_time": "2024-11-15T10:00:00Z"
}
```

---

### Mensagens do Terminal → Servidor

#### `debit_request`

Solicita um débito em uma comanda.

```json
{
  "type": "debit_request",
  "comanda_code": "F104",
  "amount": 650
}
```

**Respostas possíveis:**

`debit_confirmed`:
```json
{
  "type": "debit_confirmed",
  "event_id": "evt_004",
  "comanda_id": "550e8400-...",
  "amount": 650,
  "new_balance": 700,
  "holder_name": "João Silva"
}
```

`debit_rejected`:
```json
{
  "type": "debit_rejected",
  "reason": "insufficient_balance",
  "current_balance": 400,
  "requested": 650
}
```

#### `balance_query`

Consulta o saldo de uma comanda sem realizar débito (para exibir ao cliente antes de confirmar).

```json
{
  "type": "balance_query",
  "comanda_code": "F104"
}
```

**Resposta:**
```json
{
  "type": "balance_response",
  "comanda_id": "550e8400-...",
  "holder_name": "João Silva",
  "balance": 1350
}
```

## WebSocket — Administração e Banco

Interface para operadores do Banco e Administradores. Mantém sincronia entre os múltiplos terminais de cadastro.

### Conexão

```
ws://localhost:8000/ws/admin?token=<admin_token>
```

### Mensagens do Admin → Servidor

#### `create_comanda`

Solicita a criação de uma nova comanda com saldo inicial.

```json
{
  "type": "create_comanda",
  "holder_name": "Maria Oliveira",
  "initial_balance": 5000
}
```

#### `register_category`

Cadastra ou atualiza uma categoria/preço de produto.

```json
{
  "type": "register_category",
  "name": "Bolsa",
  "price": 1500,
  "total_entries": 10
}
```

### Mensagens do Servidor → Admin (broadcast)

#### `comanda_created`

Confirmado para todos os admins quando uma nova comanda é gerada.

```json
{
  "type": "comanda_created",
  "code": "F105",
  "holder_name": "Maria Oliveira",
  "balance": 5000
}
```

#### `update_next_code`

Informa aos terminais qual será o próximo código `Fxxx` disponível, evitando conflitos de entrada manual.

```json
{
  "type": "update_next_code",
  "next_code": "F106"
}
```

---

### Mensagens do Servidor → Terminal (broadcast)

Mensagens enviadas a todos os terminais conectados quando eventos ocorrem.

#### `balance_updated`

Disparado após qualquer transação confirmada no sistema.

```json
{
  "type": "balance_updated",
  "comanda_code": "F104",
  "new_balance": 700,
  "event_type": "debit",
  "store_id": "store_loja_italiana"
}
```

---

## Admin — Visão geral

### `GET /admin/overview`

Retorna o estado atual da economia do evento.

**Auth:** Admin

**Response `200`:**
```json
{
  "total_comandas": 243,
  "total_credits_issued": 486000,
  "total_debits": 312500,
  "total_in_circulation": 173500,
  "active_stores": 12,
  "connected_terminals": 10,
  "events_pending_sync": 3,
  "last_transaction_at": "2024-11-15T11:47:32Z"
}
```

---

## Códigos de erro

| Código | Significado |
|---|---|
| `comanda_not_found` | ID/Código não existe no sistema |
| `insufficient_balance` | Saldo insuficiente para o débito |
| `invalid_amount` | Valor inválido (zero, negativo, ou não-inteiro) |
| `store_not_found` | Store token não reconhecido |
| `unauthorized` | Token ausente ou inválido |
