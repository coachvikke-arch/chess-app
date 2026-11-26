/* ──────────────────────────────────────────────────────────────────────────
 * STRATEGIC SACRIFICE (path E) — a capture of a SMALLER piece that is
 * deliberately exposed, and the regression set the spec asks for.
 *
 * The classical detectors reject these moves on geometry alone: the capturing
 * piece is defended (ourDef ≥ moved) or nothing attacks it YET because the trap
 * comes later (canBeTaken false). strategicSacrificeGeometry only makes such a
 * move ELIGIBLE; the engine's own continuation has to prove that the opponent
 * really wins the piece and that the mover keeps compensation.
 *
 * Scenario → test map (spec numbering):
 *   1  queen takes a pawn, the queen can be trapped          — trap walk + pipeline
 *   2  rook takes a pawn, a fork follows                     — geometry + settlement
 *   3  bishop takes a pawn, a mating attack follows          — validation table
 *   4  knight takes a pawn, opening a file/diagonal          — geometry
 *   5  a piece takes less and is caught in a calculated trade — settlement
 *   6  deliberate exposure for a positional/tactical gain     — validation table
 *   7  mate / winning attack / material gain compensation     — validation table
 *   Rejections: ordinary safe capture, exposure the opponent cannot exploit,
 *   a collected-and-abandoned piece (an accidental blunder), an even trade.
 *
 * Every fixture below is built to be provable by inspection — each move is
 * asserted legal before its classification is trusted, so a typo cannot
 * masquerade as a passing test.
 *
 * Run: node --test scripts/strategic-sacrifice.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  strategicSacrificeGeometry,
  strategicSacrificeValidated,
  settledNetSacrifice,
  sacrificeCandidate,
  protectedSacrificeGeometry,
} from '../src/utils/reviewClassify.js';
import { SIGMA_TYPE } from '../src/utils/sigmaType.js';
import { reviewGame } from '../src/utils/gameReview.js';

/** Assert the SAN/UCI move is legal in `fen`, then return the verbose move. */
function play(fen, san) {
  const g = new Chess(fen);
  const mv = g.move(san);
  assert.ok(mv, `fixture is wrong: ${san} is not legal in ${fen}`);
  return mv;
}

/** Geometry on a capture of a smaller piece, from the position BEFORE the move. */
function geometryFor(fen, san) {
  const mv = play(fen, san);
  return {
    mv,
    strategic: strategicSacrificeGeometry(fen, mv, null),
    classical: sacrificeCandidate(fen, mv, null),
    protectedShape: protectedSacrificeGeometry(fen, mv, null),
  };
}

/* ── Scenario geometry ─────────────────────────────────────────────────────
   Each of these captures a pawn with a minor piece or better and lands on a
   square the opponent does NOT attack — so both classical detectors say no and
   only the strategic path is even eligible. Whether the move is a sacrifice is
   decided by the engine line, which is covered below. */

const GEOMETRY_CASES = [
  {
    /* 1 — the queen takes a pawn and can be trapped later (Rb8, Rxb7). */
    name: 'scenario 1: queen takes a pawn and can be trapped',
    fen: 'r5k1/1p3ppp/8/3Q4/2B1n3/8/P7/1R2K3 w - - 0 1',
    san: 'Qxb7',
    piece: 'q',
  },
  {
    /* 2 — the rook takes a pawn; losing it later pays for the fork. */
    name: 'scenario 2: rook takes a pawn in a combination',
    fen: '6k1/1p4pp/8/8/8/8/1R4P1/6K1 w - - 0 1',
    san: 'Rxb7',
    piece: 'r',
  },
  {
    /* 3/4 share the shape: the bishop/knight takes a pawn, nothing attacks it
       yet, and the compensation is an attack the engine line must prove. */
    name: 'scenario 3: bishop takes a pawn for an attack',
    fen: '6k1/1p4pp/8/8/4B3/8/6P1/6K1 w - - 0 1',
    san: 'Bxb7',
    piece: 'b',
  },
  {
    /* 4 — the knight takes a pawn, opening lines for the attack. */
    name: 'scenario 4: knight takes a pawn, opening the position',
    fen: '6k1/1p4pp/3N4/8/8/8/6P1/6K1 w - - 0 1',
    san: 'Nxb7',
    piece: 'n',
  },
];

