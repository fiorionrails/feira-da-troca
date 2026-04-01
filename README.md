<p align="center">
  <img src="docs/assets/ouroboros-banner.png" alt="Ouroboros Banner" width="720" />
</p>

<h1 align="center">Ouroboros</h1>

<p align="center">
  <em>A serpente que morde a própria cauda. O crédito nunca sai — apenas circula.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white" />
  <img src="https://img.shields.io/badge/python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" />
  <img src="https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white" />
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" />
  <img src="https://img.shields.io/badge/WebSocket-010101?style=for-the-badge&logo=socketdotio&logoColor=white" />
</p>

<p align="center">
  <a href="docs/architecture/overview.md">Arquitetura</a> •
  <a href="docs/api/reference.md">API Reference</a> •
  <a href="docs/guides/setup.md">Setup</a> •
  <a href="docs/guides/resilience.md">Resiliência</a>
</p>

---

## O que é

Sistema de **economia digital fechada** projetado para a **Feira da Troca na Etec Profª Terezinha Monteiro dos Santos** (Taquarituba/SP), adaptável para qualquer evento escolar com múltiplos pontos de venda.

Substitui moedas físicas (fichas, papelão) por uma camada digital que opera **100% offline** dentro da rede local — sem depender de internet, sem Firebase obrigatório, sem plano pago. Um notebook rodando o servidor + qualquer browser na mesma rede WiFi como terminal.

---

## Demo

<!-- GIF 1: Fluxo do Banco criando comanda -->
<p align="center">
  <img src="docs/assets/demo-banco.gif" alt="Demo do Banco Central criando comanda e adicionando crédito" width="720" />
  <br>
  <em>Banco Central — Dual Mode: Emissão de nova comanda e Adição de crédito em existente</em>
</p>

<!-- GIF 2: Fluxo da Loja debitando -->
<p align="center">
  <img src="docs/assets/demo-loja.gif" alt="Demo da Loja debitando comanda via Token amigável" width="720" />
  <br>
  <em>Terminal da Loja — Login com token rápido (ex: XJ92KF), busca de comanda e débito</em>
</p>

<!-- GIF 3: Analytics em Tempo Real -->
<!--
<p align="center">
  <img src="docs/assets/demo-analytics.gif" alt="Demo do Dashboard Analytics público" width="720" />
  <br>
  <em>Dashboard Analítico Público — Atualização 100% ao vivo via WebSocket (IDEAL PARA TELÃO)</em>
</p>
-->
<!-- GIF 4: Gestão de Lojas -->
<p align="center">
  <img src="docs/assets/demo-lojas-admin.gif" alt="Demo de criação de loja no admin" width="720" />
  <br>
  <em>Admin — Criação de lojas instantâneas</em>
</p>

---

## Por que não cloud?

| Cenário | Cloud-first | Ouroboros |
|---|---|---|
| WiFi da escola cai | ❌ Sistema para | ✅ Continua normal |
| Rate limit Firebase | ❌ Bloqueado | ✅ Sem limite (local) |
| Latência de transação | ⚠️ 100–400ms | ✅ <10ms |
| Energia acaba | ❌ Perde estado | ✅ WAL mode preserva |
| Auditoria pós-evento | ⚠️ Depende do provedor | ✅ Event log imutável |
| Custo | 💸 Plano pago ou free-tier | ✅ Zero |

> Detalhes completos: [ADR-001: Local-First](docs/architecture/adr-001.md)

---

## Arquitetura

```mermaid
graph LR
    A["🏪 Terminal Loja"] -- WebSocket --> B["🖥️ Servidor Local"]
    F["🏦 Terminal Banco"] -- WebSocket --> B
    F -- REST --> B
    B -- "leitura/escrita" --> C[("💾 SQLite WAL")]
    B -. "sync eventual" .-> D[("☁️ Firebase")]
    D -. "leitura" .-> E["📱 Celular Cliente"]
```

| Componente | Stack | Função |
|---|---|---|
| **Servidor** | Node.js + Express + SQLite **ou** Python + FastAPI + SQLite | Processa transações, WebSockets e dados analíticos (ETC puro, sem centavos) |
| **Terminal Banco** | React + Vite | Dual Mode (Nova comanda / Crédito extra), gestão rápida de lojas |
| **Terminal Loja** | React + Vite | Busca rápida, proteção dupla e interface focada em tokens simplificados (6 chars) |
| **Analytics (Telão)** | React + Recharts | Gráficos e kpis atualizados via polling 3s + Live Feed WebSocket |

### Decisões de projeto

| Decisão | Motivo | Documento |
|---|---|---|
| Local-first | Internet é opcional, não infraestrutura | [ADR-001](docs/architecture/adr-001.md) |
| SQLite | Zero config, WAL, backup = copiar arquivo | [ADR-002](docs/architecture/adr-002.md) |
| Event sourcing | Auditoria completa, saldo derivado, imutável | [ADR-003](docs/architecture/adr-003.md) |

---

## Quick Start

### 1. Backend

Escolha a opção que preferir — ambas expõem **exatamente a mesma API REST e WebSocket** e usam o mesmo banco SQLite.

#### Opção A — Node.js (`backend-node/`)

```bash
cd backend-node
npm install
cp .env.example .env          # configure o ADMIN_TOKEN
npm run db:init               # cria o banco SQLite
npm start
```

#### Opção B — Python / FastAPI (`backend-python/`)

```bash
cd backend-python
python -m venv .venv

# Windows
.venv\Scripts\activate
# Linux/Mac
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env          # configure o ADMIN_TOKEN
python manage.py              # cria o banco SQLite
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

### 3. Acesse e Teste

Abra `http://localhost:5173`:

