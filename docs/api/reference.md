# Referência da API

A API do Ouroboros é exposta na porta `8000` e é idêntica nos dois backends disponíveis:

- **Node.js** (`backend-node/`) — Express + node:sqlite *(SQLite embutido no Node.js v22+, sem dependência nativa externa)*
- **Python** (`backend-python/`) — FastAPI + Uvicorn *(ao usar o backend Python, a documentação interativa está disponível em `/docs` (Swagger UI) e `/redoc` (ReDoc) enquanto o servidor estiver rodando)*

!!! note "Backend como fonte única de verdade"
    **Toda a validação de dados é feita no backend.** O frontend nunca deve ser a única barreira de proteção contra entradas inválidas. Um frontend alternativo pode ser construído em qualquer tecnologia — o backend garante a integridade independentemente do cliente.

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
    As rotas `GET /api/categories` e `GET /api/reports/analytics` são **públicas e não exigem token**.
    - `/categories` — os terminais de loja precisam consultar o catálogo de preços sem autenticação admin
    - `/reports/analytics` — dados agregados para o telão/painel público do evento (sem dados individuais)

### WebSocket

A autenticação é feita via query string na conexão:

```
ws://host/ws/admin?token=<admin_token>
ws://host/ws/store?token=<store_terminal_token>
```

---

## Limites e restrições globais

| Recurso | Limite |
|---|---|
| Tamanho máximo do body (REST) | `10 KB` |
| Conexões admin simultâneas (WebSocket) | `10` |
| Conexões de loja simultâneas (WebSocket) | Configurável via `MAX_STORE_CONNECTIONS` no `.env` (padrão: `100`) |
| Mensagens por minuto por conexão WebSocket | `300` (admin e loja) |
| Máximo de comandas | Configurável via `MAX_COMANDAS` no `.env` (padrão: `1000`) |

!!! tip "Variáveis opcionais de ambiente"
    Além das variáveis documentadas no guia de setup, existem duas variáveis opcionais para uso interno:

    - `MAX_STORE_CONNECTIONS` — limite de conexões WebSocket simultâneas de loja (padrão: `100`)
    - `STRESS_NO_RATELIMIT=true` — desativa o rate limiting de WebSocket para testes de carga (nunca usar em produção)

---

## Regras de validação do backend

O backend impõe as seguintes restrições em todas as entradas. **O frontend não precisa — e não deve — ser a única camada de validação.**

| Campo | Regra |
|---|---|
| `holder_name` | String não vazia após trim. Obrigatório. |
| `initial_balance` | Inteiro não-negativo (≥ 0). Ausente = 0. Se 0, nenhum evento de crédito inicial é criado. |
| `amount` (crédito/débito) | Inteiro estritamente positivo (> 0). Rejeita floats, strings não-numéricas e NaN. |
| `comanda_code` | Sempre normalizado: trim + uppercase. Formato esperado: `F001` a `F999+`. |
| `name` (loja/categoria) | String não vazia após trim. Obrigatório. |
| `price` (categoria via REST) | Inteiro estritamente positivo (> 0). |
| `price` (categoria via WS `register_category`) | Inteiro não-negativo (≥ 0). Zero = sem alteração de preço, apenas incrementa contagem. |
| `cart_items[].quantity` | Inteiro positivo. Itens com quantity inválida são silenciosamente ignorados. |

---

## Rotas REST

### Health check

#### `GET /`

Retorna o status do servidor.

**Auth:** Pública

**Response `200`:**
```json
{ "status": "online", "mode": "local-first", "event": "Feira da Troca 2025" }
```

---

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
| `total_issued` | Soma de todos os créditos **iniciais** emitidos (eventos com `note = 'Saldo inicial'`). Créditos adicionais adicionados após o cadastro **não** entram neste total — consulte `total_circulating` para o saldo real em circulação. |
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