for (const { name, fen, san, piece } of GEOMETRY_CASES) {
  test(name, () => {
    const { mv, strategic, classical, protectedShape } = geometryFor(fen, san);
    assert.equal(mv.piece, piece);
    assert.ok(mv.captured, `${san} must be a capture`);
    /* The classical paths must genuinely reject the shape, or this test would
       be exercising the old detector rather than the strategic path. */
    assert.equal(classical, false, 'the classical loose/exchange detector must reject it');
    assert.equal(protectedShape, false, 'the protected-offer detector must reject it');
    assert.equal(strategic, true, 'the strategic geometry must accept it');
  });
}

/* ── Scenario geometry: what must NEVER become eligible ───────────────────── */

test('a recapture is not a strategic sacrifice', () => {
  /* Black's pawn just captured on d4 and Qxd4 restores the material — the
     retake is not an offer, whatever it captures. */
  const fen = '6k1/1p4pp/8/8/3p4/8/6P1/3Q2K1 w - - 0 1';
  const mv = play(fen, 'Qxd4');
  const prev = { to: 'd4', flags: 'c' }; // the capture the review recorded before this ply
  assert.equal(strategicSacrificeGeometry(fen, mv, prev), false);
});

test('a capture of an EQUAL or bigger piece is a win, not a sacrifice', () => {
  const fen = '6k1/1p4pp/8/2q5/8/8/2Q3P1/6K1 w - - 0 1';
  const { strategic, classical } = geometryFor(fen, 'Qxc5');
  assert.equal(strategic, false, 'queen takes queen is a win');
  assert.equal(classical, false);
});

test('a pawn capture is never a strategic sacrifice', () => {
  const fen = '6k1/1p4pp/8/8/8/8/1P4P1/6K1 w - - 0 1';
  const g = new Chess(fen);
  const mv = g.move({ from: 'b2', to: 'b4' });
  assert.equal(strategicSacrificeGeometry(fen, mv, null), false);
});

test('a landing square our own king covers is not an offer', () => {
  /* Qxd2 takes a pawn defended by the white king — the enemy can never collect
     without walking into check. */
  const fen = '6k1/7p/8/8/8/8/3p4/3QK3 w - - 0 1';
  const { strategic } = geometryFor(fen, 'Qxd2');
  assert.equal(strategic, false);
});

test('a quiet move (nothing captured) is not a strategic sacrifice', () => {
  const fen = 'r5k1/1p3ppp/8/3Q4/2B1n3/8/P7/1R2K3 w - - 0 1';
  const mv = play(fen, 'Qe5');
  assert.equal(strategicSacrificeGeometry(fen, mv, null), false);
});

/* ── Validation: what the settled engine line must prove ───────────────────
   These are the scenario requirements in table form: the mover must actually
   lose the piece (`offeredTaken`), stay net down (or recoup under a forcing
   attack, or mate), and keep pressing. Everything else is rejected. */

const settledLike = (fields) => ({
  netDown: 0, offeredTaken: false, pressed: false,
  materialWinning: false, checksInContinuation: 0, forcedMate: false,
  ...fields,
});

