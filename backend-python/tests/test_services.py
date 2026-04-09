"""Unit tests for service modules — mirrors backend-node/tests/services.test.js"""

import pytest
from datetime import datetime

from tests.helpers.db import create_test_db
from app.services.comanda_service import (
    get_next_code, create_comanda, get_comanda_by_code, get_balance,
)
from app.services.transaction_service import (
    process_credit, process_debit, InsufficientBalanceError, InvalidAmountError,
)
from app.services.product_service import create_or_update_category
from app.services.distribution_service import distribute_items, suggest_box_count


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------
def seed_comanda(conn, code="F001", holder="Test User", balance=2000):
    cid = f"cid-{code}"
    conn.execute(
        "INSERT INTO comandas (id, code, holder_name, created_at) VALUES (?,?,?,?)",
        (cid, code, holder, datetime.utcnow().isoformat()),
    )
    if balance > 0:
        conn.execute(
            "INSERT INTO events (id, type, comanda_id, amount, note, timestamp) VALUES (?,?,?,?,?,?)",
            (f"eid-{code}", "credit", cid, balance, "Saldo inicial", datetime.utcnow().isoformat()),
        )
    conn.commit()
    return cid


def seed_store(conn, store_id="store-1", name="Loja 1", token="TKTST1"):
    conn.execute(
        "INSERT INTO stores (id, name, theme, terminal_token) VALUES (?,?,?,?)",
        (store_id, name, "default", token),
    )
    conn.commit()
    return store_id


# ============================================================================
# get_next_code
# ============================================================================
class TestGetNextCode:
    def test_returns_f001_on_empty_db(self):
        conn = create_test_db()
        assert get_next_code(conn) == "F001"

    def test_increments_after_one_comanda(self):
        conn = create_test_db()
        seed_comanda(conn, "F001")
        assert get_next_code(conn) == "F002"

    def test_increments_to_f010(self):
        conn = create_test_db()
        for i in range(1, 10):
            seed_comanda(conn, f"F00{i}")
        assert get_next_code(conn) == "F010"


# ============================================================================
# create_comanda
# ============================================================================
class TestCreateComanda:
    def test_creates_comanda_with_positive_balance(self):
        conn = create_test_db()
        comanda, event_id = create_comanda(conn, "Alice", 1500)
        assert comanda.holder_name == "Alice"
        assert comanda.code == "F001"
        balance = get_balance(conn, comanda.id)
        assert balance == 1500

    def test_creates_comanda_with_zero_balance(self):
        conn = create_test_db()
        comanda, event_id = create_comanda(conn, "Bob", 0)
        assert comanda.holder_name == "Bob"
        balance = get_balance(conn, comanda.id)
        assert balance == 0
        # event_id is always a UUID string (matching Node.js behavior), even when no event is inserted
        assert isinstance(event_id, str)

    def test_code_increments_sequentially(self):
        conn = create_test_db()
        c1, _ = create_comanda(conn, "C1", 0)
        c2, _ = create_comanda(conn, "C2", 0)
        assert c1.code == "F001"
        assert c2.code == "F002"


# ============================================================================
# get_comanda_by_code
# ============================================================================
class TestGetComandaByCode:
    def test_finds_existing_comanda(self):
        conn = create_test_db()
        seed_comanda(conn, "F001", "Maria")
        comanda = get_comanda_by_code(conn, "F001")
        assert comanda is not None
        assert comanda.holder_name == "Maria"

    def test_returns_none_for_unknown_code(self):
        conn = create_test_db()
        assert get_comanda_by_code(conn, "ZZZZ") is None


# ============================================================================
# get_balance
# ============================================================================
class TestGetBalance:
    def test_returns_correct_balance(self):
        conn = create_test_db()
        cid = seed_comanda(conn, "F001", balance=3000)
        assert get_balance(conn, cid) == 3000

    def test_returns_zero_for_no_events(self):
        conn = create_test_db()
        cid = seed_comanda(conn, "F001", balance=0)
        assert get_balance(conn, cid) == 0


# ============================================================================
# process_credit
# ============================================================================
class TestProcessCredit:
    def test_increases_balance(self):
        conn = create_test_db()
        cid = seed_comanda(conn, "F001", balance=1000)
        process_credit(conn, cid, 500)
        conn.commit()
        assert get_balance(conn, cid) == 1500

    def test_creates_credit_event(self):
        conn = create_test_db()
        cid = seed_comanda(conn, "F001", balance=0)
        process_credit(conn, cid, 200)
        conn.commit()
        row = conn.execute(
            "SELECT COUNT(*) as c FROM events WHERE comanda_id = ? AND type = 'credit'", (cid,)
        ).fetchone()
        assert row["c"] == 1


