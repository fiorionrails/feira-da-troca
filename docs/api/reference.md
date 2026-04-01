# Referência da API

A API do Ouroboros é exposta na porta `8000` e é idêntica nos dois backends disponíveis:

- **Node.js** (`backend-node/`) — Express + better-sqlite3
- **Python** (`backend-python/`) — FastAPI + Uvicorn *(ao usar o backend Python, a documentação interativa está disponível em `/docs` (Swagger UI) e `/redoc` (ReDoc) enquanto o servidor estiver rodando)*

---

## Base URL

```
http://localhost:8000/api
```

Em produção (rede local do evento), substituir `localhost` pelo IP da máquina servidora.

---

## Autenticação

A API usa dois mecanismos de autenticação dependendo do canal:

### REST (HTTP)

As rotas administrativas exigem o header customizado `token`:

```
token: <admin_token>
```

O valor do token é definido pela variável `ADMIN_TOKEN` no arquivo `.env`.

!!! note "Rotas públicas"
    A rota `GET /api/categories` é pública e não exige token — isso permite que os terminais de loja consultem o catálogo de preços.

### WebSocket

A autenticação é feita via query string na conexão:

```
ws://host/ws/admin?token=<admin_token>
ws://host/ws/store?token=<store_terminal_token>
```

---

## Rotas REST

### Relatórios

#### `GET /api/reports/economy_state`

Retorna a visão macro da economia da feira.

**Auth:** Admin (`token` header)

**Response `200`:**
```json
{
  "total_issued": 486000,
  "total_circulating": 173500,
  "comandas_active": 243,
  "stores_registered": 12
}
```

| Campo | Descrição |
|---|---|
| `total_issued` | Soma de todos os créditos iniciais emitidos |
| `total_circulating` | Soma dos saldos atuais de todas as comandas |
| `comandas_active` | Total de comandas cadastradas |
| `stores_registered` | Total de lojas cadastradas |

#### `GET /api/reports/analytics`

Retorna dados agregados para o dashboard analítico público (ideal para telão do evento).

**Auth:** Pública (nenhum token necessário)

**Response `200`:**
```json
{
  "kpis": {
    "total_comandas": 257,
    "total_emitido": 486000,
    "total_gasto": 312500,
    "total_circulante": 173500,
    "total_transacoes": 2320,
    "lojas_ativas": 12
  },
  "transactions_per_minute": [
    { "minute": "10:32", "credits": 0, "debits": 3, "total": 3 }
  ],
  "top_stores": [
    { "name": "Cantina Italiana", "total": 45000, "count": 30 }
  ],
  "category_distribution": [
    { "name": "Jaqueta", "count": 42, "price": 1500 }
  ]
}
```

---

### Comandas

#### `GET /api/comanda/{code}`

Retorna os detalhes de uma comanda pelo código curto (ex: `F001`).

**Auth:** Admin (`token` header)

**Response `200`:**
```json
{
  "id": "uuid-interno",
  "code": "F001",
  "holder_name": "João Silva",
  "balance": 1350,
  "created_at": "2025-11-15T10:00:00Z"
}
```

Retorna `404` se o código não existir.

---

### Lojas

#### `GET /api/stores`

Lista todas as lojas cadastradas.

**Auth:** Admin

**Response `200`:**
```json
[
  {
    "id": "uuid-da-loja",
    "name": "Cantina Italiana",
    "theme": "default",
    "terminal_token": "XJ92KF"
  }
]
```

#### `POST /api/stores`

Cria uma nova loja com token de terminal gerado automaticamente.

**Auth:** Admin

**Request body:**
```json
{
  "name": "Cantina Italiana"
}
```

**Response `201`:**
```json
{
  "id": "uuid-gerado",
  "name": "Cantina Italiana",
  "terminal_token": "XJ92KF"
}
```

!!! note "Formato do token de loja"
    O token gerado é uma string de **6 caracteres** alfanuméricos maiúsculos (ex: `XJ92KF`).
    O alfabeto exclui caracteres ambíguos (`0`, `O`, `1`, `I`) para facilitar a leitura e digitação em terminais de loja.

#### `PUT /api/stores/{store_id}`

Atualiza o nome de uma loja existente.

**Auth:** Admin

**Request body:**
```json
{
  "name": "Novo Nome da Loja"
}
```

#### `POST /api/stores/{store_id}/revoke_token`

Gera um novo token para a loja, invalidando o anterior imediatamente. Qualquer terminal usando o token antigo perde acesso ao tentar reconectar.

**Auth:** Admin

**Response `200`:**
```json
{
  "id": "uuid-da-loja",
  "new_token": "KM74PQ"
}
```

!!! warning "Efeito da revogação"
    Ao regerar o token, qualquer terminal de loja usando o token antigo será desconectado na próxima tentativa de reconexão. O novo token deve ser informado ao lojista para que ele possa acessar novamente.

---

### Categorias

#### `GET /api/categories`

Lista todas as categorias de produto cadastradas com seus preços.

**Auth:** Pública (nenhum token necessário)

**Response `200`:**
```json
[
  {
    "id": "uuid-categoria",
    "name": "Jaqueta",
    "price": 1500,
    "total_entries": 42,
    "total_exits": 18
  }
]
```

!!! note "Unidade de preço"
    O campo `price` é armazenado em centavos fictícios. O frontend converte para ETECOINS dividindo por 100 (ex: `1500` → `15 ETC`).

