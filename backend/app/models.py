from pydantic import BaseModel, ConfigDict
from enum import Enum
from typing import Optional
from datetime import datetime

class EventType(str, Enum):
    credit = "credit"
    debit = "debit"

class Comanda(BaseModel):
    id: str                # UUID format
    code: str              # F001 etc
    holder_name: str
    created_at: str

class Event(BaseModel):
    id: str                # UUID
    type: EventType
    comanda_id: str
    amount: int            # Centavos positivos
    store_id: Optional[str] = None
    note: Optional[str] = None
    timestamp: str         # ISO 8601
    synced_to_firebase: bool = False

class Store(BaseModel):
    id: str
    name: str
    theme: str
    terminal_token: str

class Category(BaseModel):
    id: str
    name: str
    price: int
    total_entries: int = 0
    total_exits: int = 0

class BalanceView(BaseModel):
    comanda_id: str
    balance: int