# ============================================================================
# process_debit
# ============================================================================
class TestProcessDebit:
    def test_deducts_balance(self):
        conn = create_test_db()
        cid = seed_comanda(conn, "F001", balance=2000)
        sid = seed_store(conn)
        process_debit(conn, cid, 600, sid)
        conn.commit()
        assert get_balance(conn, cid) == 1400

    def test_raises_insufficient_balance(self):
        conn = create_test_db()
        cid = seed_comanda(conn, "F001", balance=100)
        sid = seed_store(conn)
        with pytest.raises(InsufficientBalanceError):
            process_debit(conn, cid, 500, sid)

    def test_raises_invalid_amount_for_zero(self):
        conn = create_test_db()
        cid = seed_comanda(conn, "F001", balance=1000)
        sid = seed_store(conn)
        with pytest.raises(InvalidAmountError):
            process_debit(conn, cid, 0, sid)

    def test_raises_invalid_amount_for_negative(self):
        conn = create_test_db()
        cid = seed_comanda(conn, "F001", balance=1000)
        sid = seed_store(conn)
        with pytest.raises(InvalidAmountError):
            process_debit(conn, cid, -100, sid)

    def test_balance_unchanged_on_insufficient(self):
        conn = create_test_db()
        cid = seed_comanda(conn, "F001", balance=500)
        sid = seed_store(conn)
        with pytest.raises(InsufficientBalanceError):
            process_debit(conn, cid, 1000, sid)
        assert get_balance(conn, cid) == 500


# ============================================================================
# create_or_update_category
# ============================================================================
class TestCreateOrUpdateCategory:
    def test_creates_new_category(self):
        conn = create_test_db()
        cat = create_or_update_category(conn, "Jaqueta", 1500, 0)
        conn.commit()
        assert cat.name == "Jaqueta"
        assert cat.price == 1500

    def test_updates_existing_price(self):
        conn = create_test_db()
        create_or_update_category(conn, "Bolsa", 800, 0)
        conn.commit()
        updated = create_or_update_category(conn, "Bolsa", 1000, 0)
        conn.commit()
        assert updated.price == 1000

    def test_zero_price_doesnt_overwrite_existing(self):
        conn = create_test_db()
        create_or_update_category(conn, "Sapato", 700, 0)
        conn.commit()
        result = create_or_update_category(conn, "Sapato", 0, 3)
        conn.commit()
        assert result.price == 700  # original price unchanged
        assert result.total_entries == 3

    def test_increments_total_entries(self):
        conn = create_test_db()
        cat = create_or_update_category(conn, "Calca", 900, 5)
        conn.commit()
        assert cat.total_entries == 5


# ============================================================================
# distribute_items
# ============================================================================
class TestDistributeItems:
    def _make_stores(self, n):
        return [{"id": f"store-{i}", "name": f"Loja {i}"} for i in range(1, n + 1)]

    def _make_cats(self, *entries):
        return [{"id": f"cat-{i}", "name": f"Cat{i}", "total_entries": e}
                for i, e in enumerate(entries, 1)]

    def test_distributes_evenly(self):
        result = distribute_items(self._make_cats(6), 3, self._make_stores(2))
        assert len(result["boxes"]) == 3

    def test_raises_when_no_items(self):
        with pytest.raises(ValueError, match="Nenhum produto"):
            distribute_items([], 2, self._make_stores(2))

    def test_raises_when_boxes_exceed_items(self):
        with pytest.raises(ValueError):
            distribute_items(self._make_cats(2), 5, self._make_stores(2))

    def test_raises_when_num_boxes_is_zero(self):
        with pytest.raises(ValueError):
            distribute_items(self._make_cats(5), 0, self._make_stores(2))

    def test_all_items_are_assigned(self):
        cats = self._make_cats(10, 5)
        result = distribute_items(cats, 3, self._make_stores(2))
        total = sum(
            qty for box in result["boxes"] for qty in box["items"].values()
        )
        assert total == 15  # 10 + 5


# ============================================================================
# suggest_box_count
# ============================================================================
class TestSuggestBoxCount:
    def test_respects_minimum_one_box_per_store(self):
        cats = [{"total_entries": 5}]
        result = suggest_box_count(cats, 10)
        assert result["suggested"] >= 10

    def test_zero_items_returns_stores_count(self):
        # No special case — returns max(stores_count, ceil(0/15))
        result = suggest_box_count([], 5)
        assert result["suggested"] == 5

    def test_large_inventory_increases_suggestion(self):
        cats = [{"total_entries": 300}]
        result = suggest_box_count(cats, 3)
        assert result["suggested"] == 20  # ceil(300/15) = 20
