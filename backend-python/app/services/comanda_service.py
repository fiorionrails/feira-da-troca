import uuid
import re
import sqlite3
from typing import Optional
from app.models import Comanda, Event, EventType
from app.utils import now_iso
from app.config import settings

CODE_REGEX = re.compile(r'^F(\d+)$')


class MaxComandasReachedError(Exception):
    pass


class DuplicateCodeError(Exception):
    pass


def get_next_code(conn) -> str:
    """Retorna o próximo código disponível (ex: F001, F002)"""
    cursor = conn.cursor()
    cursor.execute("SELECT code FROM comandas ORDER BY created_at DESC LIMIT 1")
    row = cursor.fetchone()

    if not row:
        return "F001"

    last_code = row["code"]
    match = CODE_REGEX.match(last_code)
    if not match:
        return "F001"
    number = int(match.group(1))
    return f"F{number + 1:03d}"

def create_comanda(conn, holder_name: str, initial_balance: int) -> tuple[Comanda, str]:
    """Cria uma comanda gerando um código automático e emite saldo inicial."""
    trimmed_name = holder_name.strip() if holder_name else ''
    if not trimmed_name:
        raise ValueError('holder_name is required')
    if not isinstance(initial_balance, int) or initial_balance < 0:
        raise ValueError('initial_balance must be a non-negative integer')

    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as c FROM comandas")
    count = cursor.fetchone()["c"]
    if count >= settings.max_comandas:
        raise MaxComandasReachedError(
            f"Maximum number of comandas ({settings.max_comandas}) reached"
        )

    comanda_id = str(uuid.uuid4())
    code = get_next_code(conn)
    created_at = now_iso()

    try:
        cursor.execute(
            "INSERT INTO comandas (id, code, holder_name, created_at) VALUES (?, ?, ?, ?)",
            (comanda_id, code, trimmed_name, created_at)
        )

        event_id = str(uuid.uuid4())
        if initial_balance > 0:
            cursor.execute(
                "INSERT INTO events (id, type, comanda_id, amount, note, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
                (event_id, EventType.credit.value, comanda_id, initial_balance, "Saldo inicial", created_at)
            )

        conn.commit()
    except sqlite3.IntegrityError as err:
        if 'UNIQUE constraint failed: comandas.code' in str(err):
            raise DuplicateCodeError('Concurrent comanda creation conflict. Please retry.')
        raise

    comanda = Comanda(id=comanda_id, code=code, holder_name=trimmed_name, created_at=created_at)
    return comanda, event_id

def get_comanda_by_code(conn, code: str) -> Optional[Comanda]:
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM comandas WHERE code = ?", (code,))
    row = cursor.fetchone()
    if row:
        return Comanda(**dict(row))
    return None

def get_balance(conn, comanda_id: str) -> int:
    """Consulta a view 'balance_view' que processa on-the-fly a soma dos eventos."""
    cursor = conn.cursor()
    cursor.execute("SELECT balance FROM balance_view WHERE comanda_id = ?", (comanda_id,))
    row = cursor.fetchone()
    if row and row["balance"] is not None:
        return row["balance"]
    return 0

def get_comanda_events(conn, comanda_id: str) -> list[Event]:
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM events WHERE comanda_id = ? ORDER BY timestamp ASC", (comanda_id,))
    events = []
    for row in cursor.fetchall():
        events.append(Event(**dict(row)))
    return events
