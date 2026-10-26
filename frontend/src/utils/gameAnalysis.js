/* Per-move game analysis: flags each move as brilliant / great / best /
   excellent / good / book / inaccuracy / mistake / miss / blunder by running
   the SAME fixed-depth NNUE review pipeline as Game Review (see ./reviewConfig.js,
   ./reviewClassify.js and ./gameReview.js) and projecting its verdict rows +
   counts into the lightweight shape the Analysis Board and post-game popup
   consume. One engine, one set of verdicts, everywhere. */

import { Chess } from 'chess.js';
import { getCanonicalAnalysis } from './canonicalAnalysis';

/*
  Each verdict has:
  - label   : human-readable name
  - glyph   : short annotation (shown in move list badge)
  - symbol  : Unicode symbol shown prominently in review/overlay
  - tone    : CSS class suffix
  - color   : hex color used for board square tint during review
*/
export const VERDICT_META = {
  brilliant:  { label: 'Brilliant',  glyph: '!!',  symbol: '★',  tone: 'brilliant',  color: '#19c9c3' },
  great:      { label: 'Great',      glyph: '!',   symbol: '!',  tone: 'great',      color: '#3d7ff5' },
  best:       { label: 'Best',       glyph: '★',   symbol: '★',  tone: 'best',       color: '#0fa968' },
  excellent:  { label: 'Excellent',  glyph: '✓',   symbol: '✓',  tone: 'good',       color: '#7bb51f' },
  good:       { label: 'Good',       glyph: '·',   symbol: '·',  tone: 'good',       color: '#a3d977' },
  book:       { label: 'Book',       glyph: '☰',   symbol: '☰',  tone: 'book',       color: '#0369a1' },
  inaccuracy: { label: 'Inaccuracy', glyph: '?!',  symbol: '?!', tone: 'inaccuracy', color: '#93c5fd' },
  mistake:    { label: 'Mistake',    glyph: '?',   symbol: '?',  tone: 'mistake',    color: '#e8502c' },
  miss:       { label: 'Miss',       glyph: '✕',   symbol: '✕',  tone: 'miss',       color: '#c241e0' },
  blunder:    { label: 'Blunder',    glyph: '??',  symbol: '??', tone: 'blunder',    color: '#d41826' },
};

const EMPTY_COUNTS = {
  brilliant: 0, great: 0, best: 0, excellent: 0, good: 0, book: 0,
  inaccuracy: 0, mistake: 0, miss: 0, blunder: 0,
};

/* Run the same fixed-depth NNUE review as Game Review, then project its verdict
   rows + per-side counts into the shape the Analysis Board consumes.

   Routed through getCanonicalAnalysis so this surface reuses an analysis the
   game already has instead of re-running the engine, and so its engine config
   is the canonical one by construction. `gameRef` ({ gameSource, gameId }) gives
   that analysis an identity; without one (a game still in progress, a one-off)
   the facade simply runs the pipeline uncached. */
export async function analyzeGame(initialFen, moves, {
  onProgress, isCancelled, gameRef = null, loadAnalysis = null, saveAnalysis = null,
} = {}) {
  const res = await getCanonicalAnalysis(
    { ...(gameRef || {}), initialFen, moves },
    { onProgress, isCancelled, loadAnalysis, saveAnalysis },
  );
  if (!res) return null;

  const capturedBy = new Map();
  try {
    const g = new Chess(initialFen === 'start' ? undefined : initialFen);
    for (const san of moves) {
      try { capturedBy.set(san, g.move(san).captured || null); } catch { break; }
    }
  } catch { /* best-effort: captured stays null if the replay fails */ }

  const verdicts = res.moves.map((row, i) => ({
    index: i,
    san: row.san,
    verdict: row.verdict,
    loss: row.loss == null ? 0 : Number((row.loss / 100).toFixed(2)),
    player: row.player,
    captured: capturedBy.get(row.san) ?? null,
    uci: row.uci,
    bestUci: row.bestUci || null,
  }));

  const counts = {
    white: { ...EMPTY_COUNTS, ...((res.white && res.white.counts) || {}) },
    black: { ...EMPTY_COUNTS, ...((res.black && res.black.counts) || {}) },
  };

  return { verdicts, counts };
}

export function accuracyFor(counts) {
  const c = counts || EMPTY_COUNTS;
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  if (!total) return 100;
  /* weighted scoring mirrors Game Review's per-move accuracy: brilliant/great/
     best/excellent/book = 100%, good = 85%, inaccuracy = 50%, miss/mistake =
     20%, blunder = 0% */
  const score =
    (c.brilliant || 0) * 1.0 + (c.great || 0) * 1.0 + (c.best || 0) * 1.0 +
    (c.excellent || 0) * 1.0 + (c.book || 0) * 1.0 + (c.good || 0) * 0.85 +
    (c.inaccuracy || 0) * 0.5 + (c.miss || 0) * 0.2 + (c.mistake || 0) * 0.2;
  return Math.round((score / total) * 100);
}

/*
 * Rule-based coach feedback for the post-game result popup.
 * `counts` is the side-by-side verdict count map (see analyzeGame); `mySide`
 * is 'white'|'black' — the player we are summarising. Returns a short,
 * human-readable summary sentence shown next to the coach avatar.
 */
export function buildCoachMessage({ won, drew, counts, mySide, reason }) {
  const c = (counts && counts[mySide]) || EMPTY_COUNTS;
  const great = (c.brilliant || 0) + (c.great || 0) + (c.best || 0);
  const good  = c.good || 0;
  const errors = (c.inaccuracy || 0) + (c.mistake || 0) + (c.blunder || 0);
  const blunders = c.blunder || 0;
  const total = great + good + errors;

  const byTimeout = /time/i.test(reason || '');
  const byMate = /checkmate/i.test(reason || '');

  if (won) {
    if (!total) return 'Victory secured — the position spoke for itself this game.';
    if (blunders === 0 && errors <= 1) {
      return great > 0
        ? 'A clinical win — you found the strong moves and never let the advantage slip.'
        : 'Controlled play from start to finish. Keep converting advantages exactly like this.';
    }
    return 'You fought through the tense moments and came out on top. Keep that composure.';
  }

  if (drew) {
    if (byTimeout) return 'It ended as a draw on time — clear your head and manage the clock next game.';
    if (blunders === 0) return 'A solid, balanced game. Look for the winning chances that were on the board.';
    return 'You held the draw, but a few slips let the win escape. Review those moves below.';
  }

  // loss
  if (byTimeout) return 'Tough beat on the clock — pace yourself early and bank time for the endgame.';
  if (byMate) {
    return blunders > 0
      ? 'One slip opened the door — see where the game turned so it does not happen again.'
      : 'You were outmanoeuvred this time. Solid effort, but the faster player deserved it today.';
  }
  return blunders > 0
    ? 'A couple of mistimed moves decided it. The analysis below shows exactly where.'
    : 'A well-fought game that slipped away — the analysis below shows the key moments.';
}
