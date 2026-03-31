import asyncio
import json
import random
import time
import urllib.request
from collections import deque
import websockets
from dotenv import dotenv_values

# Pega o token de admin do .env local
env = dotenv_values(".env")
ADMIN_TOKEN = env.get("ADMIN_TOKEN", "")

BASE_URL = "http://localhost:8000"
WS_URL = "ws://localhost:8000"

categories = [
    {"name": "Bolo de Pote", "price": 10},
    {"name": "Refrigerante 350ml", "price": 5},
    {"name": "Fatia de Pizza", "price": 15},
    {"name": "Pulseira Neon", "price": 8},
    {"name": "Hambúrguer", "price": 25}
]

store_names = [
    "Cantina Central",
    "Barraca de Jogos",
    "Bazar 3º Ano",
    "Doces e Cia",
    "Artesanato Local"
]

active_comandas = []
metrics = {
    "comandas_created": 0,
    "debits_requested": 0,
    "debits_success": 0,
    "debits_failed": 0,  # Geralmente saldo insuficiente
    "errors": 0,
    "latencies": deque(maxlen=200)
}

def post_json(endpoint, data, token):
    req = urllib.request.Request(f"{BASE_URL}{endpoint}", data=json.dumps(data).encode('utf-8'))
    req.add_header('Content-Type', 'application/json')
    req.add_header('token', token)
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as e:
        if e.code != 400: # Ignora 400 se a categoria/loja já existir
            print(f"[{e.code}] Erro ao chamar {endpoint}: {e.read().decode()}")
        return None
    except Exception as e:
        print(f"Erro de conexão com {endpoint}: {e}")
        return None

async def admin_worker():
    uri = f"{WS_URL}/ws/admin?token={ADMIN_TOKEN}"
    while True:
        try:
            async with websockets.connect(uri) as ws:
                print("[🏦 Admin Worker] Conectado e emitindo comandas!")
                names = ["Pedro", "Maria", "João", "Ana", "Lucas", "Julia", "Marcos"]
                
                while True:
                    # Emite comanda com valor inicial aleatório entre 50 e 150 ETC
                    holder = random.choice(names) + f" {random.randint(100, 999)}"
                    balance = random.randint(50, 150)
                    
                    # Simula adição de crédito atrelado à compra de produtos iniciais (ex: Banco vendeu o ingresso e pulseras)
                    cart = [
                        {"name": random.choice(categories)["name"], "quantity": random.randint(1, 3)}
                    ]
                    
                    msg = {
                        "action": "create_comanda",
                        "holder_name": holder,
                        "initial_balance": balance,
                        "cart_items": cart
                    }
                    start_t = time.time()
                    await ws.send(json.dumps(msg))
                    resp = json.loads(await ws.recv())
                    latency = (time.time() - start_t) * 1000
                    metrics["latencies"].append(latency)
                    
                    if resp.get("status") == "success":
                        metrics["comandas_created"] += 1
                        active_comandas.append(resp["data"]["code"])
                    else:
                        metrics["errors"] += 1
                        
                    # Velocidade de emissão (ex: 2 comandas por segundo = 0.5s de taxa)
                    await asyncio.sleep(0.5) 
        except Exception as e:
            print(f"[🏦 Admin Erro] {e}. Reconectando...")
            metrics["errors"] += 1
            await asyncio.sleep(2)

async def store_worker(store_token, store_name):
    uri = f"{WS_URL}/ws/store?token={store_token}"
    while True:
        try:
            async with websockets.connect(uri) as ws:
                print(f"[🏪 Store Worker - {store_name}] Operacional e cobrando!")
                while True:
                    if active_comandas:
                        comanda_code = random.choice(active_comandas)
                        amount = random.randint(5, 30)
                        
                        msg = {
                            "action": "debit",
                            "comanda_code": comanda_code,
                            "amount": amount
                        }
                        metrics["debits_requested"] += 1
                        start_t = time.time()
                        await ws.send(json.dumps(msg))
                        resp = json.loads(await ws.recv())
                        latency = (time.time() - start_t) * 1000
                        metrics["latencies"].append(latency)
                        
                        if resp.get("status") == "success":
                            metrics["debits_success"] += 1
                        else:
                            metrics["debits_failed"] += 1
                            
                    # Simula fluxo maluco: lojas tentando debitar entre 0.1 e 0.6s
                    await asyncio.sleep(random.uniform(0.1, 0.6))
        except Exception as e:
            print(f"[🏪 Store {store_name} Offline] {e}. Reparando máquina de cartão...")
            metrics["errors"] += 1
            await asyncio.sleep(2)

async def reporter_loop():
    start_time = time.time()
    while True:
        await asyncio.sleep(3)
        elapsed = time.time() - start_time
        total_ops = metrics["comandas_created"] + metrics["debits_requested"]
        ops_sec = total_ops / elapsed if elapsed > 0 else 0
        avg_lat = sum(metrics["latencies"])/len(metrics["latencies"]) if metrics["latencies"] else 0
        
        print("\n" + "="*40)
        print(f"📊 RELATÓRIO DE ESTRESSE ({elapsed:.0f} segundos)")
        print(f"⚡ Throughput: {ops_sec:.2f} transações por segundo")
        print(f"⏱️ Latência Média WS: {avg_lat:.2f} ms")
        print("-" * 40)
        print(f"🎫 Comandas Emitidas:   {metrics['comandas_created']}")
        print(f"💸 Cobranças Tentadas:  {metrics['debits_requested']}")
        print(f"✅ Cobranças Sucesso:   {metrics['debits_success']}")
        print(f"❌ Saldos Insuficientes: {metrics['debits_failed']}")
        print(f"🔌 Erros Lógicos/Rede:  {metrics['errors']}")
        print("="*40 + "\n")

async def main():
    print("🚀 INICIANDO TESTE DE ESTRESSE OUROBOROS\n")
    print("1️⃣ Semeando categorias iniciais...")
    for cat in categories:
        post_json("/api/categories", {"name": cat["name"], "price": cat["price"]}, ADMIN_TOKEN)
        
    print("2️⃣ Registrando pontos de venda (Lojas)...")
    store_tokens = []
    
    # Pega lojas existentes primeiro para evitar duplicação no dashboard, 
    # mas cria novas se for necessário.
    existing_stores_req = urllib.request.Request(f"{BASE_URL}/api/stores", headers={'token': ADMIN_TOKEN})
    try:
        with urllib.request.urlopen(existing_stores_req) as response:
            existing = json.loads(response.read().decode())
            for s in existing:
                store_tokens.append((s["terminal_token"], s["name"]))
    except:
        pass

    # Cria até atingir 5 lojas para o teste
    for i in range(len(store_tokens), 5):
        s_name = store_names[i]
        resp = post_json("/api/stores", {"name": s_name}, ADMIN_TOKEN)
        if resp and "terminal_token" in resp:
            store_tokens.append((resp["terminal_token"], s_name))
            
    if not store_tokens:
        print("❌ Falha crítica: Nenhuma loja criada/recuperada. Verifique se o backend está rodando e aceite o ADMIN_TOKEN.")
        return
        
    print(f"✅ {len(store_tokens)} Lojas preparadas para atacar!\n")
    
    tasks = [
        asyncio.create_task(admin_worker()),
        asyncio.create_task(reporter_loop())
    ]
    
    for token, s_name in store_tokens:
        tasks.append(asyncio.create_task(store_worker(token, s_name)))
        
    print("🔥 DISPARANDO CONEXÕES! (Pressione Ctrl+C para parar)\n")
    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        pass

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n🛑 TESTE ABORTADO PELO USUÁRIO. FIM.")