Retorna os detalhes de uma comanda pelo código curto (ex: `F001`). O código é normalizado para maiúsculas automaticamente.

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

**Validação:** `name` deve ser uma string não vazia após trim.

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
    O alfabeto utilizado é `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — exclui os caracteres ambíguos `0`, `O`, `1`, `I` e `L` para facilitar leitura e digitação, e usa apenas os dígitos `2-9`.

**Erros:**
```json
{ "detail": "name is required" }   // 400
```

#### `PUT /api/stores/{store_id}`

Atualiza o nome de uma loja existente.

**Auth:** Admin

**Request body:**
```json
{
  "name": "Novo Nome da Loja"
}
```

**Erros:**
```json
{ "detail": "name is required" }  // 400
{ "detail": "Store not found" }   // 404
```

#### `POST /api/stores/{store_id}/revoke_token`

Gera um novo token para a loja, **invalidando o anterior imediatamente**. Qualquer terminal WebSocket usando o token antigo é **desconectado na hora** (código WS `1008 Token revoked`).

**Auth:** Admin

**Response `200`:**
```json
{
  "id": "uuid-da-loja",
  "new_token": "KM74PQ"
}
```

!!! warning "Efeito imediato da revogação"
    Ao revogar o token, todos os terminais WebSocket ativos daquela loja são fechados imediatamente com código `1008`. O novo token deve ser informado ao lojista para reconexão.

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

!!! note "Unidade de valor"
    O campo `price` é armazenado em ETC inteiros (sem decimais). `1500` = 1500 ETC.

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

**Validação:**
- `name`: string não vazia após trim
- `price`: inteiro estritamente positivo (> 0)
- Nome duplicado (case-insensitive) é rejeitado

**Response `201`:**
```json
{
  "id": "uuid-gerado",
  "name": "Bolsa",
  "price": 1500,
  "total_entries": 0,
  "total_exits": 0
}
```

**Erros:**
```json
{ "detail": "name is required" }                      // 400
{ "detail": "price must be a positive integer" }      // 400
{ "detail": "Categoria já existe" }                   // 400
```

---

### Distribuição e Packing

O sistema de distribuição organiza os produtos cadastrados em caixas e as entrega às lojas participantes, com controle de montagem por voluntários.

#### `GET /api/distribution`

Lista todas as rodadas de distribuição cadastradas.

**Auth:** Admin

**Response `200`:**
```json
[
  {
    "id": "uuid",
    "name": "Rodada 1",
    "num_boxes": 10,
    "status": "planning",
    "needs_recalc": 0,
    "created_at": "2025-11-15T10:00:00Z",
    "completed_at": null
  }
]
```

**Status possíveis:** `planning`, `active`, `complete`

#### `POST /api/distribution`

Cria uma nova rodada de distribuição.

**Auth:** Admin

**Request body:**
```json
{
  "name": "Rodada 1",
  "num_boxes": 10
}
```

**Response `201`:**
```json
{
  "id": "uuid-gerado",
  "name": "Rodada 1",
  "num_boxes": 10,
  "status": "planning"
}
```

**Erros:**
```json
{ "detail": "name and num_boxes are required" }  // 400
```

#### `GET /api/distribution/suggest`

Sugere automaticamente o número ideal de caixas com base no inventário cadastrado (categorias com `total_entries > 0`) e no número de lojas registradas.

**Auth:** Admin

**Response `200`:**
```json
{
  "suggested": 12,
  "reasoning": "10 lojas, 180 itens → mínimo 10 caixas (1/loja), ideal 12 caixas (~15 itens/caixa)"
}
```

#### `GET /api/distribution/{id}`

Retorna os detalhes completos de uma rodada, incluindo todas as caixas e seus itens.

**Auth:** Admin

**Response `200`:**
```json
{
  "distribution": {
    "id": "uuid",
    "name": "Rodada 1",
    "num_boxes": 10,
    "status": "active",
    "needs_recalc": 0,
    "created_at": "2025-11-15T10:00:00Z",
    "completed_at": null
  },
  "boxes": [
    {
      "id": "uuid-caixa",
      "distribution_id": "uuid",
      "box_number": 1,
      "assigned_store_id": "uuid-loja",
      "store_name": "Cantina Italiana",
      "responsible_name": null,
      "status": "pending",
      "claimed_at": null,
      "completed_at": null,
      "items": [
        { "category_name": "Jaqueta", "target_quantity": 3 }
      ]
    }
  ]
}
```

**Status de caixa possíveis:** `pending`, `in_progress`, `done`

Retorna `404` se o ID não existir.

#### `POST /api/distribution/{id}/calculate`

Executa o algoritmo de distribuição round-robin, calculando quais itens vão em quais caixas com base no inventário atual das categorias (`total_entries`). Substitui qualquer cálculo anterior da rodada.

**Auth:** Admin

**Response `200`:**
```json
{
  "message": "Distribuição calculada com sucesso",
  "warnings": [
    "\"Bolsa\" tem apenas 3 itens — 7 caixa(s) ficarão sem esta categoria."
  ]
}
```

**Erros:**
```json
{ "detail": "Distribution not found" }                              // 404
{ "detail": "Nenhuma loja cadastrada para receber caixas." }        // 400
{ "detail": "Nenhum produto cadastrado para distribuir." }          // 400
{ "detail": "Impossível criar N caixas com apenas M itens." }       // 400
```

#### `DELETE /api/distribution/{id}`

Remove uma rodada e todas as suas caixas e itens. Se a rodada estiver ativa e houver caixas com status `in_progress`, retorna `409`.

**Auth:** Admin

**Response `200`:**
```json
{ "message": "Rodada excluída." }
```

**Erros:**
```json
{ "detail": "Distribution not found" }                                            // 404
{ "detail": "Não é possível excluir: 2 caixa(s) estão sendo montadas agora." }   // 409
```

#### `PUT /api/distribution/{id}/activate`

Ativa uma rodada para início do packing. Arquiva automaticamente qualquer rodada ativa anterior (status → `complete`). Transmite `distribution_status_changed` via WebSocket Packing para todos os voluntários conectados.

**Auth:** Admin

**Response `200`:**
```json
{ "status": "active" }
```

**Erros:**
```json
{ "detail": "Distribution not found" }  // 404
```

---

### Packing (Voluntários de Montagem)

Rotas usadas pelos voluntários que montam fisicamente as caixas de produto.

#### `GET /api/packing/active`

Retorna a rodada de distribuição ativa com todas as caixas e estatísticas de progresso.

**Auth:** Admin

**Response `200`:**
```json
{
  "distribution": {
    "id": "uuid",
    "name": "Rodada 1",
    "status": "active"
  },
  "boxes": [
    {
      "id": "uuid-caixa",
      "box_number": 1,
      "store_name": "Cantina Italiana",
      "responsible_name": null,
      "status": "pending",
      "items": [
        { "category_name": "Jaqueta", "target_quantity": 3 }
      ]
    }
  ],
  "stats": {
    "total_boxes": 10,
    "pending": 7,
    "in_progress": 2,
    "done": 1
  }
}
```

**Erros:**
```json
{ "detail": "Nenhuma distribuição ativa no momento." }  // 404
```

#### `POST /api/packing/boxes/{boxId}/claim`

Um voluntário assume a responsabilidade por uma caixa. Usa UPDATE atômico (`WHERE responsible_name IS NULL AND status = 'pending'`) para evitar conflito entre dois voluntários tentando pegar a mesma caixa simultaneamente. Transmite `box_claimed` via WebSocket Packing.

**Auth:** Admin

**Request body:**
```json
{ "responsible_name": "Ana" }
```

**Response `200`:**
```json
{ "message": "Caixa assumida com sucesso!" }
```

**Erros:**
```json
{ "detail": "O seu nome é obrigatório para assumir a caixa." }   // 400
{ "detail": "Caixa #3 já foi assumida por Carlos." }             // 409
{ "detail": "Caixa não encontrada." }                            // 409
```

#### `POST /api/packing/boxes/{boxId}/complete`

Marca a caixa como montada (`done`). Se havia sinalização de recálculo pendente (`needs_recalc = 1`) e não restam mais caixas `in_progress`, o recálculo das caixas `pending` é executado automaticamente. Transmite `box_completed` (e `distribution_recalculated` se houver recálculo) via WebSocket Packing.

**Auth:** Admin

**Response `200`:**
```json
{ "message": "Caixa concluída com sucesso!", "recalc_triggered": false }
```

**Erros:**
```json
{ "detail": "Caixa não encontrada." }  // 400
```

#### `POST /api/packing/boxes/{boxId}/cancel`

Libera uma caixa de volta para `pending`, removendo o voluntário responsável. Se havia recálculo pendente e não restam mais caixas `in_progress`, o recálculo é executado. Transmite `box_released` (e `distribution_recalculated` se houver recálculo) via WebSocket Packing.

**Auth:** Admin

**Response `200`:**
```json
{ "message": "Caixa liberada para outros voluntários.", "recalc_triggered": false }
```

**Erros:**
```json
{ "detail": "Caixa não encontrada." }  // 400
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

