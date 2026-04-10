"""
Concurrency tests — mirrors backend-node/tests/concurrency.test.js

Verifies that SQLite's BEGIN IMMEDIATE transaction in process_debit prevents
double-spending when multiple threads simultaneously attempt to debit the same
comanda.

Tests run at the service layer directly (no HTTP/WS overhead) using a temporary
file-based SQLite database, which allows multiple threads to use separate
connections to the same data.
"""

import threading
import os
import pytest
from datetime import datetime, timezone

from tests.helpers.db import create_shared_test_db, open_shared_db
from app.services.comanda_service import get_balance
from app.services.transaction_service import (
    process_debit,
    InsufficientBalanceError,
    InvalidAmountError,
)


# ---------------------------------------------------------------------------
# Seed helpers for shared-memory DB
# ---------------------------------------------------------------------------
def seed_comanda(conn, code="F001", holder="Test User", balance=5000):
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


def run_debit(db_uri: str, comanda_id: str, store_id: str, amount: int, results: list):
    """Target function for each debiting thread."""
    conn = open_shared_db(db_uri)
    try:
        event = process_debit(conn, comanda_id, amount, store_id)
        conn.commit()
        results.append(("confirmed", event))
    except InsufficientBalanceError as e:
        results.append(("rejected_insufficient", str(e)))
    except Exception as e:
        results.append(("error", str(e)))
    finally:
        conn.close()


# ============================================================================
# Double-spend prevention
# ============================================================================
class TestDoubleSpendPrevention:
    def test_only_one_debit_confirmed_when_both_drain_exact_balance(self):
        """Two stores simultaneously attempt to debit the full balance.
        SQLite's BEGIN IMMEDIATE lock guarantees exactly one succeeds."""
        db_path, seed_conn = create_shared_test_db()
        try:
            cid = seed_comanda(seed_conn, "F001", "Alice", 1000)
            sid = seed_store(seed_conn)
            seed_conn.close()

            results = []
            threads = [
                threading.Thread(target=run_debit, args=(db_path, cid, sid, 1000, results)),
                threading.Thread(target=run_debit, args=(db_path, cid, sid, 1000, results)),
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            confirmed = [r for r in results if r[0] == "confirmed"]
            rejected = [r for r in results if r[0] == "rejected_insufficient"]
            assert len(confirmed) == 1, f"Expected 1 confirmed, got {len(confirmed)}. Results: {results}"
            assert len(rejected) == 1, f"Expected 1 rejected, got {len(rejected)}. Results: {results}"
        finally:
            os.unlink(db_path)

    def test_confirmed_balance_matches_db_after_double_spend_attempt(self):
        """After concurrent debits, the confirmed event's new balance matches
        what is actually in the database."""
        db_path, seed_conn = create_shared_test_db()
        try:
            cid = seed_comanda(seed_conn, "F001", "Bob", 2000)
            sid = seed_store(seed_conn)
            seed_conn.close()

            results = []
            threads = [
                threading.Thread(target=run_debit, args=(db_path, cid, sid, 2000, results)),
                threading.Thread(target=run_debit, args=(db_path, cid, sid, 2000, results)),
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            check_conn = open_shared_db(db_path)
            actual_balance = get_balance(check_conn, cid)
            check_conn.close()

            assert actual_balance == 0
            confirmed = [r for r in results if r[0] == "confirmed"]
            assert len(confirmed) == 1
        finally:
            os.unlink(db_path)

    def test_five_stores_competing_for_insufficient_balance(self):
        """Five simultaneous debits of 2000 against a balance of 2000.
        Exactly one should succeed."""
        db_path, seed_conn = create_shared_test_db()
        try:
            cid = seed_comanda(seed_conn, "F001", "Charlie", 2000)
            n_stores = 5
            for i in range(n_stores):
                seed_store(seed_conn, f"store-{i}", f"Store {i}", f"TKN{i:03d}1")
            seed_conn.close()

            results = []
            threads = [
                threading.Thread(
                    target=run_debit,
                    args=(db_path, cid, f"store-{i}", 2000, results),
                )
                for i in range(n_stores)
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            confirmed = [r for r in results if r[0] == "confirmed"]
            rejected = [r for r in results if r[0] == "rejected_insufficient"]
            assert len(confirmed) == 1
            assert len(rejected) == 4
        finally:
            os.unlink(db_path)

    def test_all_confirmed_when_total_fits_in_balance(self):
        """Five debits of 100 against a balance of 1000 should all succeed."""
        db_path, seed_conn = create_shared_test_db()
        try:
            cid = seed_comanda(seed_conn, "F001", "Diana", 1000)
            n_stores = 5
            for i in range(n_stores):
                seed_store(seed_conn, f"store-{i}", f"Store {i}", f"TKN{i:03d}1")
            seed_conn.close()

            results = []
            threads = [
                threading.Thread(
                    target=run_debit,
                    args=(db_path, cid, f"store-{i}", 100, results),
                )
                for i in range(n_stores)
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            confirmed = [r for r in results if r[0] == "confirmed"]
            assert len(confirmed) == 5

            check_conn = open_shared_db(db_path)
            assert get_balance(check_conn, cid) == 500
            check_conn.close()
        finally:
            os.unlink(db_path)

    def test_event_log_integrity_after_concurrent_debits(self):
        """After concurrent debits, the total events + balance must be
        consistent with each other (no phantom debits)."""
        db_path, seed_conn = create_shared_test_db()
        try:
            initial = 3000
            cid = seed_comanda(seed_conn, "F001", "Eve", initial)
            n_stores = 4
            for i in range(n_stores):
                seed_store(seed_conn, f"store-{i}", f"Store {i}", f"TKN{i:03d}1")
            seed_conn.close()

            results = []
            threads = [
                threading.Thread(
                    target=run_debit,
                    args=(db_path, cid, f"store-{i}", 1000, results),
                )
                for i in range(n_stores)
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            confirmed = [r for r in results if r[0] == "confirmed"]
            assert len(confirmed) == 3  # only 3 of 4 fit

            check_conn = open_shared_db(db_path)
            assert get_balance(check_conn, cid) == 0
            row = check_conn.execute(
                "SELECT COUNT(*) as c FROM events WHERE comanda_id = ? AND type = 'debit'", (cid,)
            ).fetchone()
            assert row["c"] == 3
            check_conn.close()
        finally:
            os.unlink(db_path)
