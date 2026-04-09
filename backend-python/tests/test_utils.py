"""Unit tests for utils.py — mirrors backend-node/tests/utils.test.js"""

from app.utils import now_iso, parse_positive_int, parse_non_negative_int


# ============================================================================
# now_iso
# ============================================================================
class TestNowIso:
    def test_returns_string(self):
        result = now_iso()
        assert isinstance(result, str)

    def test_ends_with_z(self):
        result = now_iso()
        assert result.endswith("Z"), f"Expected Z suffix, got: {result}"

    def test_valid_iso_format(self):
        import datetime
        result = now_iso()
        # Should parse without error
        dt = datetime.datetime.fromisoformat(result.replace("Z", "+00:00"))
        assert dt is not None

    def test_millisecond_precision(self):
        result = now_iso()
        # Format: 2024-01-01T12:00:00.123Z — 3 digits after dot
        dot_idx = result.index(".")
        frac = result[dot_idx + 1 : dot_idx + 4]
        assert len(frac) == 3 and frac.isdigit()


# ============================================================================
# parse_positive_int
# ============================================================================
class TestParsePositiveInt:
    def test_valid_int(self):
        assert parse_positive_int(5) == 5

    def test_valid_int_string(self):
        assert parse_positive_int("10") == 10

    def test_returns_none_for_zero(self):
        assert parse_positive_int(0) is None

    def test_returns_none_for_negative(self):
        assert parse_positive_int(-1) is None

    def test_returns_none_for_float(self):
        assert parse_positive_int(1.5) is None

    def test_returns_none_for_none(self):
        assert parse_positive_int(None) is None

    def test_returns_none_for_string(self):
        assert parse_positive_int("abc") is None

    def test_returns_none_for_bool(self):
        assert parse_positive_int(True) is None
        assert parse_positive_int(False) is None

    def test_integer_float_is_valid(self):
        # 3.0 is an integer value stored as float
        assert parse_positive_int(3.0) == 3


# ============================================================================
# parse_non_negative_int
# ============================================================================
class TestParseNonNegativeInt:
    def test_valid_positive(self):
        assert parse_non_negative_int(5) == 5

    def test_zero_is_valid(self):
        assert parse_non_negative_int(0) == 0

    def test_none_returns_zero(self):
        assert parse_non_negative_int(None) == 0

    def test_returns_none_for_negative(self):
        assert parse_non_negative_int(-1) is None

    def test_returns_none_for_float(self):
        assert parse_non_negative_int(1.5) is None

    def test_returns_none_for_string(self):
        assert parse_non_negative_int("abc") is None

    def test_returns_none_for_bool(self):
        assert parse_non_negative_int(True) is None

    def test_integer_float_is_valid(self):
        assert parse_non_negative_int(4.0) == 4
