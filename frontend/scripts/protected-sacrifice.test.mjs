/* ──────────────────────────────────────────────────────────────────────────
 * Protected tactical sacrifices (the defended-offer path).
 *
 * Root cause: the loose geometry (sacrificeCandidate) demands `ourDef <
 * moved` — the offer must land loose. A genuine tactical sacrifice whose
 * piece stays defended (25...Bxg3: bishop lands on g3 under fire from the
 * f-pawn yet defended by the g4 rook, ourDef 500 ≥ moved 330) is rejected
 * there, so the whole Brilliant pipeline never sees it.
 *
 * The fix adds a second, generic path — NOT a special case:
 *   C. protectedSacrificeGeometry: same spend/collectability bars as a loose
 *      offer, but with the protected marker (ourDef ≥ moved) instead of the
 *      loose one. Geometry alone never blesses the move.
 *   D. protectedSacrificeValidated: promotes the offer ONLY on pre-existing
 *      settlement evidence (connected / forced mate / material winning) from
 *      the ACCEPT-line continuation — the opponent collects cheapest-first
 *      (acceptCaptureUcis) and the engine replies from there. A defended
 *      piece taken quietly dies here.
 * The Qxg3+ false positive is excluded by construction: the quiet
 * below asserts a defended offer with no compensation validates to false.
 *
 * Pure chess.js + settlement arithmetic — no engine, runs in milliseconds.
 *
 * Run: node --test scripts/protected-sacrifice.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  sacrificeCore,
  sacrificeCandidate,
  protectedSacrificeGeometry,
  protectedSacrificeValidated,
  acceptCaptureUcis,
  settledNetSacrifice,
  hasSettledSacrifice,
  describeSacrifice,
} from '../src/utils/reviewClassify.js';
import { BRILLIANT_SETTLED_MAX_PLIES } from '../src/utils/reviewConfig.js';

/* The 25...Bxg3!! game (Kotronias–Sutovsky style Sacramento simul line). */
const SANS = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'h6', 'O-O', 'Nf6', 'Nc3', 'b6',
  'd3', 'Bb7', 'Be3', 'Be7', 'h3', 'Nd4', 'Nxd4', 'exd4', 'Bxd4', 'c5', 'Be3',
  'd5', 'exd5', 'Nxd5', 'Nxd5', 'Bxd5', 'Bb5+', 'Kf8', 'c4', 'Be6', 'Qd2', 'a6',
  'Ba4', 'Bd6', 'Rad1', 'g5', 'Rfe1', 'Rg8', 'Re2', 'Ke7', 'Rde1', 'Qc7', 'Qc3',
  'g4', 'hxg4', 'Rxg4', 'Bxh6', 'Rag8', 'g3', 'Bxg3', 'fxg3', 'Qxg3+', 'Kf1', 'Qg1#'];

function positionBefore(plyIndex) {
  const g = new Chess();
  const fens = [g.fen()];
  const mvs = [];
  for (const san of SANS) {
    const mv = g.move(san);
    mvs.push(mv);
    fens.push(g.fen());
  }
  return { fens, mvs };
}

const { fens, mvs } = positionBefore();
const IDX = SANS.indexOf('Bxg3'); // 25...Bxg3
assert.equal(IDX, 49);
const FEN_BEFORE = fens[IDX];
const FEN_AFTER = fens[IDX + 1];
const MV = mvs[IDX];
const PREV = mvs[IDX - 1];
assert.equal(MV.from + MV.to, 'd6g3');

test('root cause: Bxg3 spends like a sacrifice but lands defended, so the loose geometry rejects it', () => {
  const c = sacrificeCore(FEN_BEFORE, MV, PREV);
  assert.ok(c, 'core facts exist');
  assert.equal(c.recapture, false);
  assert.equal(c.moved, 330);
  assert.equal(c.gained, 100);
  assert.equal(c.dealt, 230);
  assert.equal(c.canBeTaken, true);
  assert.equal(c.theirAtk, 100);
  assert.equal(c.theirCheapest, 100);
  assert.equal(c.ourDef, 500);
  assert.equal(c.ourKingDef, false);
  assert.equal(c.moved > c.theirCheapest, true);
  assert.equal(sacrificeCandidate(FEN_BEFORE, MV, PREV), false);
  assert.equal(protectedSacrificeGeometry(FEN_BEFORE, MV, PREV), true);
});

test('accept captures: only fxg3 can collect the bishop, cheapest-first', () => {
  assert.deepEqual(acceptCaptureUcis(FEN_AFTER, 'g3', 'b'), ['f2g3']);
  assert.deepEqual(acceptCaptureUcis(FEN_BEFORE, 'g3', 'b'), []);
});

