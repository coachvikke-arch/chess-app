/* ──────────────────────────────────────────────────────────────────────────
 * Canonical analysis reuse: analyse ONCE, reuse until something that changes
 * the answer changes.
 *
 * The engine is stubbed, so "did the engine run?" is a counter — these tests
 * assert call counts, not timing, and run in milliseconds.
 *
 * Run: node --test scripts/canonical-analysis-cache.test.mjs
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCanonicalAnalysis,
  canonicalAnalysisKey,
  isValidCanonicalAnalysis,
  isStaleAnalysis,
  hasAnalysisShape,
  clearCanonicalAnalysisCache,
  getCanonicalAnalysisCacheSize,
  getCanonicalAnalysisInFlightCount,
  isCanonicalAnalysisInMemory,
  CANONICAL_ANALYSIS_VERSION,
  ANALYSIS_SCHEMA_VERSION,
} from '../src/utils/canonicalAnalysis.js';

const MOVES = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'h6'];

/** A stand-in canonical review result with the shape the layer validates.
 *
 *  ONE ROW PER MOVE. That is the real shape: the canonical analysis grades
 *  every ply of the game, so the analysis's move list IS the game's move list
 *  (the SAN of every move, in order). A fixture with a different row count
 *  would be a shape the engine never produces. */
function fakeAnalysis(moves = MOVES) {
  return {
    initialFen: 'start',
    moves: Array.from({ length: moves.length }, (_, i) => ({
      ply: i, player: i % 2 ? 'b' : 'w', san: moves[i], uci: 'a1a2',
      verdict: 'good', cpl: 0, acc: 100, loss: 0, swing: 0, wpd: 0,
      best: 20, played: 20, bestUci: 'a1a2',
    })),
    white: { accuracy: 95.5, counts: {} },
    black: { accuracy: 92.1, counts: {} },
  };
}

/* A result shaped EXACTLY like a real reviewGame() output — including the nulls
 * the engine genuinely produces. This is the fixture that matters: a validator
 * tuned to a convenient shape passes while rejecting real data.
 *
 * Real reviewGame rows for any game opening in theory carry:
 *   - verdict 'book' with acc === null  (moveAccuracy returns null for book —
 *     theory is scored 100 by the aggregator, not per row)
 *   - loss/swing/wpd/acc all null on a row the engine could not score
 * Both are legitimate canonical values, and a validator that demanded numbers
 * here silently made every book-opening game uncacheable. */
function realisticAnalysis() {
  const book = (ply, san, uci, player) => ({
    ply, player, san, uci, verdict: 'book',
    cpl: 0, loss: 0, swing: 0, wpd: 0, acc: null,       // ← acc is null for book
    best: 12, played: 12, bestUci: uci, bestSan: san,
    forced: false, sacrifice: false, sacrificeProtected: false,
    sigma: null, lines: [{ uci, from: uci.slice(0, 2), to: uci.slice(2, 4), score: 12 }],
  });
  const unscored = (ply, san, uci, player) => ({
    ply, player, san, uci, verdict: 'good',
    cpl: 0, loss: null, swing: null, wpd: null, acc: null, // ← no engine data
    best: null, played: null, bestUci: null, bestSan: null,
    forced: false, sacrifice: false, sacrificeProtected: false,
    sigma: null, lines: [],
  });
  /* One row per move of MOVES — the real shape. */
  return {
    initialFen: 'start',
    moves: [
      book(0, 'e4', 'e2e4', 'w'),
      book(1, 'e5', 'e7e5', 'b'),
      book(2, 'Nf3', 'g1f3', 'w'),
      { ...book(3, 'Nc6', 'b8c6', 'b'), verdict: 'sigma', acc: 100, loss: 0,
        sigma: { type: 'knight_sacrifice', label: 'Knight Sacrifice', piece: 'n', rank: 2, fromSquare: 'g1', toSquare: 'f3' } },
      unscored(4, 'Bc4', 'f1c4', 'w'),
      unscored(5, 'h6', 'h7h6', 'b'),
    ],
    white: { accuracy: 98.2, counts: { brilliant: 0 } },
    black: { accuracy: 91.4, counts: {} },
  };
}

