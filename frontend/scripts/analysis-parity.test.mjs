/* ──────────────────────────────────────────────────────────────────────────
 * Analysis parity: Game Review = Chess Profile = GM Game.
 *
 *   A = reviewGame(initFen, sans, { engine })              (Game Review path)
 *   B = analyzeCanonical(initFen, sans, { engine })        (Chess Profile path)
 *   C = analyzeGmGame(initFen, sans, { engine })           (GM Game path)
 *
 * All three adapters must run the same canonical pipeline with the same
 * engine config, so every compared field must be deeply identical (no
 * tolerances): verdict, CPL, best/played scores, WPD, accuracy, bestUci,
 * bestSan, forced status, sacrifice status, Sigma status, engine lines.
 *
 * Short games here; the tactical marquee (ordinary sacrifice, protected
 * sacrifice, GM game) lives in analysis-parity-marquee.test.mjs. The two
 * files run in parallel (separate processes/engines).
 *
 * Run: node --test scripts/analysis-parity.test.mjs
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { reviewGame } from '../src/utils/gameReview.js';
import { analyzeCanonical, resolveInitialFen } from '../src/utils/canonicalAnalysis.js';
import { createReviewEngine } from './nodeEngine.mjs';
import { loadTsLib } from './lib/tsLoad.mjs';
import { assertSurfacesEqual, assertNoSigma, sigmaSans } from './lib/analysisParity.mjs';

const GM_SRC = new URL('../src/lib/gmAnalysis.ts', import.meta.url);

const GAMES = [
  {
    name: 'normal game (Ruy Lopez)',
    initFen: 'start',
    sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6'],
    sigma: 'none',
  },
  {
    name: "tactical game ending in mate (scholar's mate)",
    initFen: 'start',
    sans: ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'],
    sigma: 'none',
  },
  {
    name: 'forced mate (fool\'s mate)',
    initFen: 'start',
    sans: ['f3', 'e5', 'g4', 'Qh4#'],
    sigma: 'none',
  },
  {
    name: 'quiet game (Najdorf)',
    initFen: 'start',
    sans: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'],
    sigma: 'none',
  },
  {
    name: 'gambit tactics (Danish)',
    initFen: 'start',
    sans: ['e4', 'e5', 'd4', 'exd4', 'c3', 'dxc3', 'Bc4', 'cxb2', 'Bxb2'],
    sigma: 'any',
  },
  {
    name: 'custom FEN game',
    initFen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
    sans: ['d4', 'exd4', 'Nxd4'],
    sigma: 'any',
  },
  {
    name: 'false positive: hanging queen with no follow-through',
    initFen: 'start',
    sans: ['e4', 'e5', 'Qh5', 'Nc6', 'Qxe5+', 'Nxe5'],
    sigma: 'none',
  },
  {
    name: 'false positive: knight taken cleanly with no compensation given',
    initFen: 'start',
    sans: ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'd6', 'Nxf7', 'Kxf7'],
    sigma: 'none',
  },
  {
    name: 'false positive: ordinary checking capture (Qxf7+)',
    initFen: 'start',
    sans: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7+'],
    sigma: 'none',
  },
  {
    name: 'false positive: defended piece taken with no attack (Bxf3)',
    initFen: 'start',
    sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'd6', 'O-O', 'Bg4', 'h3', 'Bxf3', 'Qxf3'],
    sigma: 'none',
  },
];

let engine;
let gm;

before(async () => {
  globalThis.__Chess = Chess;
  gm = await loadTsLib(GM_SRC);
  engine = await createReviewEngine();
}, { timeout: 180000 });

after(() => { try { engine.destroy(); } catch { /* already gone */ } });

async function analyseAll(game) {
  const initFen = game.initFen === 'start'
    ? resolveInitialFen({})
    : resolveInitialFen({ suppliedFen: game.initFen });
  assert.equal(initFen, game.initFen);
  const resA = await reviewGame(initFen, game.sans, { engine });
  const resB = await analyzeCanonical(initFen, game.sans, { engine });
  const rowsC = await gm.analyzeGmGame(initFen, game.sans, { engine });
  /* reviewGame truncates an illegal SAN tail instead of throwing, so a short
     row list means a bad test game, not a surface difference. */
  assert.equal(resA?.moves?.length, game.sans.length, `${game.name}: review truncated`);
  assert.equal(resB?.moves?.length, game.sans.length, `${game.name} (profile): truncated`);
  assert.equal(rowsC.length, game.sans.length, `${game.name} (gm): truncated`);
  return { resA, resB, rowsC };
}

for (const game of GAMES) {
  test(`${game.name}: identical across all three surfaces`, { timeout: 300000 }, async () => {
    const { resA, resB, rowsC } = await analyseAll(game);
    assertSurfacesEqual(resA, resB, rowsC, game.name);
    if (game.sigma === 'none') {
      assertNoSigma(resA.moves, `${game.name} (review)`);
      assertNoSigma(resB.moves, `${game.name} (profile)`);
      assertNoSigma(rowsC, `${game.name} (gm)`);
    } else {
      // Gambit/custom positions may genuinely contain a sacrifice — whatever
      // the canonical pipeline finds must simply be the same everywhere.
      assert.deepEqual(sigmaSans(rowsC), sigmaSans(resA.moves), `${game.name}: sigma set`);
    }
  });
}
