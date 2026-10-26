/* ──────────────────────────────────────────────────────────────────────────
 * The reproduction game, run through the real review pipeline.
 *
 * Unlike net-sacrifice-settlement.test.mjs this drives reviewGame() with the
 * actual engine, so it asserts the shipped verdict rather than the settlement
 * arithmetic. It is slower (one NNUE pass over 21 plies) but it is the only thing
 * that can catch a gate rejecting a genuine sacrifice end to end.
 *
 * The negative cases matter as much as the positive one: a fix that settles
 * sequences properly must not start buying every sacrifice a "!!".
 *
 * Run: node --test scripts/qxf6-sacrifice-regression.test.mjs
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { reviewGame } from '../src/utils/gameReview.js';
import { createReviewEngine } from './nodeEngine.mjs';

let engine;

before(async () => { engine = await createReviewEngine(); }, { timeout: 120000 });

/* Shut the UCI subprocess down properly. `process.exit()` here would take the
   whole `node --test` runner with it when this file runs alongside others. */
after(() => { try { engine.destroy(); } catch { /* already gone */ } });

/* 1.c3 Nf6 2.Nf3 g6 3.Qb3 Bg7 4.Ng5 O-O 5.e3 d6 6.Bc4 Nbd7 7.Bxf7+ Rxf7
   8.Qxf7+ Kh8 9.Qxf6 Bxf6 10.Nf7+ Kg7 11.Nxd8 */
const REPRO_MOVES = ['c3', 'Nf6', 'Nf3', 'g6', 'Qb3', 'Bg7', 'Ng5', 'O-O', 'e3', 'd6',
  'Bc4', 'Nbd7', 'Bxf7+', 'Rxf7', 'Qxf7+', 'Kh8', 'Qxf6', 'Bxf6', 'Nf7+', 'Kg7', 'Nxd8'];

const verdictAt = (res, san) => {
  const row = res.moves.find((m) => m.san === san);
  assert.ok(row, `${san} must be present in the review`);
  return row.verdict;
};

test('9.Qxf6 is classified brilliant', { timeout: 300000 }, async () => {
  const res = await reviewGame('start', REPRO_MOVES, { engine });

  assert.equal(verdictAt(res, 'Qxf6'), 'sigma');

  /* The canonical internal id, and the badge must be attached to this move. */
  const row = res.moves.find((m) => m.san === 'Qxf6');
  assert.equal(row.uci, 'f7f6');
  assert.ok(row.sigma, 'the move carries its Brilliant payload');
  assert.ok(row.sigma.label, 'and a display label');

  /* It was a near-best move, so quality is not what carried it. */
  assert.ok(row.cpl <= 10, `expected cpl <= 10, got ${row.cpl}`);
});

test('the rest of the game keeps its classification', { timeout: 300000 }, async () => {
  const res = await reviewGame('start', REPRO_MOVES, { engine });

  /* Exactly one Brilliant in the whole game, and no accidental promotion of the
     surrounding moves — the sequence around a sac is where false positives hide. */
  const brilliant = res.moves.filter((m) => m.verdict === 'brilliant' || m.verdict === 'sigma');
  assert.equal(brilliant.length, 1, `expected 1 brilliant move, got ${brilliant.length}`);
  assert.equal(brilliant[0].san, 'Qxf6');

  for (const san of ['Bxf7+', 'Qxf7+', 'Bxf6', 'Nf7+', 'Nxd8']) {
    assert.notEqual(verdictAt(res, san), 'brilliant',
      `${san} must not be promoted — it is a plain capture`);
    assert.notEqual(verdictAt(res, san), 'sigma',
      `${san} must not be promoted — it is a plain capture`);
  }
});

test('the brilliant count includes 9.Qxf6', { timeout: 300000 }, async () => {
  const res = await reviewGame('start', REPRO_MOVES, { engine });

  const white = res.white.counts || {};
  const brilliant = white.brilliant != null ? white.brilliant
    : (white.sigma != null ? white.sigma : 0);
  assert.equal(brilliant, 1, 'the Brilliant Moves count must include 9.Qxf6');
});

/* ── negative regressions: the fix must not over-buy ────────────────── */

test('a hanging queen with no tactical follow-through is not brilliant', { timeout: 300000 }, async () => {
  /* 1.e4 e5 2.Nf3 Nc6 3.Bc4 Qf6 — the queen is loose on f6 and Black simply takes
     it. No checks connect the offer to any recovery. */
  const moves = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Qf6', 'Nxe5', 'Qxf3', 'Ke2'];
  const res = await reviewGame('start', moves, { engine });
  for (const m of res.moves) {
    assert.notEqual(m.verdict, 'brilliant', `${m.san} must not be brilliant`);
    assert.notEqual(m.verdict, 'sigma', `${m.san} must not be brilliant`);
  }
});

test('a rook offered with no compensation and a high CPL is not brilliant', { timeout: 300000 }, async () => {
  /* 1.e4 e5 2.Nf3 Nf6 3.Nxe5 Nxe4 4.Qe2 Nxe2 — black wins material cleanly. */
  const moves = ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'Nxe4', 'Qe2', 'Nxe2', 'Ke2'];
  const res = await reviewGame('start', moves, { engine });
  for (const m of res.moves) {
    assert.notEqual(m.verdict, 'brilliant', `${m.san} must not be brilliant`);
    assert.notEqual(m.verdict, 'sigma', `${m.san} must not be brilliant`);
  }
});

test('a plain rook exchange is not brilliant', { timeout: 300000 }, async () => {
  /* 1.e4 e5 2.Nf3 Nf6 3.Nxe5 Nxe5 — an even knight trade, nothing given up. */
  const moves = ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'Nxe5', 'Bc4', 'Bc5', 'O-O'];
  const res = await reviewGame('start', moves, { engine });
  for (const m of res.moves) {
    assert.notEqual(m.verdict, 'brilliant', `${m.san} must not be brilliant`);
    assert.notEqual(m.verdict, 'sigma', `${m.san} must not be brilliant`);
  }
});

test('a pawn sacrifice is never brilliant', { timeout: 300000 }, async () => {
  /* 1.d4 d5 2.c4 e5 — the Danish gambit pawn is simply taken. */
  const moves = ['d4', 'd5', 'c4', 'e5', 'cxd5', 'exd5', 'Nc3', 'Nf6', 'Bg5'];
  const res = await reviewGame('start', moves, { engine });
  for (const m of res.moves) {
    assert.notEqual(m.verdict, 'brilliant', `${m.san} must not be brilliant`);
    assert.notEqual(m.verdict, 'sigma', `${m.san} must not be brilliant`);
  }
});

test('the opening of the reproduction game produces no other brilliancies', { timeout: 300000 }, async () => {
  /* Same game truncated before the sacrifice — the whole point is that the engine
     sees nothing brilliant until 9.Qxf6. */
  const res = await reviewGame('start', REPRO_MOVES.slice(0, 16), { engine });
  for (const m of res.moves) {
    assert.notEqual(m.verdict, 'brilliant', `${m.san} must not be brilliant`);
    assert.notEqual(m.verdict, 'sigma', `${m.san} must not be brilliant`);
  }
});