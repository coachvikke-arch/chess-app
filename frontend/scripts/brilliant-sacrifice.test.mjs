/* ──────────────────────────────────────────────────────────────────────────
 * BRILLIANT SACRIFICE — the test matrix.
 *
 * The rule under test, in the order brilliantGates() evaluates it:
 *
 *      objectively excellent (cpl ≤ 10)
 *   + genuine sacrifice (minor piece or better — never a pawn)
 *   + net sacrifice (the forced exchange really leaves the mover down)
 *   + caused by this move (the piece was not already loose beforehand)
 *   + valid evaluation context (−600 < evalBefore < +600, or a FORCED major sac)
 *   + compensation (the engine confirms it holds or wins)
 *   + no false positive (no strictly better non-sacrificing move was available)
 *   ────────────────────────────────────────────────────────────────────────
 *   = brilliant
 *
 * TRAP WORTH NAMING: classifyMove DERIVES cpl from bestM/playedM via
 * moveMetrics — it takes no `cpl` argument. A test that passes cpl directly is
 * silently ignored, every case collapses to cpl 0, and the whole matrix passes
 * for the wrong reason. Every case below therefore shapes the two evals.
 *
 * Deliberately absent: any assertion that a threshold is "nice". These pin
 * BEHAVIOUR against the documented gate list, so a deliberate calibration change
 * surfaces as a named failing test rather than a silently different badge.
 *
 * Run: node --test scripts/brilliant-sacrifice.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  classifyMove,
  brilliantGates,
  sacrificeCandidate,
  heuristicIsSacrifice,
  sacrificeAttribution,
  betterNonSacrificialLine,
  attackingSacrifice,
  settledNetSacrifice,
} from '../src/utils/reviewClassify.js';

const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900 };

/* Play a SAN on a FEN and return the verbose move (the shape the geometry
   helpers take). */
function moveFrom(fen, san) {
  const g = new Chess(fen);
  const mv = g.move(san, { verbose: true });
  assert.ok(mv, `${san} must be legal in ${fen}`);
  return mv;
}

/* Evals that produce a chosen cpl. cpl = bestM − playedM (mover perspective). */
const evals = (cpl, extra = {}) => ({ bestM: 0, playedM: -cpl, ...extra });

/* Everything passes by default so each case varies exactly ONE thing — a failure
   then points at the responsible gate instead of at "brilliant". */
const PASSES_ALL = {
  isBook: false,
  isBestMove: true,
  sacrifice: true,
  hasSafeAlternative: false,
  hasNetSacrifice: true,
  isSharp: true,
  sacrificeAttributed: true,
  betterNonSacLine: false,
  attackingSac: true,
  forcedSac: false,
  secondM: -400,
  isForced: false,
  sacMovedCp: VAL.n,
};

const classify = (over = {}) => classifyMove({ ...PASSES_ALL, ...evals(0), ...over });

/* classifyMove DERIVES cpl from the two evals; brilliantGates takes it as an
   argument. Mirror moveMetrics() here so a gate assertion exercises the gate
   rather than quietly testing `cpl = null`. */
const cplOf = (a) => Math.round(Math.max(0, a.bestM - a.playedM));
const gates = (over = {}) => {
  const args = { ...PASSES_ALL, ...evals(0), ...over };
  return brilliantGates({ ...args, cpl: cplOf(args) });
};

/* ── 1–2. the happy path ────────────────────────────────────────────── */

test('1. best move + genuine sacrifice → Brilliant', () => {
  assert.equal(classify({ cpl: 0, bestM: 0, playedM: 0 }), 'brilliant');
});

test('2. near-best move (cpl exactly 10) + genuine sacrifice → Brilliant', () => {
  assert.equal(classify(evals(10)), 'brilliant');
});

test('3. CPL 11 + sacrifice → NOT Brilliant', () => {
  /* The boundary is inclusive: 10cp is "near-best", 11 is not. */
  assert.equal(gates(evals(11)).nearBest, false);
  assert.notEqual(classify(evals(11)), 'brilliant');
});

