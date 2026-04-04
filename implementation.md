# Ouroboros — Sistema de Distribuição de Caixas (v2)

## Plano de Implementação para Claude

**Projeto:** Ouroboros — Feira da Troca  
**Feature:** Distribuição justa de produtos em caixas para lojas  
**Data:** Abril 2026  
**Autor:** Caio Fiori Martins + Claude

---

## 1. Contexto do Problema

A Feira da Troca tem duas etapas:

1. **Coleta** (já implementada): Produtos são trazidos pelos alunos, avaliados em categorias com preço em ETC, e comandas são emitidas. As categorias ficam na tabela `categories` com `total_entries` representando quantos itens daquela categoria foram coletados.
2. **Distribuição** (esta feature): Os produtos coletados precisam ser organizados em caixas e distribuídos para as lojas de forma **justa e inclusiva** — nenhuma loja deve receber apenas produtos ruins ou ficar sem produtos de alguma categoria.

O problema atual é manual: alguém decide "essa caixa vai pra loja X" e joga produtos dentro. Isso gera desigualdade. Precisamos de um algoritmo que calcula tudo antes, e uma interface onde vários voluntários trabalham ao mesmo tempo montando as caixas físicas.

---

## 2. Fluxo Completo do Sistema

```
ETAPA 1 — ADMIN CONFIGURA (rota /admin/distribution)
══════════════════════════════════════════════════════
Admin abre tela de distribuição
    ↓
Sistema mostra inventário atual (categorias + total_entries)
    ↓
Admin define quantidade de caixas (ou aceita sugestão automática)
    ↓
Admin clica "Calcular Distribuição"
    ↓
Algoritmo roda:
  - Divide categorias entre caixas (Round-Robin com rotação)
  - Atribui cada caixa a uma loja (prioriza quem tem menos)
  - Gera o plano completo
    ↓
Admin revisa e clica "Ativar Distribuição"
    ↓
Status muda para "active" → voluntários podem começar


ETAPA 2 — VOLUNTÁRIOS MONTAM (rota /packing)
══════════════════════════════════════════════
Voluntário abre /packing (rota pública, sem login)
    ↓
Vê grid de caixas com status de cada uma:
  🟢 Disponível — ninguém pegou ainda
  🟡 Em andamento — alguém está montando (mostra nome)
  ✅ Concluída — pronta
    ↓
Clica numa caixa disponível → Modal aparece:
  "Você será responsável pela Caixa 3 (Loja Cantina Central)"
  "Seu nome: [__________]"
  [Cancelar] [Assumir Responsabilidade]
    ↓
Ao confirmar: caixa TRAVA para essa pessoa
    ↓
Tela de montagem aparece:
  "Caixa 3 — para Loja Cantina Central"
  "Responsável: Maria"
  ┌──────────────────────────────────────────┐
  │ Categoria      │ Quantidade │ Status     │
  │ Jaqueta        │ 5          │ □ Pendente │
  │ Brinquedo      │ 4          │ □ Pendente │
  │ Livro          │ 3          │ □ Pendente │
  └──────────────────────────────────────────┘
  [Concluir Caixa ✓]  [Cancelar e Liberar ✗]
    ↓
Voluntário coloca os itens na caixa física, marca cada
categoria como colocada (checkbox ou +/- quantity)
    ↓
Quando terminar: clica "Concluir Caixa"
  → Status vira "done" → caixa fica ✅ no grid de todos
    ↓
OU clica "Cancelar e Liberar"
  → Nome sai, caixa volta a 🟢 Disponível
  → Se houver recálculo pendente, caixa será recalculada


ETAPA 3 — RECÁLCULO AUTOMÁTICO
═══════════════════════════════
Quando uma nova categoria é cadastrada durante a distribuição:
    ↓
Sistema detecta que o inventário mudou
    ↓
VERIFICA: existe alguma caixa com status "in_progress"?
    ↓
  SIM → NÃO recalcula. Mostra banner no topo:
        "⚠️ Novas categorias detectadas. O recálculo só
         acontecerá quando todas as caixas em andamento
         forem concluídas ou canceladas."
    ↓
  NÃO → Recalcula automaticamente APENAS as caixas "pending".
         Caixas "done" nunca são tocadas.
```

---

## 3. Modelagem do Banco de Dados

### Novas Tabelas

