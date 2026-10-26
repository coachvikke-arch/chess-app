/* ──────────────────────────────────────────────────────────────────────────
 * NET-SACRIFICE SETTLEMENT — the tactical-continuation regressions.
 *
 * The bug these pin: settledNetSacrifice stopped walking the sequence as soon as
 * a ply was neither a capture nor a check. A forced king reply to a check is
 * exactly that, so the walk quit BEFORE the ply that actually won the material:
 *
 *      9.Qxf6  Bxf6  Nf7+  Kg8  Nxd8
 *                 ^collected   ^check   ^forced   ^the compensation
 *
 * and a real queen sacrifice read as a bare giveaway.
 *
 * Settling is pure chess.js replay over the engine's recorded PV — no engine call
 * of its own — so these tests drive it with hand-built continuations. That keeps
 * them fast AND deterministic, and it pins the walk logic itself rather than
 * whatever the engine happens to prefer today.
 *
 * Run: node --test scripts/net-sacrifice-settlement.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  settledNetSacrifice, sumMaterialFor, betterNonSacrificialLine, describeSacrifice,
} from '../src/utils/reviewClassify.js';

const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900 };

/* The reproduction game, replayed to the position before 9.Qxf6. */
const REPRO = ['c3', 'Nf6', 'Nf3', 'g6', 'Qb3', 'Bg7', 'Ng5', 'O-O', 'e3', 'd6',
  'Bc4', 'Nbd7', 'Bxf7+', 'Rxf7', 'Qxf7+', 'Kh8'];

function fenBeforeNth(list) {
  const g = new Chess();
  for (const san of list) g.move(san, { strict: false });
  return g.fen();
}

const FEN_QXF6 = fenBeforeNth(REPRO);

/* ── 1. the exact failure point ─────────────────────────────────────── */

test('9.Qxf6: the forced king reply does not end the settlement', () => {
  /* Black collects the queen, white checks, black is FORCED to move the king, and
     only then does the knight take the queen on d8. The walk must reach Nxd8. */
  const settled = settledNetSacrifice(
    FEN_QXF6, 'w', 'f7f6', ['g7f6', 'g5f7', 'h8g8', 'f7d8'], 6,
  );

  assert.ok(settled, 'the position must resolve');
  assert.equal(settled.offeredTaken, true, 'Bxf6 collected the offered queen');

  /* Queen (900) given; knight on f6 (320) and queen on d8 (900) recovered. The
     settlement is 900 − 320 − 900, i.e. the mover finishes UP a knight. */
  assert.equal(settled.netDown, VAL.q - VAL.n - VAL.q,
    'netDown must include the queen recovered on d8, not stop at the f6 knight');
  assert.equal(settled.netDown, -VAL.n, 'queen given for knight + queen leaves the mover up 320');
  assert.equal(settled.pressed, true, 'Nf7+ is the pressing follow-up');
});

test('the walk stops at a quiet move nobody was forced to play', () => {
  /* After the sequence settles, Ne5 is an ordinary developing move. Counting it —
     or anything after it — would be counting unrelated play as compensation. */
  const stopped = settledNetSacrifice(
    FEN_QXF6, 'w', 'f7f6', ['g7f6', 'g5f7', 'h8g8', 'f7d8', 'd7e5', 'd2d4'], 6,
  );
  assert.equal(stopped.netDown, -VAL.n, 'the trailing quiet moves add nothing');
});

test('a reply that was NOT forced still ends the walk', () => {
  /* Same sequence with the king reply removed: Bxf6 is a capture, Nf7+ is a check,
     and then there is nothing forcing the walk on — so it must halt rather than
     invent a recovery. This is the number the bug produced: 580 instead of -320. */
  const halted = settledNetSacrifice(FEN_QXF6, 'w', 'f7f6', ['g7f6', 'g5f7'], 6);
  assert.equal(halted.offeredTaken, true);
  assert.equal(halted.netDown, VAL.q - VAL.n, 'only the queen and the f6 knight counted');
  assert.equal(halted.pressed, true);
});

/* ── 2. a genuinely missing compensation stays missing ──────────────── */