**Erros de conexão:**

| Código WS | Motivo | Causa |
|---|---|---|
| `1008` | `Store Token Unauthorized` | Token inválido ou inexistente |
| `1008` | `Max connections reached` | Limite de 100 conexões atingido |
| `1008` | `Token revoked` | Token revogado pelo admin enquanto conectado |

---

### Mensagens do Terminal → Servidor

#### `balance_query`

Consulta o saldo de uma comanda sem realizar débito. O campo `comanda_code` é normalizado (trim + uppercase) antes da busca.

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

**Erro:**
```json
{ "type": "error", "reason": "comanda_not_found" }
```

#### `debit_request`

Solicita um débito em uma comanda. O `comanda_code` é normalizado automaticamente. O `amount` deve ser um inteiro positivo.

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

| `reason` | Causa |
|---|---|
| `comanda_not_found` | Código não existe ou veio vazio |
| `insufficient_balance` | Saldo atual menor que o valor solicitado. Inclui `current_balance` e `requested`. |
| `invalid_amount` | `amount` é zero, negativo, float ou não-numérico |
| `server_error` | Erro interno inesperado |

---

### Mensagens do Servidor → Todos os Terminais de Loja (broadcast)

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

### Mensagens de erro genéricas (loja)

```json
{ "type": "error", "reason": "rate_limit_exceeded" }
```