```sql
-- Representa uma "sessão" de distribuição.
-- Normalmente só haverá uma ativa por vez.
CREATE TABLE IF NOT EXISTS distributions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    num_boxes INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'planning',
    -- planning  = admin ainda configurando
    -- active    = voluntários podem trabalhar
    -- completed = tudo distribuído
    needs_recalc INTEGER NOT NULL DEFAULT 0,
    -- 0 = tudo em dia
    -- 1 = inventário mudou, precisa recalcular quando possível
    created_at TEXT NOT NULL,
    completed_at TEXT
);

-- Cada caixa física
CREATE TABLE IF NOT EXISTS boxes (
    id TEXT PRIMARY KEY,
    distribution_id TEXT NOT NULL,
    box_number INTEGER NOT NULL,
    assigned_store_id TEXT NOT NULL,
    -- ↑ Já vem preenchido desde o cálculo. Cada caixa
    -- já nasce sabendo para qual loja vai.
    responsible_name TEXT,
    -- NULL = disponível, preenchido = travada para essa pessoa
    status TEXT NOT NULL DEFAULT 'pending',
    -- pending     = ninguém pegou ainda (🟢 Disponível)
    -- in_progress = alguém está montando (🟡 Em andamento)
    -- done        = caixa pronta (✅ Concluída)
    claimed_at TEXT,
    completed_at TEXT,
    FOREIGN KEY(distribution_id) REFERENCES distributions(id),
    FOREIGN KEY(assigned_store_id) REFERENCES stores(id)
);

-- O que cada caixa deve conter
CREATE TABLE IF NOT EXISTS box_items (
    id TEXT PRIMARY KEY,
    box_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    target_quantity INTEGER NOT NULL,
    -- ↑ Quantidade calculada pelo algoritmo.
    -- Não tem "actual_quantity" porque o voluntário
    -- simplesmente marca como concluída quando terminar.
    -- A caixa é "tudo ou nada".
    FOREIGN KEY(box_id) REFERENCES boxes(id),
    FOREIGN KEY(category_id) REFERENCES categories(id)
);
```

### Por Que Essa Estrutura (O Que Acontece Por Baixo)

**`assigned_store_id NOT NULL` na criação:** Diferente do plano anterior onde a loja era atribuída depois, agora o algoritmo já faz tudo de uma vez. Quando ele calcula a distribuição, ele também decide qual caixa vai para qual loja usando o scoring de prioridade. Isso significa que o voluntário já vê na tela: "Caixa 3 — para Loja Cantina Central". Sem ambiguidade.

**`responsible_name` como mecanismo de lock:** Quando é NULL, a caixa está livre. Quando alguém coloca seu nome, ela trava. O backend valida atomicamente: antes de aceitar o claim, faz um `SELECT ... WHERE id = ? AND responsible_name IS NULL`. Se já tem nome, rejeita. O SQLite serializa writes, então não tem race condition.

**`needs_recalc` na distribution:** Flag booleana que fica 1 quando o inventário muda (nova categoria cadastrada) mas existem caixas em andamento impedindo recálculo. Quando a última caixa `in_progress` é concluída ou cancelada, o backend checa essa flag e recalcula se necessário.

**Sem `actual_quantity`:** Simplificação intencional. O voluntário vê a lista de itens que precisa colocar na caixa e, quando terminar, clica "Concluir". Não precisa ficar contando item por item no sistema — isso seria microgerenciamento que atrasa o trabalho. A caixa é "tudo ou nada": ou está pronta, ou não.

### View Auxiliar

```sql
CREATE VIEW IF NOT EXISTS store_box_count AS
SELECT
    s.id as store_id,
    s.name as store_name,
    COUNT(CASE WHEN b.status IN ('done', 'in_progress', 'pending') THEN 1 END) as boxes_total,
    COUNT(CASE WHEN b.status = 'done' THEN 1 END) as boxes_done
FROM stores s
LEFT JOIN boxes b ON b.assigned_store_id = s.id
GROUP BY s.id;
```

---

## 4. Algoritmo de Distribuição — Detalhado

### Entrada

```javascript
{
    categories: [
        { id: "uuid-1", name: "Jaqueta", total_entries: 20 },
        { id: "uuid-2", name: "Brinquedo", total_entries: 15 },
        { id: "uuid-3", name: "Livro", total_entries: 10 }
    ],
    numBoxes: 4,
    stores: [
        { id: "store-1", name: "Cantina Central" },
        { id: "store-2", name: "Barraca de Jogos" },
        { id: "store-3", name: "Bazar 3º Ano" }
    ]
}
```

### Passo 1: Validação

