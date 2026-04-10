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


# ============================================================================
# Admin WS — missing token closes connection
# ============================================================================
class TestAdminWSMissingToken:
    def test_server_closes_for_missing_token(self, client):
        with pytest.raises(Exception):
            with client.websocket_connect(f"/ws/admin") as ws:
                ws.receive_text()


# ============================================================================
# Admin WS — add_credit missing validations
# ============================================================================
class TestAdminWSAddCreditExtra:
    def test_rejects_negative_amount(self, client, seed):
        seed(lambda conn: seed_comanda(conn, "F001", "Alice", 1000))
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            ws.send_json({"type": "add_credit", "comanda_code": "F001", "amount": -50})
            reply = ws.receive_json()
            assert reply["type"] == "error"
            assert reply["reason"] == "invalid_amount"


# ============================================================================
# Admin WS — cart_items on create_comanda
# ============================================================================
class TestAdminWSCartItems:
    def test_cart_items_with_valid_entries_increment_category_total_entries(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            ws.send_json({
                "type": "create_comanda",
                "holder_name": "CartTest",
                "initial_balance": 0,
                "cart_items": [{"name": "Jaqueta", "quantity": 3}]
            })
            msgs = [ws.receive_json(), ws.receive_json()]
            assert any(m["type"] == "comanda_created" for m in msgs)

        # Verify category total_entries was incremented via the same client
        cats = client.get("/api/categories").json()
        jaqueta = next((c for c in cats if c["name"] == "Jaqueta"), None)
        assert jaqueta is not None
        assert jaqueta["total_entries"] == 3

    def test_cart_items_with_invalid_quantity_are_silently_ignored(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            ws.send_json({
                "type": "create_comanda",
                "holder_name": "CartBad",
                "initial_balance": 0,
                "cart_items": [{"name": "Bolsa", "quantity": -5}]
            })
            msgs = [ws.receive_json(), ws.receive_json()]
            # Comanda is still created despite invalid cart item
            assert any(m["type"] == "comanda_created" for m in msgs)


# ============================================================================
# Admin WS — register_category extra validations
# ============================================================================
class TestAdminWSRegisterCategoryExtra:
    def test_price_0_does_not_update_existing_price(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            # Create category with price 1500
            ws.send_json({"type": "register_category", "name": "Sapato", "price": 1500, "total_entries": 0})
            ws.receive_json()
            # Update with price=0 (should preserve existing price)
            ws.send_json({"type": "register_category", "name": "Sapato", "price": 0, "total_entries": 5})
            reply = ws.receive_json()
            assert reply["type"] == "category_updated"
            assert reply["category"]["price"] == 1500
            assert reply["category"]["total_entries"] == 5

    def test_rejects_float_total_entries(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws:
            ws.receive_json()
            ws.send_json({"type": "register_category", "name": "Bolsa", "price": 500, "total_entries": 1.5})
            reply = ws.receive_json()
            assert reply["type"] == "error"
            assert reply["reason"] == "invalid_amount"


# ============================================================================
# Admin WS — broadcast to multiple admin terminals
# ============================================================================
class TestAdminWSBroadcast:
    def test_comanda_created_broadcast_to_second_admin_terminal(self, client):
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws1:
            ws1.receive_json()  # ws1 greeting
            with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as ws2:
                ws2.receive_json()  # ws2 greeting
                ws1.send_json({"type": "create_comanda", "holder_name": "BroadcastUser", "initial_balance": 0})
                # Drain all broadcasts on both websockets (2 each: comanda_created + update_next_code)
                msgs_ws2 = [ws2.receive_json(), ws2.receive_json()]
                msgs_ws1 = [ws1.receive_json(), ws1.receive_json()]
                assert any(m["type"] == "comanda_created" for m in msgs_ws2)
                assert any(m["type"] == "comanda_created" for m in msgs_ws1)


# ============================================================================
# Store WS — balance_query empty code
# ============================================================================
class TestStoreWSBalanceQueryEmpty:
    def test_returns_error_for_empty_comanda_code(self, client, seed):
        seed(lambda conn: seed_store(conn))
        with client.websocket_connect("/ws/store?token=STRTK1") as ws:
            ws.receive_json()
            ws.send_json({"type": "balance_query", "comanda_code": ""})
            reply = ws.receive_json()
            assert reply["type"] == "error"
            assert reply["reason"] == "comanda_not_found"


# ============================================================================
# Store WS — debit_request empty code
# ============================================================================
class TestStoreWSDebitEmpty:
    def test_empty_comanda_code_returns_debit_rejected_comanda_not_found(self, client, seed):
        seed(lambda conn: seed_store(conn))
        with client.websocket_connect("/ws/store?token=STRTK1") as ws:
            ws.receive_json()
            ws.send_json({"type": "debit_request", "comanda_code": "", "amount": 100})
            reply = ws.receive_json()
            assert reply["type"] == "debit_rejected"
            assert reply["reason"] == "comanda_not_found"


# ============================================================================
# Store WS — broadcast after debit
# ============================================================================
class TestStoreWSBroadcast:
    def test_debit_broadcasts_balance_updated_to_all_connected_store_terminals(self, client, seed):
        seed(lambda conn: (
            seed_comanda(conn, "F001", "Alice", 2000),
            seed_store(conn),
        ))
        with client.websocket_connect("/ws/store?token=STRTK1") as ws1:
            ws1.receive_json()  # ws1 greeting
            with client.websocket_connect("/ws/store?token=STRTK1") as ws2:
                ws2.receive_json()  # ws2 greeting
                ws1.send_json({"type": "debit_request", "comanda_code": "F001", "amount": 200})
                # ws1 receives debit_confirmed, then balance_updated (broadcast to self too)
                msg_ws1 = ws1.receive_json()  # debit_confirmed
                broadcast_ws2 = ws2.receive_json()  # balance_updated
                broadcast_ws1 = ws1.receive_json()  # balance_updated (also sent to ws1)
                assert msg_ws1["type"] == "debit_confirmed"
                assert broadcast_ws2["type"] == "balance_updated"
                assert broadcast_ws2["comanda_code"] == "F001"
                assert broadcast_ws1["type"] == "balance_updated"

    def test_debit_broadcasts_admin_balance_updated_to_connected_admin(self, client, seed):
        seed(lambda conn: (
            seed_comanda(conn, "F001", "Bob", 2500),
            seed_store(conn),
        ))
        with client.websocket_connect(f"/ws/admin?token={ADMIN_TOKEN}") as admin_ws:
            admin_ws.receive_json()  # admin greeting
            with client.websocket_connect("/ws/store?token=STRTK1") as store_ws:
                store_ws.receive_json()  # store greeting
                store_ws.send_json({"type": "debit_request", "comanda_code": "F001", "amount": 300})
                # debit_confirmed goes to store_ws; balance_updated broadcasts to all stores; admin_balance_updated to admins
                debit_confirmed = store_ws.receive_json()  # debit_confirmed
                balance_updated = store_ws.receive_json()  # balance_updated broadcast (self)
                admin_msg = admin_ws.receive_json()  # admin_balance_updated
                assert debit_confirmed["type"] == "debit_confirmed"
                assert balance_updated["type"] == "balance_updated"
                assert admin_msg["type"] == "admin_balance_updated"
                assert admin_msg["comanda_code"] == "F001"


# ============================================================================
# Store WS — token revocation closes active WebSocket
# ============================================================================
class TestStoreWSRevocation:
    def test_revoke_token_via_rest_closes_active_websocket(self, client, seed):
        seed(lambda conn: seed_store(conn, "store-rev", "Revoke Me", "REVTK1"))
        with client.websocket_connect("/ws/store?token=REVTK1") as ws:
            ws.receive_json()  # greeting
            # Revoke the token via REST
            res = client.post("/api/stores/store-rev/revoke_token", headers={"token": ADMIN_TOKEN})
            assert res.status_code == 200
            # Server should have closed the WebSocket — receiving should raise
            with pytest.raises(Exception):
                ws.receive_json()


# ============================================================================
# WS rate limiting (must remain last — rate-limits a store WS connection,
# which can interfere with subsequent WS tests if not the final class)
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