Enviado quando o terminal excede **300 mensagens por minuto**. O frontend deve implementar debounce ou throttle para evitar isso.

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

**Erros de conexão:**

| Código WS | Motivo | Causa |
|---|---|---|
| `1008` | `Unauthorized` | Token admin inválido |
| `1008` | `Max connections reached` | Limite de 10 conexões admin atingido |

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

**Validação:**
- `holder_name`: obrigatório, string não vazia após trim
- `initial_balance`: inteiro não-negativo (≥ 0), ausente = 0. Se 0, nenhum evento de crédito inicial é gerado.
- `cart_items`: opcional. Itens com `name` vazio ou `quantity` inválida são ignorados.

**Erros:**
```json
{ "type": "error", "reason": "holder_name is required" }
{ "type": "error", "reason": "invalid_amount" }
{ "type": "error", "reason": "Maximum number of comandas (1000) reached" }
{ "type": "error", "reason": "Concurrent comanda creation conflict. Please retry." }
```

#### `add_credit`

Adiciona crédito extra a uma comanda já existente. O campo `cart_items` segue a mesma lógica de `create_comanda`.

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

**Validação:**
- `comanda_code`: obrigatório, normalizado (trim + uppercase)
- `amount`: inteiro estritamente positivo (> 0)

!!! info "Campo `note` no evento gerado"
    Ao receber `add_credit`, o servidor cria um evento de crédito com `note = 'Crédito adicional'`. Isso o diferencia dos créditos iniciais (`note = 'Saldo inicial'`) na auditoria. Ambos contribuem para o saldo da comanda, mas **apenas** os créditos iniciais entram no `total_issued` de `/reports/economy_state`.