```javascript
const availableCategories = categories.filter(c => c.total_entries > 0)
const totalItems = availableCategories.reduce((sum, c) => sum + c.total_entries, 0)

if (totalItems === 0) {
    return { error: 'no_inventory', message: 'Nenhum produto cadastrado para distribuir.' }
}

if (numBoxes <= 0) {
    return { error: 'invalid_count', message: 'Número de caixas deve ser maior que zero.' }
}

if (numBoxes > totalItems) {
    return {
        error: 'impossible',
        message: `Impossível criar ${numBoxes} caixas com apenas ${totalItems} itens.`,
        max_possible: totalItems
    }
}
```

### Passo 2: Distribuição de Itens por Categoria (Round-Robin com Rotação)

O coração do algoritmo. Para cada categoria, divide o total pelo número de caixas. O resto (módulo) é distribuído um a um, mas com um offset que roda a cada categoria para não privilegiar sempre as mesmas caixas.

```javascript
// Inicializar caixas vazias
const boxes = Array.from({ length: numBoxes }, (_, i) => ({
    box_number: i + 1,
    items: {}    // category_id → target_quantity
}))

availableCategories.forEach((category, catIndex) => {
    const base = Math.floor(category.total_entries / numBoxes)
    const remainder = category.total_entries % numBoxes

    // O offset roda: categoria 0 começa na caixa 0,
    // categoria 1 começa na caixa 1, etc.
    // Isso evita que a Caixa 1 sempre ganhe o "+1" de todas as categorias.
    const offset = catIndex % numBoxes

    for (let i = 0; i < numBoxes; i++) {
        const rotatedIndex = (i + offset) % numBoxes
        const bonus = rotatedIndex < remainder ? 1 : 0
        const quantity = base + bonus

        if (quantity > 0) {
            boxes[i].items[category.id] = quantity
        }
    }
})
```

**Exemplo com os dados acima (4 caixas):**

Jaqueta (20 itens, offset=0): base=5, resto=0 → todas recebem 5
Brinquedo (15 itens, offset=1): base=3, resto=3 → caixas rotadas 0,1,2 recebem +1
Livro (10 itens, offset=2): base=2, resto=2 → caixas rotadas 0,1 recebem +1

| Caixa | Jaquetas | Brinquedos | Livros | Total |
|-------|----------|------------|--------|-------|
| 1     | 5        | 3          | 3      | 11    |
| 2     | 5        | 4          | 2      | 11    |
| 3     | 5        | 4          | 3      | 12    |
| 4     | 5        | 4          | 2      | 11    |

Distribuição justa: a diferença máxima entre caixas é de 1 item.

### Passo 3: Atribuição de Lojas às Caixas

Cada caixa recebe uma loja. Se tem mais caixas que lojas, as lojas se repetem em round-robin. Se tem mais lojas que caixas, prioriza as que têm menos caixas (neste cálculo, todas começam com 0).

```javascript
// Ordenar lojas: quem tem menos caixas recebidas primeiro
// (na primeira distribuição, todas têm 0 — aí vai por ordem)
const sortedStores = [...stores].sort((a, b) => {
    // boxesAlreadyReceived vem do banco (store_box_count view)
    return (a.boxes_received || 0) - (b.boxes_received || 0)
})

boxes.forEach((box, i) => {
    // Round-robin cíclico entre as lojas ordenadas por prioridade
    box.assigned_store_id = sortedStores[i % sortedStores.length].id
    box.assigned_store_name = sortedStores[i % sortedStores.length].name
})
```

**Com 4 caixas e 3 lojas:**

| Caixa | Loja |
|-------|------|
| 1     | Cantina Central |
| 2     | Barraca de Jogos |
| 3     | Bazar 3º Ano |
| 4     | Cantina Central ← recebe 2ª caixa (round-robin) |

### Passo 4: Gerar Warnings

```javascript
const warnings = []

availableCategories.forEach(cat => {
    if (cat.total_entries < numBoxes) {
        const missing = numBoxes - cat.total_entries
        warnings.push(
            `"${cat.name}" tem apenas ${cat.total_entries} itens — ` +
            `${missing} caixa(s) ficarão sem esta categoria.`
        )
    }
})

// Verificar se alguma loja recebe mais caixas que outras
const storeBoxCounts = {}
boxes.forEach(b => {
    storeBoxCounts[b.assigned_store_name] = (storeBoxCounts[b.assigned_store_name] || 0) + 1
})
const counts = Object.values(storeBoxCounts)
if (Math.max(...counts) - Math.min(...counts) > 1) {
    warnings.push('Algumas lojas receberão mais caixas que outras (diferença > 1).')
}
```

