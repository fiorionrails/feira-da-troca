import uuid
from datetime import datetime, timezone
from app.models import Event, EventType
from app.services.comanda_service import get_balance

class InsufficientBalanceError(Exception):
    pass

class InvalidAmountError(Exception):
    pass

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def process_debit(conn, comanda_id: str, amount: int, store_id: str, note: str = None) -> Event:
    """Processa um débito atomicamente validando o saldo."""
    if amount <= 0:
        raise InvalidAmountError("O valor do débito deve ser maior que zero.")
        
    cursor = conn.cursor()
    
    # Dentro de transação WAL
    cursor.execute("BEGIN TRANSACTION;")
    try:
        current_balance = get_balance(conn, comanda_id)
        if current_balance < amount:
            raise InsufficientBalanceError(f"Saldo insuficiente. Atual: {current_balance}, Requerido: {amount}")
            
        event_id = str(uuid.uuid4())
        created_at = _now_iso()
        
        cursor.execute(
            "INSERT INTO events (id, type, comanda_id, store_id, amount, note, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (event_id, EventType.debit.value, comanda_id, store_id, amount, note, created_at)
        )
        
        # Recuperando do cursor/row as dict pra criar o objeto Pydantic
        cursor.execute("SELECT * FROM events WHERE id = ?", (event_id,))
        row = cursor.fetchone()
        
        cursor.execute("COMMIT;")
        return Event(**dict(row))
        
    except Exception as e:
        cursor.execute("ROLLBACK;")
        raise e

def process_credit(conn, comanda_id: str, amount: int, store_id: str = None, note: str = None) -> Event:
    """Processa um crédito direto para uma comanda."""
    if amount <= 0:
        raise InvalidAmountError("O valor do crédito deve ser maior que zero.")
        
    cursor = conn.cursor()
    event_id = str(uuid.uuid4())
    created_at = _now_iso()
    
    cursor.execute(
        "INSERT INTO events (id, type, comanda_id, store_id, amount, note, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (event_id, EventType.credit.value, comanda_id, store_id, amount, note, created_at)
    )
    
    cursor.execute("SELECT * FROM events WHERE id = ?", (event_id,))
    row = cursor.fetchone()
    
    conn.commit()
    return Event(**dict(row))
