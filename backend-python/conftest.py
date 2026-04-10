"""
pytest configuration and shared fixtures.
Provides test database isolation by overriding the DB path before each test
and resetting it afterwards.
"""

import os
import sqlite3
import pytest

# Load .env BEFORE importing app modules so config picks up the correct ADMIN_TOKEN.
from dotenv import load_dotenv
load_dotenv()

ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "admin_token_change_me")


@pytest.fixture()
def test_db_path(tmp_path):
    """Creates a fresh temporary SQLite file path and overrides the global DB path.
    Also force-initializes the schema so tests can seed data directly before HTTP requests.
    """
    from app.database import _override_db_path, get_db_connection
    db_file = str(tmp_path / "test_ouroboros.db")
    _override_db_path(db_file)
    # Force schema initialization now (sets _initialized = True)
    conn = get_db_connection()
    conn.close()
    yield db_file
    # Reset to default so the next test starts fresh
    _override_db_path("./ouroboros.db")


@pytest.fixture()
def client(test_db_path):
    """Provides a Starlette TestClient with a fresh isolated database."""
    from starlette.testclient import TestClient
    from app.main import app
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture()
def seed(test_db_path):
    """Returns a helper function that seeds data into the test database directly."""
    def _seed(fn):
        conn = sqlite3.connect(test_db_path)
        conn.row_factory = sqlite3.Row
        fn(conn)
        conn.commit()
        conn.close()
    return _seed


def admin_headers():
    return {"token": ADMIN_TOKEN}
