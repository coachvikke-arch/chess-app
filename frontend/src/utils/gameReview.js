import { perspectiveScore, comparableScore } from './engineScore.js';
import { hasSettledSacrifice } from './reviewClassify.js';

/* Game Review — move-by-move engine classification and accuracy model.
   A position before each move is searched once with MultiPV, then the played
   move's evaluation is taken from that same search when it appears in the PV
   list (avoiding a second search); otherwise a follow-up evaluation of the
   resulting position is used.

   Classification is deterministic and win%-drop based — see ./reviewConfig.js
   for every threshold and ./reviewClassify.js for the pure verdict decision.
   Each move scores CPL (evaluation loss vs the engine best) and winPctDrop
   (win percent lost vs the engine best); the winPctDrop drives the verdict,
   and the badge shown is exactly the verdict the accuracy penalty uses.
   Verdicts are rendered with a 10-tier scale (labels live in REVIEW_META;
   keys below stay internal):

 Brilliant   played == engine best or near-best (cpl ≤ 10) + genuine sacrifice
                  of a minor piece or greater (pawn sacs never count), that
                  survives the forced exchange, eval window −600..600 → "!!"
        Great Move played best or near-best, runner-up ≥ GREAT_MIN_GAP_CP worse in a
                  non-opening position, position wasn't lost and (optionally)
                  tactically dense (not quiet) → "!"
Best      played == engine best, CPL ≤ 0 → "★" (a FORCED best move — single
                  legal move, or every alternative ≥ FORCED_SECOND_LOSS_CP
                  worse — is Best too: it is no sacrifice, and Great requires
                  not-forced)
        Miss      a forced win/mate was on the board but the player let it
                  slip (≥ MISS_MIN_LOSS_CP from a winning position) → "✕"
        Nice      winPctDrop ≤ 2 → "✓"
        Ok        winPctDrop ≤ 5
        Theoretical inside the opening book (./openings.js — live Lichess
                  Explorer lookup gated by game frequency, offline book as
                  fallback), applied only through the first BOOK_MAX_MOVE_NUMBER
                  fullmoves; overrides other verdicts except Mistake/Blunder —
                  a theory move that loses material is still flagged.
        Strange   winPctDrop ≤ 10 → "?!"
        Bad       winPctDrop ≤ 20 → "?"
        Clown     winPctDrop > 20, or the move hands the opponent a forced mate → "??"

   Tie-breaking: classification is driven by winPctDrop (the win percent lost
   vs the engine's best) — rules are checked top-to-bottom, first match wins.
   Brilliant follows its five-condition spec (window −600..600, a genuine
   sacrifice that survives the forced exchange, a safe alternative); Great
   still needs the position not already lost (eval_before ≤ −300cp).

   Accuracy model (chess.com-compatible, win%-drop based):
     Each classified move scores a single win%-based quality
        acc(i) = ACC_MAX · e^(−ACC_DECAY · winPctDrop) − ACC_FLOOR
     (perfect verdicts sit at 100 because their winPctDrop is 0). The game
     accuracy is the plain mean of those per-move qualities (chess.com's
     CAPS headline — no volatility re-weighting): blunders pull the headline
     down by their own per-move score, so a game with several blunders lands
     well below 90%. Book moves are engine theory and count the full 100 (like
     chess.com's "book is always best"); rows without engine data are excluded;
     the "avg CPL" and "avg WPD" lines report the plain unweighted averages.
     Because the score consumes the identical winPctDrop that produced each
     badge, accuracy and the classification counts can never contradict.
*/

import { Chess } from 'chess.js';
import { searchTopMoves as realSearchTopMoves, evaluateGame as realEvaluateGame } from './nnueEngine.js';
import { REVIEW_DISPATCH_WIDTH } from './engineConfig.js';
import { resolveBookMove, openingTag } from './openings.js';
import { classifyMove, moveMetrics, sacrificeCandidate, protectedSacrificeGeometry, protectedSacrificeValidated, acceptCaptureUcis, settledNetSacrifice, isQuietPosition, moveAccuracy, winPercentDrop, withTrustFloor, sacrificeAttribution, betterNonSacrificialLine, attackingSacrifice } from './reviewClassify.js';
import { classifySigmaFromPly, SIGMA_TYPE_META, SIGMA_TYPES_IN_PRIORITY_ORDER, SIGMA_VERDICT, isSigmaVerdict } from './sigmaType.js';
import { aggregateSide } from './reviewAccuracy.js';
import {
  REVIEW_DEPTH,
  REVIEW_DEPTH_DEEP,
  REVIEW_MULTIPV,
  REVIEW_MIN_TRUST_DEPTH,
  FORCED_SECOND_LOSS_CP,
  GREAT_MIN_GAP_CP,
  GREAT_NEEDS_SHARP_POSITION,
  BRILLIANT_NEAR_BEST_CPL,
  BRILLIANT_EVAL_MIN,
  BRILLIANT_EVAL_MAX,
  BRILLIANT_SETTLED_MAX_PLIES,
  SAFE_ALT_EVAL_CP,
  ACCURACY_CPL_CAP,
  REVIEW_SCAN_DEPTH,
  REVIEW_SCAN_MULTIPV,
  REVIEW_SCAN_ENABLED,
  REVIEW_ENGINE_VERSION,
  REVIEW_CRITICAL_CPL,
  REVIEW_CRITICAL_BAND_CP,
} from './reviewConfig.js';
import { createReviewCache } from './reviewCache.js';
import { needsDeepReview, isMateish } from './reviewScan.js';