**Erros:**
```json
{ "type": "error", "reason": "comanda_code is required" }
{ "type": "error", "reason": "invalid_amount" }
{ "type": "error", "reason": "comanda_not_found" }
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

**Validação:**
- `name`: obrigatório, string não vazia após trim
- `price`: inteiro não-negativo (≥ 0). Se 0, o preço existente não é alterado — apenas o `total_entries` é incrementado.
- `total_entries`: inteiro não-negativo (≥ 0), ausente = 0

**Erros:**
```json
{ "type": "error", "reason": "category name is required" }
{ "type": "error", "reason": "invalid_amount" }
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

### Mensagens de erro genéricas (admin)

```json
{ "type": "error", "reason": "rate_limit_exceeded" }
```

Enviado quando o terminal excede **300 mensagens por minuto**.

---

## WebSocket — Canal de Packing (Voluntários)

Canal de broadcast para atualizações em tempo real durante a montagem de caixas. **Este canal é somente de leitura para o cliente** — todas as ações (claim, complete, cancel) são realizadas via REST para garantir atomicidade.

### Conexão

```
ws://localhost:8000/ws/packing?token=<admin_token>
```

Após conectar:
```json
{
  "type": "connected",
  "role": "packer",
  "message": "Bem-vindo ao canal de distribuição Ouroboros."
}
```

!!! note "Diferença entre backends"
    O campo `message` da mensagem de boas-vindas tem texto ligeiramente diferente entre os dois backends (o backend Python inclui `"(Python)"` no texto). O campo `type` e `role` são idênticos — código cliente deve verificar `type === 'connected'` e ignorar o conteúdo exato de `message`.

**Erros de conexão:**

| Código WS | Motivo | Causa |
|---|---|---|
| `4001` | `Unauthorized` | Token admin inválido |

---

### Mensagens do Servidor → Clientes Packing (broadcast)

#### `distribution_status_changed`

Disparado ao ativar uma rodada via `PUT /api/distribution/{id}/activate`.

```json
{ "type": "distribution_status_changed", "status": "active" }
```

#### `box_claimed`

Disparado quando um voluntário assume uma caixa via `POST /api/packing/boxes/{boxId}/claim`.

```json
{
  "type": "box_claimed",
  "box_id": "uuid-caixa",
  "responsible_name": "Ana"
}
```

#### `box_completed`

Disparado quando uma caixa é concluída via `POST /api/packing/boxes/{boxId}/complete`.

```json
{ "type": "box_completed", "box_id": "uuid-caixa" }
```

#### `box_released`

Disparado quando uma caixa é liberada via `POST /api/packing/boxes/{boxId}/cancel`.

```json
{ "type": "box_released", "box_id": "uuid-caixa" }
```

#### `distribution_recalculated`

Disparado quando o algoritmo de recálculo automático é executado (após `complete` ou `cancel` quando não há mais caixas `in_progress` e havia `needs_recalc = 1`).

```json
{ "type": "distribution_recalculated" }
```

---

## Códigos de erro — tabela consolidada

### REST

