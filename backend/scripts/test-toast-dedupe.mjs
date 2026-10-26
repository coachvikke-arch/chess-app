/* Unit tests for the toast dedupe helper (pure logic, no React).
 * Run: node --test scripts/test-toast-dedupe.mjs  (from backend/, or adapt path)
 * The helper lives in frontend/src/utils/toastDedupe.js.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkToastDedupe, matchRequestKey, DEDUPE_WINDOW_MS } from '../../frontend/src/utils/toastDedupe.js';

test('first show with a key passes', () => {
  const seen = new Map();
  assert.equal(checkToastDedupe(seen, 'a', 1000).suppressed, false);
});

test('repeat inside the window is suppressed', () => {
  const seen = new Map();
  checkToastDedupe(seen, 'a', 1000);
  assert.equal(checkToastDedupe(seen, 'a', 1000 + DEDUPE_WINDOW_MS - 1).suppressed, true);
});

test('same key after the window shows again', () => {
  const seen = new Map();
  checkToastDedupe(seen, 'a', 1000);
  assert.equal(checkToastDedupe(seen, 'a', 1000 + DEDUPE_WINDOW_MS).suppressed, false);
});

test('different keys are independent', () => {
  const seen = new Map();
  checkToastDedupe(seen, 'a', 1000);
  assert.equal(checkToastDedupe(seen, 'b', 1001).suppressed, false);
});

test('null key never dedupes (legacy callers unchanged)', () => {
  const seen = new Map();
  assert.equal(checkToastDedupe(seen, null, 1000).suppressed, false);
  assert.equal(checkToastDedupe(seen, undefined, 1000).suppressed, false);
  assert.equal(seen.size, 0);
});

test('matchRequestKey is stable per game+user', () => {
  assert.equal(matchRequestKey(12, 34), matchRequestKey(12, 34));
  assert.notEqual(matchRequestKey(12, 34), matchRequestKey(13, 34));
  assert.notEqual(matchRequestKey(12, 34), matchRequestKey(12, 35));
});
