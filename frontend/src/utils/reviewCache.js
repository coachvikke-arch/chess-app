/* Position-analysis cache for the game review.
 *
 * A review asks the engine for the same position far more often than it looks:
 * the warm-up probe, a position reached twice by move transposition, and — most
 * usefully — the whole review being re-run for the same game, which today pays
 * full depth-18 searches again for every position it already knows.
 *
 * The key is FEN + depth + multiPV + engine version, exactly as the parameters
 * that produced the result. Two searches that differ in ANY of them are different
 * searches and are cached separately — in particular a MultiPV-1 result must
 * never be served for a MultiPV-3 request, because Stockfish returns a
 * measurably different rank-1 score for the two at the same depth (verified:
 * 24/24 positions differed, by 3-29cp), and the review classifies off that score.
 *
 * CACHING DOES NOT CHANGE A VERDICT. Every entry is the result of one fixed-depth
 * search, and a repeated request is by definition the same search, so a hit and a
 * miss cannot disagree. That is why this is safe under the determinism contract
 * in reviewConfig.js: the cache is keyed on the inputs, never on time.
 *
 * In-flight requests are shared rather than duplicated: when the review asks for
 * a position that is already being searched, it awaits that search instead of
 * queueing an identical one. */

/** Bumped by hand when a cached value stops being what the engine would return. */
export const CACHE_VERSION = 1;

/**
 * The cache key. Exported because it is the contract that makes caching safe, and
 * therefore the thing most worth asserting on directly: depth, multiPV and engine
 * version must all change the key, or a cheaper search gets served for a more
 * expensive request.
 */
export const cacheKey = (fen, depth, multiPv, version) =>
  `${fen}|${depth}|${multiPv}|v${version}`;

export function createReviewCache({ version = CACHE_VERSION, maxEntries = 4096 } = {}) {
  /** @type {Map<string, any>} settled results, in insertion order. */
  const store = new Map();
  /** @type {Map<string, Promise<any>>} searches currently running. */
  const inflight = new Map();
  const stats = { hits: 0, misses: 0, coalesced: 0, stores: 0, evictions: 0 };

  const key = (fen, depth, multiPv) => cacheKey(fen, depth, multiPv, version);

  function remember(k, value) {
    /* Never cache a failed/empty engine answer: a boot failure or aborted
       search resolves null, and caching that poisons every later re-review
       of the same position into an instant "no evaluation" row — including
       the Re-analyze click that is supposed to recover. */
    if (value == null) return;
    /* Map preserves insertion order, so the first key is the oldest — a plain
       LRU is unnecessary here: review positions are never revisited after the
       cap, and the cap exists only to bound a very long session's memory. */
    if (store.size >= maxEntries) {
      const oldest = store.keys().next().value;
      store.delete(oldest);
      stats.evictions += 1;
    }
    store.set(k, value);
    stats.stores += 1;
  }

  /**
   * Run `fn` unless its exact result is already known.
   * @template T
   * @param {string} fen
   * @param {number} depth
   * @param {number} multiPv
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async function wrap(fen, depth, multiPv, fn) {
    const k = key(fen, depth, multiPv);

    if (store.has(k)) {
      stats.hits += 1;
      return store.get(k);
    }

    const running = inflight.get(k);
    if (running) {
      stats.coalesced += 1;
      return running;
    }

    stats.misses += 1;
    const p = (async () => fn())().then(
      (value) => { inflight.delete(k); remember(k, value); return value; },
      (err) => { inflight.delete(k); throw err; },
    );
    inflight.set(k, p);
    return p;
  }

  return {
    wrap,
    stats,
    get size() { return store.size; },
    has: (fen, depth, multiPv) => store.has(key(fen, depth, multiPv)),
    clear() { store.clear(); inflight.clear(); },
  };
}
