"""
REST API integration tests — mirrors backend-node/tests/rest.test.js

Uses a per-test temporary SQLite database via the `client` and `seed` fixtures
from conftest.py.
"""

import os
import pytest
from datetime import datetime, timezone

ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "admin_token_change_me")
WRONG_TOKEN = "wrong-token"


def ah():
    """Admin headers shorthand."""
    return {"token": ADMIN_TOKEN}


# ---------------------------------------------------------------------------
# Seed helpers — insert rows directly via sqlite
# ---------------------------------------------------------------------------
def seed_comanda(conn, code="F001", holder="Test User", balance=2000):
    cid = f"comanda-{code}"
    conn.execute(
        "INSERT INTO comandas (id, code, holder_name, created_at) VALUES (?,?,?,?)",
        (cid, code, holder, datetime.now(timezone.utc).isoformat()),
    )
    if balance > 0:
        conn.execute(
            "INSERT INTO events (id, type, comanda_id, amount, note, timestamp) VALUES (?,?,?,?,?,?)",
            (f"evt-{code}", "credit", cid, balance, "Saldo inicial", datetime.now(timezone.utc).isoformat()),
        )
    conn.commit()
    return cid


def seed_store(conn, store_id="store-1", name="Test Store", token="TESTST"):
    conn.execute(
        "INSERT INTO stores (id, name, theme, terminal_token) VALUES (?,?,?,?)",
        (store_id, name, "default", token),
    )
    conn.commit()
    return store_id


def seed_category(conn, name="Jaqueta", price=1500):
    cat_id = f"cat-{name.lower()}"
    conn.execute(
        "INSERT INTO categories (id, name, price) VALUES (?,?,?)",
        (cat_id, name, price),
    )
    conn.commit()
    return cat_id


# ============================================================================
# GET /
# ============================================================================
class TestRoot:
    def test_returns_200_with_status_online(self, client):
        res = client.get("/")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "online"
        assert body["mode"] == "local-first"
        assert isinstance(body["event"], str)


# ============================================================================
# GET /api/reports/economy_state
# ============================================================================
class TestEconomyState:
    def test_returns_401_without_token(self, client):
        res = client.get("/api/reports/economy_state")
        assert res.status_code == 401

    def test_returns_401_with_wrong_token(self, client):
        res = client.get("/api/reports/economy_state", headers={"token": WRONG_TOKEN})
        assert res.status_code == 401

    def test_returns_200_with_valid_token(self, client, seed):
        seed(lambda conn: (seed_comanda(conn, "F001", "Alice", 1500), seed_store(conn)))
        res = client.get("/api/reports/economy_state", headers=ah())
        assert res.status_code == 200
        body = res.json()
        assert "total_issued" in body
        assert "total_circulating" in body
        assert "comandas_active" in body
        assert "stores_registered" in body

    def test_reflects_seeded_data(self, client, seed):
        seed(lambda conn: (seed_comanda(conn, "F001", "Alice", 1500), seed_store(conn)))
        body = client.get("/api/reports/economy_state", headers=ah()).json()
        assert body["comandas_active"] == 1
        assert body["stores_registered"] == 1
        assert body["total_issued"] == 1500

    def test_accepts_token_via_query_param(self, client):
        res = client.get(f"/api/reports/economy_state?token={ADMIN_TOKEN}")
        assert res.status_code == 200


# ============================================================================
# GET /api/reports/analytics
# ============================================================================
class TestAnalytics:
    def test_returns_200_without_authentication(self, client):
        res = client.get("/api/reports/analytics")
        assert res.status_code == 200

    def test_response_has_expected_shape(self, client):
        body = client.get("/api/reports/analytics").json()
        assert "kpis" in body
        assert "transactions_per_minute" in body
        assert "top_stores" in body
        assert "category_distribution" in body
        k = body["kpis"]
        for field in ("total_comandas", "total_emitido", "total_gasto",
                      "total_circulante", "total_transacoes", "lojas_ativas"):
            assert field in k

    def test_kpis_reflect_seeded_data(self, client, seed):
        seed(lambda conn: (
            seed_comanda(conn, "F001", "Alice", 2000),
            seed_store(conn),
            seed_category(conn),
        ))
        body = client.get("/api/reports/analytics").json()
        assert body["kpis"]["total_comandas"] == 1
        assert body["kpis"]["lojas_ativas"] == 1
        assert body["kpis"]["total_emitido"] == 2000