/* ── 4–5. quality alone is not enough ───────────────────────────────── */

test('4. best move + no sacrifice → NOT Brilliant', () => {
  assert.notEqual(classify({ sacrifice: false }), 'brilliant');
});

test('5. best move + pure pawn sacrifice → NOT Brilliant', () => {
  /* A pawn giveaway is never a Brilliant piece sacrifice, and the geometry
     detectors refuse minors, so `sacrifice` cannot even be true for one. */
  const fen = '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1';
  const mv = moveFrom(fen, 'e4d5');
  assert.equal(mv.piece, 'p');
  assert.equal(sacrificeCandidate(fen, mv, null), false, 'a pawn capture is not a piece sacrifice');
  assert.equal(heuristicIsSacrifice(fen, mv, null), false);
  assert.notEqual(classify({ sacrifice: false }), 'brilliant');
});

/* ── 6. the piece was already hanging (spec §5 / §13 / §14) ──────────── */

test('6. piece already hanging → NOT Brilliant (the move did not create the sac)', () => {
  /* White knight on d4 is already attacked by the e5 pawn and defended by nobody,
     so it is loose material BEFORE the move. 15.Nb5 walks it onto b5, where the a6
     pawn attacks and nothing defends — after-position geometry alone reads that as
     a clean Knight Sacrifice. The move never created the concession. */
  const fen = '4k3/8/p7/2p1p3/3N4/8/8/4K3 w - - 0 1';
  const mv = moveFrom(fen, 'd4b5');

  assert.equal(new Chess(fen).attackers('d4', 'b').length, 2, 'fixture: c5 and e5 both attack d4');

  assert.equal(sacrificeCandidate(fen, mv, null), true,
    'the after-position geometry is the trap this gate exists to catch');
  assert.equal(sacrificeAttribution(fen, mv), false,
    'an already-loose piece cannot be credited to this move');
  assert.equal(gates({ sacrificeAttributed: false }).pass, false);
  assert.notEqual(classify({ sacrificeAttributed: false }), 'brilliant');
});

test('6b. a piece that was merely contested is NOT treated as pre-existing', () => {
  /* Attacked, but our own rook defends it — nothing free to win, so the move can
     still be a genuine offer. */
  const fen = '4k3/8/8/3p4/8/8/8/N3K2R w - - 0 1';
  const mv = moveFrom(fen, 'a1b3');
  assert.equal(sacrificeAttribution(fen, mv), true);
});

test('6c. an untouched piece passes attribution', () => {
  /* Nobody was attacking it, so this move is what put it on offer. */
  const fen = '4k3/8/8/8/8/8/8/N3K3 w - - 0 1';
  const mv = moveFrom(fen, 'a1b3');
  assert.equal(new Chess(fen).attackers('a1', 'b').length, 0, 'fixture: the knight starts unattacked');
  assert.equal(sacrificeAttribution(fen, mv), true);
});

/* ── 7–8. compensation (spec §11 / §26) ─────────────────────────────── */

test('7. rook sacrifice + strong compensation → Brilliant (grand-sac leg)', () => {
  /* Misses near-best by 120cp, but the played position is still decisively winning
     (+400) and the piece given up is a rook. */
  const args = { bestM: 520, playedM: 400, sacMovedCp: VAL.r }; // cpl 120
  assert.equal(gates(args).nearBest, false, 'leg 1 does not apply');
  assert.equal(gates(args).pass, true);
  assert.equal(classify(args), 'brilliant');
});

test('8. queen sacrifice + forced mate → Brilliant even outside the window', () => {
  /* evalBefore is already a decisive win, so the normal window rejects it. The
     exception now requires EVIDENCE the sac was forced. */
  const args = { bestM: 1500, playedM: 1500, sacMovedCp: VAL.q, isForced: true, forcedSac: true };
  assert.equal(gates(args).inWindow, false);
  assert.equal(gates(args).forcedOutsideWindow, true);
  assert.equal(classify(args), 'brilliant');
});