### Sugestão Automática de Quantidade

```javascript
function suggestBoxCount(categories, stores) {
    const ITEMS_PER_BOX_IDEAL = 15  // configurável
    const totalItems = categories.reduce((s, c) => s + c.total_entries, 0)
    const numStores = stores.length

    const byCapacity = Math.ceil(totalItems / ITEMS_PER_BOX_IDEAL)
    const suggestion = Math.max(numStores, byCapacity)

    return {
        suggested: suggestion,
        reasoning: `${numStores} lojas, ${totalItems} itens → ` +
                   `mínimo ${numStores} caixas (1/loja), ` +
                   `ideal ${byCapacity} caixas (~${ITEMS_PER_BOX_IDEAL} itens/caixa)`
    }
}
```

---

## 5. Endpoints REST

### Distribuição (Admin — requer header `token`)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/distribution` | Listar todas as distribuições |
| POST | `/api/distribution` | Criar distribuição (`{ name, num_boxes }`) |
| GET | `/api/distribution/:id` | Detalhes + caixas + itens (tudo junto) |
| POST | `/api/distribution/:id/calculate` | Rodar algoritmo, gerar caixas e itens no banco |
| PUT | `/api/distribution/:id/activate` | Mudar status para "active" (libera packing) |
| PUT | `/api/distribution/:id/complete` | Mudar status para "completed" |
| GET | `/api/distribution/validate` | Query param `?num_boxes=N` — checa viabilidade |
| GET | `/api/distribution/suggest` | Retorna sugestão automática de quantidade |

### Caixas (Packing — rota PÚBLICA, sem autenticação)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/packing/active` | Retorna a distribuição ativa + todas as caixas com status |
| POST | `/api/packing/boxes/:boxId/claim` | Voluntário assume caixa (`{ responsible_name }`) |
| POST | `/api/packing/boxes/:boxId/complete` | Voluntário marca caixa como concluída |
| POST | `/api/packing/boxes/:boxId/cancel` | Voluntário cancela e libera a caixa |

**Por que packing é público?** Os voluntários são alunos aleatórios ajudando na feira. Não têm login nem token. A rota `/packing` no frontend é aberta, e os endpoints `/api/packing/*` não exigem autenticação. A "segurança" é o nome da pessoa vinculado à caixa — se alguém fizer gracinha, o admin vê quem foi.

### Contratos Detalhados

**GET `/api/packing/active`**

Retorna a distribuição ativa com todas as caixas. É o endpoint principal que a tela de packing consulta.

```json
{
    "distribution": {
        "id": "uuid",
        "name": "Distribuição Manhã",
        "status": "active",
        "needs_recalc": false,
        "num_boxes": 6
    },
    "boxes": [
        {
            "id": "box-uuid-1",
            "box_number": 1,
            "status": "done",
            "responsible_name": "João",
            "store_name": "Cantina Central",
            "completed_at": "2025-...",
            "items": [
                { "category_name": "Jaqueta", "target_quantity": 5 },
                { "category_name": "Brinquedo", "target_quantity": 4 }
            ]
        },
        {
            "id": "box-uuid-2",
            "box_number": 2,
            "status": "pending",
            "responsible_name": null,
            "store_name": "Barraca de Jogos",
            "items": [
                { "category_name": "Jaqueta", "target_quantity": 5 },
                { "category_name": "Brinquedo", "target_quantity": 3 }
            ]
        }
    ],
    "stats": {
        "total_boxes": 6,
        "pending": 3,
        "in_progress": 1,
        "done": 2
    },
    "recalc_blocked": true,
    "recalc_blocked_reason": "1 caixa em andamento. Recálculo acontecerá quando for concluída ou cancelada."
}
```

**POST `/api/packing/boxes/:boxId/claim`**

```json
// Request
{ "responsible_name": "Maria" }

// Response 200 (sucesso)
{
    "box_id": "box-uuid-2",
    "box_number": 2,
    "status": "in_progress",
    "responsible_name": "Maria",
    "store_name": "Barraca de Jogos",
    "items": [
        { "category_name": "Jaqueta", "target_quantity": 5 },
        { "category_name": "Brinquedo", "target_quantity": 3 }
    ]
}

// Response 409 (já foi pega por outra pessoa)
{
    "error": "already_claimed",
    "message": "Esta caixa já foi assumida por João.",
    "responsible_name": "João"
}
```