# ============================================================================
# GET /api/comanda/:code
# ============================================================================
class TestGetComanda:
    def test_returns_401_without_token(self, client, seed):
        seed(lambda conn: seed_comanda(conn, "F001", "Test User", 3000))
        res = client.get("/api/comanda/F001")
        assert res.status_code == 401

    def test_returns_404_for_unknown_code(self, client):
        res = client.get("/api/comanda/ZZZZ", headers=ah())
        assert res.status_code == 404
        assert "detail" in res.json()

    def test_returns_200_with_correct_shape(self, client, seed):
        seed(lambda conn: seed_comanda(conn, "F001", "Test User", 3000))
        res = client.get("/api/comanda/F001", headers=ah())
        assert res.status_code == 200
        body = res.json()
        assert body["id"]
        assert body["code"] == "F001"
        assert body["holder_name"] == "Test User"
        assert body["balance"] == 3000
        assert body["created_at"]

    def test_normalizes_code_to_uppercase(self, client, seed):
        seed(lambda conn: seed_comanda(conn, "F001", "Test User", 0))
        res = client.get("/api/comanda/f001", headers=ah())
        assert res.status_code == 200
        assert res.json()["code"] == "F001"


# ============================================================================
# GET /api/stores
# ============================================================================
class TestGetStores:
    def test_returns_401_without_token(self, client):
        assert client.get("/api/stores").status_code == 401

    def test_returns_array_of_stores(self, client, seed):
        seed(lambda conn: (
            seed_store(conn, "store-a", "Store A", "TOKENA1"),
            seed_store(conn, "store-b", "Store B", "TOKENB1"),
        ))
        body = client.get("/api/stores", headers=ah()).json()
        assert isinstance(body, list)
        assert len(body) == 2

    def test_each_store_has_required_fields(self, client, seed):
        seed(lambda conn: (
            seed_store(conn, "store-a", "Store A", "TOKENA1"),
            seed_store(conn, "store-b", "Store B", "TOKENB1"),
        ))
        body = client.get("/api/stores", headers=ah()).json()
        for s in body:
            assert s["id"]
            assert s["name"]
            assert s["terminal_token"]


# ============================================================================
# POST /api/stores
# ============================================================================
class TestCreateStore:
    def test_returns_401_without_token(self, client):
        assert client.post("/api/stores", json={"name": "Loja X"}).status_code == 401

    def test_returns_400_when_name_missing(self, client):
        res = client.post("/api/stores", json={}, headers=ah())
        assert res.status_code == 400
        assert res.json()["detail"] == "name is required"

    def test_returns_400_when_name_is_whitespace(self, client):
        res = client.post("/api/stores", json={"name": "   "}, headers=ah())
        assert res.status_code == 400

    def test_returns_201_with_correct_shape(self, client):
        res = client.post("/api/stores", json={"name": "Cantina"}, headers=ah())
        assert res.status_code == 201
        body = res.json()
        assert body["id"]
        assert body["name"] == "Cantina"
        assert isinstance(body["terminal_token"], str)
        assert len(body["terminal_token"]) == 6

    def test_generated_token_is_unambiguous_alphanumeric(self, client):
        import re
        res = client.post("/api/stores", json={"name": "Loja Token Test"}, headers=ah())
        token = res.json()["terminal_token"]
        assert re.match(r"^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$", token)

    def test_trims_whitespace_from_name(self, client):
        res = client.post("/api/stores", json={"name": "  Padaria  "}, headers=ah())
        assert res.status_code == 201
        assert res.json()["name"] == "Padaria"