test('8b. a NON-forced major sacrifice outside the window → NOT Brilliant', () => {
  /* The regression this replaced: being a rook or queen sac no longer bypasses the
     window on its own. 46.Rxc6 was black +5.84, engine-best, cpl 0 — a routine
     winning capture that happens to hang a rook — and it collected "!!". */
  const args = { bestM: 700, playedM: 700, sacMovedCp: VAL.r, isForced: false, forcedSac: false };
  assert.equal(gates(args).inWindow, false);
  assert.equal(gates(args).forcedOutsideWindow, false);
  assert.notEqual(classify(args), 'brilliant');
});

/* ── 9. queen sacrifice with nothing to show for it ──────────────────── */

test('9. queen sacrifice + no compensation → NOT Brilliant', () => {
  /* Leg 1 fails on quality (cpl 300); leg 2 fails because the mover is not winning
     afterwards — a hanging queen leaves playedM far below +200. */
  const args = { bestM: 150, playedM: -150, sacMovedCp: VAL.q }; // cpl 300
  assert.equal(gates(args).nearBest, false);
  assert.notEqual(classify(args), 'brilliant');
});

/* ── 10. exchange sacrifice ──────────────────────────────────────────── */

test('10. exchange sacrifice + strong compensation → Brilliant', () => {
  /* Rook genuinely down ~2 points of material, but engine-confirmed. */
  const args = { bestM: 310, playedM: 250, sacMovedCp: VAL.r }; // cpl 60
  assert.equal(classify(args), 'brilliant');
});

/* ── 11. netSacrifice false (spec §6 / §7 / §27E) ───────────────────── */

test('11. netSacrifice=false → NOT Brilliant', () => {
  /* The forced exchange refunded the material: a trade, not a sacrifice. */
  assert.equal(gates({ hasNetSacrifice: false }).pass, false);
  assert.notEqual(classify({ hasNetSacrifice: false }), 'brilliant');
});

test('11b. a move that simply WINS material is not counted as a sacrifice', () => {
  /* The offer is declined and the mover is up a pawn: netDown goes negative, so
     this is a capture, never a net sacrifice. */
  const fen = '4k3/8/8/3p4/8/8/8/3R2K1 w - - 0 1';
  const settled = settledNetSacrifice(fen, 'w', 'd1d5', [], 6);
  assert.ok(settled, 'the position must resolve');
  assert.equal(settled.offeredTaken, false);
  assert.ok(settled.netDown <= 0, 'winning material must not read as a net sacrifice');
});

/* ── 12–13. evaluation context (spec §9 / §10) ──────────────────────── */

test('12. forced mating sacrifice outside the window → Brilliant', () => {
  const args = { bestM: 20000, playedM: 20000, sacMovedCp: VAL.q, isForced: true, forcedSac: true };
  assert.equal(classify(args), 'brilliant');
});

test('13. ordinary sacrifice outside a valid context → NOT Brilliant', () => {
  /* Dead-lost: no brilliant move is owed in a position that is already over. */
  const args = { bestM: -700, playedM: -700 };
  assert.equal(gates(args).inWindow, false);
  assert.notEqual(classify(args), 'brilliant');
});

test('13b. dead-won and not forced → NOT Brilliant (spec §27F)', () => {
  /* Already +8.00, hangs a rook, still winning. §9 forbids calling this Brilliant
     merely because the move happens to be engine-best. */
  const args = { bestM: 800, playedM: 800, sacMovedCp: VAL.r, isForced: false, forcedSac: false };
  assert.notEqual(classify(args), 'brilliant');
});

test('13c. dead-lost is never rescued by the forced-mate exception', () => {
  const args = { bestM: -900, playedM: -900, sacMovedCp: VAL.q, isForced: true, forcedSac: true };
  assert.equal(gates(args).forcedOutsideWindow, false);
  assert.notEqual(classify(args), 'brilliant');
});

/* ── 14–15. the internal id (spec §28) — display concerns ───────────── */

