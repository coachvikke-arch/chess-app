/* ──────────────────────────────────────────────────────────────────────────
 * 25...Bxg3!! end to end: the defended-offer path through the real pipeline.
 *
 * The bishop lands on g3 defended by the g4 rook (ourDef 500 ≥ moved 330),
 * so the loose geometry rejects it; the protected path (accept-line walk:
 * 26.fxg3 26...Qxg3+ ...) must promote it to a genuine sacrifice and the
 * verdict must come out Sigma. 26...Qxg3+ itself must NOT be Sigma — it is
 * the replacement killer: a checking capture with no sacrifice behind it.
 *
 * One full review is shared by all tests (54 plies + accept-walk searches).
 *
 * Run: node --test scripts/bxg3-sigma-regression.test.mjs
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { reviewGame } from '../src/utils/gameReview.js';
import { createReviewEngine } from './nodeEngine.mjs';

let engine;
let res;

const SANS = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'h6', 'O-O', 'Nf6', 'Nc3', 'b6',
  'd3', 'Bb7', 'Be3', 'Be7', 'h3', 'Nd4', 'Nxd4', 'exd4', 'Bxd4', 'c5', 'Be3',
  'd5', 'exd5', 'Nxd5', 'Nxd5', 'Bxd5', 'Bb5+', 'Kf8', 'c4', 'Be6', 'Qd2', 'a6',
  'Ba4', 'Bd6', 'Rad1', 'g5', 'Rfe1', 'Rg8', 'Re2', 'Ke7', 'Rde1', 'Qc7', 'Qc3',
  'g4', 'hxg4', 'Rxg4', 'Bxh6', 'Rag8', 'g3', 'Bxg3', 'fxg3', 'Qxg3+', 'Kf1', 'Qg1#'];

/* ONE hook: create the engine, then review. (Two sequential `before` hooks
   did not run in definition order here — the review ran before the engine
   was assigned and fell back to the browser worker build.) */
before(async () => {
  engine = await createReviewEngine();
  res = await reviewGame('start', SANS, { engine });
  for (const m of res.moves) {
    // eslint-disable-next-line no-console
    console.log(`${m.san.padEnd(8)} ${String(m.verdict).padEnd(10)} cpl=${m.cpl}`);
  }
}, { timeout: 600000 });

after(() => { try { engine.destroy(); } catch { /* already gone */ } });

const verdictAt = (san) => {
  const row = res.moves.find((m) => m.san === san);
  assert.ok(row, `${san} must be present in the review`);
  return row.verdict;
};

test('25...Bxg3 is Sigma', () => {
  assert.equal(verdictAt('Bxg3'), 'sigma');
  const row = res.moves.find((m) => m.san === 'Bxg3');
  assert.equal(row.uci, 'd6g3');
  assert.ok(row.cpl <= 10, `expected cpl <= 10, got ${row.cpl}`);
  assert.ok(row.sigma, 'the move carries its Sigma payload');
  assert.ok(row.sigma.label, 'and a display label');
});

test('26...Qxg3+ is not Sigma — the checking capture is no sacrifice', () => {
  assert.notEqual(verdictAt('Qxg3+'), 'sigma');
  assert.notEqual(verdictAt('Qxg3+'), 'brilliant');
});

test('the surrounding captures are not promoted', () => {
  for (const san of ['Rxg4', 'Bxh6', 'Qg1#']) {
    assert.notEqual(verdictAt(san), 'sigma', `${san} must not be Sigma`);
    assert.notEqual(verdictAt(san), 'brilliant', `${san} must not be Brilliant`);
  }
});