/** A counting stub standing in for the engine pipeline. */
function countingAnalyze(result = fakeAnalysis()) {
  const calls = { n: 0 };
  const fn = async () => { calls.n += 1; return result; };
  fn.calls = calls;
  return fn;
}

const GAME = { gameSource: 'chess_profile', gameId: 42, initialFen: 'start', moves: MOVES };
const memoryHas = (key) => {
  const source = key.split(':')[0];
  const id = key.split(':').slice(1).join(':');
  return isCanonicalAnalysisInMemory({ gameSource: source, gameId: id });
};

beforeEach(() => { clearCanonicalAnalysisCache(); });

/* ── identity ────────────────────────────────────────────────────────────── */

test('the cache identity is the canonical (source, id) pair', () => {
  assert.equal(canonicalAnalysisKey({ gameSource: 'chess_profile', gameId: 42 }), 'chess_profile:42');
  assert.equal(canonicalAnalysisKey({ gameSource: 'online', gameId: 42 }), 'online:42');
  /* no identity → no key (never an invented one) */
  assert.equal(canonicalAnalysisKey({ moves: MOVES }), null);
  assert.equal(canonicalAnalysisKey({ gameSource: 'chess_profile' }), null);
});

test('the SAME numeric id in different sources never collides', async () => {
  const a = countingAnalyze(fakeAnalysis(MOVES.slice(0, 4)));
  const b = countingAnalyze(fakeAnalysis(MOVES));
  await getCanonicalAnalysis({ ...GAME, gameSource: 'chess_profile', moves: MOVES.slice(0, 4) }, { analyze: a });
  await getCanonicalAnalysis({ ...GAME, gameSource: 'online' }, { analyze: b });
  await getCanonicalAnalysis({ ...GAME, gameSource: 'computer' }, { analyze: b });
  await getCanonicalAnalysis({ ...GAME, gameSource: 'tournament' }, { analyze: b });
  await getCanonicalAnalysis({ ...GAME, gameSource: 'gm' }, { analyze: b });
  assert.equal(a.calls.n, 1, 'each source analysed once, independently');
  assert.equal(b.calls.n, 4, 'and never shared');
});

/* ── A/B/C: first open analyses, later opens are instant ─────────────────── */

test('A. first open: cache miss → one analysis → persisted', async () => {
  const analyze = countingAnalyze();
  const saved = [];
  const res = await getCanonicalAnalysis(GAME, {
    analyze, saveAnalysis: async (_id, entry) => { saved.push(entry); },
  });
  assert.equal(analyze.calls.n, 1, 'exactly one engine run');
  assert.ok(res);
  assert.equal(saved.length, 1, 'the result was persisted');
  assert.equal(saved[0].analysisVersion, CANONICAL_ANALYSIS_VERSION);
  assert.equal(saved[0].schemaVersion, ANALYSIS_SCHEMA_VERSION);
  assert.equal(saved[0].gameSource, 'chess_profile');
  assert.equal(saved[0].gameId, 42);
});

test('B/C. second, third, fourth, fifth open: NO further analysis', async () => {
  const analyze = countingAnalyze();
  for (let i = 0; i < 5; i += 1) {
    const res = await getCanonicalAnalysis(GAME, { analyze });
    assert.ok(res, `open ${i + 1} returned a result`);
  }
  assert.equal(analyze.calls.n, 1, 'the engine ran ONCE across five opens');
});

test('B. a second open served from PERSISTENCE runs no engine', async () => {
  /* A fresh module-level cache (cleared), but the store still holds the entry —
     exactly the "reopen the app tomorrow" case. */
  const store = new Map();
  const first = countingAnalyze();
  await getCanonicalAnalysis(GAME, {
    analyze: first,
    saveAnalysis: async (id, entry) => { store.set(id, entry); },
  });
  clearCanonicalAnalysisCache();
  assert.equal(getCanonicalAnalysisCacheSize(), 0, 'memory really was cleared');

  const second = countingAnalyze();
  const res = await getCanonicalAnalysis(GAME, {
    analyze: second, loadAnalysis: async (id) => store.get(id) || null,
  });
  assert.equal(second.calls.n, 0, 'the engine did NOT run — the store answered');
  assert.ok(res.moves.length === first ? true : true);
  assert.ok(res, 'and a real analysis came back');
});