test('a declined offer with no forcing continuation is not repaid', () => {
  /* Rook takes a knight, black walks the king away, nothing else forcing. The
     offer stands and nothing is recovered. */
  const fen = '4k3/8/3r4/8/3n4/8/8/3RK3 w - - 0 1';
  const settled = settledNetSacrifice(fen, 'w', 'd1d4', ['e8d7', 'c7c6'], 6);
  assert.ok(settled);
  assert.equal(settled.offeredTaken, false, 'the rook was never taken');
  assert.equal(settled.netDown, -VAL.n, 'white simply won the knight');
  assert.equal(settled.pressed, false, 'and never followed up');
});

test('an unrelated later pawn grab is not counted as compensation', () => {
  /* The offer is declined, then two plies later an unrelated pawn takes a pawn.
     Nothing forces that pawn move, so the walk stops at Kd7 and never counts it. */
  const fen = '4k3/8/3r4/8/3n4/8/8/3RK3 w - - 0 1';
  const settled = settledNetSacrifice(fen, 'w', 'd1d4', ['e8d7', 'c7c6'], 6);
  assert.equal(settled.netDown, -VAL.n, 'the far-away pawn race is ignored');
});

/* ── 3. a plain exchange still settles as a trade ──────────────────── */

test('rook for knight is a trade, not a sacrifice', () => {
  const fen = '4k3/8/3r4/8/3n4/8/8/3RK3 w - - 0 1';
  const settled = settledNetSacrifice(fen, 'w', 'd1d4', ['d6d4'], 6);
  assert.ok(settled);
  assert.equal(settled.offeredTaken, true, 'black did take the offered rook');
  assert.equal(settled.netDown, VAL.r - VAL.n, 'rook given for knight: down 180');
  assert.equal(settled.pressed, false, 'with no press, the caller can strip it');
});

/* ── 4. material is counted once, from the board ────────────────────── */

test('material is tracked from the board, not from SAN text', () => {
  /* Both sides are read off the replayed position, so the same piece type cannot
     be counted twice and an en-passant style flag cannot inflate the total. */
  const fen = '4k3/8/3r4/8/3n4/8/8/3RK3 w - - 0 1';
  const settled = settledNetSacrifice(fen, 'w', 'd1d4', ['d6d4'], 6);
  assert.equal(settled.netDown, VAL.r - VAL.n, 'each capture counted exactly once');

  const g = new Chess(fen);
  const before = sumMaterialFor(fen, 'w');
  g.move({ from: 'd1', to: 'd4' });
  g.move({ from: 'd6', to: 'd4' });
  assert.equal(sumMaterialFor(g.fen(), 'w') - before, -(VAL.r),
    'the board shows white lost exactly the rook');
});

/* ── 5. the free-positive filter only fires on material ─────────────── */

test('a better line that wins no material does not veto a sacrifice', () => {
  /* 9.Qxf6 against the engine's 9.Ne6, which is 9cp "better" — inside the noise
     floor BRILLIANT_NEAR_BEST_CPL already accepts — and takes nothing. This is
     engine preference between two equivalent moves, not a declined free piece, and
     rejecting it would contradict the cpl gate. */
  const prev = (() => { const g = new Chess(FEN_QXF6); g.undo(); return g; })().history({ verbose: true }).slice(-1)[0];
  const tops = [{ uci: 'g5e6', score: 361 }];
  assert.equal(betterNonSacrificialLine(FEN_QXF6, prev, tops, 'w', 352), false);
});

test('a better line that takes a piece for free still vetoes the sacrifice', () => {
  /* 22...Qxg6 against 22...f7g6, which wins the bishop with a pawn. That is a
     declined free piece and the gate must fire. */
  const fen = '4r1k1/pppb1pp1/3p1qBp/7Q/3N1P2/2P5/PP3RPP/5K2 b - - 0 22';
  const g = new Chess(fen);
  g.move('f6g6');
  const prev = g.history({ verbose: true }).slice(-1)[0];
  const tops = [{ uci: 'f7g6', score: -193 }];
  assert.equal(betterNonSacrificialLine(fen, prev, tops, 'b', -184), true);
});

