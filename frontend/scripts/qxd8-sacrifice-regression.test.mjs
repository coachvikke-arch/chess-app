/* ──────────────────────────────────────────────────────────────────────────
 * The supplied game, reviewed end to end: 26.Qxd8!! must be Sigma.
 *
 * Nagavel_Krishnamoorthi vs Prmdgtm (chess.com live 187595041982).
 * Before this regression the move was classified Best. Every Brilliant input
 * was already true — genuine sacrifice, settled net sacrifice, forced major-sac
 * window, near-best, attacking — except gate D (sacrificeAttribution): the
 * queen on d2 was ATTACKED before the move (by the rook it captures). The gate
 * read that as "already loose, the move did not create the offer".
 *
 * The refinement under test: when every profitable pre-move attacker is the
 * exact piece the move captures, the move answered the attack, so the fire the
 * piece stands in afterwards is its own concession.
 *
 * The negative cases pin the boundary: answering ONE attacker while another
 * profitable attacker remains is still "already loose", and a capture that
 * removes no attacker changes nothing.
 *
 * Run: node --test scripts/qxd8-sacrifice-regression.test.mjs
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { reviewGame, REVIEW_META } from '../src/utils/gameReview.js';
import { getDisplayVerdict } from '../src/utils/sigmaType.js';
import { sacrificeAttribution, attackValueBy, attackersOf } from '../src/utils/reviewClassify.js';
import { createReviewEngine } from './nodeEngine.mjs';

let engine;

before(async () => { engine = await createReviewEngine(); }, { timeout: 120000 });
after(() => { try { engine.destroy(); } catch { /* already gone */ } });

const GAME_MOVES = [
  'e4', 'e5', 'Nf3', 'Nc6', 'c3', 'Nf6', 'd3', 'Be7', 'Be3', 'O-O',
  'Be2', 'd5', 'Nbd2', 'dxe4', 'Nxe4', 'Nxe4', 'dxe4', 'Bg4', 'O-O', 'Bf6',
  'Qc2', 'Qe7', 'Nxe5', 'Bxe2', 'Nxc6', 'bxc6', 'Qxe2', 'Qxe4', 'Rfd1', 'Rfe8',
  'Rd3', 'c5', 'f3', 'Qe6', 'Re1', 'c4', 'Rd2', 'Bh4', 'g3', 'Bf6',
  'Qg2', 'Bg5', 'Rde2', 'Bxe3+', 'Rxe3', 'Qb6', 'Qd2', 'Rad8', 'Kf1', 'Rf8',
  'Qxd8', 'Qxe3', 'Qxf8+',
];

const moveFrom = (fen, san) => {
  const g = new Chess(fen);
  const mv = g.move(san, { verbose: true });
  assert.ok(mv, `${san} must be legal in ${fen}`);
  return mv;
};

/* The exact position before 26.Qxd8. */
const POS_26 = '3r1rk1/p1p2ppp/1q6/8/2p5/2P1RPP1/PP1Q3P/4RK2 w - - 5 26';

test('26.Qxd8 settles to Sigma through the canonical review', { timeout: 300000 }, async () => {
  const res = await reviewGame('start', GAME_MOVES, { engine });

  const row = res.moves.find((m) => m.san === 'Qxd8');
  assert.ok(row, '26.Qxd8 must be present in the review');
  assert.equal(row.uci, 'd2d8');
  assert.equal(row.verdict, 'sigma', `26.Qxd8 must be Sigma, got ${row.verdict}`);
  assert.equal(row.cpl, 0, 'the move is engine-best');
  assert.ok(row.sigma, 'the Sigma payload must be attached');
  assert.equal(row.sigma.type, 'queen_sacrifice');
  assert.equal(row.sigma.label, 'Queen Sacrifice');

  /* What every UI surface draws: MoveBadge / RankBadges / the Sigma list all
     map the stored 'sigma' id through getDisplayVerdict into the legacy
     'brilliant' key, whose label is the Brilliant (!!) badge. */
  assert.equal(getDisplayVerdict(row.verdict), 'brilliant');
  assert.equal(REVIEW_META[getDisplayVerdict(row.verdict)].label, 'Brilliant');

  /* The concession is real: the queen lands on a square the f8 rook attacks. */
  const after = new Chess(POS_26);
  after.move('Qxd8');
  assert.ok(after.moves({ verbose: true }).some((m) => m.from + m.to === 'f8d8'),
    'the f8 rook can take the offered queen — this is a genuine offer');

  /* No other capture in the game is promoted: the fix must not buy ordinary
     material grabs. The companion Qxf8+ is the same combination (the rook
     recovers the queen on e3), so it may also be Sigma — nothing else may. */
  const sigmas = res.moves.filter((m) => m.verdict === 'sigma').map((m) => m.san);
  assert.ok(sigmas.includes('Qxd8'), 'Qxd8 must be in the Sigma list');
  for (const san of ['Nxe5', 'Qxe2', 'Qxe4', 'Bxe3+', 'Rxe3', 'Nxc6']) {
    const r = res.moves.find((m) => m.san === san);
    assert.notEqual(r.verdict, 'sigma', `${san} must not be promoted — it is an ordinary capture`);
  }
});

/* ── gate D (sacrificeAttribution) — the gate that blocked Qxd8 ─────── */

test('attribution: capturing the only attacker counts as creating the offer', () => {
  const mv = moveFrom(POS_26, 'Qxd8');
  assert.equal(attackValueBy(new Chess(POS_26), 'd2', 'b'), 500,
    'fixture: the d8 rook attacks the queen on d2');
  assert.equal(attackersOf(new Chess(POS_26), 'd2', 'b').length, 1,
    'fixture: the d8 rook is the only pre-move attacker');
  assert.equal(sacrificeAttribution(POS_26, mv), true,
    'the capture answered the only threat — the offer is this move’s');
});

test('attribution: answering one attacker while another remains is still pre-existing', () => {
  /* Queen on d2 under BOTH the d8 rook and a b4 bishop; Qxb4 removes one. */
  const fen = '3r1rk1/8/8/8/1b6/8/3Q4/6K1 w - - 0 1';
  const mv = moveFrom(fen, 'Qxb4');
  assert.equal(sacrificeAttribution(fen, mv), false,
    'the rook still wins the queen — it was loose before the move');
});

test('attribution: a capture that removes no attacker changes nothing', () => {
  /* Queen on d2 under the d8 rook; it captures a bishop on e3 instead. */
  const fen = '3r1rk1/8/8/8/8/4b3/3Q4/6K1 w - - 0 1';
  const mv = moveFrom(fen, 'Qxe3');
  assert.equal(mv.captured, 'b');
  assert.equal(sacrificeAttribution(fen, mv), false,
    'the rook attack survives the move — still already hanging');
});

test('attribution: the captured piece must be the attacker, not merely nearby', () => {
  /* Queen on d2 under the d8 rook; it captures a knight on c3 instead. The
     rook's attack on the queen survives the move untouched. */
  const fen = '3r1rk1/8/8/8/8/2n5/3Q4/6K1 w - - 0 1';
  const mv = moveFrom(fen, 'Qxc3');
  assert.equal(mv.captured, 'n');
  assert.equal(sacrificeAttribution(fen, mv), false);
});
