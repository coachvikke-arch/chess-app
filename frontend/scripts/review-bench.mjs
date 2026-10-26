/* REVIEW PARITY + PERF HARNESS
   ────────────────────────────────────────────────────────────────────────────
   Runs the REAL review pipeline (real full-NNUE Stockfish, via the Node UCI
   bridge) over one or more games, and dumps a canonical JSON snapshot of every
   classification plus per-search timing.

   Two jobs:
     1. CAPTURE  — `node scripts/review-bench.mjs --out before.json`
        records a baseline snapshot of the CURRENT code.
     2. COMPARE  — `node scripts/review-bench.mjs --compare before.json`
        re-runs and asserts the new code produces byte-identical verdicts/CPL/
        accuracy/lines, then prints the speedup.

   The snapshot covers every field that feeds or is produced by the
   classification logic, so any behavioural drift fails loudly.

   Usage:
     node scripts/review-bench.mjs [--plies 40] [--depth 18] [--pool 3]
                                   [--hash 128] [--seed 1] [--out f.json]
                                   [--compare f.json] [--repeat 1]
*/
import { Chess } from 'chess.js';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { reviewGame } from '../src/utils/gameReview.js';
import { createReviewEnginePool } from './nodeEngine.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const has = (n) => process.argv.includes(`--${n}`);

const PLIES = Number(arg('plies', 40));
const DEPTH = Number(arg('depth', 18));
const POOL = Number(arg('pool', 3));
const HASH = Number(arg('hash', 128));
const REPEAT = Number(arg('repeat', 1));
const OUT = arg('out', null);
const COMPARE = arg('compare', null);
/* Sweep the two-stage deep-search trigger. Omitted = use the reviewConfig
   default, which is what production runs. */
const CRITICAL_CPL = arg('critical-cpl', null);
const CRITICAL_CPL_N = CRITICAL_CPL == null ? null : Number(CRITICAL_CPL);

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* Deterministic legal game: move choice is a pure function of the position, so
   every run replays exactly the same game (no RNG, no corpus files needed). */
function generateGame(plies) {
  const g = new Chess();
  const san = [];
  for (let n = 0; n < plies; n++) {
    const opts = g.moves({ verbose: true });
    if (!opts.length) break;
    let best = opts[0]; let bestH = Infinity;
    for (const mv of opts) {
      const h = hashStr(`${g.fen()}|play|${mv.from + mv.to + (mv.promotion || '')}`);
      if (h < bestH) { bestH = h; best = mv; }
    }
    g.move(best); san.push(best.san);
  }
  return san;
}

/* A second, differently-shaped game (longer, more material) so parity is not
   proven on a single trivial line. */
function generateLongGame(plies) {
  const g = new Chess();
  const san = [];
  for (let n = 0; n < plies; n++) {
    const opts = g.moves({ verbose: true });
    if (!opts.length) break;
    // prefer captures/checks to reach a tactically rich middlegame faster
    const scored = opts.map((mv) => {
      const h = hashStr(`${g.fen()}|l|${mv.from + mv.to}${mv.captured || ''}${mv.san}`);
      return { mv, h, weight: (mv.captured ? 400 : 0) + (mv.san.includes('+') ? 250 : 0) + (mv.san.includes('#') ? 900 : 0) };
    });
    let best = scored[0];
    for (const s of scored) if (s.h % 1000 < s.weight) { best = s; break; }
    g.move(best.mv); san.push(best.mv.san);
  }
  return san;
}

const GAMES = [
  { name: 'quiet-40', moves: generateGame(PLIES) },
  { name: 'tactical-56', moves: generateLongGame(56) },
];

