# Setup Local

Como rodar o Ouroboros em desenvolvimento ou em um evento real.

---

## Pré-requisitos

- Python 3.11+
- Node.js 18+ (para o frontend)
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

```bash
cd backend

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

# Firebase (opcional — sync desabilitada se não configurado)
FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=

# Configuração do evento
EVENT_NAME=Feira da Troca 2025
MAX_COMANDAS=500
```

!!! tip "Gerando tokens seguros"
    ```bash
    python -c "import secrets; print(secrets.token_urlsafe(32))"
    ```

---

## 3. Inicializa o banco

```bash
python manage.py init_db
```

Isso cria o arquivo `ouroboros.db` com o schema completo.

---

## 4. Sobe o servidor

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

O servidor estará acessível em:

- **API:** `http://localhost:8000`
- **Docs interativas:** `http://localhost:8000/docs`
- **ReDoc:** `http://localhost:8000/redoc`

Com `--host 0.0.0.0`, outros dispositivos na mesma rede WiFi podem acessar via IP da máquina (ex: `http://192.168.1.10:8000`).

---

## 5. Frontend

```bash
cd ../frontend
npm install
npm run dev
```

O painel estará em `http://localhost:5173`.

Para produção (servido pelo próprio backend):

```bash
npm run build
# O build vai pra ../backend/static/
```

---

## 6. Criando lojas e tokens

Após o servidor rodar, acesse o painel admin e crie as lojas. Cada loja recebe um token único que deve ser inserido no terminal correspondente.

Ou via API:

```bash
curl -X POST http://localhost:8000/api/v1/stores \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Cantina Italiana", "theme": "italiana"}'
```

---

## Setup para evento real

### Rede local

O servidor roda na máquina do organizador. Os terminais das lojas se conectam via WiFi da escola.

```
Notebook do organizador
├── IP: 192.168.1.10 (exemplo)
└── roda: uvicorn --host 0.0.0.0 --port 8000

Terminais das lojas
└── abrem: http://192.168.1.10:8000/store/<store_token>
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

---

## Verificando que está tudo certo

```bash
# Health check
curl http://localhost:8000/health

# Resposta esperada
{"status": "ok", "db": "connected", "firebase": "connected"}
# ou
{"status": "ok", "db": "connected", "firebase": "disabled"}
```
