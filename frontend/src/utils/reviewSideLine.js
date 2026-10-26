/* Game Review — live side-line classifier.
 *
 * The Advanced Engine / Analysis mode lets the player step off the reviewed
 * game onto an alternative line without touching the main review. Every move
 * played inside the variation is graded by the SAME canonical pipeline as the
 * main review — a one-move reviewGame() — so a variation move shows exactly
 * the badge the main review would give it, including the protected tactical
 * sacrifice path. There is deliberately no second classifier here: the
 * per-ply metrics, gates and verdict order live in exactly one place
 * (reviewGame → classifyMove), and this module only adapts a single move
 * into and out of that pipeline.
 *
 * The only deliberate difference from a main-line row: no opening-book lookup
 * (a deviation is off-theory by definition), via bookLookup. Rows are shaped
 * exactly like reviewGame's output rows, so the move list, board badge and
 * best-move hint keep working unchanged.
 */

import { reviewGame } from './gameReview.js';
import { CANONICAL_ENGINE_OVERRIDES } from './canonicalAnalysis.js';

/**
 * Classify ONE move (SAN) played from `fenBefore` — the live variation row.
 * @param {string} fenBefore  FEN of the position BEFORE the move (the board the
 *   player actually played on — must match the review prefix exactly).
 * @param {object} opts
 *   san          the played move (SAN — chess.js resolves it from fenBefore)
 *   ply          absolute ply index (kept for row order only; moveNumber-scoped
 *                gates see a one-move line, exactly like a fresh deviation)
 *   isCancelled  optional abort probe, forwarded to the canonical pipeline
 *   engine       Node-test hook (reviewGame's own `{ engine }` option);
 *                browser callers omit it and get the full NNUE pool
 * @returns {Promise<object|null>} canonical review row, or null on illegal move.
 */
export async function classifySideMove(fenBefore, { san, ply = 0, isCancelled, engine } = {}) {
  if (!san) return null;
  let res = null;
  try {
    /* Canonical engine config, exactly like every surface — plus
       bookLookup: () => null, which keeps a deviation off-theory by
       definition. */
    res = await reviewGame(fenBefore, [san], {
      engineOverrides: { ...CANONICAL_ENGINE_OVERRIDES },
      bookLookup: () => null,
      isCancelled,
      engine,
    });
  } catch {
    return null;
  }
  if (!res || !Array.isArray(res.moves) || !res.moves[0]) return null;
  const row = res.moves[0];
  /* Preserve the variation's absolute ply so rows[base + k] keeps mapping to
     variant move k; everything else is the canonical row untouched. */
  return { ...row, ply };
}