/* --------------------------- verdict presentation --------------------------- */

/* Exported so the Review page can render the five Sigma type chips in a fixed
   order without importing sigmaType.js directly. */
export { SIGMA_TYPES_IN_PRIORITY_ORDER };

/* Badge palette — calm cool tones (Brilliant/Great/Best) → warm intense tones
   (Strange → Bad → Miss → Clown). Each entry carries the coin-icon gradient stops:
     color  — base fill (also the board-square tint)
     deep   — darker same-hue ring/emboss (bottom-right gradient stop)
     light  — specular highlight (top-left gradient stop)
     glow   — premium halo (Brilliant only)
   Miss (missed a forced win/mate, "✕") is magenta; Bad (mistake, "?") is
   vermilion-orange while Clown (blunder, "??") is crimson-red so the three
   stay distinct at small sizes. */
/* THE SIGMA ENTRY, DEFINED ONCE.
   The classification layer calls the verdict 'sigma' (see ./sigmaType.js) while
   the review rows written before that rename — and still sitting in saved
   sessions — call it 'brilliant'. Both are the same tier, so both keys point at
   ONE object rather than at two copies of the same colours: there is no second
   description to edit, so the two spellings cannot drift apart.

   `label` is what the player reads, and it says Brilliant. 'sigma' is an internal
   classification id and must never reach the screen — see ./sigmaType.js. */
const SIGMA_META = { label: 'Brilliant', glyph: '!!', icon: '🪄', tone: 'spark', color: '#19c9c3', deep: '#0a807d', light: '#59e8df', glow: true };

export const REVIEW_META = {
  [SIGMA_VERDICT]: SIGMA_META,
  brilliant: SIGMA_META,
  great: { label: 'Great Move', glyph: '!', icon: '👍', tone: 'highlight', color: '#3d7ff5', deep: '#1e4fb8', light: '#7fb2ff' },
  best: { label: 'Best', glyph: '★', icon: '★', tone: 'praise', color: '#0fa968', deep: '#0a7b4e', light: '#4fd298' },
  excellent: { label: 'Nice', glyph: '✓', icon: '✓', tone: 'praise', color: '#7bb51f', deep: '#57851a', light: '#a8de4e' },
   good: { label: 'Ok', glyph: '·', icon: '·', tone: 'muted', color: '#73809a', deep: '#515c73', light: '#9aa6bd' },
   book: { label: 'Theoretical', glyph: '☰', icon: '📖', tone: 'neutral', color: '#0369a1', deep: '#7a5f20', light: '#d0aa50' },
  inaccuracy: { label: 'Strange', glyph: '?!', icon: '?!', tone: 'warn', color: '#e89618', deep: '#b1700e', light: '#f6bd4e' },
  mistake: { label: 'Bad', glyph: '?', icon: '?', tone: 'warn', color: '#e8502c', deep: '#b13a20', light: '#f5815a' },
  miss: { label: 'Miss', glyph: '✕', icon: '✕', tone: 'warn', color: '#c241e0', deep: '#8d1bb0', light: '#e681fa' },
  blunder: { label: 'Clown', glyph: '??', icon: '💥', tone: 'severe', color: '#d41826', deep: '#a3101d', light: '#ef4053' },
};

/* exact row order used by the summary table.
   'brilliant' only, on purpose: the two Sigma spellings are ONE tier, so
   listing both would print the same badge twice with the count split in half. */
export const REVIEW_ORDER = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
];

/**
 * REVIEW_META lookup that understands BOTH Sigma spellings.
 *
 * `REVIEW_META[verdict]` returns undefined for 'sigma' on its own, and a
 * missing entry is not an error — it is a silently absent badge, an absent
 * board tint and an absent summary row, which is precisely how a brilliant move
 * came to look like no verdict at all. Going through one function means no
 * caller can forget the alias.
 *
 * Returns null (not undefined) for an unknown verdict, so `?.` chains and
 * falsy checks behave the same as they did before.
 */
export function reviewMetaFor(verdict) {
  if (!verdict) return null;
  return REVIEW_META[verdict] || (isSigmaVerdict(verdict) ? REVIEW_META[SIGMA_VERDICT] : null);
}

/**
 * One side's per-verdict tally with the Sigma bucket folded onto 'brilliant'.
 *
 * aggregateSide() already writes the canonical key, so this only matters for a
 * review restored from a session saved before that fix — its counts.sigma would
 * otherwise be an orphan key and the summary would report 0 brilliant moves for
 * a game that plainly has one.
 *
 * Returns null when there is no tally, matching reviewMetaFor.
 */
export function reviewCounts(counts) {
  if (!counts || typeof counts !== 'object') return null;
  if (!counts[SIGMA_VERDICT]) return counts;
  const out = { ...counts, brilliant: (counts.brilliant || 0) + counts[SIGMA_VERDICT] };
  /* Drop the orphan key rather than leaving it: anything that sums every value
     in the tally (accuracyFor, the backend's headline) would otherwise count the
     same move twice. */
  delete out[SIGMA_VERDICT];
  return out;
}

/* -------------------------------- helpers ---------------------------------- */

const empties = () => Object.fromEntries(REVIEW_ORDER.map((v) => [v, 0]));

/* rough game-phase heuristic — kept for the plies record, no longer feeds
     the verdict (Great no longer needs a non-opening critical position). */
