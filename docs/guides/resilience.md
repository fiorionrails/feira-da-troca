# Plano de Resiliência

O Ouroboros foi projetado para operar em ambientes adversos. Este documento descreve o que acontece em cada cenário de falha e como o sistema se recupera.

---

## Princípio geral

> **Nenhuma falha externa deve parar uma transação local.**

O sistema é projetado em camadas de criticidade:

| Camada | Criticidade | O que falha | Impacto |
|---|---|---|---|
| SQLite | Máxima | Banco corrompido | Sistema para |
| Servidor (Node.js / FastAPI) | Alta | Processo cai | Downtime temporário |
| Rede WiFi local | Média | Terminal desconecta | Terminal offline, servidor ok |
| Internet | Baixa | Firebase inacessível | Sync pausa, operação continua |
| Firebase | Baixa | Serviço fora do ar | Cliente não vê saldo, operação continua |

---

## Cenário 1: Internet cai durante o evento

**O que acontece:**

- O servidor não percebe — ele não depende de internet para operar
- Transações continuam normalmente
- Novos eventos acumulam com `synced = 0` no banco
- O cliente não consegue atualizar o saldo no celular

**Recuperação:**

- Quando a internet voltar, o worker de sync identifica eventos pendentes (`synced = 0`) e os envia ao Firebase em ordem cronológica
- Nenhuma transação é perdida — o event store é a fonte da verdade

**Ação necessária do operador:** nenhuma.

---

## Cenário 2: Firebase fora do ar

Igual ao cenário 1. Firebase é uma camada de leitura — sua indisponibilidade não afeta as operações.

**Ação necessária do operador:** nenhuma.

---

## Cenário 3: Terminal de loja perde WiFi

**O que acontece:**

- O browser do terminal detecta que o WebSocket foi fechado
- Exibe banner "Reconectando..." ao lojista
- Implementa reconnect automático com backoff exponencial (2s, 4s, 8s, máx 30s)

**Recuperação:**

- Quando o WiFi volta, o terminal reconecta automaticamente
- O servidor envia os eventos perdidos durante a desconexão
- O terminal volta ao estado correto

**Durante a desconexão:**

- O terminal **não processa transações** — exibe mensagem ao lojista
- Lojistas em outros terminais continuam operando normalmente

**Ação necessária do operador:** aguardar reconexão automática. Se o WiFi não voltar, o lojista pode usar outro dispositivo.

---

## Cenário 4: Servidor cai (crash, reinício)

**O que acontece:**

- Todos os terminais perdem a conexão WebSocket simultaneamente
- Exibem "Servidor offline"

**Recuperação:**

1. Operador reinicia o servidor:
   - **Node.js:** `cd backend-node && npm start`
   - **Python:** `uvicorn app.main:app --host 0.0.0.0 --port 8000`
2. SQLite abre o arquivo `.db` — WAL mode garante que nenhuma transação confirmada foi perdida
3. Servidor fica disponível (tipicamente em < 10 segundos)
4. Terminais reconectam automaticamente
5. Worker de sync retoma o envio de eventos pendentes ao Firebase

**Tempo de downtime esperado:** 10–30 segundos.

**Ação necessária do operador:** reiniciar o processo do servidor.

---

## Cenário 5: Energia da máquina servidora cai

O cenário mais severo.

**O que acontece:**

- Servidor para imediatamente
- Todos os terminais ficam offline

**Por que os dados são preservados:**

O SQLite com WAL mode funciona assim:

1. Antes de qualquer write, registra a intenção no WAL file
2. Escreve os dados
3. Após confirmação da transação, limpa o WAL

Se a energia cair no passo 2, o SQLite detecta o WAL incompleto na próxima abertura e **desfaz automaticamente** a transação parcial. O banco volta ao último estado consistente.

Isso significa: qualquer transação que retornou `debit_confirmed` para o terminal **está garantida no banco** — a confirmação só é enviada após o `INSERT` ser commitado.

**Recuperação:**

1. Ligar o notebook na tomada
2. Reiniciar o servidor
3. Banco restaura automaticamente — zero intervenção manual
4. Terminais reconectam

**Ação necessária do operador:** ligar a máquina e reiniciar o servidor.

!!! warning "Recomendação de hardware"
    Rodar o servidor em um notebook (não desktop) garante que a bateria atua como UPS natural. Mesmo que a tomada caia, o servidor continua por horas.

---

## Cenário 6: Banco de dados corrompido (catastrófico)

Extremamente improvável com SQLite + WAL, mas documentado por completude.

**Prevenção:**

- Backups periódicos do arquivo `.db` (recomendado: a cada 30 minutos durante o evento)
- Script de backup automatizado incluso no repositório:

```bash
# scripts/backup.sh
#!/bin/bash
BACKUP_DIR="./backups"
mkdir -p $BACKUP_DIR
cp ouroboros.db "$BACKUP_DIR/ouroboros-$(date +%Y%m%d-%H%M%S).db"
echo "Backup criado: $BACKUP_DIR/ouroboros-$(date +%Y%m%d-%H%M%S).db"
```

```bash
# Agendar backup a cada 30min (Linux)
crontab -e
# Adicionar:
# */30 * * * * /path/to/ouroboros/scripts/backup.sh
```

**Recuperação se o pior acontecer:**

1. Parar o servidor
2. Copiar o último backup: `cp backups/ouroboros-TIMESTAMP.db ouroboros.db`
3. Reiniciar o servidor
4. Perda máxima: transações desde o último backup (30 min)

---

## Checklist pré-evento

Antes de começar o evento, o operador deve verificar:

- [ ] Notebook com bateria carregada e carregador conectado
- [ ] Arquivo `.db` novo (ou resetado) — sem dados de teste
- [ ] Todas as lojas criadas e tokens distribuídos
- [ ] Terminais de loja testados (scan de QR + débito de teste)
- [ ] Script de backup configurado
- [ ] IP da máquina anotado e comunicado aos lojistas
- [ ] Firebase configurado (opcional, mas recomendado)
- [ ] Backup do `.env` em local seguro

---

## Resumo de garantias

| Garantia | Condição |
|---|---|
| Transações não são perdidas | SQLite + WAL mode (sempre ativo) |
| Sistema não para se internet cair | Local-first por design |
| Sistema não para se Firebase cair | Firebase é leitura-only, não operacional |
| Terminais reconectam sozinhos | Reconnect automático com backoff |
| Saldo nunca fica inconsistente | Event sourcing — saldo é derivado, nunca armazenado |
| Recuperação após queda de energia | WAL mode + restart manual do processo |