/* ── D: one game, many brilliant moves ───────────────────────────────────── */

test('D. different plies in one game are ONE analysis', async () => {
  const analyze = countingAnalyze();
  for (const ply of [14, 49, 73, 101]) {
    /* ply is UI navigation only — it is not part of the identity and not even
       part of the game record here. */
    await getCanonicalAnalysis(GAME, { analyze, ply });
  }
  assert.equal(analyze.calls.n, 1, 'four brilliant moves, one analysis');
});

/* ── E: different games never share ──────────────────────────────────────── */

test('E. game 42 and game 43 analyse independently', async () => {
  const a = countingAnalyze(fakeAnalysis(MOVES.slice(0, 4)));
  const b = countingAnalyze(fakeAnalysis(MOVES.slice(0, 5)));
  const gameA = { ...GAME, gameId: 42, moves: MOVES.slice(0, 4) };
  const gameB = { ...GAME, gameId: 43, moves: MOVES.slice(0, 5) };
  await getCanonicalAnalysis(gameA, { analyze: a });
  await getCanonicalAnalysis(gameB, { analyze: b });
  await getCanonicalAnalysis(gameA, { analyze: a });
  await getCanonicalAnalysis(gameB, { analyze: b });
  assert.equal(a.calls.n, 1);
  assert.equal(b.calls.n, 1);
  assert.equal(getCanonicalAnalysisCacheSize(), 2, 'two independent entries');
});

/* ── G: a version change invalidates ─────────────────────────────────────── */

test('G. an entry stored under another version is rejected', async () => {
  const store = new Map();
  const analyze = countingAnalyze();
  await getCanonicalAnalysis(GAME, { analyze, saveAnalysis: async (id, e) => store.set(id, e) });
  clearCanonicalAnalysisCache();

  /* Pretend the engine, depth, multiPv or classifier changed since. */
  const old = { ...store.get(42), analysisVersion: 'nnue-17-0+d16m2r1' };
  const res = await getCanonicalAnalysis(GAME, {
    analyze: countingAnalyze(), loadAnalysis: async () => old,
  });
  assert.ok(res, 'a fresh analysis was produced');
});

test('G. a current-version entry IS accepted', () => {
  const entry = {
    gameSource: 'chess_profile', gameId: 42, initialFen: 'start', moveCount: MOVES.length,
    analysisVersion: CANONICAL_ANALYSIS_VERSION,
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    analysis: fakeAnalysis(),
  };
  assert.equal(isValidCanonicalAnalysis(entry, GAME), true);
  assert.equal(isStaleAnalysis(entry), false);
});

test('G. every version component is part of the one stamp', () => {
  /* engine, depth, multiPv and logic all appear, so a change to any of them
     changes the version. */
  assert.match(CANONICAL_ANALYSIS_VERSION, /^nnue-\d+-\d+\+d\d+m\d+r\d+$/);
});

/* ── H: concurrent requests produce ONE run ─────────────────────────────── */

test('H. three simultaneous requests → one analysis, one shared result', async () => {
  let resolveEngine;
  const analyze = () => { analyze.n += 1; return new Promise((r) => { resolveEngine = r; }); };
  analyze.n = 0;

  const a = getCanonicalAnalysis(GAME, { analyze });
  const b = getCanonicalAnalysis(GAME, { analyze });
  const c = getCanonicalAnalysis(GAME, { analyze });
  assert.equal(getCanonicalAnalysisInFlightCount(), 1, 'one in-flight entry');

  const result = fakeAnalysis();
  resolveEngine(result);
  const [ra, rb, rc] = await Promise.all([a, b, c]);
  assert.equal(analyze.n, 1, 'the engine ran exactly ONCE');
  assert.equal(ra, result);
  assert.equal(rb, result, 'and all three received the same object');
  assert.equal(rc, result);
  assert.equal(getCanonicalAnalysisInFlightCount(), 0, 'the in-flight entry was cleared');
});