function gamePhase(fen, ply) {
  if (ply <= 8) return 'opening';
  const board = fen.split(' ')[0];
  const heavy = (board.match(/[NBRQnbrq]/g) || []).length;
  const queens = (board.match(/[Qq]/g) || []).length;
  if (queens === 0 && heavy <= 6) return 'endgame';
  return 'middlegame';
}

/* Bounded-concurrency map: run `fn` over `items` with at most `limit`
   invocations in flight, preserving input order in the returned array. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit || 1, items.length)) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Classify every move of a game played from `initialFen` (default start).
 * Moves may be SAN or UCI. Each move is evaluated under the hood via the
 * full-NNUE Stockfish worker pool (see ./nnueEngine.js + ./engineConfig.js).
 * `onProgress(done, total)` is called after each move; returning true from
 * `isCancelled()` aborts with a null result. `engineOverrides`:
 * { depth, multiPv, deep } search tuning — `deep: true` selects
 * REVIEW_DEPTH_DEEP, otherwise the default depth comes from reviewConfig.js
 * (REVIEW_DEPTH). `bookLookup` (optional) replaces the opening-book resolver
 * (see ./openings.js resolveBookMove) — used by the determinism harness and
 * offline test runs.
 *
 * DETERMINISM: this pipeline is purely FIXED-DEPTH — every position is
 * searched to exactly `depth` plies (never a per-move "think for X ms",
 * never a wall-clock budget), and the worker pins its fixed threads/Hash /
 * skill, same evals → same verdicts → same accuracy. Time-based analysis has
 * no place here: whatever time a fixed-depth search needs is fine.
 * @param {object} [engine] optional { searchTopMoves, evaluateGame } replacement for tests.
 */
