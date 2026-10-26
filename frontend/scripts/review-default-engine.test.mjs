// Regression test for the gameReview() default-engine path — the one the
// BROWSER takes and the Node harnesses never did.
//
//   run: node --test scripts/review-default-engine.test.mjs   (from frontend/)
//
// gameReview.js imports the engine as `searchTopMoves as realSearchTopMoves` at
// MODULE scope, then declared `const realSearchTopMoves = engine && ... ?
// engine.searchTopMoves : realSearchTopMoves` INSIDE reviewGame(). The inner
// const shadows the import across the whole function body — including its own
// initializer — so when `engine` is omitted the fallback read hit a temporal
// dead zone and threw:
//
//     Review failed — Cannot access 'realSearchTopMoves' before initialization
//
// Every Node harness (review-determinism, review-bench, check-sacs, …) passes a
// stub `engine`, which selects the OTHER ternary branch, so the suite stayed
// green while the only branch real users hit was broken. The production
// callers — reviewRunner.js (Review page), ChessProfile.jsx and
// gameAnalysis.js — all omit `engine`.
//
// So: the engine module is stubbed here, and reviewGame() is called with NO
// `engine`, which is exactly the browser call. It must produce a real review
// and must never throw a TDZ ReferenceError.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, cpSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Chess } from 'chess.js';

const UTILS = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'utils');

/* A tiny deterministic stand-in for the NNUE pool. The point is not engine
   quality — it is that reviewGame() REACHES the engine at all without an
   `engine` option. `searchTopMoves` must answer with a MultiPV list carrying
   real uci moves, or the classifier has nothing to score. */
const calls = { searchTopMoves: 0, evaluateGame: 0 };
function engineModule() {
  return `
    export const searchTopMoves = async (fen, opts = {}) => {
      globalThis.__engineCalls.searchTopMoves += 1;
      const g = new (globalThis.__Chess)();
      const legal = g.moves();
      return legal.slice(0, Math.max(1, opts.multiPv ?? 1)).map((m, i) => ({
        rank: i + 1,
        uci: m.from + m.to + (m.promotion || ''),
        from: m.from,
        to: m.to,
        promotion: m.promotion || null,
        score: 20 - i * 5,
        mate: null,
        depth: opts.maxDepth ?? 18,
        pv: [m.from + m.to],
        san: m.san,
      }));
    };
    export const evaluateGame = async (fen, opts = {}) => {
      globalThis.__engineCalls.evaluateGame += 1;
      return { pawns: 0.2, score: 20, mate: null, depth: opts.maxDepth ?? 18 };
    };
  `;
}

/* Copy src/utils to a temp dir INSIDE the project with ./nnueEngine.js replaced
   by the stub, so gameReview.js's real import specifier resolves to it. The copy
   lives under the project so bare specifiers (chess.js) still resolve through
   node_modules; nothing else about the pipeline is altered — the classification
   code under test is the real one.

   IMPORTANT: the copy MUST be removed afterwards. It sits inside `src/`, which
   the Vite dev server watches, so a leftover `.tmp-gr-default-*` directory is a
   full duplicate of src/utils being watched by the running app — duplicated
   module instances and HMR churn in dev. An earlier version of this test leaked
   them (that is where the stale dirs found in src/ came from; they were briefly
   suspected of breaking Play Arena). We therefore clean up in `after()`, on
   process exit, and sweep any stragglers left by an earlier run. */
const TEMP_PREFIX = '.tmp-gr-default-';

function sweepStaleTempDirs() {
  for (const entry of readdirSync(dirname(UTILS), { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith(TEMP_PREFIX)) {
      try {
        rmSync(join(dirname(UTILS), entry.name), { recursive: true, force: true });
      } catch { /* best effort */ }
    }
  }
}
sweepStaleTempDirs();

const tempRoots = [];

function loadReview() {
  const base = mkdtempSync(join(dirname(UTILS), TEMP_PREFIX));
  tempRoots.push(base);
  const root = join(base, 'utils');
  cpSync(UTILS, root, { recursive: true });
  writeFileSync(join(root, 'nnueEngine.js'), engineModule());
  return import(pathToFileURL(join(root, 'gameReview.js')).href);
}

function cleanupTempDirs() {
  for (const base of tempRoots) {
    try { rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  tempRoots.length = 0;
}

after(cleanupTempDirs);
process.on('exit', cleanupTempDirs);

globalThis.__Chess = Chess;
globalThis.__engineCalls = calls;
const { reviewGame } = await loadReview();

test('reviewGame with NO engine option does not throw a TDZ error', async () => {
  /* This is the exact production call shape: reviewRunner / ChessProfile /
     gameAnalysis pass no `engine`. Before the fix this rejected with
     "Cannot access 'realSearchTopMoves' before initialization". */
  const res = await reviewGame('start', SANS, { bookLookup: async () => null });

  assert.ok(res, 'reviewGame must return a result when no engine is passed');
  assert.ok(Array.isArray(res.moves) && res.moves.length > 0,
    'the review must contain moves');
});

test('the default engine is actually reached (not silently skipped)', async () => {
  calls.searchTopMoves = 0;
  await reviewGame('start', SANS, { bookLookup: async () => null });
  /* If the default engine were never wired up, the review would "succeed" with
     empty rows — a silent regression rather than a crash. Assert we drove it. */
  assert.ok(calls.searchTopMoves > 0,
    'the default (imported) engine must be used when no engine option is given');
});

test('per-move verdicts are still produced (classification intact)', async () => {
  const res = await reviewGame('start', SANS, { bookLookup: async () => null });
  for (const m of res.moves) {
    assert.equal(typeof m.san, 'string', 'each move keeps its SAN');
    assert.equal(typeof m.player, 'string', 'each move keeps its player');
    assert.ok(typeof m.verdict === 'string' && m.verdict.length > 0,
      `move ${m.ply} (${m.san}) must carry a verdict, got ${JSON.stringify(m.verdict)}`);
  }
  assert.equal(res.moves.length, SANS.length, 'every ply is classified');
});

test('an explicit engine option still overrides the default', async () => {
  let used = 0;
  const stub = {
    searchTopMoves: async (fen, opts = {}) => {
      used += 1;
      const m = new Chess().moves()[0];
      return [{ rank: 1, uci: m.from + m.to, from: m.from, to: m.to,
                promotion: null, score: 10, mate: null, depth: opts.maxDepth ?? 18,
                pv: [m.from + m.to], san: m.san }];
    },
    evaluateGame: async () => ({ pawns: 0.1, score: 10, mate: null, depth: 18 }),
  };
  const before = calls.searchTopMoves;
  await reviewGame('start', SANS, { engine: stub, bookLookup: async () => null });
  assert.ok(used > 0, 'the injected engine must be used when provided');
  assert.equal(calls.searchTopMoves, before,
    'the default engine must NOT be consulted when one is injected');
});


/* Morphy's Opera Game opening — short, legal, every ply classified. */
const SANS = 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3'.split(' ');
