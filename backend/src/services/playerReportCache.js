/*
 * Tiny in-process cache for Player Report responses.
 *
 * A cached value is only returned while its fingerprint still matches. The
 * caller builds that fingerprint from cheap DB signals (last sync time, last
 * analysis completion, analysed-game count), so a newly synced game or a newly
 * analysed in-app game automatically triggers exactly one recompute.
 */

const config = require('../config/playerReportConfig');

const cache = new Map();

function prune() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > config.cache.maxEntries) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

/**
 * Return the cached value when both the key and fingerprint match.
 * @param {string} key       e.g. `42|all`
 * @param {string} fingerprint cheap change signal from the DB
 * @returns {any|undefined}
 */
function get(key, fingerprint) {
  prune();
  const entry = cache.get(key);
  if (!entry || entry.fingerprint !== fingerprint) return undefined;
  if (entry.expiresAt <= Date.now()) return undefined;
  return entry.value;
}

function set(key, fingerprint, value) {
  prune();
  cache.set(key, {
    fingerprint,
    value,
    expiresAt: Date.now() + config.cache.ttlMs,
  });
  return value;
}

async function getOrCompute(key, fingerprint, compute) {
  const hit = get(key, fingerprint);
  if (hit !== undefined) return hit;
  const value = await compute();
  return set(key, fingerprint, value);
}

function invalidate(studentId) {
  if (studentId == null) {
    cache.clear();
    return;
  }
  const prefix = `${studentId}|`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

module.exports = { get, set, getOrCompute, invalidate, __cache: cache };
