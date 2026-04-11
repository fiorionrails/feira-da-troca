# Setup Local

Como rodar o Ouroboros em desenvolvimento ou em um evento real.

---

## Pré-requisitos

- Node.js 20+ (backend Node.js e frontend)
- Python 3.11+ (apenas se usar o backend Python)
- Git

Nenhum banco de dados externo, nenhum Docker obrigatório.

---

## 1. Clone o repositório

```bash
git clone https://github.com/fiorionrails/feira-da-troca.git
cd feira-da-troca
```

---

## 2. Backend

Escolha a opção que preferir — ambas expõem **exatamente a mesma API REST e WebSocket** e usam o mesmo banco SQLite.

---

### Opção A — Node.js (`backend-node/`)

```bash
cd backend-node

# Instala dependências
npm install

# Cria o arquivo de configuração
cp .env.example .env
```

Edite o `.env` com os valores do seu ambiente:

```env
# Segurança
ADMIN_TOKEN=seu_token_admin_aqui
SECRET_KEY=chave_secreta_aleatoria  # Reservado para uso futuro (ex: JWT/HMAC com Firebase). Não tem efeito funcional hoje.

# Banco de dados (padrão é o diretório do backend-node/)
DATABASE_URL=./ouroboros.db

# Configuração do evento
EVENT_NAME=Feira da Troca 2025
MAX_COMANDAS=1000
PORT=8000
```

!!! tip "Gerando tokens seguros"
    ```bash
    node -e "const c=require('crypto');console.log(c.randomBytes(32).toString('hex'))"
    ```

## 3. Inicializa o banco (Node.js)

```bash
npm run db:init
```

## 4. Sobe o servidor (Node.js)

```bash
npm start
```

O servidor estará acessível em `http://localhost:8000`.

Com `0.0.0.0` como host padrão, outros dispositivos na mesma rede WiFi podem acessar via IP da máquina (ex: `http://192.168.1.10:8000`).

---

### Opção B — Python / FastAPI (`backend-python/`)

```bash
cd backend-python

# Cria e ativa o ambiente virtual
python -m venv .venv
source .venv/bin/activate  # Linux/Mac
# .venv\Scripts\activate   # Windows

# Instala dependências
pip install -r requirements.txt

# Cria o arquivo de configuração
cp .env.example .env
```

Edite o `.env` com os valores do seu ambiente:

```env
# Segurança
ADMIN_TOKEN=seu_token_admin_aqui
SECRET_KEY=chave_secreta_aleatoria

# Banco de dados (padrão é o diretório do backend)
DATABASE_URL=sqlite:///./ouroboros.db

# Firebase (opcional — sync desabilitada se não configurado)
# FIREBASE_PROJECT_ID=
# FIREBASE_PRIVATE_KEY=
# FIREBASE_CLIENT_EMAIL=

# Configuração do evento
EVENT_NAME=Feira da Troca 2025
MAX_COMANDAS=1000
```

!!! tip "Gerando tokens seguros"
    ```bash
    python -c "import secrets; print(secrets.token_urlsafe(32))"
    ```

## 3. Inicializa o banco (Python)

```bash
python manage.py
```

## 4. Sobe o servidor (Python)

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

O servidor estará acessível em:

- **API:** `http://localhost:8000`
- **Docs interativas:** `http://localhost:8000/docs`
- **ReDoc:** `http://localhost:8000/redoc`

Com `--host 0.0.0.0`, outros dispositivos na mesma rede WiFi podem acessar via IP da máquina (ex: `http://192.168.1.10:8000`).

---

## 5. Frontend (demonstração)

!!! note "Frontend de demonstração"
    O frontend incluído é um **protótipo funcional de demonstração**. Ele implementa todos os fluxos do sistema (login, emissão de comandas, carrinho, debitar) mas foi construído com foco em funcionalidade, não em design final. **A interface pode ser livremente customizada, redesenhada ou substituída** — o backend e a API WebSocket são a camada estável do projeto.

```bash
cd ../frontend
npm install
npm run dev
```

O painel estará em `http://localhost:5173`.

Para produção (servido pelo próprio backend):

```bash
# 1. Configure o IP do servidor na LAN
cp .env.example .env
# Edite .env e substitua 192.168.1.10 pelo IP real da máquina servidora

# 2. Build de produção (lê as variáveis do .env automaticamente)
npm run build
# O build vai para dist/ — copie para backend-node/public/ ou backend-python/public/
```

!!! warning "Não pule a configuração do IP"
    Se fizer `npm run build` sem configurar o `.env`, o frontend irá apontar para `localhost:8000`.
    Isso funciona apenas na máquina servidora — todos os outros terminais na LAN não conseguirão conectar.

---

## 6. Criando lojas

Após o servidor rodar, acesse o painel admin (frontend em `http://localhost:5173`, selecione "Banco" e use o `ADMIN_TOKEN` como chave de acesso).

No Dashboard do Banco, clique em **"Gerenciar Lojas"** para criar lojas e obter os tokens dos terminais.

Ou via API REST:

```bash
curl -X POST http://localhost:8000/api/stores \
  -H "token: SEU_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Cantina Italiana"}'
```

A resposta incluirá o `terminal_token` gerado automaticamente para a loja.

---

## 7. Fluxo de login e operação

1. **Banco (Admin):** Na tela de login, selecione "Banco" e insira o `ADMIN_TOKEN` definido no `.env`.
2. **Loja:** Na tela de login, selecione "Loja" e insira o `terminal_token` da loja (obtido via painel admin ou API).

---

## Setup para evento real

### Rede local

O servidor roda na máquina do organizador. Os terminais das lojas se conectam via WiFi da escola.

```
Notebook do organizador
├── IP: 192.168.1.10 (exemplo)
├── Node.js:  cd backend-node && npm start
└── Python:   uvicorn app.main:app --host 0.0.0.0 --port 8000

Terminais das lojas
└── abrem: http://192.168.1.10:5173 (frontend dev)
    ou http://192.168.1.10:8000 (se build de produção)
```

!!! warning "Anote o IP antes do evento"
    Descubra o IP da máquina servidora antes de começar:
    ```bash
    ip addr show  # Linux
    ipconfig      # Windows
    ```

### Backup durante o evento

```bash
# Copie o arquivo de banco a cada hora
cp ouroboros.db backups/ouroboros-$(date +%H%M).db
```

O banco inteiro é um único arquivo. Um pendrive com cópias periódicas é suficiente.