const VALIDATION_CASES = [
  {
    /* 1 / 5 / 7 — the queen is won, the mover is materially down but the
       attack continues (the trap walk in the next section proves this shape). */
    name: 'accepted offer with a pressing attack and a net loss validates',
    settled: settledLike({ offeredTaken: true, pressed: true, netDown: 700, checksInContinuation: 1 }),
    expected: true,
  },
  {
    /* 7 — a forced mate inside the line is the strongest compensation. */
    name: 'a forced mate validates whatever the material ledger says',
    settled: settledLike({ offeredTaken: true, pressed: true, netDown: 500, forcedMate: true }),
    expected: true,
  },
  {
    /* 3 / 7 — recovery that rides a forcing attack: the mover comes back with
       MORE than given, while the line keeps checking. */
    name: 'an attacking recoup (checks behind the material gain) validates',
    settled: settledLike({
      offeredTaken: true, pressed: true, netDown: -200,
      materialWinning: true, checksInContinuation: 1,
    }),
    expected: true,
  },
  {
    /* Rejection — the opponent never actually wins the piece. This is the
       "safe capture" / "the exposure cannot be exploited" case. */
    name: 'a piece nobody captures is an ordinary capture, not a sacrifice',
    settled: settledLike({ offeredTaken: false, pressed: true, netDown: -100 }),
    expected: false,
  },
  {
    /* Rejection — collected and abandoned: the material is just gone. This is
       the accidental-blunder guard. */
    name: 'a hung piece collected with no follow-up stays a blunder',
    settled: settledLike({ offeredTaken: true, pressed: false, netDown: 800 }),
    expected: false,
  },
  {
    /* Rejection — an even trade: the mover recovers everything quietly. */
    name: 'recouping the full material without an attack is a trade',
    settled: settledLike({
      offeredTaken: true, pressed: true, netDown: 0,
      materialWinning: false, checksInContinuation: 0,
    }),
    expected: false,
  },
  {
    /* Rejection — the quiet recapture with interest: material comes back, but
       with no check the line is an exchange, not a sacrifice. */
    name: 'a quiet recapture with interest is still just an exchange',
    settled: settledLike({
      offeredTaken: true, pressed: true, netDown: -200,
      materialWinning: true, checksInContinuation: 0,
    }),
    expected: false,
  },
  {
    /* Rejection — no settlement at all (engine failure) never awards the path. */
    name: 'a missing settlement validates nothing',
    settled: null,
    expected: false,
  },
];

for (const { name, settled, expected } of VALIDATION_CASES) {
  test(name, () => {
    assert.equal(strategicSacrificeValidated(settled), expected);
  });
}

/* ── The trap walk (scenario 1, end to end through settledNetSacrifice) ────
   The queen takes b7. Nothing attacks it yet, so the classical walk (which
   only follows captures/checks) stops at black's quiet Rb8 and never sees the
   piece fall. With followQuietUntilTaken the walk rides the quiet moves,
   watches Rxb7 collect the queen, and then demands a pressing reply — here
   Bxf7+, which checks while winning another pawn. */

const TRAP_FEN = 'r5k1/1p3ppp/8/3Q4/2B1n3/8/P7/1R2K3 w - - 0 1';
const TRAP_PV = ['a8b8', 'e1f1', 'b8b7', 'c4f7']; // Rb8, Kf1, Rxb7, Bxf7+

test('the trap walk follows quiet moves until the offer is collected', () => {
  const g = new Chess(TRAP_FEN);
  g.move('Qxb7');
  for (const uci of TRAP_PV) {
    const mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
    assert.ok(mv, `the trap line must be legal: ${uci}`);
  }

  const settled = settledNetSacrifice(TRAP_FEN, 'w', 'd5b7', TRAP_PV, 18, null, {
    followQuietUntilTaken: true,
  });
  assert.ok(settled);
  assert.equal(settled.offeredTaken, true, 'Rxb7 actually wins the queen');
  assert.equal(settled.pressed, true, 'Bxf7+ keeps the attack going');
  assert.equal(settled.netDown, 700, 'queen (900) against two pawns (200)');
  assert.equal(settled.checksInContinuation, 1);
  assert.equal(settled.offeredEscaped, false);
  assert.equal(strategicSacrificeValidated(settled), true);
});

test('without the trap walk the same line shows nothing (classical behaviour is unchanged)', () => {
  /* No followQuietUntilTaken: the first quiet move ends the walk, exactly as
     every classical Brilliants path expects. */
  const settled = settledNetSacrifice(TRAP_FEN, 'w', 'd5b7', TRAP_PV, 18, null);
  assert.ok(settled);
  assert.equal(settled.offeredTaken, false);
  assert.equal(strategicSacrificeValidated(settled), false);
});

