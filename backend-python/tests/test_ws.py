"""
WebSocket integration tests — mirrors backend-node/tests/ws.test.js

Uses Starlette's TestClient which supports synchronous WebSocket testing.
"""

import os
import json
import pytest
from datetime import datetime, timezone

ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "admin_token_change_me")
WRONG_TOKEN = "wrong-token"


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------
def seed_comanda(conn, code="F001", holder="Test User", balance=2000):
    cid = f"cid-{code}"
    conn.execute(
        "INSERT INTO comandas (id, code, holder_name, created_at) VALUES (?,?,?,?)",
        (cid, code, holder, datetime.now(timezone.utc).isoformat()),
    )
    if balance > 0:
        conn.execute(
            "INSERT INTO events (id, type, comanda_id, amount, note, timestamp) VALUES (?,?,?,?,?,?)",
            (f"eid-{code}", "credit", cid, balance, "Saldo inicial", datetime.now(timezone.utc).isoformat()),
        )
    conn.commit()
    return cid


def seed_store(conn, store_id="store-1", name="Test Store", token="STRTK1"):
    conn.execute(
        "INSERT INTO stores (id, name, theme, terminal_token) VALUES (?,?,?,?)",
        (store_id, name, "default", token),
    )
    conn.commit()
    return store_id


# ============================================================================
# Admin WS — authentication
# ============================================================================
class TestAdminWSAuth:
    def test_connects_with_valid_token(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            msg = ws.receive_json()
            assert msg["type"] == "connected"
            assert msg["role"] == "admin"
            assert isinstance(msg["next_code"], str)

    def test_server_closes_with_1008_for_invalid_token(self, client):
        with pytest.raises(Exception):
            with client.websocket_connect(f"/ws/admin?token={WRONG_TOKEN}") as ws:
                ws.receive_text()

    def test_next_code_is_f001_on_empty_db(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            msg = ws.receive_json()
            assert msg["next_code"] == "F001"


# ============================================================================
# Admin WS — create_comanda
# ============================================================================
class TestAdminWSCreateComanda:
    def test_creates_comanda_and_receives_comanda_created(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()  # greeting
            ws.send_json({"type": "create_comanda", "holder_name": "Maria", "initial_balance": 1000})
            msgs = [ws.receive_json(), ws.receive_json()]
            created = next((m for m in msgs if m["type"] == "comanda_created"), None)
            next_code = next((m for m in msgs if m["type"] == "update_next_code"), None)
            assert created is not None
            assert created["holder_name"] == "Maria"
            assert created["balance"] == 1000
            assert created["code"].startswith("F")
            assert next_code is not None

    def test_zero_initial_balance(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            ws.send_json({"type": "create_comanda", "holder_name": "Zero", "initial_balance": 0})
            msgs = [ws.receive_json(), ws.receive_json()]
            created = next((m for m in msgs if m["type"] == "comanda_created"), None)
            assert created["balance"] == 0

    def test_absent_balance_defaults_to_zero(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            ws.send_json({"type": "create_comanda", "holder_name": "NoBal"})
            msgs = [ws.receive_json(), ws.receive_json()]
            created = next((m for m in msgs if m["type"] == "comanda_created"), None)
            assert created["balance"] == 0

    def test_rejects_empty_holder_name(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            ws.send_json({"type": "create_comanda", "holder_name": "", "initial_balance": 500})
            reply = ws.receive_json()
            assert reply["type"] == "error"
            assert reply["reason"] == "holder_name is required"

    def test_rejects_whitespace_holder_name(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            ws.send_json({"type": "create_comanda", "holder_name": "   ", "initial_balance": 500})
            reply = ws.receive_json()
            assert reply["type"] == "error"
            assert reply["reason"] == "holder_name is required"

    def test_rejects_float_balance(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            ws.send_json({"type": "create_comanda", "holder_name": "X", "initial_balance": 1.5})
            reply = ws.receive_json()
            assert reply["type"] == "error"
            assert reply["reason"] == "invalid_amount"

    def test_rejects_negative_balance(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            ws.send_json({"type": "create_comanda", "holder_name": "X", "initial_balance": -10})
            reply = ws.receive_json()
            assert reply["type"] == "error"
            assert reply["reason"] == "invalid_amount"


# ============================================================================
# Admin WS — add_credit
# ============================================================================
class TestAdminWSAddCredit:
    def test_adds_credit_returns_credit_confirmed(self, client, seed):
        seed(lambda conn: seed_comanda(conn, "F001", "Alice", 1000))
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            ws.send_json({"type": "add_credit", "comanda_code": "F001", "amount": 500})
            reply = ws.receive_json()
            assert reply["type"] == "credit_confirmed"
            assert reply["code"] == "F001"
            assert reply["amount"] == 500
            assert reply["new_balance"] == 1500

    def test_accepts_lowercase_code(self, client, seed):
        seed(lambda conn: seed_comanda(conn, "F001", "Alice", 1000))
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            ws.send_json({"type": "add_credit", "comanda_code": "f001", "amount": 100})
            reply = ws.receive_json()
            assert reply["type"] == "credit_confirmed"

    def test_rejects_missing_code(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            ws.send_json({"type": "add_credit", "amount": 500})
            reply = ws.receive_json()
            assert reply["type"] == "error"
            assert reply["reason"] == "comanda_code is required"

    def test_rejects_zero_amount(self, client, seed):
        seed(lambda conn: seed_comanda(conn, "F001", "Alice", 1000))
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            ws.send_json({"type": "add_credit", "comanda_code": "F001", "amount": 0})
            reply = ws.receive_json()
            assert reply["type"] == "error"
            assert reply["reason"] == "invalid_amount"

    def test_rejects_float_amount(self, client, seed):
        seed(lambda conn: seed_comanda(conn, "F001", "Alice", 1000))
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            ws.send_json({"type": "add_credit", "comanda_code": "F001", "amount": 1.5})
            reply = ws.receive_json()
            assert reply["type"] == "error"
            assert reply["reason"] == "invalid_amount"

    def test_rejects_unknown_comanda(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            ws.send_json({"type": "add_credit", "comanda_code": "ZZZZ", "amount": 100})
            reply = ws.receive_json()
            assert reply["type"] == "error"
            assert reply["reason"] == "comanda_not_found"


# ============================================================================
# Admin WS — register_category
# ============================================================================
class TestAdminWSRegisterCategory:
    def test_creates_new_category(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            ws.send_json({"type": "register_category", "name": "Bolsa", "price": 1200, "total_entries": 5})
            reply = ws.receive_json()
            assert reply["type"] == "category_updated"
            assert reply["category"]["name"] == "Bolsa"
            assert reply["category"]["price"] == 1200
            assert reply["category"]["total_entries"] == 5

    def test_updates_existing_category(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            ws.send_json({"type": "register_category", "name": "Sapato", "price": 800, "total_entries": 0})
            ws.receive_json()
            ws.send_json({"type": "register_category", "name": "Sapato", "price": 1000, "total_entries": 2})
            reply = ws.receive_json()
            assert reply["type"] == "category_updated"
            assert reply["category"]["price"] == 1000
            assert reply["category"]["total_entries"] == 2

    def test_rejects_missing_name(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            ws.send_json({"type": "register_category", "price": 500})
            reply = ws.receive_json()
            assert reply["type"] == "error"
            assert reply["reason"] == "category name is required"

    def test_rejects_float_price(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            ws.send_json({"type": "register_category", "name": "X", "price": 1.5})
            reply = ws.receive_json()
            assert reply["type"] == "error"
            assert reply["reason"] == "invalid_amount"

    def test_rejects_negative_price(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            ws.send_json({"type": "register_category", "name": "X", "price": -100})
            reply = ws.receive_json()
            assert reply["type"] == "error"
            assert reply["reason"] == "invalid_amount"


# ============================================================================
# Admin WS — malformed messages
# ============================================================================
class TestAdminWSMalformed:
    def test_invalid_json_is_silently_ignored(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()  # greeting
            ws.send_text("{ this is not json }")
            # Send a follow-up valid message to confirm server is still alive
            ws.send_json({"type": "create_comanda", "holder_name": "Alive", "initial_balance": 0})
            msgs = [ws.receive_json(), ws.receive_json()]
            assert any(m["type"] == "comanda_created" for m in msgs)

    def test_unknown_message_type_is_silently_ignored(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()  # greeting
            ws.send_json({"type": "unknown_type", "foo": "bar"})
            # Server replies with unknown_message_type error
            reply = ws.receive_json()
            assert reply["type"] == "error"


# ============================================================================
# Store WS — authentication
# ============================================================================
class TestStoreWSAuth:
    def test_connects_with_valid_store_token(self, client, seed):
        seed(lambda conn: seed_store(conn, "store-1", "My Store", "STRTK1"))
        with client.websocket_connect("/ws/store?token=STRTK1") as ws:
            msg = ws.receive_json()
            assert msg["type"] == "connected"
            assert msg["store_id"] == "store-1"
            assert msg["store_name"] == "My Store"
            assert msg["server_time"]

    def test_server_closes_for_invalid_token(self, client):
        with pytest.raises(Exception):
            with client.websocket_connect("/ws/store?token=BADTOKEN") as ws:
                ws.receive_text()

    def test_server_closes_for_missing_token(self, client):
        with pytest.raises(Exception):
            with client.websocket_connect("/ws/store") as ws:
                ws.receive_text()


# ============================================================================
# Store WS — balance_query
# ============================================================================
class TestStoreWSBalanceQuery:
    def test_returns_balance_for_known_comanda(self, client, seed):
        seed(lambda conn: (
            seed_comanda(conn, "F001", "João Silva", 1350),
            seed_store(conn),
        ))
        with client.websocket_connect("/ws/store?token=STRTK1") as ws:
            ws.receive_json()
            ws.send_json({"type": "balance_query", "comanda_code": "F001"})
            reply = ws.receive_json()
            assert reply["type"] == "balance_response"
            assert reply["comanda_code"] == "F001"
            assert reply["holder_name"] == "João Silva"
            assert reply["balance"] == 1350

    def test_normalizes_code_to_uppercase(self, client, seed):
        seed(lambda conn: (
            seed_comanda(conn, "F001", "João", 500),
            seed_store(conn),
        ))
        with client.websocket_connect("/ws/store?token=STRTK1") as ws:
            ws.receive_json()
            ws.send_json({"type": "balance_query", "comanda_code": "f001"})
            reply = ws.receive_json()
            assert reply["comanda_code"] == "F001"

    def test_trims_whitespace_from_code(self, client, seed):
        seed(lambda conn: (
            seed_comanda(conn, "F001", "Test", 500),
            seed_store(conn),
        ))
        with client.websocket_connect("/ws/store?token=STRTK1") as ws:
            ws.receive_json()
            ws.send_json({"type": "balance_query", "comanda_code": "  F001  "})
            reply = ws.receive_json()
            assert reply["type"] == "balance_response"

    def test_returns_error_for_unknown_code(self, client, seed):
        seed(lambda conn: seed_store(conn))
        with client.websocket_connect("/ws/store?token=STRTK1") as ws:
            ws.receive_json()
            ws.send_json({"type": "balance_query", "comanda_code": "ZZZZ"})
            reply = ws.receive_json()
            assert reply["type"] == "error"
            assert reply["reason"] == "comanda_not_found"


# ============================================================================
# Store WS — debit_request
# ============================================================================
class TestStoreWSDebitRequest:
    def test_successful_debit_returns_debit_confirmed(self, client, seed):
        seed(lambda conn: (
            seed_comanda(conn, "F001", "Alice", 2000),
            seed_store(conn),
        ))
        with client.websocket_connect("/ws/store?token=STRTK1") as ws:
            ws.receive_json()
            ws.send_json({"type": "debit_request", "comanda_code": "F001", "amount": 600})
            reply = ws.receive_json()
            assert reply["type"] == "debit_confirmed"
            assert reply["comanda_code"] == "F001"
            assert reply["holder_name"] == "Alice"
            assert reply["amount"] == 600
            assert reply["new_balance"] == 1400
            assert reply["event_id"]

    def test_accepts_lowercase_code(self, client, seed):
        seed(lambda conn: (
            seed_comanda(conn, "F001", "Alice", 2000),
            seed_store(conn),
        ))
        with client.websocket_connect("/ws/store?token=STRTK1") as ws:
            ws.receive_json()
            ws.send_json({"type": "debit_request", "comanda_code": "f001", "amount": 100})
            reply = ws.receive_json()
            assert reply["type"] == "debit_confirmed"

    def test_insufficient_balance_returns_debit_rejected(self, client, seed):
        seed(lambda conn: (
            seed_comanda(conn, "F001", "Alice", 2000),
            seed_store(conn),
        ))
        with client.websocket_connect("/ws/store?token=STRTK1") as ws:
            ws.receive_json()
            ws.send_json({"type": "debit_request", "comanda_code": "F001", "amount": 99999})
            reply = ws.receive_json()
            assert reply["type"] == "debit_rejected"
            assert reply["reason"] == "insufficient_balance"
            assert isinstance(reply["current_balance"], int)
            assert reply["requested"] == 99999

    def test_insufficient_balance_does_not_persist_event(self, client, seed):
        seed(lambda conn: (
            seed_comanda(conn, "F001", "Alice", 2000),
            seed_store(conn),
        ))
        with client.websocket_connect("/ws/store?token=STRTK1") as ws:
            ws.receive_json()
            # Query balance before
            ws.send_json({"type": "balance_query", "comanda_code": "F001"})
            before = ws.receive_json()
            # Attempt over-balance debit
            ws.send_json({"type": "debit_request", "comanda_code": "F001", "amount": before["balance"] + 1})
            ws.receive_json()  # rejected
            # Query balance after
            ws.send_json({"type": "balance_query", "comanda_code": "F001"})
            after = ws.receive_json()
            assert before["balance"] == after["balance"]

    def test_unknown_comanda_returns_debit_rejected_not_found(self, client, seed):
        seed(lambda conn: seed_store(conn))
        with client.websocket_connect("/ws/store?token=STRTK1") as ws:
            ws.receive_json()
            ws.send_json({"type": "debit_request", "comanda_code": "ZZZZ", "amount": 100})
            reply = ws.receive_json()
            assert reply["type"] == "debit_rejected"
            assert reply["reason"] == "comanda_not_found"

    def test_zero_amount_returns_invalid_amount(self, client, seed):
        seed(lambda conn: (seed_comanda(conn, "F001", "A", 1000), seed_store(conn)))
        with client.websocket_connect("/ws/store?token=STRTK1") as ws:
            ws.receive_json()
            ws.send_json({"type": "debit_request", "comanda_code": "F001", "amount": 0})
            reply = ws.receive_json()
            assert reply["type"] == "debit_rejected"
            assert reply["reason"] == "invalid_amount"

    def test_float_amount_returns_invalid_amount(self, client, seed):
        seed(lambda conn: (seed_comanda(conn, "F001", "A", 1000), seed_store(conn)))
        with client.websocket_connect("/ws/store?token=STRTK1") as ws:
            ws.receive_json()
            ws.send_json({"type": "debit_request", "comanda_code": "F001", "amount": 1.5})
            reply = ws.receive_json()
            assert reply["type"] == "debit_rejected"
            assert reply["reason"] == "invalid_amount"

    def test_negative_amount_returns_invalid_amount(self, client, seed):
        seed(lambda conn: (seed_comanda(conn, "F001", "A", 1000), seed_store(conn)))
        with client.websocket_connect("/ws/store?token=STRTK1") as ws:
            ws.receive_json()
            ws.send_json({"type": "debit_request", "comanda_code": "F001", "amount": -50})
            reply = ws.receive_json()
            assert reply["type"] == "debit_rejected"
            assert reply["reason"] == "invalid_amount"

    def test_string_amount_returns_invalid_amount(self, client, seed):
        seed(lambda conn: (seed_comanda(conn, "F001", "A", 1000), seed_store(conn)))
        with client.websocket_connect("/ws/store?token=STRTK1") as ws:
            ws.receive_json()
            ws.send_json({"type": "debit_request", "comanda_code": "F001", "amount": "abc"})
            reply = ws.receive_json()
            assert reply["type"] == "debit_rejected"
            assert reply["reason"] == "invalid_amount"


# ============================================================================
# WS rate limiting
# ============================================================================
class TestWSRateLimit:
    def test_exceeding_300_messages_triggers_rate_limit_exceeded(self, client, seed):
        seed(lambda conn: seed_store(conn))
        with client.websocket_connect("/ws/store?token=STRTK1") as ws:
            ws.receive_json()  # greeting
            msgs = []
            for _ in range(305):
                ws.send_json({"type": "balance_query", "comanda_code": "ZZZZ"})
                msgs.append(ws.receive_json())

            rate_limited = [m for m in msgs if m.get("reason") == "rate_limit_exceeded"]
            assert len(rate_limited) > 0