export async function reviewGame(
  initialFen,
  moveList,
  { onProgress = () => {}, isCancelled = () => false, engineOverrides = {}, engine, bookLookup } = {},
) {
  const depth = engineOverrides.depth ?? (engineOverrides.deep ? REVIEW_DEPTH_DEEP : REVIEW_DEPTH);
  const multiPv = engineOverrides.multiPv ?? REVIEW_MULTIPV;
  /* The deep-search trigger is a runtime knob rather than a hard-coded
     constant so scripts/review-bench.mjs can sweep it and measure the real
     speed/accuracy trade at each level, instead of the bar being argued about
     in the abstract. Production always uses the reviewConfig default. */
  const criticalCpl = engineOverrides.criticalCpl ?? REVIEW_CRITICAL_CPL;
  const criticalBandCp = engineOverrides.criticalBandCp ?? REVIEW_CRITICAL_BAND_CP;
  /* Resolve the engine implementation ONCE, up front.
     These deliberately do NOT reuse the imported `realSearchTopMoves` /
     `realEvaluateGame` names as locals: a `const realSearchTopMoves = ... ? ... : realSearchTopMoves`
     shadows the module-scope import for the WHOLE function body — including its
     own initializer — so the fallback branch hit a temporal dead zone and threw
     "Cannot access 'realSearchTopMoves' before initialization". The browser
     callers (reviewRunner / ChessProfile / gameAnalysis) pass no `engine`, so
     that fallback is the ONLY branch production ever takes; every Node test
     passes a stub `engine` and took the other branch, which is why this stayed
     hidden. The locals are now distinctly named. */
  const searchImpl = (engine && engine.searchTopMoves) || realSearchTopMoves;
  const evaluateImpl = (engine && engine.evaluateGame) || realEvaluateGame;

/* Every engine call in the review goes through the position cache, so a re-run
   of the same game costs no engine time and two plies that ask for the same
   position share one search. See ./reviewCache.js for why this cannot change a
   verdict. Tests pass a stub `engine`, which is cached the same way. */
const cache = createReviewCache({ version: REVIEW_ENGINE_VERSION });
const searchTopMoves = (fen, opts = {}) =>
  cache.wrap(fen, opts.maxDepth ?? REVIEW_DEPTH, opts.multiPv ?? 1, () => searchImpl(fen, opts));
/* evaluateGame is a MultiPV-1 search by definition, so it shares a cache slot
   with a MultiPV-1 searchTopMoves of the same position and depth. */
const evaluateGame = (fen, opts = {}) =>
  cache.wrap(fen, opts.maxDepth ?? REVIEW_DEPTH, 1, () => evaluateImpl(fen, opts));

const PIECE_VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  const bookResolver = typeof bookLookup === 'function'
    ? bookLookup
    : (pl) => resolveBookMove({ fenBefore: pl.fenBefore, historySan: pl.historySan, san: pl.san });

  const g = (() => {
    /* A corrupt saved session or custom FEN can reach here — fail fast with an
       actionable message instead of dying mid-pipeline inside the engine. */
    try {
      return new Chess(initialFen && initialFen !== 'start' ? initialFen : undefined);
    } catch {
      throw new Error('Invalid starting position — the FEN could not be read. Paste a fresh PGN or reset the board. ');
    }
  })();
  const historySan = [];
  const results = [];
  const total = moveList.length;
  let prevMv = null;

  /* Warm up the engine (boots/compiles the wasm once) so the first real
     search starts against a ready worker. Fixed depth — its own result is
     discarded. */
  try {
    await searchTopMoves(g.fen(), { maxDepth: 4, multiPv: 1 });
  } catch { /* warm-up is best-effort — the review will still run */ }

  // pass 1 — replay the game (pure chess.js, no engine) and capture each
  // ply's context: FEN before/after, mover, phase, legality, prior history.
  // Book lines are resolved in a separate async step right after (they may
  // hit the Lichess Explorer API), so replay stays free of I/O.
  const plies = [];
  let parseFailures = 0;
  for (let i = 0; i < total; i++) {
    if (isCancelled()) return null;

    let fenBefore = null;
    try {
      fenBefore = g.fen();
    } catch {
      parseFailures += 1;
      break; // board state unreadable — stop cleanly, report below
    }
    const mover = g.turn();
    const phase = gamePhase(fenBefore, i);
    let legalCount = 0;
    try {
      legalCount = g.moves().length; // legal moves BEFORE this move
    } catch {
      parseFailures += 1;
      break;
    }
    let mv = null;
    try {
      mv = g.move(moveList[i]);
    } catch {
      parseFailures += 1;
      break; // stop on the first illegal move / game over
    }
    if (!mv) {
      parseFailures += 1;
      break; // chess.js refused the move without throwing — same stop rule
    }
    const prev = prevMv;
    prevMv = mv;
    const historySanBefore = historySan.slice();
    historySan.push(mv.san);
    const uci = mv.from + mv.to + (mv.promotion || '');
    let fenAfter = null;
    try {
      fenAfter = g.fen();
    } catch {
      parseFailures += 1;
      break; // position after this move is unreadable — stop, keep this ply out
    }
    plies.push({
      ply: i, player: mover, san: mv.san, uci,
      fenBefore, fenAfter,
      phase, legalCount, mv, prev,
      historySan: historySanBefore,
    });
  }

  /* Nothing replayable: every input move was illegal (or the board was already
     over). That used to fall through to the engine with zero plies and surface
     as the generic "engine hit a problem" — report the real cause instead. */
  if (plies.length === 0) {
    throw new Error(
      parseFailures > 0
        ? `No legal moves found — the pasted game stopped at move 1. Check the PGN or FEN and try again. `
        : 'No moves to review — paste a game first. '
    );
  }

  // pass 1b — resolve each move's opening-book status (Explorer lookup, gated
  // by game frequency, falling back to the curated local book). Resolved in
  // parallel so a whole game costs ~one request per distinct position.
  await Promise.all(plies.map(async (pl) => {
    if (isCancelled()) return;
    let line = null;
    try { line = await bookResolver(pl); } catch { line = null; }
    pl.isBook = Boolean(line);
    pl.bookLine = line && line.name ? line.name : undefined;
    // Book moves only need a light search: we still grade them so a theory
    // deviation that loses material stays flagged, but a full-deep search
    // here would take time on moves that are almost always theory-sound.
    // Book rows keep a fixed (lighter) depth too — reproducibility only
    // requires the depth be CONSTANT, not maximal.
    pl.maxDepth = pl.isBook ? Math.min(depth, 12) : depth;
  }));

  // pass 2 — engine analysis with bounded concurrency (no window barriers).
  // Every ply's FIXED-DEPTH searches are fully independent of every other, so
  // all of them are dispatched through a width-limited driver with no
  // per-window barrier (a barrier used to idle workers whenever one ply in a
  // batch ran long).
  //
  // The width is REVIEW_DISPATCH_WIDTH (> the worker pool) rather than the pool
  // size: a single ply runs 1-3 searches SEQUENTIALLY, so a ply parked on its
  // 2nd search used to hold one of the N driver slots while the other workers
  // sat idle. The extra in-flight plies just queue inside the pool, which is
  // where waiting belongs — the pool still runs exactly N searches at a time,
  // so this cannot change how much work happens, only when it is picked up.
  // Each row is assembled the instant its own searches finish (progress still
  // counts completed plies), and the completed array is SORTED back into game
  // order (by move index) before being stored/reported. The searches themselves
  // are unchanged — same fixed depth + options wherever a position lands — so
  // verdicts, CPL, scores and accuracy stay byte-for-byte identical; only
  // wall-clock improves.
  let done = 0;
  const onRowDone = (row) => { if (row) { done += 1; onProgress(done, total); } };

  /* Section-23 style instrumentation. Collected unconditionally (it is a handful
     of integer increments) but only PRINTED under import.meta.env.DEV, so a
     normal user never sees it. `perf` is also handed to the caller on the result
     so the numbers can be asserted in tests instead of eyeballed. */
  const perf = {
    plies: total,
    scanOnly: 0,
    deepPlies: 0,
    deepSearches: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheCoalesced: 0,
    deepReasons: {},
    startedAt: Date.now(),
    elapsedMs: 0,
  };

  const rows = await mapLimit(plies, REVIEW_DISPATCH_WIDTH, async (pl) => {
    /* One bad ply (corrupt FEN, engine hiccup on a single position) must never
       sink the whole review — the stages below already fall back to a neutral
       row per position. This outer guard covers the pure-JS assembly between
       them, which used to throw straight out of mapLimit and surface as the
       generic "engine hit a problem". */
    try {
    if (isCancelled()) return null;

    /* ── STAGE 1 — cheap scan of EVERY position ────────────────────────────
       The deep search is ~99% of a review's cost, so the only lever that moves
       the wall clock is how many positions get one. Stage 1 gives every ply a
       cheap fixed-depth answer and then asks whether that answer could be wrong
       (./reviewScan.js). */
    let tops = null;
    let playedWhite = null;
    let playedEvaluation = null;
    let playedDepth = 0;
    let deepSearches = 0;
    let scanOnly = false;

    if (REVIEW_SCAN_ENABLED) {
      const scanTops = await searchTopMoves(pl.fenBefore, {
        maxDepth: REVIEW_SCAN_DEPTH, multiPv: REVIEW_SCAN_MULTIPV,
      }).catch(() => null);

      if (scanTops && scanTops.length) {
        const scanFound = scanTops.find((t) => t.uci === pl.uci);
        const scanEv = scanFound ? null
          : await evaluateGame(pl.fenAfter, { maxDepth: REVIEW_SCAN_DEPTH }).catch(() => null);
        const scanPlayed = scanFound ? scanFound.score : (scanEv ? scanEv.score : null);

        const sp = pl.player === 'w' ? 1 : -1;
        const scanBestWhite = scanTops[0] && scanTops[0].score != null ? scanTops[0].score : null;
        const scanBestM = perspectiveScore(scanTops[0], sp);
        const scanPlayedM = perspectiveScore(scanFound || scanEv, sp);
        const scanCpl = moveMetrics(scanBestM, scanPlayedM).cpl;

        const decision = needsDeepReview({
          cpl: scanCpl,
          playedM: scanPlayedM,
          bestM: scanBestM,
          criticalCpl,
          criticalBandCp,
        });
        perf.scanOnly += decision.deep ? 0 : 1;
        perf.deepReasons[decision.reason] = (perf.deepReasons[decision.reason] || 0) + 1;

        if (!decision.deep) {
          /* Stable under the safe band: this ply is done. The row keeps the
             scan's 3-line set, so the review's arrows still render. */
          tops = scanTops;
          playedWhite = scanPlayed;
          playedEvaluation = scanFound || scanEv;
          playedDepth = scanFound ? (scanFound.depth || 0) : (scanEv ? scanEv.depth || 0 : 0);
          scanOnly = true;
        }
      }
    }

    /* ── STAGE 2 — full-depth search, only where stage 1 was inconclusive ── */
    if (!scanOnly) {
      const deepTops = await searchTopMoves(pl.fenBefore, { maxDepth: pl.maxDepth, multiPv })
        .catch((err) => {
          console.error('engine failed on move', pl.ply + 1, pl.san, err);
          return null;
        });
      deepSearches += 1;

      // one stubborn position must not sink the whole review — fall back to a
      // plain neutral row (book stays "book") and carry on with the next move.
      if (!deepTops) {
        const neutral = {
          ply: pl.ply, player: pl.player, san: pl.san, uci: pl.uci,
          verdict: pl.isBook ? 'book' : 'good', cpl: 0, loss: null, best: null, played: null, wpd: null, depth: 0,
          bookLine: pl.bookLine,
          lines: [],
        };
        onRowDone(neutral);
        return neutral;
      }

      const deepFound = deepTops.find((t) => t.uci === pl.uci);
      // played move not in the top list — evaluate its position at the same
      // fixed depth (deterministic, same result every run). Skipped when the
      // tops search failed (that eval was previously dispatched then discarded
      // by the neutral-row fallback — a wasted expensive search).
      const deepEv = deepFound ? null : await evaluateGame(pl.fenAfter, { maxDepth: pl.maxDepth })
        .catch((err) => {
          console.error('engine failed on move', pl.ply + 1, pl.san, err);
          return null;
        });

      tops = deepTops;
      playedWhite = deepFound ? deepFound.score : (deepEv ? deepEv.score : null);
      playedEvaluation = deepFound || deepEv;
      playedDepth = deepFound ? (deepFound.depth || 0) : (deepEv ? deepEv.depth || 0 : 0);
    }

    const seenDepth = Math.max(...tops.map((t) => t.depth || 0), 0);
    const bestWhite = tops[0] && tops[0].score != null ? tops[0].score : null;
    const secondWhite = tops[1] ? tops[1].score : null;
    const found = tops.find((t) => t.uci === pl.uci);

    const p = pl.player === 'w' ? 1 : -1;
    const bestScore = perspectiveScore(tops[0], p);
    const playedScore = perspectiveScore(playedEvaluation, p);
    const bestM = comparableScore(bestScore);
    const playedM = comparableScore(playedScore);
    const secondM = comparableScore(perspectiveScore(tops[1], p));

    const isBestMove = Boolean(found && found.rank === 1);
    const isForced = pl.legalCount === 1
      || (bestM != null && secondM != null && bestM - secondM >= FORCED_SECOND_LOSS_CP);
    const { cpl, swing } = moveMetrics(bestScore, playedScore);
    const wpd = bestM != null && playedM != null ? winPercentDrop(bestM, playedM) : null;

    /* ── Brilliant inputs (six-gate spec) ────────────────────────────────
       LEG 1 near-best cpl ≤ BRILLIANT_NEAR_BEST_CPL (10cp) — best or
                       rank-2-by-noise (chess.com: "best or near-best").
       LEG 2 grand sacrifice: played may miss near-best by up to
                       BRILLIANT_SAC_CPL_MAX when it still decisively WINS the
                       position (playedM ≥ BRILLIANT_PLAYED_WIN_CP) — a real
                       big-piece sac in a winning direction, e.g. 9.Qxf6!!.
       5 sane window −600 < evalBefore < 600.
       Sacrifice is pure geometry (sacrificeCandidate) and the safe-alt check
       reuses the MultiPV search. The 2b net-trade guard (does the sacrifice
       SURVIVE the forced exchange sequence?) needs the engine's best
       continuation from the played position, so strong candidates get ONE
       extra fixed-depth multiPv-1 search — still fully deterministic. */
    const nearBest = bestM != null && playedM != null && cpl <= BRILLIANT_NEAR_BEST_CPL;
    const notDeadLost = bestM != null && bestM > BRILLIANT_EVAL_MIN;
    const inBrilliantWindow = bestM != null && bestM > BRILLIANT_EVAL_MIN && bestM < BRILLIANT_EVAL_MAX;

    /* sacrifice geometry is pure board logic (no engine call) — computed for any
       non-lost position so a forced-mate major-piece sac (Rxg6+ / Rxg5+ leading
       to mate) can still register as a sacrifice even when the position already
       shows a mate score (out of the ±600 Brilliant window). */
    let sacrifice = false;
    if (notDeadLost && pl.legalCount > 1) {
      try { sacrifice = sacrificeCandidate(pl.fenBefore, pl.mv, pl.prev); } catch { sacrifice = false; }
    }

    /* 4 not forced — a SAFE alternative: another MultiPV line whose eval
       (mover perspective) stays above SAFE_ALT_EVAL_CP.
       Note: hasSafeAlternative is kept for Great's check but is NO LONGER
       required for Brilliant — forced sacrifices (e.g. Rxg6+ leading to mate)
       ARE brilliant on chess.com even when there's no safe alternative. */
    let hasSafeAlternative = false;
    {
      const altWhite = tops
        .filter((t) => t.uci !== pl.uci && t.score != null)
        .find((t) => (pl.player === 'w' ? t.score : -t.score) > SAFE_ALT_EVAL_CP);
      hasSafeAlternative = Boolean(altWhite);
    }

    /* 2b net-trade guard — settle the full forced capture/check continuation
       against the engine's best line AFTER the played move. The "sacrifice"
       is a real one when the opponent never actually takes the offered piece
       (a poisoned/declined invitation, e.g. 19.Bxd5) OR the mover keeps
       PRESSING with a follow-up capture/check in the forced line (settled.pressed
       — a classical Bxh7+ Kxh7 Ng5+ or Nxh7 … Bxh6 whose compensation is an
       ongoing attack survives Brilliant even when the raw material refunds to
       equal-or-better). Only a QUIET trade — the offer taken and no pressing
       follow-up — is stripped. Only runs for real Brilliant candidates
       (extra multiPv-1 search). */
    let hasNetSacrifice = true;
    let settled = null;
    /* Protected-shape offer (path C): a defended tactical sacrifice spends
       material exactly like a loose one, but the loose geometry rejects it
       (ourDef ≥ moved). The declined-line walk below can never fire for such
       an offer — a defended piece the opponent ignores is no sacrifice — so
       run the ACCEPT-line walk instead (path D): the opponent collects with a
       cheapest-first legal capture and the engine replies from there. Only
       real tactical evidence from the pre-existing settlement machinery
       (connected / mate / material) promotes the offer to a genuine
       sacrifice; a defended piece taken quietly dies here. */
    let protectedShape = false;
    if (!sacrifice && nearBest && pl.legalCount > 1 && pl.mv) {
      try { protectedShape = protectedSacrificeGeometry(pl.fenBefore, pl.mv, pl.prev); } catch { protectedShape = false; }
    }
    if ((sacrifice || protectedShape) && nearBest && pl.legalCount > 1) {
      if (protectedShape) {
        try {
          const accepts = acceptCaptureUcis(pl.fenAfter, pl.mv.to, pl.player);
          for (const acceptUci of accepts.slice(0, 3)) {
            let acceptFen = null;
            try {
              const probe = new Chess(pl.fenAfter);
              const am = probe.move({
                from: acceptUci.slice(0, 2),
                to: acceptUci.slice(2, 4),
                ...(acceptUci.length > 4 ? { promotion: acceptUci[4] } : {}),
              });
              if (!am) continue;
              acceptFen = probe.fen();
            } catch { continue; }
            if (!acceptFen) continue;
            try {
              const aline = await searchTopMoves(acceptFen, { maxDepth: REVIEW_DEPTH, multiPv: 1 });
              const apv = aline && aline[0] && Array.isArray(aline[0].pv) && aline[0].pv.length ? aline[0].pv : null;
              const trial = settledNetSacrifice(
                pl.fenBefore, pl.player, pl.uci,
                apv ? [acceptUci, ...apv] : [acceptUci],
                BRILLIANT_SETTLED_MAX_PLIES, aline && aline[0],
              );
              if (trial && protectedSacrificeValidated(trial)) {
                sacrifice = true;
                settled = trial;
                hasNetSacrifice = hasSettledSacrifice(trial);
                break;
              }
            } catch { continue; }
          }
        } catch { /* unpromoted: sacrifice stays false, hasNetSacrifice unused */ }
      } else {
      try {
        const line = await searchTopMoves(pl.fenAfter, { maxDepth: REVIEW_DEPTH, multiPv: 1 });
        const pv = line && line[0] && Array.isArray(line[0].pv) && line[0].pv.length ? line[0].pv : null;
        settled = settledNetSacrifice(pl.fenBefore, pl.player, pl.uci, pv, BRILLIANT_SETTLED_MAX_PLIES, line[0]);
        hasNetSacrifice = hasSettledSacrifice(settled);
      } catch { hasNetSacrifice = true; }
      }

      /* Forced-recapture filter: when the opponent's ONLY legal reply is a
         capture on the same square (e.g. Qxg8+ → Kxg8), the piece was not
         really "sacrificed" — the opponent had no choice but to recapture.
         This is a simple trade, not a sacrifice. */
      if (hasNetSacrifice && pl.mv && pl.mv.to) {
        try {
          const after = new Chess(pl.fenAfter);
          const oppMoves = after.moves({ verbose: true });
          if (oppMoves.length === 1 && oppMoves[0].captured
              && oppMoves[0].to === pl.mv.to && !settled?.connectedTacticalSacrifice) {
            hasNetSacrifice = false;
          }
        } catch { /* keep existing hasNetSacrifice */ }
      }
    }

    /* ── Great inputs ────────────────────────────────────────────────────
       Optional sharpness gate (GREAT_NEEDS_SHARP_POSITION): a quiet position
       (no legal check/capture of our side) whose big runner-up gap just
       reflects an opponent blunder gets no "!". Pure chess.js geometry
       (isQuietPosition) — no engine call, still deterministic. Only computed
       for real Great candidates (near-best, not forced, runner-up gap ≥
       GREAT_MIN_GAP_CP). */
    let isSharp = true;
    if (GREAT_NEEDS_SHARP_POSITION && nearBest && !isForced && secondM != null
      && bestM != null && bestM - secondM >= GREAT_MIN_GAP_CP) {
      try { isSharp = !isQuietPosition(pl.fenBefore); } catch { isSharp = true; }
    }

    const sacMovedCpValue = sacrifice && pl.mv
      ? PIECE_VAL[pl.mv.promotion ?? pl.mv.piece] ?? null
      : null;

    /* ── Brilliant attribution (gate D) ────────────────────────────────────
       Pure geometry on the position BEFORE the move: was the moved piece already
       loose material, so that this move did not create the concession it appears
       to offer? Cheap, no engine call. Declared BEFORE classifyMove() — it is an
       input to the gate table, not a follow-up to the verdict. */
    let sacrificeAttributed = true;
    if (sacrifice && pl.mv) {
      try { sacrificeAttributed = sacrificeAttribution(pl.fenBefore, pl.mv); } catch { sacrificeAttributed = true; }
    }

    /* ── Brilliant free-positive filter (gate G) ───────────────────────────
       Did a STRICTLY better line exist that was not itself a sacrifice? If so the
       mover turned down a free piece and paid for it — 22...Qxg6 at cpl 9 lost to
       22...f7g6, a plain pawn capture. Geometry over the recorded MultiPV lines. */
    const betterNonSacLine = sacrifice && playedM != null
      ? betterNonSacrificialLine(pl.fenBefore, pl.prev, tops, pl.player, playedM)
      : false;

    /* ── Brilliant attacking gate (gate H) ──────────────────────────────────
       Does the sacrifice DO anything — give check, attack the king, or actually win
       material? 46.Rxc6 and 28.Qxf2 both took a pawn while hanging the capturing
       piece and attacked nothing, yet were cpl 0 and engine-best, so every other gate
       waved them through. Pure geometry, no engine call. */
    let attackingSac = true;
    if (sacrifice && pl.mv) {
      try { attackingSac = attackingSacrifice(pl.fenBefore, pl.mv); } catch { attackingSac = true; }
    }

    const verdictRaw = classifyMove({
      isBook: pl.isBook,
      isBestMove,
      sacrifice,
      hasSafeAlternative,
      hasNetSacrifice,
      isSharp,
      secondM,
      bestM,
      playedM,
      isForced,
      moveNumber: Math.floor(pl.ply / 2) + 1,
      /* A promoting move gives up a PAWN but leaves a major piece behind, so the
         pre-promotion value would understate the sacrifice and let the leg miss.
         e.g. b8=R is a rook sacrifice, not a pawn sacrifice. */
      sacMovedCp: sacMovedCpValue,
      sacrificeAttributed,
      betterNonSacLine,
      attackingSac,
      connectedTacticalSacrifice: settled?.connectedTacticalSacrifice === true,
      forcedMate: settled?.forcedMate === true,
      bestScore,
      playedScore,
      /* The out-of-window exception needs evidence the sacrifice was FORCED, not
         merely that a big piece was given up. isForced means every alternative was
         at least FORCED_SECOND_LOSS_CP worse, i.e. there was nothing else to play. */
      forcedSac: Boolean(sacMovedCpValue != null && sacMovedCpValue >= PIECE_VAL.r),
    });

    // A failed/partial fixed-depth search must never accuse a move — error
    // verdicts need a trusted (deep enough) evaluation.
    const trusted = pl.isBook || seenDepth >= REVIEW_MIN_TRUST_DEPTH;
    const verdict = verdictRaw === 'brilliant' ? 'sigma' : withTrustFloor(verdictRaw, trusted);
    const loss = bestM != null && playedM != null ? cpl : null;

    /* ── Sigma TYPE (which kind of sacrifice this was) ──────────────────
       Only asked once the verdict already says Sigma. classifySigmaFromPly is
       pure board geometry — no engine call — so it is safe to run here and costs
       nothing measurable. A move can be a genuine Sigma that exposes nothing
       detectable (e.g. a poisoned offer that is simply declined), so a null
       type is expected and must NOT downgrade the verdict. */
    let sigma = null;
    if (isSigmaVerdict(verdict)) {
      const classified = classifySigmaFromPly({
        fenBefore: pl.fenBefore,
        moveSan: pl.san,
        isSigma: true,
      });
      if (classified) {
        const meta = SIGMA_TYPE_META[classified.type];
        sigma = {
          type: classified.type,
          label: meta ? meta.label : 'Brilliant',
          piece: meta ? meta.piece : null,
          rank: meta ? meta.rank : 0,
          fromSquare: classified.fromSquare,
          toSquare: classified.toSquare,
        };
      }
    }

    /* Canonical display helpers, derived — never reclassified. `bestSan` comes
       from the engine's own rank-1 line (or the same UCI resolved through
       chess.js); every consumer reads these instead of recomputing them. */
    let bestSan = tops[0] && tops[0].san ? tops[0].san : null;
    if (!bestSan && tops[0] && tops[0].uci) {
      try {
        const bg = new Chess(pl.fenBefore);
        const bm = bg.move({
          from: tops[0].uci.slice(0, 2),
          to: tops[0].uci.slice(2, 4),
          promotion: tops[0].uci.length > 4 ? tops[0].uci[4] : undefined,
        });
        bestSan = bm ? bm.san : null;
      } catch { bestSan = null; }
    }

    const row = {
      ply: pl.ply, player: pl.player, san: pl.san, uci: pl.uci,
      verdict,
      sigma,
      /* Canonical per-move metadata every surface compares and displays
         directly: forced status, the engine's best move in SAN, and the final
         sacrifice decision (true only after the settlement guards, including
         the protected-tactical-sacrifice accept-line walk). */
      forced: Boolean(isForced),
      bestSan,
      sacrifice: Boolean(sacrifice),
      sacrificeProtected: Boolean(protectedShape),
      cpl: loss == null ? 0 : Math.min(ACCURACY_CPL_CAP, cpl),
      loss,
      swing,
      wpd,
      acc: loss == null ? null : moveAccuracy(bestM, playedM, verdict),
      evalBefore: bestScore,
      evalAfter: playedScore,
      bestMate: bestScore?.type === 'mate' ? bestScore.value : null,
      playedMate: playedScore?.type === 'mate' ? playedScore.value : null,
      best: bestM == null ? null : Math.round(bestM),
      played: playedM == null ? null : Math.round(playedM),
      bestUci: tops[0] ? tops[0].uci : null,
      depth: Math.max(seenDepth, playedDepth),
      bookLine: pl.bookLine,
      /* the exact multiPV candidate set that produced this row — surfacing the
         best/great/good arrow trio while browsing this move of the review */
      lines: tops.slice(0, 3)
        .map((t) => ({
          uci: t.uci,
          from: t.from || (t.uci ? t.uci.slice(0, 2) : null),
          to: t.to || (t.uci ? t.uci.slice(2, 4) : null),
          score: t.score != null ? t.score : null,
          evaluation: t.evaluation,
          mate: t.mate ?? null,
        }))
        .filter((l) => l.from && l.to),
    };
    if (deepSearches > 0) perf.deepPlies += 1;
    onRowDone(row);
    return row;
    } catch {
      /* A single ply blew up outside the guarded engine stages (bad FEN inside
         a pure helper, unexpected shape from the engine, …). Keep the move in
         the report as an unscored row instead of failing the whole game. */
      if (deepSearches > 0) perf.deepPlies += 1;
      onRowDone(null);
      return {
        ply: pl.ply, player: pl.player, san: pl.san, uci: pl.uci,
        verdict: 'good',
        cpl: 0, loss: null, swing: null, wpd: null, acc: null,
        best: null, played: null, bestUci: null, bestSan: null,
        forced: false, sacrifice: false, sacrificeProtected: false,
        depth: 0, bookLine: pl.bookLine || null, lines: [],
        unanalysed: true,
      };
    }
  });
  if (isCancelled()) return null;

  // Game-order re-assembly: rows complete in arbitrary completion order, so
  // the stored/reported result is sorted back by move index (ply) — exactly
  // the move-by-move ordering the old windowed loop produced.
  // Cancelled plies resolve null — drop them so a Vanish can't poison the
  // sort or the aggregation below with a null row.
  const live = rows.filter(Boolean);
  live.sort((a, b) => a.ply - b.ply);
  results.push(...live);

  /* Every ply failing (engine down on all of them) used to return a plausible
     but empty report — badges over zero rows. Fail loudly instead so the UI
     shows the retry path rather than a fake perfect game. */
  if (live.length === 0 && plies.length > 0) {
    throw new Error('The engine returned no evaluations — it may still be loading. Wait a few seconds and hit Re-analyze. ');
  }

  perf.deepSearches = perf.deepPlies;
  perf.cacheHits = cache.stats.hits;
  perf.cacheMisses = cache.stats.misses;
  perf.cacheCoalesced = cache.stats.coalesced;
  perf.elapsedMs = Date.now() - perf.startedAt;

  if (import.meta.env && import.meta.env.DEV) {
    const c = cache.stats;
    /* eslint-disable no-console */
    console.log(
      `[review] ${perf.elapsedMs}ms  plies=${perf.plies}  scan-only=${perf.scanOnly}`
      + `  deep=${perf.deepPlies}  cache hit/miss/coalesced=${c.hits}/${c.misses}/${c.coalesced}`,
    );
    console.log('[review] positions sent deep, by reason:', perf.deepReasons);
    /* eslint-enable no-console */
  }

  return {
    initialFen,
    opening: openingTag(historySan),
    moves: results,
    total: results.length,
    white: aggregateSide(results, 'w', empties()),
    black: aggregateSide(results, 'b', empties()),
    perf,
  };
}