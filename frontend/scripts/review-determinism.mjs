/* Review determinism validation — run the SAME game through reviewGame 5× and
   prove accuracy + per-move CPL + per-move badges are identical every run.

   The engine is FAKED with deterministic values that depend ONLY on the FEN
   (so every run sees identical evals), while the *response timing* is random
   (`setTimeout` jitter). If the pipeline had any time/async-ordering dependence
   (classification reading partial evals, rounding at different stages), the
   outputs would diverge across runs and this script would flag the exact diffs.

   Node:  node scripts/review-determinism.mjs   (run from frontend/)
*/

import { reviewGame } from '../src/utils/gameReview.js';
import { REVIEW_DISPATCH_WIDTH } from '../src/utils/engineConfig.js';
import {
  REVIEW_DEPTH,
  REVIEW_MULTIPV,
} from '../src/utils/reviewConfig.js';
import { sacrificeCandidate } from '../src/utils/reviewClassify.js';
import {
  BRILLIANT_NEAR_BEST_CPL,
  BRILLIANT_EVAL_MIN,
  BRILLIANT_EVAL_MAX,
  FORCED_SECOND_LOSS_CP,
} from '../src/utils/reviewConfig.js';
import { Chess } from 'chess.js';

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* Build a LEGAL game by replaying through chess.js — the piece choice is a
   pure function of the FEN, so the same game is generated every run. The
   selection hash intentionally differs from the fake engine's eval hash, so
   the played move lands in different verdict bands (best / inaccuracy / etc.). */
function generateGame(plies) {
  const g = new Chess();
  const san = [];
  for (let n = 0; n < plies; n++) {
    const opts = g.moves({ verbose: true });
    if (!opts.length) break;
    let best = opts[0];
    let bestH = Infinity;
    for (const mv of opts) {
      const h = hashStr(`${g.fen()}|play|${mv.from + mv.to + (mv.promotion || '')}`);
      if (h < bestH) { bestH = h; best = mv; }
    }
    g.move(best); san.push(best.san);
  }
  return san;
}

/* ── fake engine: values are pure functions of the position — identical every run ── */
let inFlight = 0;
let maxInflight = 0;
let callLog = [];

function delayJitter() {
  return new Promise((r) => setTimeout(r, 3 + (Math.random() * 12) | 0));
}

function legalTopMoves(fen, maxDepth, multiPv) {
  const g = new Chess(fen);
  const scored = g.moves({ verbose: true }).map((mv) => {
    const uci = mv.from + mv.to + (mv.promotion || '');
    const h = hashStr(fen + '|eval|' + uci);
    const score = (h % 251) - 125; // stable −125..125 white-persp cp
    return { uci, san: mv.san, score, mate: null, depth: maxDepth, pv: [uci] };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, multiPv || 4));
}

const fakeEngine = {
  searchTopMoves: async (fen, { maxDepth = REVIEW_DEPTH, multiPv = REVIEW_MULTIPV } = {}) => {
    inFlight++; maxInflight = Math.max(maxInflight, inFlight);
    await delayJitter();
    const moves = legalTopMoves(fen, maxDepth, multiPv)
      .map((m, i) => ({ ...m, rank: i + 1 }));
    inFlight--; callLog.push({ type: 'tops', fen });
    return moves;
  },
  evaluateGame: async (fen, { maxDepth = REVIEW_DEPTH } = {}) => {
    inFlight++; maxInflight = Math.max(maxInflight, inFlight);
    await delayJitter();
    const h = hashStr(fen + ':eval');
    inFlight--; callLog.push({ type: 'eval', fen });
    return { pawns: ((h % 401) - 200) / 100, score: (h % 401) - 200, mate: null, depth: maxDepth };
  },
};

function snapshot(res) {
  return {
    opening: res.opening,
    white: res.white,
    black: res.black,
    moves: res.moves.map((m) => [
      m.san, m.verdict, m.cpl, m.loss, m.acc, m.wpd, m.best, m.played, m.depth, m.bestUci, m.bookLine ?? null,
    ]),
  };
}