test('a mover who saves the offered piece before it is won ends the walk', () => {
  /* After Rb8 the queen slides away (Qd7): the invitation was declined, the
     piece was never collected, so it is not a sacrifice. */
  const escapePv = ['a8b8', 'b7d7'];
  const settled = settledNetSacrifice(TRAP_FEN, 'w', 'd5b7', escapePv, 18, null, {
    followQuietUntilTaken: true,
  });
  assert.ok(settled);
  assert.equal(settled.offeredEscaped, true);
  assert.equal(settled.offeredTaken, false);
  assert.equal(strategicSacrificeValidated(settled), false);
});

test('the opponent that simply cannot exploit the piece gets no sacrifice', () => {
  /* The PV wanders off without ever touching the queen. */
  const safePv = ['a8b8', 'e1f1'];
  const settled = settledNetSacrifice(TRAP_FEN, 'w', 'd5b7', safePv, 18, null, {
    followQuietUntilTaken: true,
  });
  assert.ok(settled);
  assert.equal(settled.offeredTaken, false);
  assert.equal(settled.offeredEscaped, false);
  assert.equal(strategicSacrificeValidated(settled), false);
});

test('the piece is collected and then abandoned — the blunder shape', () => {
  /* Rb8, Kf1, Rxb7 and the line ends: the queen is simply gone with nothing
     behind it, so it must not be promoted. */
  const abandonedPv = ['a8b8', 'e1f1', 'b8b7'];
  const settled = settledNetSacrifice(TRAP_FEN, 'w', 'd5b7', abandonedPv, 18, null, {
    followQuietUntilTaken: true,
  });
  assert.ok(settled);
  assert.equal(settled.offeredTaken, true);
  assert.equal(settled.pressed, false);
  assert.equal(strategicSacrificeValidated(settled), false);
});

test('scenario 5: a calculated exchange that recovers everything is not a sacrifice', () => {
  /* Ne4xc5 (pawn), ...Nxc5 takes the knight, bxc5 takes it back: the mover is
     actually AHEAD on material — an exchange, not an offer. */
  const fen = '6k1/3n4/8/2p5/1P2N3/8/8/6K1 w - - 0 1';
  const pv = ['d7c5', 'b4c5'];
  play(fen, 'Nxc5');
  const settled = settledNetSacrifice(fen, 'w', 'e4c5', pv, 18, null);
  assert.ok(settled);
  assert.equal(settled.offeredTaken, true);
  assert.equal(settled.pressed, true);
  assert.ok(settled.netDown <= 0, 'the mover is not down material');
  assert.equal(strategicSacrificeValidated(settled), false);
});

/* ── Pipeline integration (scenario 1 through reviewGame) ─────────────────
   A deterministic fake engine proves the wiring, not the chess: the position
   before Qxb7 returns the played move as the near-best line, and the position
   after it returns the trap PV the settlement walk consumes. Every other
   position gets equal-eval filler lines, so nothing else is promoted. */

/* The reviewed game stops the moment the trap closes. The settlement PV below
   carries the pressing Bxf7+ reply itself; keeping it in the game as well would
   hand the fake engine a filler line, and a filler that ignores a hanging piece
   reads as a declined offer. */
const GAME_MOVES = ['Qxb7', 'Rb8', 'Kf1', 'Rxb7'];

function fensAlong(fen, moves) {
  const g = new Chess(fen);
  const out = [g.fen()];
  for (const san of moves) {
    const mv = g.move(san);
    assert.ok(mv, `pipeline fixture move must be legal: ${san}`);
    out.push(g.fen());
  }
  return out;
}

const genericTops = (fen, opts = {}) => {
  const g = new Chess(fen);
  return g.moves({ verbose: true }).slice(0, 3).map((m, i) => ({
    rank: i + 1,
    uci: m.from + m.to + (m.promotion || ''),
    san: m.san,
    score: 0,
    mate: null,
    depth: opts.maxDepth ?? 18,
    pv: [m.from + m.to + (m.promotion || '')],
  }));
};