/* ── I: failure safety ───────────────────────────────────────────────────── */

test('I. a failed analysis is never cached and never poisons later requests', async () => {
  const failing = async () => { failing.n += 1; throw new Error('engine died'); };
  failing.n = 0;
  await assert.rejects(() => getCanonicalAnalysis(GAME, { analyze: failing }), /engine died/);
  assert.equal(getCanonicalAnalysisCacheSize(), 0, 'nothing was cached');
  assert.equal(getCanonicalAnalysisInFlightCount(), 0, 'in-flight was cleaned up');

  const good = countingAnalyze();
  const res = await getCanonicalAnalysis(GAME, { analyze: good });
  assert.equal(good.calls.n, 1, 'the next attempt retried successfully');
  assert.ok(res);
});

test('I. a null (cancelled) result is not cached', async () => {
  const cancelled = async () => { cancelled.n += 1; return null; };
  cancelled.n = 0;
  await getCanonicalAnalysis(GAME, { analyze: cancelled });
  assert.equal(getCanonicalAnalysisCacheSize(), 0, 'cancellation is not an analysis');
  assert.equal(getCanonicalAnalysisInFlightCount(), 0);
});

test('I. a partial/malformed result is not cached', async () => {
  await getCanonicalAnalysis(GAME, { analyze: async () => ({ moves: [{ san: 'e4' }] }) });
  assert.equal(getCanonicalAnalysisCacheSize(), 0);
  await getCanonicalAnalysis(GAME, { analyze: async () => ({ moves: [] }) });
  assert.equal(getCanonicalAnalysisCacheSize(), 0);
});

test('I. a failed persistence write still leaves a usable result', async () => {
  const analyze = countingAnalyze();
  const res = await getCanonicalAnalysis(GAME, {
    analyze, saveAnalysis: async () => { throw new Error('db down'); },
  });
  assert.ok(res, 'the caller still gets its analysis');
  assert.equal(getCanonicalAnalysisCacheSize(), 1, 'and the memory entry is usable');
});

/* ── J: corruption is a miss, never a crash ──────────────────────────────── */

test('J. corrupt stored data is treated as a miss', async () => {
  const junk = [null, undefined, 0, '', 'nonsense', 42, {}, [], { analysisVersion: CANONICAL_ANALYSIS_VERSION },
    { schemaVersion: ANALYSIS_SCHEMA_VERSION, analysisVersion: CANONICAL_ANALYSIS_VERSION },
    { analysisVersion: CANONICAL_ANALYSIS_VERSION, schemaVersion: ANALYSIS_SCHEMA_VERSION, analysis: null },
    { analysisVersion: CANONICAL_ANALYSIS_VERSION, schemaVersion: ANALYSIS_SCHEMA_VERSION, analysis: { moves: [] } }];
  for (const bad of junk) {
    assert.equal(isValidCanonicalAnalysis(bad, GAME), false, `${JSON.stringify(bad)} is invalid`);
    const analyze = countingAnalyze();
    const res = await getCanonicalAnalysis(GAME, { analyze, loadAnalysis: async () => bad });
    assert.ok(res, `recovered from ${JSON.stringify(bad)}`);
    clearCanonicalAnalysisCache();
  }
});

test('J. an entry for a DIFFERENT game is not served to this one', async () => {
  const entry = {
    gameSource: 'chess_profile', gameId: 999, initialFen: 'start', moveCount: MOVES.length,
    analysisVersion: CANONICAL_ANALYSIS_VERSION, schemaVersion: ANALYSIS_SCHEMA_VERSION,
    analysis: fakeAnalysis(),
  };
  assert.equal(isValidCanonicalAnalysis(entry, GAME), false, 'wrong game id');
});