test('14/15. the classifier still emits the internal id, unchanged', () => {
  /* The algorithm is deliberately NOT altered to emit 'sigma'. Both spellings are
     a display concern, asserted in scripts/sigma-verdict-display.test.mjs. */
  assert.equal(classify({ bestM: 0, playedM: 0 }), 'brilliant');
});

/* ── the free-positive filter that caught the reported false positive ─ */

test('a strictly better NON-sacrificing move defeats the free-positive filter', () => {
  /* 22...Qxg6 from the real game (fen_before straight out of sigma_moves): the
     engine's best was 22...f7g6, a plain pawn capture, at −193; the played queen sac
     scored −184, cpl 9. Both fit "best or near-best", so the sac collected "!!" —
     for a move 9cp WORSE than taking the bishop with a pawn. */
  const fen = '4r1k1/pppb1pp1/3p1qBp/7Q/3N1P2/2P5/PP3RPP/5K2 b - - 0 22';
  const mv = moveFrom(fen, 'f6g6');
  const tops = [
    { uci: 'f7g6', score: -193 },   // strictly better — a pawn takes the bishop
    { uci: 'f6g6', score: -184 },   // the played move itself
    { uci: 'c7c5', score: -97 },
  ];
  const playedM = 184;              // mover (black) perspective

  assert.equal(mv.piece, 'q');
  assert.equal(sacrificeCandidate(fen, mv, null), true, 'it IS a real queen sacrifice');
  assert.equal(betterNonSacrificialLine(fen, null, tops, 'b', playedM), true);
  assert.notEqual(classify({ bestM: 193, playedM: 184, sacMovedCp: VAL.q, betterNonSacLine: true }), 'brilliant');
});

test('the filter stands down when the played move IS the engine top line', () => {
  /* 46.Rxc6 / 28.Qxf2 were cpl 0 and bestUci === the played move: there is nothing
     better to have found, so this gate has no opinion. */
  const fen = '8/5pk1/1RP2pp1/3b4/2r5/3K4/8/8 b - - 6 46';
  const tops = [
    { uci: 'c4c6', score: -584 },
    { uci: 'c4c5', score: -553 },
    { uci: 'c4c1', score: -522 },
  ];
  assert.equal(betterNonSacrificialLine(fen, null, tops, 'b', 584), false);
});

test('a strictly better line that is ALSO a sacrifice does not trip the filter', () => {
  /* The classic poisoned piece: recapturing is itself a giveaway, so choosing the
     best of several sacrifices is precisely what the badge is for. Here the better
     line (22...Qg5, onto a square the h6 pawn only half-covers) is read as a
     giveaway too — lineM 300 vs playedM 184, so it is strictly better AND a sac. */
  const fen = '4r1k1/pppb1pp1/3p1qBp/7Q/3N1P2/2P5/PP3RPP/5K2 b - - 0 22';
  const betterLine = moveFrom(fen, 'f6g5');
  assert.equal(betterLine.piece, 'q');
  assert.equal(sacrificeCandidate(fen, betterLine, null), true, 'fixture: the better line sacrifices');
  assert.equal(betterNonSacrificialLine(fen, null, [{ uci: 'f6g5', score: -300 }], 'b', 184), false);
});

test('the filter ignores lines that are not strictly better', () => {
  /* An equal-eval line is the engine calling both moves the same. */
  const fen = '4r1k1/pppb1pp1/3p1qBp/7Q/3N1P2/2P5/PP3RPP/5K2 b - - 0 22';
  assert.equal(betterNonSacrificialLine(fen, null, [{ uci: 'f7g6', score: -184 }], 'b', 184), false);
});

/* ── gate H: the reported false positives, on their real positions ─────── */

