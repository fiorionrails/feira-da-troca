/**
 * Shared utility helpers used across backend-node services.
 */

/** Returns the current UTC timestamp as an ISO 8601 string. */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Safely parses a strictly positive integer from any input.
 * Returns null if the value is not a valid integer greater than zero.
 * Guards against NaN, floats, negative values, and non-numeric strings.
 */
function parsePositiveInt(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Safely parses a non-negative integer (zero or positive) from any input.
 * Returns null if the value is not a valid non-negative integer.
 * If value is undefined or null, returns 0 (treated as absent = default zero).
 */
function parseNonNegativeInt(value) {
  if (value === undefined || value === null) return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

module.exports = { nowIso, parsePositiveInt, parseNonNegativeInt };