function fakeEngine(fens, { trapPv = TRAP_PV, preTops = null } = {}) {
  const beforeTrap = fens[0];
  const afterTrap = fens[1];
  return {
    searchTopMoves(fen, opts = {}) {
      if (fen === beforeTrap && preTops) {
        return preTops.map((t) => ({ ...t, depth: opts.maxDepth ?? 18 }));
      }
      if (fen === afterTrap && (opts.multiPv ?? 1) === 1) {
        return [{
          rank: 1,
          uci: trapPv[0],
          san: 'Rb8',
          score: 300,
          mate: null,
          depth: opts.maxDepth ?? 18,
          pv: trapPv,
        }];
      }
      return genericTops(fen, opts);
    },
    evaluateGame(fen, opts = {}) {
      return { score: 0, mate: null, depth: opts.maxDepth ?? 18 };
    },
  };
}

const NEAR_BEST_TOPS = [
  { rank: 1, uci: 'd5b7', san: 'Qxb7', score: 250, mate: null, pv: ['d5b7'] },
  { rank: 2, uci: 'd5e5', san: 'Qe5', score: 240, mate: null, pv: ['d5e5'] },
  { rank: 3, uci: 'c4d3', san: 'Bd3', score: 230, mate: null, pv: ['c4d3'] },
];

test('scenario 1 pipeline: the trapped-queen capture is reviewed as Sigma', async () => {
  const fens = fensAlong(TRAP_FEN, GAME_MOVES);
  /* The trap PV must be reachable from the position after Qxb7. */
  assert.deepEqual(new Chess(fens[1]).turn(), 'b');
  const res = await reviewGame(TRAP_FEN, GAME_MOVES, {
    engine: fakeEngine(fens, { preTops: NEAR_BEST_TOPS }),
    bookLookup: () => false,
  });
  const row = res.moves[0];
  assert.equal(row.san, 'Qxb7');
  assert.equal(row.verdict, 'sigma');
  assert.ok(row.sigma, 'the row carries its Sigma payload');
  assert.equal(row.sigma.type, SIGMA_TYPE.QUEEN, 'a queen was offered');
  assert.ok(row.sigma.label, 'and a display label');
  assert.equal(row.cpl, 0);
  for (const r of res.moves.slice(1)) {
    assert.notEqual(r.verdict, 'sigma', `${r.san} must not be Sigma`);
  }
});

test('scenario 1 pipeline: an exploit the engine does not play is no sacrifice', async () => {
  /* The same move, but the opponent's line never wins the queen — an ordinary
     safe capture, and it must stay Best. */
  const fens = fensAlong(TRAP_FEN, GAME_MOVES);
  const res = await reviewGame(TRAP_FEN, GAME_MOVES, {
    engine: fakeEngine(fens, { trapPv: ['a8b8', 'e1f1'], preTops: NEAR_BEST_TOPS }),
    bookLookup: () => false,
  });
  assert.equal(res.moves[0].san, 'Qxb7');
  assert.notEqual(res.moves[0].verdict, 'sigma');
  assert.equal(res.moves[0].sigma, null);
});

test('scenario 5 pipeline: a measurably worse capture is never Sigma', async () => {
  /* The engine prefers another move by 140cp: the capture is a losing
     concession, not a brilliant sacrifice. */
  const fens = fensAlong(TRAP_FEN, GAME_MOVES);
  const worseTops = [
    { rank: 1, uci: 'd5e5', san: 'Qe5', score: 400, mate: null, pv: ['d5e5'] },
    { rank: 2, uci: 'd5b7', san: 'Qxb7', score: 260, mate: null, pv: ['d5b7'] },
    { rank: 3, uci: 'c4d3', san: 'Bd3', score: 250, mate: null, pv: ['c4d3'] },
  ];
  const res = await reviewGame(TRAP_FEN, GAME_MOVES, {
    engine: fakeEngine(fens, { preTops: worseTops }),
    bookLookup: () => false,
  });
  assert.equal(res.moves[0].san, 'Qxb7');
  assert.notEqual(res.moves[0].verdict, 'sigma');
  assert.equal(res.moves[0].sigma, null);
});