| Código HTTP | `detail` | Causa |
|---|---|---|
| `400` | `name is required` | Nome de loja ou categoria vazio ou só espaços |
| `400` | `price must be a positive integer` | Preço zero, negativo ou não-inteiro em POST /categories |
| `400` | `Categoria já existe` | Nome de categoria duplicado (case-insensitive) |
| `400` | `name and num_boxes are required` | Campos obrigatórios ausentes em POST /distribution |
| `400` | `num_boxes must be a positive integer` | `num_boxes` é zero, negativo, float ou não-numérico em POST /distribution |
| `400` | `Nenhuma loja cadastrada para receber caixas.` | Tentativa de calcular distribuição sem lojas |
| `400` | `Nenhum produto cadastrado para distribuir.` | Tentativa de calcular sem categorias com entradas |
| `400` | `Impossível criar N caixas com apenas M itens.` | Mais caixas solicitadas do que itens disponíveis |
| `400` | `Caixa não encontrada.` | boxId inexistente em complete/cancel |
| `400` | `O seu nome é obrigatório para assumir a caixa.` | `responsible_name` ausente em claim |
| `401` | `Unauthorized` | Token ausente ou incorreto |
| `404` | `Comanda não encontrada` | Código de comanda não existe |
| `404` | `Store not found` | ID de loja não existe |
| `404` | `Distribution not found` | ID de distribuição não existe |
| `404` | `Nenhuma distribuição ativa no momento.` | Nenhuma rodada com status `active` |
| `409` | `Não é possível excluir: N caixa(s) estão sendo montadas agora.` | Tentativa de excluir rodada ativa com caixas `in_progress` |
| `409` | `Caixa #N já foi assumida por <nome>.` | Race condition em claim — caixa já assumida |

### WebSocket — `reason` nos tipos `error` e `debit_rejected`

| `reason` | Contexto | Causa |
|---|---|---|
| `holder_name is required` | Admin | `holder_name` ausente ou vazio |
| `comanda_code is required` | Admin | `comanda_code` ausente ou vazio |
| `category name is required` | Admin | `name` ausente ou vazio em `register_category` |
| `comanda_not_found` | Admin / Loja | Código de comanda não existe |
| `invalid_amount` | Admin / Loja | Valor zero, negativo, float ou não-numérico |
| `insufficient_balance` | Loja | Saldo menor que o valor solicitado |
| `server_error` | Loja | Erro interno inesperado |
| `rate_limit_exceeded` | Admin / Loja | Excedeu o limite de mensagens por minuto |
| `Maximum number of comandas (...) reached` | Admin | Limite configurado em `MAX_COMANDAS` atingido |
| `Concurrent comanda creation conflict...` | Admin | Race condition em criação simultânea — tentar novamente |

---

## Construindo um frontend alternativo

O backend é completamente autossuficiente. Qualquer frontend — ou nenhum frontend — pode ser usado. A única interface necessária são as conexões HTTP REST e WebSocket descritas acima.

**Exemplo mínimo de fluxo para um Terminal de Loja:**

1. Conectar via `ws://host:8000/ws/store?token=TOKEN`
2. Aguardar `{ type: "connected" }` para confirmar autenticação
3. Para consultar saldo: enviar `{ type: "balance_query", comanda_code: "F001" }`
4. Para debitar: enviar `{ type: "debit_request", comanda_code: "F001", amount: 650 }`
5. Tratar `debit_confirmed` (sucesso) ou `debit_rejected` (com `reason` específica)
6. Implementar reconexão automática com backoff exponencial (o servidor não armazena estado de sessão)

**Exemplo mínimo de fluxo para Terminal Banco/Admin:**

1. Conectar via `ws://host:8000/ws/admin?token=ADMIN_TOKEN`
2. Aguardar `{ type: "connected", next_code: "F001" }` para saber o próximo código disponível
3. Para criar comanda: enviar `{ type: "create_comanda", holder_name: "João", initial_balance: 1000 }`
4. Tratar `comanda_created` (broadcast para todos os admins) ou `{ type: "error", reason: "..." }`
5. Para adicionar crédito extra: enviar `{ type: "add_credit", comanda_code: "F001", amount: 500 }`

