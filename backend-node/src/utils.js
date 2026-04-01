/**
 * Shared utility helpers used across backend-node services.
 */

/** Returns the current UTC timestamp as an ISO 8601 string. */
function nowIso() {
  return new Date().toISOString();
}

module.exports = { nowIso };