# ============================================================================
# PUT /api/stores/:storeId
# ============================================================================
class TestUpdateStore:
    def test_returns_401_without_token(self, client, seed):
        seed(lambda conn: seed_store(conn, "store-edit", "Old Name", "EDITTK"))
        assert client.put("/api/stores/store-edit", json={"name": "New"}).status_code == 401

    def test_returns_400_when_name_missing(self, client, seed):
        seed(lambda conn: seed_store(conn, "store-edit", "Old Name", "EDITTK"))
        assert client.put("/api/stores/store-edit", json={}, headers=ah()).status_code == 400

    def test_returns_404_for_unknown_store(self, client):
        res = client.put("/api/stores/nonexistent", json={"name": "X"}, headers=ah())
        assert res.status_code == 404
        assert res.json()["detail"] == "Store not found"

    def test_returns_200_and_updates_name(self, client, seed):
        seed(lambda conn: seed_store(conn, "store-edit", "Old Name", "EDITTK"))
        res = client.put("/api/stores/store-edit", json={"name": "New Name"}, headers=ah())
        assert res.status_code == 200
        assert res.json()["name"] == "New Name"

    def test_persisted_in_get_stores(self, client, seed):
        seed(lambda conn: seed_store(conn, "store-edit", "Old Name", "EDITTK"))
        client.put("/api/stores/store-edit", json={"name": "Updated Store"}, headers=ah())
        stores = client.get("/api/stores", headers=ah()).json()
        assert any(s["name"] == "Updated Store" for s in stores)


# ============================================================================
# POST /api/stores/:storeId/revoke_token
# ============================================================================
class TestRevokeToken:
    def test_returns_401_without_token(self, client, seed):
        seed(lambda conn: seed_store(conn, "store-rev", "Revoke Store", "REVOKE"))
        assert client.post("/api/stores/store-rev/revoke_token").status_code == 401

    def test_returns_404_for_unknown_store(self, client):
        assert client.post("/api/stores/nonexistent/revoke_token", headers=ah()).status_code == 404

    def test_returns_200_with_new_token(self, client, seed):
        seed(lambda conn: seed_store(conn, "store-rev", "Revoke Store", "REVOKE"))
        res = client.post("/api/stores/store-rev/revoke_token", headers=ah())
        assert res.status_code == 200
        body = res.json()
        assert body["id"] == "store-rev"
        assert isinstance(body["new_token"], str)
        assert len(body["new_token"]) == 6

    def test_new_token_differs_from_old(self, client, seed):
        seed(lambda conn: seed_store(conn, "store-rev", "Revoke Store", "REVOKE"))
        body = client.post("/api/stores/store-rev/revoke_token", headers=ah()).json()
        assert body["new_token"] != "REVOKE"


# ============================================================================
# GET /api/categories
# ============================================================================
class TestGetCategories:
    def test_returns_200_without_authentication(self, client, seed):
        seed(lambda conn: (seed_category(conn, "Jaqueta", 1500), seed_category(conn, "Bolsa", 1200)))
        assert client.get("/api/categories").status_code == 200

    def test_returns_array_of_categories(self, client, seed):
        seed(lambda conn: (seed_category(conn, "Jaqueta", 1500), seed_category(conn, "Bolsa", 1200)))
        body = client.get("/api/categories").json()
        assert isinstance(body, list)
        assert len(body) == 2

    def test_each_category_has_required_fields(self, client, seed):
        seed(lambda conn: (seed_category(conn, "Jaqueta", 1500), seed_category(conn, "Bolsa", 1200)))
        body = client.get("/api/categories").json()
        for c in body:
            assert c["id"]
            assert c["name"]
            assert isinstance(c["price"], int)
            assert isinstance(c["total_entries"], int)
            assert isinstance(c["total_exits"], int)