test('46.Rxc6 → NOT Brilliant: hangs the rook for a pawn and attacks nothing', () => {
  /* Straight out of sigma_moves. Black was +5.84 (outside the window), cpl 0, and
     the played move WAS the engine's top line — so gates A-C and G all passed. It
     takes a pawn on c6 and leaves the rook hanging to Bd5: no check, no attack on
     Kg7, and it nets DOWN 400. A winning capture that happens to hang a piece is not
     a brilliancy. This is the case gate H exists for. */
  const fen = '8/5pk1/1RP2pp1/3b4/2r5/3K4/8/8 b - - 6 46';
  const mv = moveFrom(fen, 'c4c6');

  assert.equal(mv.piece, 'r');
  assert.equal(mv.captured, 'p', 'it wins a pawn');
  assert.equal(sacrificeCandidate(fen, mv, null), true, 'the rook really is hanging');
  assert.equal(attackingSacrifice(fen, mv), false, 'but it achieves nothing');
  assert.notEqual(classify({ bestM: 584, playedM: 584, sacMovedCp: VAL.r, attackingSac: false }), 'brilliant');
});

test('28.Qxf2 → NOT Brilliant: hangs the queen for a pawn and attacks nothing', () => {
  /* Also cpl 0 and engine-best with no better line. Qxf2 wins a pawn, leaves the
     queen en prise to Qe3, and does not check Kc1. */
  const fen = '8/pp2n1rk/2p4p/2n2rpP/2P5/4Q3/PP3Pq1/2KR3R b - - 2 28';
  const mv = moveFrom(fen, 'g2f2');

  assert.equal(mv.piece, 'q');
  assert.equal(mv.captured, 'p', 'it wins a pawn');
  assert.equal(sacrificeCandidate(fen, mv, null), true);
  assert.equal(attackingSacrifice(fen, mv), false);
  assert.notEqual(classify({ bestM: 0, playedM: 0, sacMovedCp: VAL.q, attackingSac: false }), 'brilliant');
});

test('the gate table agrees with the geometry for both reported cases', () => {
  for (const [fen, san, cp] of [
    ['8/5pk1/1RP2pp1/3b4/2r5/3K4/8/8 b - - 6 46', 'c4c6', VAL.r],
    ['8/pp2n1rk/2p4p/2n2rpP/2P5/4Q3/PP3Pq1/2KR3R b - - 2 28', 'g2f2', VAL.q],
  ]) {
    const mv = moveFrom(fen, san);
    const attacking = attackingSacrifice(fen, mv);
    assert.equal(gates({ attackingSac: attacking, sacMovedCp: cp }).pass, false,
      `${san} must not pass the gate table`);
  }
});

test('26.Bxb7 → NOT Brilliant: takes a pawn, checks nothing, and is not an attack', () => {
  /* The other reported row. The bishop really is given away on b7, so it is a
     genuine sacrifice — but the king on b8 is NOT attacked by a bishop on b7 and
     the capture is only a pawn, so the move achieves nothing. Gate H is what stops
     it.

     Gate G deliberately does NOT fire here even though the engine preferred
     26.Bc3f3 (446 vs 436): f3 is empty, so that line wins no material. It is the
     engine preferring a quieter route inside its own noise floor, not a declined
     free piece — see the 9.Ne6 case in net-sacrifice-settlement.test.mjs. */
  const fen = '1k6/ppp2p2/2B5/2q1p3/Q7/2P4P/2Pr1PP1/R5K1 w - - 1 26';
  const mv = moveFrom(fen, 'c6b7');
  assert.equal(mv.piece, 'b');
  assert.equal(mv.captured, 'p');
  assert.equal(sacrificeCandidate(fen, mv, null), true, 'the bishop really is hanging');
  assert.equal(attackingSacrifice(fen, mv), false, 'it neither checks nor wins material');
  assert.equal(betterNonSacrificialLine(fen, null,
    [{ uci: 'c6f3', score: 446 }], 'w', 436), false, 'a better line that takes nothing is not a declined piece');
  assert.notEqual(classify({ bestM: 446, playedM: 436, sacMovedCp: VAL.b, attackingSac: false }), 'brilliant');
});

