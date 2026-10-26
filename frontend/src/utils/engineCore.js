/* Engine API factory — shared by the ANALYSIS engine (./engine.js, lite build)
   and the GAME REVIEW engine (./nnueEngine.js, full NNUE build). Both expose
   the exact same search/evaluate helpers; the only difference is which worker
   pool they are bound to.

   `timeMs` is OPTIONAL: omit it for a pure FIXED-DEPTH search (no movetime in
   the UCI go line) — use that for anything that must be run-to-run reproducible
   (e.g. the game-review pipeline). Pass `timeMs` only for time-driven UI analysis.
*/

import { Chess } from 'chess.js';

import { scoreFields } from './engineScore.js';

function fenOf(gameOrFen) {
  return typeof gameOrFen === 'string' ? gameOrFen : gameOrFen.fen();
}

/* terminal-position result from white's perspective (cp), for closed games */
function terminalScore(fen) {
  try {
    const g = new Chess(fen);
    if (g.isCheckmate()) return scoreFields({ type: 'mate', value: 0, winner: g.turn() === 'w' ? -1 : 1 });
    if (g.isStalemate() || g.isDraw() || g.isInsufficientMaterial()) return scoreFields(0);
  } catch { /* ignore malformed FEN */ }
  return null;
}

export function createEngine(sf) {
  /**
   * Find the best move for the position in `fen`. Returns null when the game
   * is over. `maxDepth` is the search depth limit, `timeMs` caps the search
   * time, and `skillLevel` (1-20) weakens Stockfish for a beatable opponent.
   */
  async function searchBest(fen, { maxDepth = 16, timeMs, skillLevel } = {}) {
    if (terminalScore(fen) !== null) return null;
    const res = await sf.search(fen, { depth: maxDepth, movetime: timeMs, skillLevel });
    if (!res || !res.uci) return null;
    const g = new Chess(fen);
    let mv = null;
    try {
      mv = g.move({ from: res.from, to: res.to, promotion: res.promotion });
    } catch { return null; }
    if (!mv) return null;
    return {
      from: mv.from,
      to: mv.to,
      promotion: mv.promotion || null,
      san: mv.san,
      uci: res.uci,
      ...scoreFields(res),
      pawns: scoreFields(res).score / 100,
      depth: res.depth,
    };
  }

  /**
   * Evaluate a position (Chess instance or FEN). Resolves to white-perspective
   * centipawn score expressed in pawns, matching the old `evaluateGame` shape.
   */
  async function evaluateGame(gameOrFen, { maxDepth = 16, timeMs } = {}) {
    const fen = fenOf(gameOrFen);
    const terminal = terminalScore(fen);
    if (terminal !== null) {
      return { ...terminal, pawns: terminal.score / 100, depth: 0 };
    }
    const res = await sf.search(fen, { depth: maxDepth, movetime: timeMs });
    return {
      ...scoreFields(res || 0),
      pawns: scoreFields(res || 0).score / 100,
      depth: res ? res.depth : 0,
    };
  }

  /**
   * MultiPV search: the top `multiPv` moves for the position in `fen`, ranked by
   * engine preference. Each entry is tagged with its SAN equivalent so callers
   * (e.g. the game-review classifier) can spot the played move among alternatives.
   * Scores are white-perspective centipawns (see buildResult in ./stockfish.js).
   * Resolves to [] for finished positions.
   *
   * `skillLevel` is optional and forwarded straight to the pool (which pins
   * UCI_LimitStrength=false + Skill Level per worker, and only re-pins when the
   * value changes). Omitting it leaves the worker at its previous level, which
   * is what the review pipeline wants. The Play-vs-Bots engine passes it because
   * a bot needs BOTH a weakened skill level AND a MultiPV candidate list — it
   * picks a personality-flavoured move from those candidates, so the top engine
   * move is not always the one played.
   */
  async function searchTopMoves(fen, { maxDepth = 18, timeMs, multiPv = 4, skillLevel } = {}) {
    if (terminalScore(fen) !== null) return [];
    const res = await sf.search(fen, { depth: maxDepth, movetime: timeMs, multiPvNum: multiPv, skillLevel });
    if (!res || !res.moves || !res.moves.length) return [];
    /* SAN is derived lazily. It costs a full `new Chess(fen)` + legal-move
       generation per line, and the review pipeline — the only hot caller —
       never reads it (it classifies off uci/from/to/score). Gating it behind a
       getter keeps the field, its value and its null-on-illegal behaviour
       exactly as before while skipping the work for callers that ignore it.
       `this` is the entry object, so `m.san` in a destructure or `.map` still
       resolves identically. */
    return res.moves.map((m) => {
      const entry = { ...m, ...scoreFields(m) };
      Object.defineProperty(entry, 'san', {
        enumerable: true,
        configurable: true,
        get() {
          let value = null;
          try {
            const g = new Chess(fen);
            const mv = g.move({ from: m.from, to: m.to, promotion: m.promotion });
            value = mv ? mv.san : null;
          } catch { value = null; }
          Object.defineProperty(entry, 'san', { value, enumerable: true, configurable: true });
          return value;
        },
        set(value) {
          Object.defineProperty(entry, 'san', { value, enumerable: true, configurable: true });
        },
      });
      return entry;
    });
  }

   /* Cancel the in-flight engine search (used by "Stop" buttons). */
  function stopEngineSearch() {
    sf.abortAll();
  }

  /* Pool health for the UI: lets a failed review name the engine (boot
     failure, blocked worker) instead of blaming the game. Pools without a
     status() (test doubles) report unknown rather than throwing. */
  function engineStatus() {
    try {
      if (typeof sf.status === 'function') return sf.status();
    } catch { /* fall through to unknown */ }
    return { state: 'unknown', readySlots: 0, totalSlots: 0, lastError: '' };
  }

  function resetEngine() {
    try {
      if (typeof sf.reset === 'function') sf.reset();
      else if (typeof sf.terminate === 'function') sf.terminate();
    } catch { /* best-effort */ }
  }

  return { searchBest, evaluateGame, searchTopMoves, stopEngineSearch, engineStatus, resetEngine };
}