**POST `/api/packing/boxes/:boxId/complete`**

```json
// Response 200
{
    "box_id": "box-uuid-2",
    "status": "done",
    "completed_at": "2025-...",
    "recalc_triggered": false
    // ↑ se true, significa que havia recálculo pendente e
    // esta era a última caixa in_progress — recálculo rodou
}
```

**POST `/api/packing/boxes/:boxId/cancel`**

```json
// Response 200
{
    "box_id": "box-uuid-2",
    "status": "pending",
    "responsible_name": null,
    "recalc_triggered": true,
    "message": "Caixa liberada. Recálculo foi executado pois havia novas categorias pendentes."
}
```

---

## 6. WebSocket — Tempo Real para Packing

### Novo Canal: `/ws/packing`

Separado do `/ws/admin` porque voluntários não têm token admin. Conexão pública.

```
ws://localhost:8000/ws/packing
```

**Sem autenticação.** Qualquer um pode conectar. O canal é somente de leitura para broadcast — as ações são feitas via REST (claim, complete, cancel) e o resultado é broadcastado para todos os conectados.

### Mensagens Broadcast (Servidor → Todos os Clientes)

```json
// Quando alguém assume uma caixa
{
    "type": "box_claimed",
    "box_id": "uuid",
    "box_number": 3,
    "responsible_name": "Maria",
    "store_name": "Cantina Central"
}

// Quando alguém conclui uma caixa
{
    "type": "box_completed",
    "box_id": "uuid",
    "box_number": 3,
    "responsible_name": "Maria",
    "stats": { "pending": 2, "in_progress": 0, "done": 4 }
}

// Quando alguém cancela e libera uma caixa
{
    "type": "box_released",
    "box_id": "uuid",
    "box_number": 3
}

// Quando recálculo é executado (caixas pending foram atualizadas)
{
    "type": "distribution_recalculated",
    "distribution_id": "uuid",
    "message": "Novas categorias foram incorporadas. Caixas pendentes atualizadas."
}

// Quando admin ativa/desativa a distribuição
{
    "type": "distribution_status_changed",
    "status": "active"
}

// Banner de aviso (quando inventário muda mas não pode recalcular)
{
    "type": "recalc_pending",
    "message": "Novas categorias detectadas. Recálculo pendente até caixas em andamento serem finalizadas.",
    "boxes_blocking": ["Caixa 3 (Maria)", "Caixa 5 (Pedro)"]
}
```

### Implementação no Backend (wsAdmin.js como referência)

Criar `src/api/wsPacking.js` seguindo o mesmo padrão do `wsAdmin.js`:

```javascript
const packingConnections = new Set()

function broadcastToPacking(message) {
    const data = JSON.stringify(message)
    for (const ws of packingConnections) {
        try { if (ws.readyState === ws.OPEN) ws.send(data) }
        catch { packingConnections.delete(ws) }
    }
}

function handlePackingConnection(ws) {
    // Sem autenticação — aceita qualquer conexão
    packingConnections.add(ws)
    ws.send(JSON.stringify({ type: 'connected', role: 'packer' }))

    ws.on('close', () => packingConnections.delete(ws))
    ws.on('error', () => packingConnections.delete(ws))
    // Não recebe mensagens do cliente — é somente broadcast
}
```

E registrar no `app.js`:

```javascript
// No handler de upgrade existente, adicionar:
} else if (pathname === '/ws/packing') {
    wss.handleUpgrade(request, socket, head, (ws) => {
        handlePackingConnection(ws)
    })
}
```

Os endpoints REST de packing (`/api/packing/boxes/:boxId/claim`, etc.) chamam `broadcastToPacking()` após cada operação.

---

## 7. Lógica de Recálculo — Regras Detalhadas

### Quando Recálculo é Disparado

O recálculo pode ser necessário quando:
- Uma nova categoria é cadastrada (via REST ou via WS admin `register_category`)
- O admin muda o número de caixas
- O admin força recálculo manualmente

### Quando Recálculo é BLOQUEADO

Recálculo **não acontece** se existir qualquer caixa com `status = 'in_progress'`.

Nesse caso:
1. O campo `needs_recalc` da distribuição é setado para `1`
2. Um broadcast `recalc_pending` é enviado para todos no canal packing
3. O frontend mostra um banner persistente:

```
⚠️ Novas categorias foram detectadas. As caixas pendentes serão
recalculadas automaticamente quando todas as caixas em andamento
forem concluídas ou canceladas.

Caixas em andamento: Caixa 3 (Maria), Caixa 5 (Pedro)
```