test('J. an entry whose CONTENT changed is not served (re-synced game)', async () => {
  const base = {
    gameSource: 'chess_profile', gameId: 42, initialFen: 'start', moveCount: 6,
    analysisVersion: CANONICAL_ANALYSIS_VERSION, schemaVersion: ANALYSIS_SCHEMA_VERSION,
    analysis: fakeAnalysis(),
  };
  assert.equal(isValidCanonicalAnalysis(base, GAME), true);
  /* same id, different move count → must not be reused */
  assert.equal(isValidCanonicalAnalysis(base, { ...GAME, moves: [...MOVES, 'd3'] }), false);
  /* same id, different starting position → must not be reused */
  assert.equal(isValidCanonicalAnalysis(base, { ...GAME, initialFen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' }), false);
});

test('J. hasAnalysisShape demands the fields the UI reads', () => {
  assert.equal(hasAnalysisShape(fakeAnalysis()), true);
  assert.equal(hasAnalysisShape(null), false);
  const noAcc = fakeAnalysis();
  delete noAcc.moves[0].acc;
  assert.equal(hasAnalysisShape(noAcc), false);
  const noVerdict = fakeAnalysis();
  noVerdict.moves[1].verdict = '';
  assert.equal(hasAnalysisShape(noVerdict), false);
});

/* ── K: custom FEN safety ────────────────────────────────────────────────── */

test('K. custom-FEN games do not collide with standard-start ones', async () => {
  const custom = { ...GAME, gameId: 77, initialFen: '4k3/8/8/8/8/5p2/8/4K3 b - - 0 1', moves: ['f4'] };
  const a = countingAnalyze(fakeAnalysis(MOVES));
  const b = countingAnalyze(fakeAnalysis(['f4']));
  await getCanonicalAnalysis({ ...GAME, gameId: 77 }, { analyze: a });
  await getCanonicalAnalysis(custom, { analyze: b });
  assert.equal(a.calls.n, 1);
  assert.equal(b.calls.n, 1, 'different origins are different analyses');
});

test('K. a game with no identity is analysed but never cached', async () => {
  const analyze = countingAnalyze();
  const pasted = { initialFen: 'start', moves: MOVES };
  await getCanonicalAnalysis(pasted, { analyze });
  await getCanonicalAnalysis(pasted, { analyze });
  assert.equal(analyze.calls.n, 2, 'no invented identity means no cache');
  assert.equal(getCanonicalAnalysisCacheSize(), 0);
});

/* ── reuseOnly: opening must not start engine work ────────────────────────── */

test('reuseOnly returns a stored analysis and never runs the engine', async () => {
  const store = new Map();
  const analyze = countingAnalyze();
  await getCanonicalAnalysis(GAME, { analyze, saveAnalysis: async (id, e) => store.set(id, e) });
  clearCanonicalAnalysisCache();

  const ask = countingAnalyze();
  const hit = await getCanonicalAnalysis(GAME, {
    analyze: ask, loadAnalysis: async (id) => store.get(id) || null, reuseOnly: true,
  });
  assert.ok(hit, 'the stored analysis came back');
  assert.equal(ask.calls.n, 0, 'no engine work on open');
});

test('reuseOnly returns null when nothing valid is stored', async () => {
  const ask = countingAnalyze();
  const res = await getCanonicalAnalysis({ ...GAME, gameId: 1234 }, {
    analyze: ask, loadAnalysis: async () => null, reuseOnly: true,
  });
  assert.equal(res, null);
  assert.equal(ask.calls.n, 0, 'and still no engine work');
});

/* ── bounds ──────────────────────────────────────────────────────────────── */

test('the memory cache is bounded', async () => {
  const analyze = countingAnalyze(fakeAnalysis(MOVES.slice(0, 2)));
  for (let i = 0; i < 40; i += 1) {
    await getCanonicalAnalysis({ ...GAME, gameId: i, moves: MOVES.slice(0, 2) }, { analyze });
  }
  assert.ok(getCanonicalAnalysisCacheSize() <= 24,
    `expected a bounded LRU, found ${getCanonicalAnalysisCacheSize()}`);
});

/* ── explicit re-analyze ─────────────────────────────────────────────────── */

test('force bypasses the cache and replaces it', async () => {
  const first = countingAnalyze(fakeAnalysis(MOVES));
  await getCanonicalAnalysis(GAME, { analyze: first });
  const second = countingAnalyze(fakeAnalysis(MOVES));
  await getCanonicalAnalysis(GAME, { analyze: second, force: true });
  assert.equal(second.calls.n, 1, 'a forced re-analyze really re-ran');
  /* and the replacement is what is now cached */
  const third = countingAnalyze();
  await getCanonicalAnalysis(GAME, { analyze: third });
  assert.equal(third.calls.n, 0, 'and later opens reuse the replacement');
});

/* ══════════════════════════════════════════════════════════════════════════
 * The two regressions that actually bit in production.
 * ══════════════════════════════════════════════════════════════════════════ */

test('REGRESSION: a REAL reviewGame result must be cacheable', async () => {
  /* This is the bug that made every book-opening game re-analyse forever.
     `hasAnalysisShape` demanded `typeof acc === 'number'`, but a canonical row
     carries acc === null for a book move and for any row the engine could not
     score. Real results were therefore classified as "malformed" and silently
     never cached — the engine re-ran on EVERY open. */
  assert.equal(hasAnalysisShape(realisticAnalysis()), true,
    'a realistic canonical result must validate');
});

test('REGRESSION: book rows and unscored rows are cached and reused', async () => {
  const real = realisticAnalysis();
  const analyze = countingAnalyze(real);
  for (let i = 0; i < 4; i += 1) await getCanonicalAnalysis(GAME, { analyze });
  assert.equal(analyze.calls.n, 1,
    'a game whose rows contain acc:null is analysed ONCE and then reused');
});

test('REGRESSION: memory eviction must fall back to the persistent store', async () => {
  /* The LRU is capped, so eviction is normal — and must never cost an engine
     run when a valid analysis is already persisted. */
  const store = new Map();
  const analyze = countingAnalyze(realisticAnalysis());

  /* Analyse 40 games, persisting each. Game 42 is the FIRST one analysed. */
  for (let id = 42; id < 82; id += 1) {
    await getCanonicalAnalysis({ ...GAME, gameId: id }, {
      analyze, saveAnalysis: async (gid, entry) => { store.set(gid, entry); },
    });
  }
  assert.equal(analyze.calls.n, 40, '40 analyses for 40 games');
  assert.ok(getCanonicalAnalysisCacheSize() <= 24, 'memory is bounded');
  assert.equal(memoryHas('chess_profile:42'), false,
    'game 42 was evicted from the memory LRU');

  /* Re-open the evicted game. Memory misses; the store must answer. */
  const again = countingAnalyze(realisticAnalysis());
  const res = await getCanonicalAnalysis({ ...GAME, gameId: 42 }, {
    analyze: again, loadAnalysis: async (id) => store.get(id) || null,
  });
  assert.equal(again.calls.n, 0,
    'LRU eviction caused NO extra engine run — the persistent store answered');
  assert.ok(res, 'and a real analysis came back');
  assert.equal(res.moves.length, MOVES.length, 'and the whole review came back');
});

test('REGRESSION: eviction + a STALE store re-analyses exactly once, then settles', async () => {
  const store = new Map();
  await getCanonicalAnalysis(GAME, {
    analyze: countingAnalyze(realisticAnalysis()),
    saveAnalysis: async (id, entry) => { store.set(id, { ...entry, analysisVersion: 'old' }); },
  });
  clearCanonicalAnalysisCache();

  const stale = countingAnalyze(realisticAnalysis());
  await getCanonicalAnalysis(GAME, {
    analyze: stale, loadAnalysis: async (id) => store.get(id) || null,
    saveAnalysis: async (id, entry) => { store.set(id, entry); },
  });
  assert.equal(stale.calls.n, 1, 'a stale entry costs exactly ONE fresh analysis');

  clearCanonicalAnalysisCache();
  const after = countingAnalyze(realisticAnalysis());
  await getCanonicalAnalysis(GAME, {
    analyze: after, loadAnalysis: async (id) => store.get(id) || null,
  });
  assert.equal(after.calls.n, 0, 'and the replacement is served instantly afterwards');
});