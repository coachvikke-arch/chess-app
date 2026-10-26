/* ──────────────────────────────────────────────────────────────────────────
 * Analysis parity, tactical marquee: ordinary sacrifice, protected tactical
 * sacrifice, and a full GM game — each through all three surfaces.
 *
 *   A = reviewGame(initFen, sans, { engine })              (Game Review path)
 *   B = analyzeCanonical(initFen, sans, { engine })        (Chess Profile path)
 *   C = analyzeGmGame(initFen, sans, { engine })           (GM Game path)
 *
 * Critical regressions:
 *   25...Bxg3!! → Sigma on Game Review AND Chess Profile AND GM Game.
 *   26...Qxg3+  → non-Sigma on all three (it must never replace Bxg3).
 *   9.Qxf6      → Sigma on all three (ordinary sacrifice control).
 *
 * Runs in parallel with analysis-parity.test.mjs (separate process/engine).
 *
 * Run: node --test scripts/analysis-parity-marquee.test.mjs
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { reviewGame } from '../src/utils/gameReview.js';
import { analyzeCanonical } from '../src/utils/canonicalAnalysis.js';
import { classifySideMove } from '../src/utils/reviewSideLine.js';
import { createReviewEngine } from './nodeEngine.mjs';
import { loadTsLib } from './lib/tsLoad.mjs';
import { assertSurfacesEqual, assertNoSigma, sigmaSans } from './lib/analysisParity.mjs';

const GM_SRC = new URL('../src/lib/gmAnalysis.ts', import.meta.url);

/* Ordinary sacrifice control (proven Sigma in the qxf6 suite). */
const QXF6_SANS = ['c3', 'Nf6', 'Nf3', 'g6', 'Qb3', 'Bg7', 'Ng5', 'O-O', 'e3', 'd6',
  'Bc4', 'Nbd7', 'Bxf7+', 'Rxf7', 'Qxf7+', 'Kh8', 'Qxf6', 'Bxf6', 'Nf7+', 'Kg7', 'Nxd8'];

/* Protected tactical sacrifice regression game. */
const BXG3_SANS = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'h6', 'O-O', 'Nf6', 'Nc3', 'b6',
  'd3', 'Bb7', 'Be3', 'Be7', 'h3', 'Nd4', 'Nxd4', 'exd4', 'Bxd4', 'c5', 'Be3',
  'd5', 'exd5', 'Nxd5', 'Nxd5', 'Bxd5', 'Bb5+', 'Kf8', 'c4', 'Be6', 'Qd2', 'a6',
  'Ba4', 'Bd6', 'Rad1', 'g5', 'Rfe1', 'Rg8', 'Re2', 'Ke7', 'Rde1', 'Qc7', 'Qc3',
  'g4', 'hxg4', 'Rxg4', 'Bxh6', 'Rag8', 'g3', 'Bxg3', 'fxg3', 'Qxg3+', 'Kf1', 'Qg1#'];

/* GM game: Morphy vs Duke Karl & Count Isouard, Paris Opera 1858. A GM game is
 * only different in SOURCE — it runs the identical pipeline with identical
 * config, and no GM-specific threshold may alter a single verdict. */
const OPERA_SANS = ['e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4', 'dxe5', 'Bxf3',
  'Qxf3', 'dxe5', 'Bc4', 'Nf6', 'Qb3', 'Qe7', 'Nc3', 'c6', 'Bg5', 'b5',
  'Nxb5', 'cxb5', 'Bxb5+', 'Nbd7', 'O-O-O', 'Rd8', 'Rxd7', 'Rxd7', 'Rd1',
  'Qe6', 'Bxd7+', 'Nxd7', 'Qb8+', 'Nxb8', 'Rd8#'];

let engine;
let gm;

before(async () => {
  globalThis.__Chess = Chess;
  gm = await loadTsLib(GM_SRC);
  engine = await createReviewEngine();
}, { timeout: 180000 });

after(() => { try { engine.destroy(); } catch { /* already gone */ } });

async function analyseAll(sans, initFen = 'start') {
  const resA = await reviewGame(initFen, sans, { engine });
  const resB = await analyzeCanonical(initFen, sans, { engine });
  const rowsC = await gm.analyzeGmGame(initFen, sans, { engine });
  /* reviewGame truncates an illegal SAN tail instead of throwing, so a short
     row list means a bad test game, not a surface difference. */
  assert.equal(resA?.moves?.length, sans.length, 'review truncated');
  assert.equal(resB?.moves?.length, sans.length, 'profile truncated');
  assert.equal(rowsC.length, sans.length, 'gm truncated');
  return { resA, resB, rowsC };
}

const verdictOf = (entries, san) => {
  const row = entries.find((m) => m.san === san);
  assert.ok(row, `${san} must be present`);
  return row.verdict;
};

test('ordinary sacrifice (9.Qxf6): identical, Sigma everywhere', { timeout: 600000 }, async () => {
  const { resA, resB, rowsC } = await analyseAll(QXF6_SANS);
  assertSurfacesEqual(resA, resB, rowsC, 'qxf6 game');
  for (const [entries, label] of [[resA.moves, 'review'], [resB.moves, 'profile'], [rowsC, 'gm']]) {
    assert.equal(verdictOf(entries, 'Qxf6'), 'sigma', `Qxf6 must be Sigma (${label})`);
  }
  assert.deepEqual(sigmaSans(rowsC), ['Qxf6']);
});

test('protected sacrifice (25...Bxg3): identical, Sigma everywhere, Qxg3+ never replaces it', { timeout: 600000 }, async () => {
  const { resA, resB, rowsC } = await analyseAll(BXG3_SANS);
  assertSurfacesEqual(resA, resB, rowsC, 'bxg3 game');
  for (const [entries, label] of [[resA.moves, 'review'], [resB.moves, 'profile'], [rowsC, 'gm']]) {
    assert.equal(verdictOf(entries, 'Bxg3'), 'sigma', `Bxg3 must be Sigma (${label})`);
    assert.notEqual(verdictOf(entries, 'Qxg3+'), 'sigma', `Qxg3+ must not be Sigma (${label})`);
    assert.notEqual(verdictOf(entries, 'Qxg3+'), 'brilliant', `Qxg3+ must not be Brilliant (${label})`);
  }
});

test('GM game (Opera 1858): identical everywhere, no GM-specific grading', { timeout: 600000 }, async () => {
  const { resA, resB, rowsC } = await analyseAll(OPERA_SANS);
  assertSurfacesEqual(resA, resB, rowsC, 'opera game');
});

test('side-line classifier shares the protected path: Bxg3 from its position is Sigma', { timeout: 300000 }, async () => {
  const g = new Chess();
  for (const san of BXG3_SANS.slice(0, BXG3_SANS.indexOf('Bxg3'))) g.move(san);
  const row = await classifySideMove(g.fen(), { san: 'Bxg3', ply: 49, engine });
  assert.ok(row, 'sideline row produced');
  assert.equal(row.verdict, 'sigma', 'a variation Bxg3 gets the canonical Sigma');
  assert.equal(row.uci, 'd6g3');
});