### Quando Recálculo é EXECUTADO

Ao concluir ou cancelar uma caixa, o backend checa:

```javascript
// Dentro de completeBox() e cancelBox():
const inProgressCount = db.prepare(
    'SELECT COUNT(*) as c FROM boxes WHERE distribution_id = ? AND status = ?'
).get(distributionId, 'in_progress').c

if (inProgressCount === 0) {
    const dist = db.prepare('SELECT needs_recalc FROM distributions WHERE id = ?').get(distributionId)
    if (dist.needs_recalc === 1) {
        // Recalcular APENAS caixas com status 'pending'
        recalculatePendingBoxes(distributionId)

        // Limpar a flag
        db.prepare('UPDATE distributions SET needs_recalc = 0 WHERE id = ?').run(distributionId)

        // Notificar todos
        broadcastToPacking({ type: 'distribution_recalculated', distribution_id: distributionId })
    }
}
```

### O Que "Recalcular Caixas Pending" Significa

Caixas `done` **nunca são tocadas**. Elas já foram montadas fisicamente.

Para as caixas `pending`:
1. Deletar os `box_items` dessas caixas
2. Recalcular o inventário **restante** (total - o que já está em caixas `done`)
3. Rodar o algoritmo novamente só para as caixas `pending`
4. Inserir os novos `box_items`

```javascript
function recalculatePendingBoxes(distributionId) {
    const db = getDb()

    // 1. Inventário total
    const categories = db.prepare('SELECT * FROM categories WHERE total_entries > 0').all()

    // 2. O que já foi distribuído em caixas DONE
    const doneItems = db.prepare(`
        SELECT bi.category_id, SUM(bi.target_quantity) as used
        FROM box_items bi
        JOIN boxes b ON bi.box_id = b.id
        WHERE b.distribution_id = ? AND b.status = 'done'
        GROUP BY bi.category_id
    `).all(distributionId)

    const usedMap = {}
    doneItems.forEach(d => { usedMap[d.category_id] = d.used })

    // 3. Inventário restante
    const remaining = categories.map(c => ({
        ...c,
        total_entries: c.total_entries - (usedMap[c.id] || 0)
    })).filter(c => c.total_entries > 0)

    // 4. Caixas pending
    const pendingBoxes = db.prepare(
        'SELECT * FROM boxes WHERE distribution_id = ? AND status = ?'
    ).all(distributionId, 'pending')

    // 5. Deletar box_items das caixas pending
    const pendingIds = pendingBoxes.map(b => b.id)
    if (pendingIds.length > 0) {
        db.prepare(
            `DELETE FROM box_items WHERE box_id IN (${pendingIds.map(() => '?').join(',')})`
        ).run(...pendingIds)
    }

    // 6. Rodar algoritmo com remaining + pendingBoxes.length
    const result = distributeItems(remaining, pendingBoxes.length)

    // 7. Inserir novos box_items
    const insertItem = db.prepare(
        'INSERT INTO box_items (id, box_id, category_id, target_quantity) VALUES (?, ?, ?, ?)'
    )

    result.boxes.forEach((calcBox, i) => {
        const realBox = pendingBoxes[i]
        Object.entries(calcBox.items).forEach(([catId, qty]) => {
            insertItem.run(uuidv4(), realBox.id, catId, qty)
        })
    })
}
```

---

## 8. Frontend — Estrutura de Arquivos

### Novas Rotas

```javascript
// Em App.jsx, adicionar:
<Route path="/packing" element={<Packing />} />
<Route path="/admin/distribution" element={<DistributionAdmin />} />
```

### Arquivos a Criar

```
src/
├── pages/
│   ├── admin/
│   │   └── Distribution.jsx        ← Tela admin para configurar distribuição
│   └── packing/
│       └── Packing.jsx             ← Tela pública dos voluntários
├── hooks/
│   └── usePackingWebSocket.js      ← Hook WS para canal /ws/packing
```

### Hook usePackingWebSocket.js

