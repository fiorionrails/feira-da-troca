"""Shared utility helpers used across backend-python services."""

from datetime import datetime, timezone
from typing import Optional


def now_iso() -> str:
    """Returns the current UTC timestamp as an ISO 8601 string ending in Z (UTC).
    Matches Node.js new Date().toISOString() format: millisecond precision, Z suffix.
    """
    now = datetime.now(timezone.utc)
    return now.strftime('%Y-%m-%dT%H:%M:%S.') + f"{now.microsecond // 1000:03d}Z"


def parse_positive_int(value) -> Optional[int]:
    """Safely parses a strictly positive integer from any input.
    Returns None if the value is not a valid integer greater than zero.
    Guards against booleans, floats, negative values, and non-numeric strings.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, float) and not value.is_integer():
        return None
    try:
        n = int(value)
        if n <= 0:
            return None
        return n
    except (TypeError, ValueError):
        return None


def parse_non_negative_int(value) -> Optional[int]:
    """Safely parses a non-negative integer (zero or positive) from any input.
    Returns None if the value is not a valid non-negative integer.
    If value is None, returns 0 (treated as absent = default zero).
    """
    if value is None:
        return 0
    if isinstance(value, bool):
        return None
    if isinstance(value, float) and not value.is_integer():
        return None
    try:
        n = int(value)
        if n < 0:
            return None
        return n
    except (TypeError, ValueError):
        return None
