'use strict';

/**
 * Unit tests for src/utils.js
 *
 * Covers: parsePositiveInt, parseNonNegativeInt, nowIso
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { parsePositiveInt, parseNonNegativeInt, nowIso } = require('../src/utils');

// ---------------------------------------------------------------------------
// parsePositiveInt
// ---------------------------------------------------------------------------
describe('parsePositiveInt', () => {
  test('returns integer for valid positive numbers', () => {
    assert.strictEqual(parsePositiveInt(1), 1);
    assert.strictEqual(parsePositiveInt(100), 100);
    assert.strictEqual(parsePositiveInt(999999), 999999);
  });

  test('parses a numeric string', () => {
    assert.strictEqual(parsePositiveInt('50'), 50);
    assert.strictEqual(parsePositiveInt('1'), 1);
  });

  test('returns null for zero', () => {
    assert.strictEqual(parsePositiveInt(0), null);
    assert.strictEqual(parsePositiveInt('0'), null);
  });

  test('returns null for negative numbers', () => {
    assert.strictEqual(parsePositiveInt(-1), null);
    assert.strictEqual(parsePositiveInt(-100), null);
    assert.strictEqual(parsePositiveInt('-5'), null);
  });

  test('returns null for floats', () => {
    assert.strictEqual(parsePositiveInt(1.5), null);
    assert.strictEqual(parsePositiveInt('1.5'), null);
    assert.strictEqual(parsePositiveInt(0.1), null);
  });

  test('returns null for non-numeric strings', () => {
    assert.strictEqual(parsePositiveInt('abc'), null);
    assert.strictEqual(parsePositiveInt(''), null);
    assert.strictEqual(parsePositiveInt('NaN'), null);
    assert.strictEqual(parsePositiveInt('one'), null);
  });

  test('returns null for null and undefined', () => {
    assert.strictEqual(parsePositiveInt(null), null);
    assert.strictEqual(parsePositiveInt(undefined), null);
  });

  test('returns null for NaN', () => {
    assert.strictEqual(parsePositiveInt(NaN), null);
  });

  test('returns null for Infinity', () => {
    assert.strictEqual(parsePositiveInt(Infinity), null);
    assert.strictEqual(parsePositiveInt(-Infinity), null);
  });
});

// ---------------------------------------------------------------------------
// parseNonNegativeInt
// ---------------------------------------------------------------------------
describe('parseNonNegativeInt', () => {
  test('returns 0 for null (treated as absent)', () => {
    assert.strictEqual(parseNonNegativeInt(null), 0);
  });

  test('returns 0 for undefined (treated as absent)', () => {
    assert.strictEqual(parseNonNegativeInt(undefined), 0);
  });

  test('returns 0 for explicit zero', () => {
    assert.strictEqual(parseNonNegativeInt(0), 0);
    assert.strictEqual(parseNonNegativeInt('0'), 0);
  });

  test('returns integer for valid positive values', () => {
    assert.strictEqual(parseNonNegativeInt(1), 1);
    assert.strictEqual(parseNonNegativeInt(100), 100);
    assert.strictEqual(parseNonNegativeInt('50'), 50);
  });

  test('returns null for negative numbers', () => {
    assert.strictEqual(parseNonNegativeInt(-1), null);
    assert.strictEqual(parseNonNegativeInt(-100), null);
    assert.strictEqual(parseNonNegativeInt('-5'), null);
  });

  test('returns null for floats', () => {
    assert.strictEqual(parseNonNegativeInt(1.5), null);
    assert.strictEqual(parseNonNegativeInt('1.5'), null);
    assert.strictEqual(parseNonNegativeInt(0.9), null);
  });

  test('returns null for non-numeric strings', () => {
    assert.strictEqual(parseNonNegativeInt('abc'), null);
    assert.strictEqual(parseNonNegativeInt('NaN'), null);
  });

  test('returns null for NaN', () => {
    assert.strictEqual(parseNonNegativeInt(NaN), null);
  });

  test('returns null for Infinity', () => {
    assert.strictEqual(parseNonNegativeInt(Infinity), null);
  });
});

// ---------------------------------------------------------------------------
// nowIso
// ---------------------------------------------------------------------------
describe('nowIso', () => {
  test('returns a valid ISO 8601 UTC string', () => {
    const result = nowIso();
    assert.strictEqual(typeof result, 'string');
    assert.ok(!isNaN(Date.parse(result)), 'should be parseable as a date');
    assert.ok(result.endsWith('Z'), 'should end with Z (UTC)');
  });

  test('returns a timestamp close to the current time', () => {
    const before = Date.now();
    const result = nowIso();
    const after = Date.now();
    const parsed = new Date(result).getTime();
    assert.ok(parsed >= before && parsed <= after + 10, 'timestamp should be current');
  });

  test('each call returns a unique or equal timestamp (monotonic)', () => {
    const t1 = new Date(nowIso()).getTime();
    const t2 = new Date(nowIso()).getTime();
    assert.ok(t2 >= t1, 'second call should not be earlier');
  });
});