# ============================================================================
# POST /api/categories
# ============================================================================
class TestCreateCategory:
    def test_returns_401_without_token(self, client):
        assert client.post("/api/categories", json={"name": "Bolsa", "price": 1200}).status_code == 401

    def test_returns_400_when_name_missing(self, client):
        res = client.post("/api/categories", json={"price": 1200}, headers=ah())
        assert res.status_code == 400
        assert res.json()["detail"] == "name is required"

    def test_returns_400_when_price_is_zero(self, client):
        res = client.post("/api/categories", json={"name": "Nova", "price": 0}, headers=ah())
        assert res.status_code == 400
        assert res.json()["detail"] == "price must be a positive integer"

    def test_returns_400_when_price_is_negative(self, client):
        assert client.post("/api/categories", json={"name": "Nova", "price": -100}, headers=ah()).status_code == 400

    def test_returns_400_for_duplicate_name_exact(self, client, seed):
        seed(lambda conn: seed_category(conn, "Jaqueta", 1500))
        res = client.post("/api/categories", json={"name": "Jaqueta", "price": 1500}, headers=ah())
        assert res.status_code == 400
        assert res.json()["detail"] == "Categoria já existe"

    def test_returns_400_for_duplicate_name_case_insensitive(self, client, seed):
        seed(lambda conn: seed_category(conn, "Jaqueta", 1500))
        res = client.post("/api/categories", json={"name": "jaqueta", "price": 1500}, headers=ah())
        assert res.status_code == 400

    def test_returns_201_with_correct_shape(self, client):
        res = client.post("/api/categories", json={"name": "Calça", "price": 900}, headers=ah())
        assert res.status_code == 201
        body = res.json()
        assert body["id"]
        assert body["name"] == "Calça"
        assert body["price"] == 900

    def test_trims_name_whitespace_before_saving(self, client):
        res = client.post("/api/categories", json={"name": "  Tênis  ", "price": 2000}, headers=ah())
        assert res.status_code == 201
        assert res.json()["name"] == "Tênis"

    def test_returns_400_when_name_is_whitespace_only(self, client):
        res = client.post("/api/categories", json={"name": "   ", "price": 1000}, headers=ah())
        assert res.status_code == 400


# ============================================================================
# Body size limit
# ============================================================================
class TestBodySizeLimit:
    def test_returns_413_for_body_larger_than_10kb(self, client):
        big_name = "X" * (11 * 1024)
        import json
        big_body = json.dumps({"name": big_name})
        res = client.post(
            "/api/stores",
            content=big_body,
            headers={"Content-Type": "application/json", "token": ADMIN_TOKEN,
                     "Content-Length": str(len(big_body.encode()))},
        )
        assert res.status_code == 413


