import uuid
from app.models import Event, EventType
from app.services.comanda_service import get_balance
from app.utils import now_iso


class InsufficientBalanceError(Exception):
    pass


class InvalidAmountError(Exception):
    pass


def process_debit(conn, comanda_id: str, amount: int, store_id: str, note: str = None) -> Event:
    """Processa um débito atomicamente validando o saldo.

    Usa BEGIN IMMEDIATE para adquirir lock de escrita antes de ler o saldo,
    prevenindo race condition entre débitos simultâneos na mesma comanda.
    """
    if not isinstance(amount, int) or amount <= 0:
        raise InvalidAmountError("O valor do débito deve ser maior que zero.")

    cursor = conn.cursor()
    conn.execute("BEGIN IMMEDIATE")
    try:
        current_balance = get_balance(conn, comanda_id)
        if current_balance < amount:
            conn.rollback()
            raise InsufficientBalanceError(
                f"Saldo insuficiente. Atual: {current_balance}, Requerido: {amount}"
            )

        event_id = str(uuid.uuid4())
        created_at = now_iso()

        cursor.execute(
            "INSERT INTO events (id, type, comanda_id, store_id, amount, note, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (event_id, EventType.debit.value, comanda_id, store_id, amount, note, created_at)
        )

        cursor.execute("SELECT * FROM events WHERE id = ?", (event_id,))
        row = cursor.fetchone()
        conn.commit()
        return Event(**dict(row))
    except (InsufficientBalanceError, InvalidAmountError):
        raise
    except Exception:
        conn.rollback()
        raise


def process_credit(conn, comanda_id: str, amount: int, store_id: str = None, note: str = None) -> Event:
    """Processa um crédito direto para uma comanda."""
    if not isinstance(amount, int) or amount <= 0:
        raise InvalidAmountError("O valor do crédito deve ser maior que zero.")

    cursor = conn.cursor()
    event_id = str(uuid.uuid4())
    created_at = now_iso()

    cursor.execute(
        "INSERT INTO events (id, type, comanda_id, store_id, amount, note, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (event_id, EventType.credit.value, comanda_id, store_id, amount, note, created_at)
    )

    cursor.execute("SELECT * FROM events WHERE id = ?", (event_id,))
    row = cursor.fetchone()

    conn.commit()
    return Event(**dict(row))

