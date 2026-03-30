# Diagramas de Sequência

Todos os fluxos principais do sistema documentados com diagramas de sequência. Esses diagramas descrevem a ordem exata das operações e quem é responsável por cada passo.

---

## 1. Criação de comanda

O administrador emite uma comanda para um participante com saldo inicial.

```mermaid
sequenceDiagram
    actor Admin
    participant API as Servidor (FastAPI)
    participant DB as SQLite
    participant FB as Firebase

    Admin->>API: POST /comandas {holder_name, initial_balance}
    API->>DB: INSERT INTO comandas
    API->>DB: INSERT INTO events (type=credit, amount=initial_balance)
    DB-->>API: ok
    API-->>Admin: {comanda_id, code, balance}
    
    Note over API,FB: sync assíncrono (background task)
    API->>FB: write comanda + evento (best-effort)
    FB-->>API: ok (ou timeout — ignorado)
```

**Pontos de atenção:**

- O código da comanda (`code`) é gerado no servidor e é curto o suficiente para digitação manual
- A resposta ao admin não espera o Firebase — a sync é fire-and-forget
- Se o Firebase estiver offline, a comanda ainda é criada normalmente

---

## 2. Débito em loja (fluxo principal)

Um participante compra algo numa loja. É o fluxo mais crítico do sistema.

```mermaid
sequenceDiagram
    actor Cliente
    actor Lojista
    participant WS as WebSocket (Terminal)
    participant API as Servidor (FastAPI)
    participant DB as SQLite
    participant Outros as Outros Terminais
    participant FB as Firebase

    Cliente->>Lojista: informa o código da comanda
    Lojista->>WS: digita código → debit_request {code, amount, store_id}
    
    WS->>API: WS message: debit_request
    
    API->>DB: SELECT balance FROM events WHERE comanda_id = ?
    DB-->>API: balance atual
    
    alt saldo suficiente
        API->>DB: INSERT INTO events (type=debit, ...)
        DB-->>API: ok
        API-->>WS: debit_confirmed {new_balance, event_id}
        API-->>Outros: broadcast: balance_updated {comanda_id, new_balance}
        
        Note over API,FB: sync assíncrono
        API->>FB: write event
    else saldo insuficiente
        API-->>WS: debit_rejected {reason: insufficient_balance, current_balance}
    end
    
    WS-->>Lojista: exibe resultado (confirmado / rejeitado)
```

**Pontos de atenção:**

- A validação de saldo e a inserção do evento acontecem dentro de uma transação SQLite — são atômicas
- O broadcast para outros terminais permite que o painel admin veja movimentações em tempo real
- O Firebase só recebe o evento após confirmação local — nunca antes

---

## 3. Consulta de saldo pelo cliente

O participante quer saber quanto tem no celular, sem interagir com nenhuma loja.

```mermaid
sequenceDiagram
    actor Cliente
    participant FB as Firebase Firestore
    participant Cache as Cache Firebase (local no celular)

    Cliente->>FB: GET /comandas/{comanda_id}/balance
    
    alt Firebase online e sync em dia
        FB-->>Cliente: {balance: X, last_updated: timestamp}
    else Firebase offline (celular sem internet)
        Cache-->>Cliente: {balance: X (cached), stale: true}
    else Firebase online mas sync atrasada
        FB-->>Cliente: {balance: X (pode estar desatualizado), last_updated: timestamp}
        Note over Cliente: UI exibe aviso de "pode estar desatualizado"
    end
```

**Pontos de atenção:**

- O cliente **nunca** consulta o servidor principal — esse canal é reservado para operações de loja
- O saldo no Firebase pode estar levemente desatualizado — isso é esperado e documentado (eventual consistency)
- A UI deve sempre exibir o `last_updated` para o cliente ter contexto da atualização

---

## 4. Reconexão de terminal após queda

Um terminal de loja perde a conexão WebSocket (WiFi momentâneo, por exemplo) e reconecta.

```mermaid
sequenceDiagram
    participant WS as Terminal (browser)
    participant API as Servidor

    WS->>API: WS connect
    API-->>WS: connected {session_id}
    
    Note over WS: conexão cai (WiFi, etc.)
    
    WS->>WS: detecta disconnect
    WS->>WS: aguarda 2s (backoff)
    WS->>API: WS reconnect
    API-->>WS: connected {session_id}
    API-->>WS: missed_events[] (eventos ocorridos durante a desconexão)
    WS->>WS: aplica missed_events no estado local
    
    Note over WS: terminal volta ao estado correto
```

**Pontos de atenção:**

- O frontend implementa reconnect automático com exponential backoff
- O servidor guarda os últimos N eventos da sessão para enviar no reconnect
- Nenhuma transação é perdida — o event store é a fonte da verdade

---

## 5. Recuperação após queda do servidor

O notebook do servidor é desligado (ou cai). O evento é reiniciado após o servidor voltar.

```mermaid
sequenceDiagram
    participant Servidor
    participant DB as SQLite (arquivo em disco)
    participant Terminais

    Note over Servidor: servidor cai (energia, crash, etc.)
    Note over Terminais: terminais exibem "Servidor offline"
    
    Note over Servidor: servidor reinicia
    Servidor->>DB: open ouroboros.db
    DB-->>Servidor: estado completo restaurado (WAL mode)
    
    Servidor->>Servidor: inicia worker de sync Firebase
    Servidor->>Servidor: abre porta WebSocket
    
    Terminais->>Servidor: reconnect automático
    Servidor-->>Terminais: connected + estado atual
    
    Note over Servidor: operação normal retomada
    Note over Servidor: eventos não-synced são enviados ao Firebase
```

**Pontos de atenção:**

- O SQLite com WAL mode garante que nenhum evento confirmado é perdido
- O worker de sync ao reiniciar identifica eventos com `synced = 0` e os envia
- O downtime é o tempo de restart do servidor (tipicamente < 10 segundos)