# ============================================================================
# Distribution seed helpers
# ============================================================================
def seed_distribution(conn, dist_id="dist-1", name="Rodada 1", num_boxes=2, status="planning"):
    from datetime import datetime, timezone
    conn.execute(
        "INSERT INTO distributions (id, name, num_boxes, status, needs_recalc, created_at) VALUES (?,?,?,?,?,?)",
        (dist_id, name, num_boxes, status, 0, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    return dist_id


def seed_box(conn, box_id, distribution_id, box_number, store_id, status="pending", responsible_name=None):
    conn.execute(
        "INSERT INTO boxes (id, distribution_id, box_number, assigned_store_id, status, responsible_name) VALUES (?,?,?,?,?,?)",
        (box_id, distribution_id, box_number, store_id, status, responsible_name),
    )
    conn.commit()
    return box_id


def seed_category_with_entries(conn, cat_id, name, price, entries):
    conn.execute(
        "INSERT INTO categories (id, name, price, total_entries) VALUES (?,?,?,?)",
        (cat_id, name, price, entries),
    )
    conn.commit()
    return cat_id


# ============================================================================
# GET /api/distribution
# ============================================================================
class TestGetDistribution:
    def test_returns_401_without_token(self, client):
        assert client.get("/api/distribution").status_code == 401

    def test_returns_empty_array_when_no_distributions_exist(self, client):
        res = client.get("/api/distribution", headers=ah())
        assert res.status_code == 200
        assert res.json() == []

    def test_returns_all_distributions(self, client, seed):
        seed(lambda conn: (
            seed_distribution(conn, "dist-1", "Rodada 1", 2, "planning"),
            seed_distribution(conn, "dist-2", "Rodada 2", 3, "active"),
        ))
        body = client.get("/api/distribution", headers=ah()).json()
        assert len(body) == 2

    def test_each_distribution_has_required_fields(self, client, seed):
        seed(lambda conn: seed_distribution(conn, "dist-1", "Rodada 1", 2, "planning"))
        body = client.get("/api/distribution", headers=ah()).json()
        for d in body:
            assert d["id"]
            assert d["name"]
            assert isinstance(d["num_boxes"], int)
            assert d["status"]
            assert d["created_at"]


# ============================================================================
# POST /api/distribution
# ============================================================================
class TestCreateDistribution:
    def test_returns_401_without_token(self, client):
        assert client.post("/api/distribution", json={"name": "Rodada 1", "num_boxes": 2}).status_code == 401

    def test_returns_400_when_name_is_missing(self, client):
        res = client.post("/api/distribution", json={"num_boxes": 2}, headers=ah())
        assert res.status_code == 400
        assert res.json()["detail"] == "name and num_boxes are required"

    def test_returns_400_when_num_boxes_is_missing(self, client):
        res = client.post("/api/distribution", json={"name": "Rodada 1"}, headers=ah())
        assert res.status_code == 400
        assert res.json()["detail"] == "name and num_boxes are required"

    def test_returns_400_when_num_boxes_is_0(self, client):
        res = client.post("/api/distribution", json={"name": "Rodada 1", "num_boxes": 0}, headers=ah())
        assert res.status_code == 400
        assert res.json()["detail"] == "name and num_boxes are required"

    def test_returns_400_when_num_boxes_is_negative(self, client):
        res = client.post("/api/distribution", json={"name": "Rodada 1", "num_boxes": -1}, headers=ah())
        assert res.status_code == 400
        assert res.json()["detail"] == "num_boxes must be a positive integer"

    def test_returns_400_when_num_boxes_is_a_float(self, client):
        res = client.post("/api/distribution", json={"name": "Rodada 1", "num_boxes": 1.5}, headers=ah())
        assert res.status_code == 400
        assert res.json()["detail"] == "num_boxes must be a positive integer"

    def test_returns_201_with_correct_shape_on_success(self, client):
        res = client.post("/api/distribution", json={"name": "Rodada 1", "num_boxes": 2}, headers=ah())
        assert res.status_code == 201
        body = res.json()
        assert body["id"]
        assert body["name"] == "Rodada 1"
        assert body["num_boxes"] == 2
        assert body["status"] == "planning"

    def test_created_distribution_appears_in_list(self, client):
        client.post("/api/distribution", json={"name": "Nova Rodada", "num_boxes": 3}, headers=ah())
        body = client.get("/api/distribution", headers=ah()).json()
        assert any(d["name"] == "Nova Rodada" for d in body)


# ============================================================================
# GET /api/distribution/suggest
# ============================================================================
class TestGetDistributionSuggest:
    def test_returns_401_without_token(self, client):
        assert client.get("/api/distribution/suggest").status_code == 401

    def test_returns_200_with_required_fields(self, client, seed):
        seed(lambda conn: (
            seed_category_with_entries(conn, "cat-1", "Jaqueta", 1500, 10),
            seed_store(conn, "store-1", "Loja 1", "STRTK1"),
        ))
        res = client.get("/api/distribution/suggest", headers=ah())
        assert res.status_code == 200
        body = res.json()
        assert isinstance(body["suggested"], int)
        assert isinstance(body["reasoning"], str)


# ============================================================================
# GET /api/distribution/:id
# ============================================================================
class TestGetDistributionById:
    def test_returns_401_without_token(self, client, seed):
        seed(lambda conn: seed_distribution(conn, "dist-1"))
        assert client.get("/api/distribution/dist-1").status_code == 401

    def test_returns_404_for_unknown_distribution(self, client):
        res = client.get("/api/distribution/nonexistent", headers=ah())
        assert res.status_code == 404
        assert res.json()["detail"] == "Distribution not found"

    def test_returns_200_with_distribution_and_boxes(self, client, seed):
        seed(lambda conn: seed_distribution(conn, "dist-detail", "Detalhe", 2, "planning"))
        res = client.get("/api/distribution/dist-detail", headers=ah())
        assert res.status_code == 200
        body = res.json()
        assert body["distribution"]["id"] == "dist-detail"
        assert isinstance(body["boxes"], list)


# ============================================================================
# POST /api/distribution/:id/calculate
# ============================================================================
class TestCalculateDistribution:
    def test_returns_401_without_token(self, client, seed):
        seed(lambda conn: seed_distribution(conn, "dist-1"))
        assert client.post("/api/distribution/dist-1/calculate").status_code == 401

    def test_returns_404_for_unknown_distribution(self, client):
        res = client.post("/api/distribution/nonexistent/calculate", headers=ah())
        assert res.status_code == 404

    def test_returns_400_when_no_stores_registered(self, client, seed):
        seed(lambda conn: (
            seed_category_with_entries(conn, "cat-1", "Jaqueta", 1500, 10),
            seed_distribution(conn, "dist-no-stores", "Sem Lojas", 2, "planning"),
        ))
        res = client.post("/api/distribution/dist-no-stores/calculate", headers=ah())
        assert res.status_code == 400
        assert res.json()["detail"]

    def test_returns_200_with_message_and_warnings_on_success(self, client, seed):
        seed(lambda conn: (
            seed_store(conn, "store-1", "Loja 1", "STRTK1"),
            seed_category_with_entries(conn, "cat-1", "Jaqueta", 1500, 10),
            seed_distribution(conn, "dist-calc", "Para Calcular", 2, "planning"),
        ))
        res = client.post("/api/distribution/dist-calc/calculate", headers=ah())
        assert res.status_code == 200
        body = res.json()
        assert isinstance(body["message"], str)
        assert isinstance(body["warnings"], list)

    def test_boxes_are_created_after_calculate(self, client, seed):
        seed(lambda conn: (
            seed_store(conn, "store-1", "Loja 1", "STRTK1"),
            seed_category_with_entries(conn, "cat-1", "Jaqueta", 1500, 10),
            seed_distribution(conn, "dist-calc2", "Para Calcular 2", 2, "planning"),
        ))
        client.post("/api/distribution/dist-calc2/calculate", headers=ah())
        detail = client.get("/api/distribution/dist-calc2", headers=ah()).json()
        assert len(detail["boxes"]) == 2


# ============================================================================
# DELETE /api/distribution/:id
# ============================================================================
class TestDeleteDistribution:
    def test_returns_401_without_token(self, client, seed):
        seed(lambda conn: seed_distribution(conn, "dist-del"))
        assert client.delete("/api/distribution/dist-del").status_code == 401

    def test_returns_404_for_unknown_distribution(self, client):
        assert client.delete("/api/distribution/nonexistent", headers=ah()).status_code == 404

    def test_returns_200_and_distribution_is_gone(self, client, seed):
        seed(lambda conn: seed_distribution(conn, "dist-del", "Para Excluir", 2, "planning"))
        res = client.delete("/api/distribution/dist-del", headers=ah())
        assert res.status_code == 200
        assert res.json()["message"]
        assert client.get("/api/distribution/dist-del", headers=ah()).status_code == 404

    def test_returns_409_when_active_with_in_progress_boxes(self, client, seed):
        seed(lambda conn: (
            seed_store(conn, "store-1", "Loja 1", "STRTK1"),
            seed_distribution(conn, "dist-active", "Rodada Ativa", 1, "active"),
            seed_box(conn, "box-ip", "dist-active", 1, "store-1", "in_progress", "João"),
        ))
        res = client.delete("/api/distribution/dist-active", headers=ah())
        assert res.status_code == 409
        assert res.json()["detail"]


# ============================================================================
# PUT /api/distribution/:id/activate
# ============================================================================
class TestActivateDistribution:
    def test_returns_401_without_token(self, client, seed):
        seed(lambda conn: seed_distribution(conn, "dist-act"))
        assert client.put("/api/distribution/dist-act/activate").status_code == 401

    def test_returns_404_for_unknown_distribution(self, client):
        assert client.put("/api/distribution/nonexistent/activate", headers=ah()).status_code == 404

    def test_returns_200_with_status_active(self, client, seed):
        seed(lambda conn: seed_distribution(conn, "dist-act", "Para Ativar", 2, "planning"))
        res = client.put("/api/distribution/dist-act/activate", headers=ah())
        assert res.status_code == 200
        assert res.json()["status"] == "active"

    def test_archives_previous_active_distribution(self, client, seed):
        seed(lambda conn: (
            seed_distribution(conn, "dist-old", "Anterior", 2, "active"),
            seed_distribution(conn, "dist-new", "Nova", 2, "planning"),
        ))
        client.put("/api/distribution/dist-new/activate", headers=ah())
        distributions = client.get("/api/distribution", headers=ah()).json()
        old = next((d for d in distributions if d["id"] == "dist-old"), None)
        assert old["status"] == "complete"


# ============================================================================
# GET /api/packing/active
# ============================================================================
class TestGetPackingActive:
    def test_returns_401_without_token(self, client):
        assert client.get("/api/packing/active").status_code == 401

    def test_returns_404_when_no_active_distribution(self, client):
        assert client.get("/api/packing/active", headers=ah()).status_code == 404

    def test_returns_200_with_distribution_boxes_and_stats(self, client, seed):
        seed(lambda conn: (
            seed_store(conn, "store-1", "Loja 1", "STRTK1"),
            seed_distribution(conn, "dist-active", "Rodada Ativa", 1, "active"),
            seed_box(conn, "box-1", "dist-active", 1, "store-1", "pending"),
        ))
        res = client.get("/api/packing/active", headers=ah())
        assert res.status_code == 200
        body = res.json()
        assert body["distribution"]["status"] == "active"
        assert isinstance(body["boxes"], list)
        assert isinstance(body["stats"]["total_boxes"], int)
        assert isinstance(body["stats"]["pending"], int)
        assert isinstance(body["stats"]["in_progress"], int)
        assert isinstance(body["stats"]["done"], int)


# ============================================================================
# POST /api/packing/boxes/:boxId/claim
# ============================================================================
class TestClaimBox:
    def test_returns_401_without_token(self, client, seed):
        seed(lambda conn: (
            seed_store(conn, "store-1", "Loja 1", "STRTK1"),
            seed_distribution(conn, "dist-1", "Rodada 1", 1, "active"),
            seed_box(conn, "box-claim", "dist-1", 1, "store-1", "pending"),
        ))
        assert client.post("/api/packing/boxes/box-claim/claim",
                           json={"responsible_name": "João"}).status_code == 401

    def test_returns_400_when_responsible_name_is_missing(self, client, seed):
        seed(lambda conn: (
            seed_store(conn, "store-1", "Loja 1", "STRTK1"),
            seed_distribution(conn, "dist-1", "Rodada 1", 1, "active"),
            seed_box(conn, "box-claim", "dist-1", 1, "store-1", "pending"),
        ))
        res = client.post("/api/packing/boxes/box-claim/claim", json={}, headers=ah())
        assert res.status_code == 400

    def test_returns_409_when_box_not_found(self, client):
        res = client.post("/api/packing/boxes/nonexistent-box/claim",
                          json={"responsible_name": "João"}, headers=ah())
        assert res.status_code == 409

    def test_returns_200_on_successful_claim(self, client, seed):
        seed(lambda conn: (
            seed_store(conn, "store-1", "Loja 1", "STRTK1"),
            seed_distribution(conn, "dist-1", "Rodada 1", 1, "active"),
            seed_box(conn, "box-claim", "dist-1", 1, "store-1", "pending"),
        ))
        res = client.post("/api/packing/boxes/box-claim/claim",
                          json={"responsible_name": "Maria"}, headers=ah())
        assert res.status_code == 200
        assert res.json()["message"]

    def test_returns_409_when_box_already_claimed(self, client, seed):
        seed(lambda conn: (
            seed_store(conn, "store-1", "Loja 1", "STRTK1"),
            seed_distribution(conn, "dist-1", "Rodada 1", 1, "active"),
            seed_box(conn, "box-claim", "dist-1", 1, "store-1", "pending"),
        ))
        client.post("/api/packing/boxes/box-claim/claim",
                    json={"responsible_name": "Maria"}, headers=ah())
        res = client.post("/api/packing/boxes/box-claim/claim",
                          json={"responsible_name": "João"}, headers=ah())
        assert res.status_code == 409


# ============================================================================
# POST /api/packing/boxes/:boxId/complete
# ============================================================================
class TestCompleteBox:
    def test_returns_401_without_token(self, client, seed):
        seed(lambda conn: (
            seed_store(conn, "store-1", "Loja 1", "STRTK1"),
            seed_distribution(conn, "dist-1", "Rodada 1", 1, "active"),
            seed_box(conn, "box-complete", "dist-1", 1, "store-1", "in_progress", "João"),
        ))
        assert client.post("/api/packing/boxes/box-complete/complete").status_code == 401

    def test_returns_400_when_box_not_found(self, client):
        res = client.post("/api/packing/boxes/nonexistent/complete", headers=ah())
        assert res.status_code == 400

    def test_returns_200_with_recalc_triggered_on_success(self, client, seed):
        seed(lambda conn: (
            seed_store(conn, "store-1", "Loja 1", "STRTK1"),
            seed_distribution(conn, "dist-1", "Rodada 1", 1, "active"),
            seed_box(conn, "box-complete", "dist-1", 1, "store-1", "in_progress", "João"),
        ))
        res = client.post("/api/packing/boxes/box-complete/complete", headers=ah())
        assert res.status_code == 200
        body = res.json()
        assert body["message"]
        assert isinstance(body["recalc_triggered"], bool)


# ============================================================================
# POST /api/packing/boxes/:boxId/cancel
# ============================================================================
class TestCancelBox:
    def test_returns_401_without_token(self, client, seed):
        seed(lambda conn: (
            seed_store(conn, "store-1", "Loja 1", "STRTK1"),
            seed_distribution(conn, "dist-1", "Rodada 1", 1, "active"),
            seed_box(conn, "box-cancel", "dist-1", 1, "store-1", "in_progress", "João"),
        ))
        assert client.post("/api/packing/boxes/box-cancel/cancel").status_code == 401

    def test_returns_400_when_box_not_found(self, client):
        res = client.post("/api/packing/boxes/nonexistent/cancel", headers=ah())
        assert res.status_code == 400

    def test_returns_200_with_recalc_triggered_on_success(self, client, seed):
        seed(lambda conn: (
            seed_store(conn, "store-1", "Loja 1", "STRTK1"),
            seed_distribution(conn, "dist-1", "Rodada 1", 1, "active"),
            seed_box(conn, "box-cancel", "dist-1", 1, "store-1", "in_progress", "João"),
        ))
        res = client.post("/api/packing/boxes/box-cancel/cancel", headers=ah())
        assert res.status_code == 200
        body = res.json()
        assert body["message"]
        assert isinstance(body["recalc_triggered"], bool)

