/* Tiny pure helper for toast dedupe — kept dependency-free (no React) so it
 * can be unit-tested directly in node (see backend/scripts or any
 * `node --test` runner importing this file).
 *
 * A toast is identified by a caller-supplied dedupeKey such as
 * `match_request:123:45` (type + gameId + userId). The first show wins; a
 * repeat of the same key inside `windowMs` is suppressed. After the window
 * expires the same key may show again (a re-invite minutes later is news).
 */

/** Default suppression window: repeats inside 8s are treated as duplicates. */
export const DEDUPE_WINDOW_MS = 8000;

/**
 * @param {Map<string, number>} seen  key -> timestamp (ms) of last shown toast
 * @param {string|null|undefined} key the dedupe key, or null for "never dedupe"
 * @param {number} now                Date.now()
 * @param {number} windowMs           suppression window
 * @returns {{ suppressed: boolean }} also records `now` for a shown key
 */
export function checkToastDedupe(seen, key, now, windowMs = DEDUPE_WINDOW_MS) {
  if (key == null || key === '') return { suppressed: false };
  const last = seen.get(key);
  if (last != null && now - last < windowMs) return { suppressed: true };
  seen.set(key, now);
  // Bound memory: drop keys long past their window.
  if (seen.size > 500) {
    for (const [k, t] of seen) {
      if (now - t >= windowMs) seen.delete(k);
      if (seen.size <= 400) break;
    }
  }
  return { suppressed: false };
}

/** Build the canonical key for a match-request toast. */
export function matchRequestKey(gameId, userId) {
  return `match_request:${gameId ?? '?'}:${userId ?? '?'}`;
}
