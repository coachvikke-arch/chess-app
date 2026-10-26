/* The extension is explicit so this module can be imported by Node (the
   backfill script and the tests read it without a browser). */
import { isSigmaVerdict } from './sigmaType.js';

/* ──────────────────────────────────────────────────────────────────────────
 * The brilliant moves of a finished review, in the shape the API takes.
 *
 * Pure on purpose: this is the part that decides WHICH moves are brilliant
 * moves, and it must be readable without a browser (the backfill script and
 * the tests both use it). The network call lives in sigmaPersist.js.
 */

/**
 * Turn a finished review into the payload the API expects.
 *
 * Only rows that are a Sigma verdict are sent. A Sigma whose type could not be
 * read off the geometry (a protected sacrifice — the piece stays defended)
 * is still a brilliant move and is KEPT, with a null type: persistSigmaMoves
 * names it from the move data, and only a move that STILL has no name is
 * dropped (the API's sigma_type is NOT NULL, and a filter chip that can hold
 * nothing is worse than one that is never offered).
 *
 * @param {object} review  the reviewGame() result
 * @returns {Array} zero or more moves
 */
export function buildSigmaPayload(review) {
  if (!review || !Array.isArray(review.moves)) return [];
  const out = [];
  for (const row of review.moves) {
    /* Either spelling of the Sigma verdict files. Testing for the one legacy id
       meant a 'sigma' row was classified, drew its badge — and was then silently
       dropped on the way to the Sigma list, so the tab stayed empty for a game
       that visibly had a brilliant move in it. */
    if (!row || !isSigmaVerdict(row.verdict)) continue;
    out.push({
      ply: row.ply,
      gameId: null,          // filled in by persistSigmaMoves
      gameSource: null,      // ditto
      sigmaType: row.sigma && row.sigma.type ? row.sigma.type : null,
      moveSan: row.san || null,
      fromSquare: (row.sigma && row.sigma.fromSquare) || null,
      toSquare: (row.sigma && row.sigma.toSquare) || null,
      fenBefore: null,       // ditto
    });
  }
  return out;
}