1. Selecione **Banco** → insira o `ADMIN_TOKEN` configurado no `.env` (case-sensitive)
2. Acesse a funcionalidade pública **Analytics** pelo rota `http://localhost:5173/analytics` (Ótimo para projetor)
3. Crie lojas pelo botão **Gerenciar Lojas**, pegue o **token curto gerado** (ex: `XJ92KF`)
4. Abra outra aba anônima → Selecione **Loja** → Faça login usando o Token (case-insensitive)

> 💡 **Load Test Incluído**: Quer testar os limites da sua máquina? Rode `python stress_test.py` no `backend-python/` para simular 5 lojas bombardeando o servidor simultaneamente e assista o Dashboard do Analytics fritar!

---

## Estrutura do projeto

```
feira-da-troca/
├── backend-node/
│   ├── src/
│   │   ├── api/
│   │   │   ├── rest.js           # Rotas REST (categorias, lojas, relatórios)
│   │   │   ├── wsAdmin.js        # WebSocket do Banco (criar comandas)
│   │   │   └── wsStore.js        # WebSocket da Loja (débito, consulta)
│   │   ├── services/
│   │   │   ├── comandaService.js
│   │   │   ├── storeService.js
│   │   │   ├── transactionService.js
│   │   │   └── productService.js
│   │   ├── config.js             # Configurações via dotenv (.env)
│   │   ├── database.js           # Conexão SQLite + PRAGMAs
│   │   ├── models.js             # Enums e constantes
│   │   └── app.js                # Express app + WebSocket upgrade
│   ├── manage.js                 # Script de inicialização do banco
│   ├── package.json
│   └── .env.example
├── backend-python/               # Backend legado (Python/FastAPI)
│   ├── app/
│   │   ├── api/
│   │   │   ├── rest.py
│   │   │   ├── ws_admin.py
│   │   │   └── ws_store.py
│   │   ├── services/
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── models.py
│   │   └── main.py
│   ├── manage.py
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── Login.jsx         # Tela de autenticação
│       │   ├── admin/Dashboard.jsx  # Painel do Banco + modal de lojas
│       │   └── store/Terminal.jsx   # Terminal de vendas da Loja
│       ├── hooks/
│       │   ├── useAdminWebSocket.js
│       │   └── useStoreWebSocket.js
│       ├── App.jsx
│       └── index.css
├── docs/                         # Documentação MkDocs completa
└── mkdocs.yml
```

---

## API em 30 segundos

### REST (autenticação via header `token`)

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `GET` | `/api/reports/economy_state` | Admin | Visão macro da economia |
| `GET` | `/api/stores` | Admin | Lista lojas |
| `POST` | `/api/stores` | Admin | Cria loja (token gerado auto) |
| `PUT` | `/api/stores/{id}` | Admin | Renomeia loja |
| `POST` | `/api/stores/{id}/revoke_token` | Admin | Regera token (revoga anterior) |
| `GET` | `/api/categories` | Pública | Lista categorias e preços |
| `POST` | `/api/categories` | Admin | Cria categoria |

### WebSocket

| Endpoint | Fluxo | Mensagens |
|---|---|---|
| `ws/admin?token=` | Banco → Servidor | `create_comanda`, `register_category` |
| `ws/admin?token=` | Servidor → Banco | `comanda_created`, `update_next_code`, `admin_balance_updated` |
| `ws/store?token=` | Loja → Servidor | `debit_request`, `balance_query` |
| `ws/store?token=` | Servidor → Loja | `debit_confirmed`, `debit_rejected`, `balance_response`, `balance_updated` |

> Referência completa: [`docs/api/reference.md`](docs/api/reference.md)

---

## Sobre o frontend

> **O frontend incluído é uma interface de demonstração funcional.**
>
> Implementa todos os fluxos do sistema (login, carrinho de avaliação, emissão de comandas, consulta de saldo, débito, gestão de lojas) mas foi construído com foco em **funcionalidade, não em design final**.
>
> A interface pode ser **livremente redesenhada, customizada ou substituída** por qualquer tecnologia — o backend (API REST + WebSocket) é a camada estável e documentada.

---

## Deploy para evento

```
Notebook do organizador (servidor)
├── IP: 192.168.1.10
├── Backend Node.js:  cd backend-node && npm start        (porta 8000)
├── Backend Python:   uvicorn app.main:app --host 0.0.0.0 (porta 8000)
└── Frontend: npm run build → serve estático

Terminais (qualquer browser na rede WiFi)
├── Banco: http://192.168.1.10:5173 → login com ADMIN_TOKEN
└── Lojas: http://192.168.1.10:5173 → login com token da loja
```

**Checklist pré-evento:**
- [ ] Notebook com bateria + carregador
- [ ] `.env` configurado com `ADMIN_TOKEN` forte
- [ ] Banco inicializado (`npm run db:init` no `backend-node/` **ou** `python manage.py` no `backend-python/`)
- [ ] Lojas criadas e tokens distribuídos
- [ ] IP anotado e comunicado aos lojistas
- [ ] Backup do `ouroboros.db` a cada 30 min

> Plano completo de falhas: [`docs/guides/resilience.md`](docs/guides/resilience.md)

---

## Licença

MIT

---

<p align="center">
  Desenvolvido para a <strong>Etec Profª Terezinha Monteiro dos Santos</strong> — Taquarituba/SP
  <br>
  <sub>por <a href="https://github.com/fiorionrails">Caio Fiori Martins</a></sub>
</p>
