"""Shared utility helpers used across backend-python services."""

from datetime import datetime, timezone


def now_iso() -> str:
    """Returns the current UTC timestamp as an ISO 8601 string."""
    return datetime.now(timezone.utc).isoformat()