```javascript
import { useState, useEffect, useRef } from 'react'
import { BACKEND_WS } from '../config'

export function usePackingWebSocket() {
    const [isConnected, setIsConnected] = useState(false)
    const [events, setEvents] = useState([])
    const ws = useRef(null)

    useEffect(() => {
        let isMounted = true
        const connect = () => {
            ws.current = new WebSocket(`${BACKEND_WS}/ws/packing`)
            ws.current.onopen = () => { if (isMounted) setIsConnected(true) }
            ws.current.onmessage = (event) => {
                if (!isMounted) return
                const msg = JSON.parse(event.data)
                setEvents(prev => [msg, ...prev].slice(0, 50))
            }
            ws.current.onclose = () => {
                if (!isMounted) return
                setIsConnected(false)
                setTimeout(connect, 2000)
            }
        }
        connect()
        return () => { isMounted = false; ws.current?.close() }
    }, [])

    return { isConnected, events }
}
```

### Página de Packing — Fluxo de Telas

A página `/packing` tem 3 estados visuais:

**Estado 1: Grid de Caixas (tela principal)**

O voluntário vê todas as caixas como cards. Cada card mostra:
- Número da caixa
- Loja destino
- Status (disponível / em andamento por Fulano / concluída)
- Quantidade de categorias

Banner no topo se `recalc_blocked`:
```
⚠️ Novas categorias detectadas. Recálculo pendente até caixas
em andamento serem finalizadas. Nenhuma caixa pendente será
recalculada até que [Maria (Caixa 3)] termine ou cancele.
```

**Estado 2: Modal de Claim (ao clicar em caixa disponível)**

```
┌─────────────────────────────────────────┐
│                                         │
│  📦 Caixa 3                             │
│  Para: Loja Cantina Central             │
│                                         │
│  Conteúdo:                              │
│  • 5x Jaqueta                           │
│  • 4x Brinquedo                         │
│  • 3x Livro                             │
│                                         │
│  ─────────────────────────────────       │
│  Seu nome:                              │
│  [____________________]                 │
│                                         │
│  Ao assumir, você será a única pessoa   │
│  responsável por montar esta caixa.     │
│                                         │
│  [Cancelar]  [Assumir Responsabilidade] │
│                                         │
└─────────────────────────────────────────┘
```

**Estado 3: Tela de Montagem (após claim)**

O voluntário vê a caixa em detalhe. Cada item é um checklist visual. Quando tudo estiver ok, clica em concluir.

```
┌─────────────────────────────────────────────────────┐
│ 📦 Caixa 3 — Loja Cantina Central                  │
│ Responsável: Maria                                  │
│                                                     │
│ Coloque os seguintes itens na caixa:                │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │ □  Jaqueta .......................... × 5   │    │
│  │ □  Brinquedo ....................... × 4   │    │
│  │ □  Livro ........................... × 3   │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  Total: 12 itens                                    │
│                                                     │
│  ┌──────────────────┐  ┌────────────────────────┐   │
│  │ ✗ Cancelar e     │  │ ✓ Concluir Caixa       │   │
│  │   Liberar        │  │                        │   │
│  └──────────────────┘  └────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Sobre a Polling + WebSocket

A tela de packing usa uma combinação:
- **WebSocket** para receber eventos em tempo real (alguém pegou caixa, alguém concluiu)
- **Fetch inicial** para carregar o estado completo ao abrir a página
- **Quando recebe evento WS**, atualiza o state local (não precisa re-fetch tudo)

```javascript
// No componente Packing.jsx:
const { isConnected, events } = usePackingWebSocket()
const [boxes, setBoxes] = useState([])

// Fetch inicial
useEffect(() => {
    fetch(`${BACKEND_HTTP}/api/packing/active`)
        .then(r => r.json())
        .then(data => setBoxes(data.boxes))
}, [])