/* ── engine wrapper: counts every search, keyed exactly as the pipeline asks ── */
function makeCountingEngine(pool) {
  const log = [];
  const t0 = () => process.hrtime.bigint();
  /* A search that fails/times out makes the pipeline substitute a neutral row,
     which legitimately changes the verdict counts. That must NEVER be reported
     as a behavioural difference caused by the code under test, so failures are
     recorded loudly and abort the comparison. */
  const failures = [];
  const wrap = (fn, label) => async (...a) => {
    try { return await fn(...a); }
    catch (e) {
      failures.push(`${label}: ${e.message}`);
      throw e;
    }
  };
  return {
    log,
    failures,
    searchTopMoves: wrap(async (fen, opts = {}) => {
      const { maxDepth = 18, multiPv = 1 } = opts;
      const s = t0();
      const r = await pool.searchTopMoves(fen, { maxDepth, multiPv });
      log.push({ kind: 'tops', fen, depth: maxDepth, multiPv, ms: Number(t0() - s) / 1e6 });
      return r;
    }, 'searchTopMoves'),
    evaluateGame: wrap(async (fen, opts = {}) => {
      const { maxDepth = 16 } = opts;
      const s = t0();
      const r = await pool.evaluateGame(fen, { maxDepth });
      log.push({ kind: 'eval', fen, depth: maxDepth, multiPv: 1, ms: Number(t0() - s) / 1e6 });
      return r;
    }, 'evaluateGame'),
  };
}

/* Canonical snapshot: EVERY classification-relevant output field. */
function snapshot(res) {
  return {
    opening: res.opening,
    total: res.total,
    white: res.white,
    black: res.black,
    moves: res.moves.map((m) => ({
      ply: m.ply, player: m.player, san: m.san, uci: m.uci,
      verdict: m.verdict, cpl: m.cpl, loss: m.loss, swing: m.swing,
      wpd: m.wpd, acc: m.acc, best: m.best, played: m.played,
      bestUci: m.bestUci, depth: m.depth, bookLine: m.bookLine ?? null,
      // +0 and -0 are equal by `===` but NOT by Object.is, and a JSON
      // round-trip (the --out/--compare path) turns -0 into 0. Normalise so the
      // comparison measures real behaviour, not negative-zero serialisation.
      lines: (m.lines || []).map((l) => [l.uci, l.from, l.to, l.score === 0 ? 0 : l.score]),
    })),
  };
}

function deepDiff(a, b, base = '') {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return `${base}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${base}: array vs non-array`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = deepDiff(a[k], b[k], base ? `${base}.${k}` : k);
    if (d) return d;
  }
  return null;
}

const engine = await createReviewEnginePool({ hashMb: HASH, size: POOL });
const results = {};
const searchCounts = {};
const perfs = {};
const timings = [];
const allLog = [];
const allFailures = [];

for (const g of GAMES) {
  for (let r = 0; r < REPEAT; r++) {
    const counting = makeCountingEngine(engine);
    const started = Date.now();
    const res = await reviewGame('start', g.moves, {
      engine: counting,
      bookLookup: async () => null, // isolate engine cost from network
      engineOverrides: CRITICAL_CPL_N == null ? {} : { criticalCpl: CRITICAL_CPL_N },
    });
    const ms = Date.now() - started;
    if (r === 0) { results[g.name] = snapshot(res); searchCounts[g.name] = counting.log.length; perfs[g.name] = res.perf; }
    timings.push({ game: g.name, run: r + 1, ms, searches: counting.log.length });
    allLog.push(...counting.log.map((e) => ({ ...e, game: g.name })));
    allFailures.push(...counting.failures.map((f) => `${g.name} run${r + 1} ${f}`));
    const w = res.white, b = res.black;
    console.log(
      `  ${g.name} run${r + 1}: ${(ms / 1000).toFixed(1)}s  ` +
      `${counting.log.length} searches  ${w.accuracy}%/${b.accuracy}%  rows ${res.total}`
    );
    /* Two-stage breakdown: how many plies were answered by the cheap scan, and
       why the rest went deep. Printed so a slow run can be explained instead of
       guessed at. */
    if (res.perf) {
      console.log(
        `      plies ${res.perf.plies}  scan-only ${res.perf.scanOnly}` +
        `  deep ${res.perf.deepPlies} (${Math.round((res.perf.deepPlies / res.perf.plies) * 100)}%)` +
        `  cache ${res.perf.cacheHits}h/${res.perf.cacheMisses}m/${res.perf.cacheCoalesced}c`
      );
      console.log(`      deep by reason: ${JSON.stringify(res.perf.deepReasons)}`);
    }
  }
}

