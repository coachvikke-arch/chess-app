/* ──────────────────────────────────────────────────────────────────────────
 * The shape of a stored analysis on the wire.
 *
 * The server stores ONE envelope per (game, user) pair in
 * `imported_game_analysis.data`:
 *
 *   { gameSource, gameId, initialFen, moveCount,
 *     analysisVersion, schemaVersion, analysis: { moves, white, black, … } }
 *
 * and the client validates EXACTLY that shape (canonicalAnalysis
 * .isValidCanonicalAnalysis). A response that wraps the envelope in
 * `{ data: envelope }` therefore looks like "no analysis version" to the
 * validator, i.e. a permanent cache MISS — which cost a full Stockfish
 * re-analysis on every single open of an already-reviewed game.
 *
 * This module is the ONE place that knows how to read a stored analysis off
 * the wire, so the service and the tests agree on it.
 */

/**
 * Read the canonical envelope out of a stored-analysis response.
 *
 * @param {object|null} payload  the response body
 * @returns {object|null} the envelope, or null when nothing is stored
 */
export function unwrapAnalysisEnvelope(payload) {
  if (!payload || typeof payload !== 'object') return null;
  /* The current shape: the envelope itself. */
  if (payload.analysisVersion) return payload;
  /* A server that still wraps it: unwrap rather than hand on a shape the
     validator would (correctly) reject. */
  if (payload.data && typeof payload.data === 'object' && payload.data.analysisVersion) {
    return { ...payload.data, created_at: payload.created_at };
  }
  /* Anything else (a legacy row, a partial payload) is passed through: the
     canonical validator decides whether it may be reused, and rejects it if
     not. A wrong answer must never be invented here. */
  return payload;
}