#### `POST /api/categories`

Cria uma nova categoria de produto/preço.

**Auth:** Admin

**Request body:**
```json
{
  "name": "Bolsa",
  "price": 1500
}
```

**Response `201`:**
```json
{
  "id": "uuid-gerado",
  "name": "Bolsa",
  "price": 1500
}
```

---

## WebSocket — Terminal de Loja

O canal principal de operação das lojas. Cada terminal mantém uma conexão WebSocket persistente.

### Conexão

```
ws://localhost:8000/ws/store?token=<store_terminal_token>
```

Após conectar, o servidor envia:

```json
{
  "type": "connected",
  "store_id": "uuid-da-loja",
  "store_name": "Cantina Italiana",
  "server_time": "2025-11-15T10:00:00Z"
}
```

Se o token for inválido, o servidor fecha a conexão com código `1008` e motivo `"Store Token Unauthorized"`.

---

### Mensagens do Terminal → Servidor

#### `balance_query`

Consulta o saldo de uma comanda sem realizar débito.

```json
{
  "type": "balance_query",
  "comanda_code": "F001"
}
```

**Resposta:**
```json
{
  "type": "balance_response",
  "comanda_code": "F001",
  "holder_name": "João Silva",
  "balance": 1350
}
```

#### `debit_request`

Solicita um débito em uma comanda.

```json
{
  "type": "debit_request",
  "comanda_code": "F001",
  "amount": 650
}
```

**Respostas possíveis:**

`debit_confirmed`:
```json
{
  "type": "debit_confirmed",
  "event_id": "uuid-evento",
  "comanda_code": "F001",
  "holder_name": "João Silva",
  "amount": 650,
  "new_balance": 700
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

Motivos possíveis de rejeição: `comanda_not_found`, `insufficient_balance`, `invalid_amount`.

---

### Mensagens do Servidor → Todos os Terminais (broadcast)

#### `balance_updated`

Disparado após qualquer débito confirmado no sistema. Permite que outros terminais que estejam visualizando a mesma comanda atualizem o saldo em tempo real.

```json
{
  "type": "balance_updated",
  "comanda_code": "F001",
  "new_balance": 700,
  "event_type": "debit",
  "store_id": "uuid-da-loja-que-debitou"
}
```

---

## WebSocket — Administração e Banco

Interface para operadores do Banco e Administradores.

### Conexão

```
ws://localhost:8000/ws/admin?token=<admin_token>
```

Após conectar:
```json
{
  "type": "connected",
  "role": "admin",
  "next_code": "F001"
}
```

Se o token for inválido, o servidor fecha a conexão com código `1008`.

---

### Mensagens do Admin → Servidor

#### `create_comanda`

Solicita a criação de uma nova comanda com saldo inicial. O campo `cart_items` é opcional e registra os itens avaliados no carrinho do Banco (incrementa `total_entries` das categorias correspondentes).

```json
{
  "type": "create_comanda",
  "holder_name": "Maria Oliveira",
  "initial_balance": 5000,
  "cart_items": [
    { "name": "Jaqueta", "quantity": 2 },
    { "name": "Camiseta", "quantity": 1 }
  ]
}
```

#### `add_credit`

Adiciona crédito extra a uma comanda já existente (Dual Mode do Banco). O campo `cart_items` segue a mesma lógica de `create_comanda`.

```json
{
  "type": "add_credit",
  "comanda_code": "F001",
  "amount": 2000,
  "cart_items": [
    { "name": "Jaqueta", "quantity": 1 }
  ]
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

---

### Mensagens do Servidor → Admin (broadcast)

#### `comanda_created`

Notifica todos os terminais Admin quando uma nova comanda é gerada.

```json
{
  "type": "comanda_created",
  "code": "F001",
  "holder_name": "Maria Oliveira",
  "balance": 5000
}
```

#### `credit_confirmed`

Notifica todos os terminais Admin quando crédito extra é adicionado a uma comanda existente.

```json
{
  "type": "credit_confirmed",
  "code": "F001",
  "holder_name": "Maria Oliveira",
  "amount": 2000,
  "new_balance": 7000
}
```

#### `update_next_code`

Sincroniza entre os terminais qual será o próximo código `Fxxx` disponível.

```json
{
  "type": "update_next_code",
  "next_code": "F002"
}
```

#### `admin_balance_updated`

Disparado quando uma loja efetua um débito, para o painel Admin acompanhar a economia em tempo real.

```json
{
  "type": "admin_balance_updated",
  "comanda_code": "F001",
  "new_balance": 700,
  "amount": 650,
  "store_name": "Cantina Italiana"
}
```

#### `category_updated`

Notifica quando uma categoria de produto é criada ou atualizada.

```json
{
  "type": "category_updated",
  "category": {
    "id": "uuid",
    "name": "Bolsa",
    "price": 1500,
    "total_entries": 10,
    "total_exits": 0
  }
}
```

---

## Códigos de erro

| Código | Significado |
|---|---|
| `comanda_not_found` | Código da comanda não existe no sistema |
| `insufficient_balance` | Saldo insuficiente para o débito |
| `invalid_amount` | Valor inválido (zero, negativo, ou não-inteiro) |
| `unauthorized` | Token ausente ou inválido (WebSocket fecha com código 1008) |