/* A timed-out / crashed search means the pipeline substituted a fallback row, so
   the verdict counts shift for reasons that have nothing to do with the code
   under test. Refuse to report a comparison in that case. */
if (allFailures.length) {
  console.log(`\n${allFailures.length} ENGINE FAILURE(S) — results are not comparable:`);
  for (const f of allFailures.slice(0, 10)) console.log(`  ${f}`);
  console.log('  (the host was likely overloaded; re-run on a quiet machine)');
  await engine.destroy();
  process.exit(2);
}

const verdictCounts = {};
for (const g of GAMES) {
  for (const m of results[g.name].moves) verdictCounts[m.verdict] = (verdictCounts[m.verdict] || 0) + 1;
}
console.log('\nverdict distribution:', JSON.stringify(verdictCounts));

// duplicate-search analysis (what memoisation could remove)
{
  const key = (e) => `${e.kind}|${e.fen}|${e.depth}|${e.multiPv}`;
  const seen = new Map();
  let dupes = 0, dupeMs = 0;
  for (const e of allLog) {
    const k = key(e);
    if (seen.has(k)) { dupes++; dupeMs += e.ms; } else seen.set(k, e);
  }
  const totalMs = allLog.reduce((s, e) => s + e.ms, 0);
  console.log(
    `searches: ${allLog.length} total, ${seen.size} distinct, ${dupes} exact duplicates ` +
    `(${dupeMs.toFixed(0)}ms of engine time recoverable)`
  );
  console.log(`total engine time: ${(totalMs / 1000).toFixed(1)}s`);
}

await engine.destroy();

const bestMs = {};
for (const t of timings) if (!bestMs[t.game] || t.ms < bestMs[t.game]) bestMs[t.game] = t.ms;
const summary = { config: { plies: PLIES, depth: DEPTH, pool: POOL, hash: HASH }, results, searchCounts, bestMs };

if (OUT) {
  writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log(`\nsnapshot written → ${OUT}`);
}

if (COMPARE) {
  if (!existsSync(COMPARE)) { console.log(`\nbaseline ${COMPARE} not found`); process.exit(1); }
  const base = JSON.parse(readFileSync(COMPARE, 'utf8'));
  let fail = 0;
  for (const name of Object.keys(base.results)) {
    const d = deepDiff(base.results[name], results[name]);
    if (d) { fail++; console.log(`\nMISMATCH ${name} at ${d}`); }
    else console.log(`\nIDENTICAL ${name} (${results[name].moves.length} moves, all classification fields)`);
    /* the number of engine calls is part of the contract: a drop means a search
       failed or was skipped, which shifts rows even if verdicts happen to match */
    if (base.searchCounts && base.searchCounts[name] !== undefined
        && base.searchCounts[name] !== searchCounts[name]) {
      fail++;
      console.log(`\nSEARCH-COUNT CHANGE ${name}: ${base.searchCounts[name]} → ${searchCounts[name]}`);
    }
  }
  if (fail) { console.log(`\n${fail} MISMATCHES — classifications changed`); process.exit(1); }

  console.log('\nspeed:');
  for (const name of Object.keys(base.bestMs)) {
    const before = base.bestMs[name], after = bestMs[name];
    const pct = before ? ((before - after) / before) * 100 : 0;
    console.log(`  ${name}: ${(before / 1000).toFixed(1)}s → ${(after / 1000).toFixed(1)}s  (${pct >= 0 ? '-' : '+'}${Math.abs(pct).toFixed(0)}% time)`);
  }
  console.log('\nPARITY OK — classifications identical, speed reported above');
}
process.exit(0);