function diffPath(a, b, base = '') {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return `${base}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = diffPath(a[k], b[k], base ? `${base}.${k}` : k);
    if (d) return d;
  }
  return null;
}

const moves = generateGame(34);
console.log(`Game: ${moves.length} plies — analyzing 5× …\n`);

const runs = [];
for (let n = 1; n <= 5; n++) {
  callLog = [];
  inFlight = 0; maxInflight = 0;
  const t0 = Date.now();
  const res = await reviewGame('start', moves, { engine: fakeEngine, bookLookup: async () => null });
  const dt = Date.now() - t0;
  runs.push({ snap: snapshot(res), log: callLog, maxInflight, ms: dt });
  console.log(`  run ${n}: ${dt}ms  white ${res.white.accuracy}%  black ${res.black.accuracy}%  rows ${res.total}`);
}

let fail = 0;
for (let n = 1; n < runs.length; n++) {
  const d = diffPath(runs[0].snap, runs[n].snap);
  if (d) { fail++; console.log(`\nMISMATCH run 1 vs run ${n + 1} at ${d}`); }
}

/* Concurrency is bounded by the dispatch width, which is intentionally WIDER
   than the worker pool so a ply waiting on its 2nd/3rd search doesn't hold a
   slot and starve the pool (see REVIEW_DISPATCH_WIDTH in engineConfig.js).
   What must hold: never more than the width, and enough plies in flight to
   keep a pool that size busy. */
const maxIn = Math.max(...runs.map((r) => r.maxInflight));
console.log(`\nmax concurrent engine searches observed: ${maxIn} (dispatch width=${REVIEW_DISPATCH_WIDTH})`);
if (maxIn > REVIEW_DISPATCH_WIDTH) {
  fail++; console.log(`dispatch width ${REVIEW_DISPATCH_WIDTH} exceeded: saw ${maxIn}`);
}
if (maxIn < Math.min(REVIEW_DISPATCH_WIDTH, moves.length)) {
  fail++;
  console.log(`expected up to ${Math.min(REVIEW_DISPATCH_WIDTH, moves.length)} concurrent searches (plies in flight), saw ${maxIn} — the pool would be under-fed`);
}

/* coverage: every ply triggers one top-moves search, plus the warm-up search
   reviewGame always fires once against the start position (depth 4), plus one
   settle search PER REAL BRILLIANT CANDIDATE (the Brilliant-2b net-trade guard
   re-searches the played position). Re-derive the candidate count determin-
   istically with the SAME mock scoring + sacrificeCandidate so the exact
   count stays meaningful — this MUST mirror gameReview's inputs exactly,
   including the played-move eval FALLBACK (a move not in the MultiPV list is
   graded via evaluateGame(fenAfter), score function `(hash(fen+':eval')%401)-200`
   — NOT via legalTopMoves). */
function mockEvalScore(fen) {
  return (hashStr(fen + ':eval') % 401) - 200;
}

function expectedSettleSearches(moves) {
  const g = new Chess();
  let prev = null, n = 0;
  for (const san of moves) {
    const legalCount = g.moves().length;
    const fenBefore = g.fen();
    const mover = g.turn();
    const mv = g.move(san);
    const uci = mv.from + mv.to + (mv.promotion || '');
    const fenAfter = g.fen();
    const tops = legalTopMoves(fenBefore, REVIEW_DEPTH, REVIEW_MULTIPV).map((m, i) => ({ ...m, rank: i + 1 }));
    const p = mover === 'w' ? 1 : -1;
    const bestM = tops[0] && tops[0].score != null ? p * tops[0].score : null;
    const found = tops.find((t) => t.uci === uci);
    const playedM = found
      ? p * found.score
      : p * mockEvalScore(fenAfter); // mirror gameReview's evaluateGame fallback
    {
      const cpl = Math.round(Math.max(0, bestM - playedM));
      const inWin = bestM > BRILLIANT_EVAL_MIN && bestM < BRILLIANT_EVAL_MAX;
      if (inWin && legalCount > 1) {
        let sacrifice = false;
        try { sacrifice = sacrificeCandidate(fenBefore, mv, prev); } catch { sacrifice = false; }
        if (sacrifice) n++; // the settle search fires for every genuine sacrifice candidate
      }
    }
    prev = mv;
  }
  return n;
}

const expectedTops = moves.length + 1 + expectedSettleSearches(moves);
for (const [n, run] of runs.entries()) {
  const topsCn = run.log.filter((c) => c.type === 'tops').length;
  if (topsCn !== expectedTops) {
    fail++;
    console.log(`run ${n + 1}: expected ${expectedTops} tops searches (${moves.length} plies + 1 warm-up), saw ${topsCn}`);
  }
}

console.log(`\nrun-to-run comparisons: ${fail === 0 ? 'ALL 5 IDENTICAL' : fail + ' MISMATCHES'}`);
process.exit(fail ? 1 : 0);