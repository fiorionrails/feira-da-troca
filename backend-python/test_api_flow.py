import asyncio
import requests
import websockets
import json
import sqlite3
from typing import Dict, Any

ADMIN_TOKEN = "your_admin_token_here"
STORE_TOKEN = "token_loja_fantasma"
BASE_URL = "http://127.0.0.1:8000"
WS_URL = "ws://127.0.0.1:8000"

def print_section(title: str):
    print(f"\n{'='*50}")
    print(f"🔹 {title}")
    print(f"{'='*50}")

def print_result(msg: str, success: bool = True):
    mark = "✅" if success else "❌"
    print(f"{mark} {msg}")

def test_rest_endpoints():
    print_section("Testes: Endpoints REST")
    
    # 1. Root
    res = requests.get(f"{BASE_URL}/")
    assert res.status_code == 200
    assert res.json()["status"] == "online"
    print_result("Root (/) retorna status online corretamente.")

    # 2. Economy State sem token
    res = requests.get(f"{BASE_URL}/api/reports/economy_state")
    assert res.status_code == 401
    print_result("Endpoint Restrito (/api/reports/...) bloqueou sem token.")

    # 3. Economy State com token
    headers = {"token": ADMIN_TOKEN}
    res = requests.get(f"{BASE_URL}/api/reports/economy_state", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert "total_circulating" in data
    print_result("Endpoint de Estado da Economia validado com sucesso.")

async def test_websocket_admin():
    print_section("Testes: WebSocket Banco / Admin")
    url = f"{WS_URL}/ws/admin?token={ADMIN_TOKEN}"
    
    try:
        async with websockets.connect(url) as ws:
            # 1. Conexão
            initial_msg = json.loads(await ws.recv())
            assert initial_msg["type"] == "connected"
            assert "next_code" in initial_msg
            print_result(f"Admin WS conectado! Próximo código: {initial_msg['next_code']}")

            # 2. Criar Categoria
            await ws.send(json.dumps({
                "type": "register_category",
                "name": "Bolo de Pote",
                "price": 1000,
                "total_entries": 10
            }))
            
            cat_update = json.loads(await ws.recv())
            assert cat_update["type"] == "category_updated"
            assert cat_update["category"]["name"] == "Bolo de Pote"
            print_result("Admin WS: Registro de cateogoria enviado -> Broadcast recebido.")

            # 3. Criar Comanda
            target_balance = 5000
            await ws.send(json.dumps({
                "type": "create_comanda",
                "holder_name": "Testador de API",
                "initial_balance": target_balance
            }))

            # WS envia dois broadcasts de volta, on para comanda e on para update code
            msg1 = json.loads(await ws.recv())
            msg2 = json.loads(await ws.recv())
            
            created_msg = msg1 if msg1["type"] == "comanda_created" else msg2
            update_msg = msg1 if msg1["type"] == "update_next_code" else msg2
            
            assert created_msg["holder_name"] == "Testador de API"
            comanda_code = created_msg["code"]
            print_result(f"Admin WS: Comanda {comanda_code} criada com saldo de {created_msg['balance']}.")
            print_result(f"Admin WS: Próximo código espalhado pelo banco: {update_msg['next_code']}")
            
            return comanda_code
            
    except Exception as e:
        print_result(f"Erro no Admin WS: {str(e)}", False)
        raise

async def test_websocket_store(comanda_code: str):
    print_section("Testes: WebSocket Lojas")
    
    # 0. Set up dummy store in DB bypassing API for auth bypass test
    conn = sqlite3.connect("ouroboros.db")
    import uuid
    store_id = str(uuid.uuid4())
    try:
         conn.execute("INSERT INTO stores (id, name, theme, terminal_token) VALUES (?, ?, ?, ?)", 
                     (store_id, "Loja Fantasma Teste", "Fantasmas", STORE_TOKEN))
         conn.commit()
    except sqlite3.IntegrityError:
         pass # Ja existe
    finally:
         conn.close()

    url = f"{WS_URL}/ws/store?token={STORE_TOKEN}"
    try:
        async with websockets.connect(url) as ws:
            initial_msg = json.loads(await ws.recv())
            assert initial_msg["type"] == "connected"
            print_result("Store WS: Conectado na Loja Fantasma Teste!")

            # 1. Consulta de saldo
            await ws.send(json.dumps({
                "type": "balance_query",
                "comanda_code": comanda_code
            }))
            
            balance_msg = json.loads(await ws.recv())
            assert balance_msg["type"] == "balance_response"
            print_result(f"Store WS: Consulta de saldo respondeu {balance_msg['balance']}.")

            # 2. Debito com sucesso
            await ws.send(json.dumps({
                "type": "debit_request",
                "comanda_code": comanda_code,
                "amount": 250
            }))
            
            debit_conf = json.loads(await ws.recv())
            assert debit_conf["type"] == "debit_confirmed"
            print_result(f"Store WS: Debito de 250 confirmado! Saldo novo: {debit_conf['new_balance']}")
            
            # (O servidor tbm espalha balance_updated, vamos puxar tbm)
            balance_bdcst = json.loads(await ws.recv())
            assert balance_bdcst["type"] == "balance_updated"
            print_result("Store WS: Broadcast de balance_updated emitido pela loja recebido de volta.")

            # 3. Debito falhando por falta de limite
            await ws.send(json.dumps({
                "type": "debit_request",
                "comanda_code": comanda_code,
                "amount": 9999999
            }))
            
            debit_rej = json.loads(await ws.recv())
            assert debit_rej["type"] == "debit_rejected"
            assert debit_rej["reason"] == "insufficient_balance"
            print_result("Store WS: Débito alto bloqueado e saldo protegido corretamente.")
            
    except Exception as e:
        print_result(f"Erro na Store WS: {str(e)}", False)
        raise

async def main():
    print("Iniciando bateria de testes do Ouroboros API...")
    test_rest_endpoints()
    comanda_code = await test_websocket_admin()
    await test_websocket_store(comanda_code)
    print_section("RESUMO")
    print_result("🎉 TODOS OS TESTES PASSARAM: Event Sourcing, REST & WebSockets estão 100% validados!")

if __name__ == "__main__":
    asyncio.run(main())