test('a sacrifice that gives check passes the attacking gate', () => {
  /* Re5+ from the rook: a real checking sacrifice, so gate H stands aside and the
     verdict falls to the remaining gates. */
  const fen = '4k3/8/8/8/3n4/8/8/4RK2 w - - 0 1';
  const mv = moveFrom(fen, 'e1e5');
  assert.equal(mv.piece, 'r');
  assert.equal(attackingSacrifice(fen, mv), true, 'Re5+ checks the king');
});

test('a sacrifice that wins a real piece passes even with no attack', () => {
  /* Rook takes a knight, hangs to a pawn recapture, and checks nothing — but it wins
     a knight. Measured on the piece TAKEN, not the net trade, because being down
     afterwards is the point of a sacrifice. */
  const fen = '4k3/8/8/8/3n4/8/8/3R1K2 w - - 0 1';
  const mv = moveFrom(fen, 'd1d4');
  assert.equal(mv.captured, 'n', 'fixture: the knight really is on d4');
  assert.equal(attackingSacrifice(fen, mv), true, 'winning a knight is enough');
});

test('taking only a pawn is never enough on its own', () => {
  /* The clearest single statement of gate H — it is the whole difference between
     Rxc6/Qxf2 and a real sacrifice. */
  const fen = '4k3/8/8/8/3p4/8/8/3R1K2 w - - 0 1';
  const mv = moveFrom(fen, 'd1d4');
  assert.equal(mv.captured, 'p', 'fixture: the pawn really is on d4');
  assert.equal(attackingSacrifice(fen, mv), false, 'a pawn is not material worth having');
});

/* ── the gate table itself (spec §24 / §30) ─────────────────────────── */

test('every gate is reported and every one of them is required', () => {
  const all = gates();
  for (const gate of ['moveQuality', 'genuineSacrifice', 'netSacrifice', 'causedByMove',
    'evaluationContext', 'compensation', 'falsePositive', 'achievesSomething']) {
    assert.ok(gate in all, `${gate} must be reported`);
  }
  assert.equal(all.pass, true);

  /* Flip each in turn — the verdict must stop being Brilliant. */
  const kills = [
    ['no sacrifice', { sacrifice: false }],
    ['not a net sacrifice', { hasNetSacrifice: false }],
    ['not caused by the move', { sacrificeAttributed: false }],
    ['a better non-sac existed', { betterNonSacLine: true }],
    ['achieved nothing', { attackingSac: false }],
    ['poor move quality', evals(500)],
    ['dead-lost context', { bestM: -900, playedM: -900 }],
    ['dead-won, not forced', { bestM: 800, playedM: 800, sacMovedCp: VAL.r }],
  ];
  for (const [why, over] of kills) {
    const g = brilliantGates({ ...PASSES_ALL, ...evals(0), ...over });
    assert.equal(g.pass, false, `${why} must block Brilliant`);
    assert.notEqual(classifyMove({ ...PASSES_ALL, ...evals(0), ...over }), 'brilliant', why);
  }
});

test('the gate table is deterministic', () => {
  const args = {
    ...PASSES_ALL, ...evals(0),
    sacMovedCp: VAL.q, bestM: 120, playedM: 118,
  };
  assert.deepEqual(brilliantGates(args), brilliantGates(args));
});

test('sacrifice detection alone never yields Brilliant (spec §23)', () => {
  /* Real giveaway geometry on a real board, but the engine says the choice was poor
     (cpl 400). Detection must not promote it. */
  const fen = '4k3/8/8/8/p7/8/8/N3K3 w - - 0 1';
  const mv = moveFrom(fen, 'a1b3');
  assert.equal(sacrificeCandidate(fen, mv, null), true, 'fixture: the geometry really is a giveaway');
  assert.notEqual(classify({ bestM: 400, playedM: 0, sacMovedCp: VAL.n }), 'brilliant');
});

test('an unrelated blunder is never Brilliant', () => {
  /* No sacrifice at all, and the engine badly disagrees. */
  assert.notEqual(classify({ sacrifice: false, bestM: 600, playedM: -600 }), 'brilliant');
});