// Reagir a eventos WS atualizando state local
useEffect(() => {
    if (events.length === 0) return
    const lastEvent = events[0]

    switch (lastEvent.type) {
        case 'box_claimed':
            setBoxes(prev => prev.map(b =>
                b.id === lastEvent.box_id
                    ? { ...b, status: 'in_progress', responsible_name: lastEvent.responsible_name }
                    : b
            ))
            break
        case 'box_completed':
            setBoxes(prev => prev.map(b =>
                b.id === lastEvent.box_id
                    ? { ...b, status: 'done' }
                    : b
            ))
            break
        case 'box_released':
            setBoxes(prev => prev.map(b =>
                b.id === lastEvent.box_id
                    ? { ...b, status: 'pending', responsible_name: null }
                    : b
            ))
            break
        case 'distribution_recalculated':
            // Re-fetch tudo porque os itens das caixas pending mudaram
            fetch(`${BACKEND_HTTP}/api/packing/active`)
                .then(r => r.json())
                .then(data => setBoxes(data.boxes))
            break
    }
}, [events])
```

---

## 9. Arquivos a Criar/Modificar — Checklist Completo

### Backend Node.js

| Arquivo | Ação | O Que Fazer |
|---------|------|-------------|
| `manage.js` | MODIFICAR | Adicionar CREATE TABLE distributions, boxes, box_items + CREATE VIEW store_box_count |
| `src/services/distributionService.js` | CRIAR | Algoritmo de distribuição (distributeItems, suggestBoxCount, validate, recalculatePendingBoxes) |
| `src/services/boxService.js` | CRIAR | claimBox, completeBox, cancelBox, checkRecalcNeeded |
| `src/api/rest.js` | MODIFICAR | Adicionar rotas /api/distribution/* e /api/packing/* |
| `src/api/wsPacking.js` | CRIAR | Canal WebSocket público para voluntários |
| `src/app.js` | MODIFICAR | Registrar rota de upgrade WS /ws/packing |

### Backend Python (manter paridade)

| Arquivo | Ação | O Que Fazer |
|---------|------|-------------|
| `manage.py` | MODIFICAR | Mesmas tabelas e view |
| `app/models.py` | MODIFICAR | Adicionar models Distribution, Box, BoxItem |
| `app/services/distribution_service.py` | CRIAR | Mesmo algoritmo |
| `app/services/box_service.py` | CRIAR | Mesma lógica |
| `app/api/rest.py` | MODIFICAR | Mesmos endpoints |
| `app/api/ws_packing.py` | CRIAR | Mesmo canal WS |
| `app/main.py` | MODIFICAR | Registrar router do ws_packing |

### Frontend

| Arquivo | Ação | O Que Fazer |
|---------|------|-------------|
| `src/App.jsx` | MODIFICAR | Adicionar rotas /packing e /admin/distribution |
| `src/components/Header.jsx` | MODIFICAR | Botão "Distribuição" no header admin (ícone Package) |
| `src/hooks/usePackingWebSocket.js` | CRIAR | Hook para canal /ws/packing |
| `src/pages/packing/Packing.jsx` | CRIAR | Tela principal dos voluntários |
| `src/pages/admin/Distribution.jsx` | CRIAR | Tela admin de configuração |

---

## 10. Ordem de Implementação (Fases)

### Fase 1: Banco de Dados + Algoritmo Core
1. Tabelas em manage.js
2. distributionService.js com algoritmo puro (sem endpoints ainda)
3. Testar algoritmo isolado com dados mock

### Fase 2: Endpoints REST
1. Endpoints de distribuição (admin)
2. Endpoints de packing (público)
3. Testar com curl

### Fase 3: WebSocket Packing
1. wsPacking.js com broadcast
2. Integrar broadcasts nos endpoints REST de packing
3. Testar com múltiplas abas

### Fase 4: Frontend Admin
1. Distribution.jsx com controles de configuração
2. Botão no Header
3. Rota no App.jsx

### Fase 5: Frontend Packing
1. Packing.jsx com grid de caixas
2. Modal de claim
3. Tela de montagem
4. Integração com usePackingWebSocket
5. Banner de recálculo pendente

### Fase 6: Paridade Python + Polish
1. Implementar mesmo backend em Python
2. Feedback sonoro (reutilizar playSound)
3. Animações nos cards de caixa
4. Testes end-to-end

---

## 11. Edge Cases e Validações

| Cenário | Comportamento |
|---------|---------------|
| 4 categorias, 10 caixas | Permitir com warning: "6 caixas ficarão sem algumas categorias" |
| 0 itens no inventário | Bloquear: "Nenhum produto para distribuir" |
| Mais caixas que itens | Bloquear: "Impossível — máx N caixas" |
| Duas pessoas clicam na mesma caixa | Primeira ganha (check atômico no SQLite), segunda recebe 409 |
| Voluntário fecha o browser | Caixa fica in_progress — admin pode forçar cancel via /admin/distribution |
| Nova categoria durante montagem | Flag needs_recalc=1, banner no frontend, recálculo ao liberar |
| Todas as caixas done | Admin pode marcar distribuição como completed |
| Admin quer refazer tudo | Criar nova distribuição (a anterior fica como histórico) |
| 6 caixas e 2 lojas | Cada loja recebe 3 caixas (round-robin) |
| 3 caixas e 5 lojas | 3 lojas recebem 1 caixa, 2 lojas ficam sem. Warning exibido |

---

*Este documento foi projetado para ser passado ao Claude como contexto completo de implementação. Cada seção tem detalhes suficientes para gerar código sem ambiguidade.*