test('generic positive: white knight offer 4.Nxe5, defended by the queen, validated by a checking recapture', () => {
  const g = new Chess();
  for (const san of ['e4', 'e5', 'Qh5', 'Nc6', 'Nf3', 'd6']) g.move(san);
  const fenBefore = g.fen();
  const offer = g.move('Nxe5');
  assert.ok(offer, 'Nxe5 is legal');
  const prev = g.history({ verbose: true }).slice(-2)[0];
  assert.equal(offer.from + offer.to, 'f3e5');

  const c = sacrificeCore(fenBefore, offer, prev);
  assert.equal(c.moved, 320);
  assert.equal(c.dealt >= 100, true);
  assert.equal(c.canBeTaken, true);
  assert.equal(sacrificeCandidate(fenBefore, offer, prev), false);
  assert.equal(protectedSacrificeGeometry(fenBefore, offer, prev), true);

  // Accept cheapest-first (d-pawn), then the queen recaptures with check.
  const after = g.fen();
  const accepts = acceptCaptureUcis(after, 'e5', 'w');
  assert.equal(accepts[0], 'd6e5');
  const settled = settledNetSacrifice(
    fenBefore, 'w', 'f3e5', ['d6e5', 'h5e5'],
    BRILLIANT_SETTLED_MAX_PLIES, null,
  );
  assert.ok(settled, 'settlement computed');
  assert.equal(settled.offeredTaken, true);
  assert.equal(settled.pressed, true);
  assert.equal(settled.checksInContinuation >= 1, true);
  assert.equal(protectedSacrificeValidated(settled), true);
  assert.equal(hasSettledSacrifice(settled), true);

  const described = describeSacrifice({
    san: 'Nxe5', mv: offer, settled, fenBefore, prevMv: prev, mover: 'w',
  });
  assert.equal(described.sacrificeDetected, true);
  assert.equal(described.protectedShape, true);
});

test('false positive guard: the same defended bishop taken quietly validates to false', () => {
  // Remove BLACK's queen (c7): the Qxg3+ mate attack behind the offer is gone,
  // so the accept line is a quiet take with nothing behind it. The white
  // queen is on c3 here, not d2; the black queen never defended g3 (its ray
  // is blocked by its own d6 bishop), so the protected shape is preserved.
  const g = new Chess(FEN_BEFORE);
  assert.ok(g.remove('c7'));
  const fpBefore = g.fen();
  const probe = new Chess(fpBefore);
  const offer = probe.move({ from: 'd6', to: 'g3' });
  assert.ok(offer, 'Bxg3 still legal without the white queen');

  assert.equal(sacrificeCandidate(fpBefore, offer, PREV), false);
  assert.equal(protectedSacrificeGeometry(fpBefore, offer, PREV), true);

  const fpAfter = probe.fen();
  assert.deepEqual(acceptCaptureUcis(fpAfter, 'g3', 'b'), ['f2g3']);

  const settled = settledNetSacrifice(
    fpBefore, 'b', 'd6g3', ['f2g3'],
    BRILLIANT_SETTLED_MAX_PLIES, null,
  );
  assert.ok(settled, 'settlement computed');
  assert.equal(settled.offeredTaken, true);
  assert.equal(settled.pressed, false);
  assert.equal(protectedSacrificeValidated(settled), false);

  const described = describeSacrifice({
    san: 'Bxg3', mv: offer, settled, fenBefore: fpBefore, prevMv: PREV, mover: 'b',
  });
  assert.equal(described.protectedShape, true);
  assert.equal(described.sacrificeDetected, false);
});

test('accept-line settlement of the real Bxg3 validates: taken, pressed, checking', () => {
  // Canned accept continuation (26.fxg3 26...Qxg3+ 27.Kf1 27...Qg1#, the moves
  // actually played — the black queen comes from c7, not c3): the same
  // evidence the production accept walk collects, without the engine.
  const settled = settledNetSacrifice(
    FEN_BEFORE, 'b', 'd6g3',
    ['f2g3', 'c7g3', 'g1f1', 'g3g1'],
    BRILLIANT_SETTLED_MAX_PLIES, null,
  );
  assert.ok(settled, 'settlement computed');
  assert.equal(settled.offeredTaken, true);
  assert.equal(protectedSacrificeValidated(settled), true);
  const described = describeSacrifice({
    san: 'Bxg3', mv: MV, settled, fenBefore: FEN_BEFORE, prevMv: PREV, mover: 'b',
  });
  assert.equal(described.sacrificeDetected, true);
  assert.equal(described.protectedShape, true);
});