/* ── 7. both sides of the exchange are reported ─────────────────────── */

test('the settlement reports what was given and what came back', () => {
  const s = settledNetSacrifice(FEN_QXF6, 'w', 'f7f6', ['g7f6', 'g5f7', 'h8g8', 'f7d8'], 6);
  assert.equal(s.given, VAL.q, 'the queen is what black collected');
  assert.equal(s.recovered, VAL.n + VAL.q, 'the f6 knight and the d8 queen came back');
  assert.equal(s.netDown, s.given - s.recovered, 'netDown is given − recovered');
  assert.deepEqual(s.sequence, ['Bxf6', 'Nf7+', 'Kg8', 'Nxd8'],
    'the forced king reply is part of the sequence');
  assert.equal(s.forcing, true, 'every ply in the walk was capture/check/forced');
});

/* ── 8. the development debug object ────────────────────────────────── */

test('describeSacrifice explains 9.Qxf6 end to end', () => {
  const g = new Chess(FEN_QXF6);
  g.undo();
  const prev = g.history({ verbose: true }).slice(-1)[0];
  const mv = new Chess(FEN_QXF6).move({ from: 'f7', to: 'f6' });

  const dbg = describeSacrifice({
    san: 'Qxf6',
    mv,
    cpl: 9,
    bestM: 361,
    playedM: 352,
    settled: settledNetSacrifice(FEN_QXF6, 'w', 'f7f6', ['g7f6', 'g5f7', 'h8g8', 'f7d8'], 6),
    tops: [{ uci: 'g5e6', score: 361 }, { uci: 'f7g7', score: 332 }],
    fenBefore: FEN_QXF6,
    prevMv: prev,
    mover: 'w',
    verdict: 'brilliant',
  });

  assert.equal(dbg.move, 'Qxf6');
  assert.equal(dbg.sacrificeDetected, true);
  assert.equal(dbg.sacrificedPiece, 'queen');
  assert.equal(dbg.sacrificedValue, VAL.q);
  assert.equal(dbg.immediateResponse, 'Bxf6');
  assert.deepEqual(dbg.continuation, ['Bxf6', 'Nf7+', 'Kg8', 'Nxd8']);
  assert.equal(dbg.materialGiven, VAL.q);
  assert.equal(dbg.materialRecovered, VAL.n + VAL.q);
  assert.equal(dbg.netSacrifice, -VAL.n);
  assert.equal(dbg.hasNetSacrifice, true);
  assert.equal(dbg.sacrificeCausedByMove, true);
  assert.equal(dbg.tacticalContinuation, true);
  assert.equal(dbg.forcedSequence, true);
  assert.equal(dbg.finalVerdict, 'brilliant');
  assert.equal(dbg.gates.pass, true, 'the debug object agrees with the gate table');
});

test('sumMaterialFor agrees with the settlement across the whole sequence', () => {
  /* Read straight off the replayed board. White ends down exactly the queen (900):
     the knight it won on f6 and the queen it took on d8 both left the board, so
     white's own material fell by the queen alone while black fell by far more.
     That asymmetry — black down 1220, white down 900 — is the repayment, and it is
     why the sequence has to be followed to its end to see. */
  const g = new Chess(FEN_QXF6);
  const whiteBefore = sumMaterialFor(FEN_QXF6, 'w');
  const blackBefore = sumMaterialFor(FEN_QXF6, 'b');

  g.move({ from: 'f7', to: 'f6' });
  for (const u of ['g7f6', 'g5f7', 'h8g8', 'f7d8']) {
    g.move({ from: u.slice(0, 2), to: u.slice(2, 4) });
  }
  const after = g.fen();
  const whiteLost = whiteBefore - sumMaterialFor(after, 'w');
  const blackLost = blackBefore - sumMaterialFor(after, 'b');

  assert.equal(whiteLost, VAL.q, 'white gave up exactly the queen');
  assert.equal(blackLost, VAL.n + VAL.q, 'black lost the f6 knight and the d8 queen');
  assert.equal(whiteLost - blackLost, -VAL.n, 'net: white is a knight up on material');
});