// Unit tests for src/lib/gmAnalysis.ts - run with: node --test (from frontend/)
//
// gmAnalysis is TypeScript, so it is transpiled with esbuild on the fly. It is
// a pure consumer of the canonical pipeline (reviewGame via canonicalAnalysis),
// so under node the review engine is supplied as a stub through the `engine`
// option — the same hook the real Node engine uses. No browser worker pool is
// touched, and no move is ever classified here: every classification assertion
// lives in the canonical suites plus analysis-parity.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { loadTsLib as loadLib } from './lib/tsLoad.mjs';

const SRC = new URL('../src/lib/gmAnalysis.ts', import.meta.url);
const REPLAY_SRC = new URL('../src/lib/chessReplay.ts', import.meta.url);

/** Morphy vs Duke of Brunswick — the game embedded in the watch-GM prototype. */
const MORPHY_PGN = `[Event "Paris Opera"]
[White "Morphy, Paul"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7
8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7
14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8# 1-0`;

const MORPHY_SANS = ['e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4', 'dxe5', 'Bxf3',
  'Qxf3', 'dxe5', 'Bc4', 'Nf6', 'Qb3', 'Qe7', 'Nc3', 'c6', 'Bg5', 'b5',
  'Nxb5', 'cxb5', 'Bxb5+', 'Nbd7', 'O-O-O', 'Rd8', 'Rxd7', 'Rxd7', 'Rd1',
  'Qe6', 'Bxd7+', 'Nxd7', 'Qb8+', 'Nxb8', 'Rd8#'];

let mod;
let replay;
let canon;
before(async () => {
  globalThis.__Chess = Chess;
  mod = await loadLib(SRC);
  /* chessReplay only needs chess.js, which runs fine under node. */
  replay = await loadLib(REPLAY_SRC);
  canon = await import('../src/utils/canonicalAnalysis.js');
});

/* ── FEN precedence: PGN [FEN] wins, else supplied, else standard ────────── */

test('resolveInitialFen prefers the PGN [FEN] tag over everything', () => {
  const pgn = '[SetUp "1"]\n[FEN "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"]\n\n1.d4 *';
  assert.equal(
    canon.resolveInitialFen({ pgnText: pgn, suppliedFen: 'start' }),
    'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'
  );
});

test('resolveInitialFen falls back to supplied FEN, then standard', () => {
  assert.equal(canon.resolveInitialFen({ pgnText: MORPHY_PGN }), 'start');
  assert.equal(
    canon.resolveInitialFen({ suppliedFen: 'k7/8/8/8/8/8/8/K7 w - - 0 1' }),
    'k7/8/8/8/8/8/8/K7 w - - 0 1'
  );
  assert.equal(canon.resolveInitialFen({}), 'start');
  assert.equal(canon.resolveInitialFen({ suppliedFen: 'start' }), 'start');
});

test('stored payloads without the canonical version stamp read as stale', () => {
  assert.equal(canon.isStaleAnalysis(null), true);
  assert.equal(canon.isStaleAnalysis({}), true);
  assert.equal(canon.isStaleAnalysis({ analysisVersion: 'nnue-18-1' }), true);
});

test('a version stamp alone is NOT enough — the payload must be a real analysis', () => {
  /* isStaleAnalysis now delegates to the one authoritative check, which also
     validates shape and schema. A version-only object used to pass and then
     rendered as an empty review; it is now correctly a miss. */
  assert.equal(
    canon.isStaleAnalysis({ analysisVersion: canon.CANONICAL_ANALYSIS_VERSION }),
    true,
    'a stamp with no analysis behind it is stale',
  );
  const entry = {
    gameSource: 'chess_profile',
    gameId: 1,
    analysisVersion: canon.CANONICAL_ANALYSIS_VERSION,
    schemaVersion: canon.ANALYSIS_SCHEMA_VERSION,
    analysis: {
      /* A realistic row: every metric the UI reads must be PRESENT. The value
         may be null (a book row has acc null; an unscored row has loss/wpd
         null) — presence is what is validated, not numeric-ness. */
      moves: [{
        ply: 0, player: 'w', san: 'e4', uci: 'e2e4', verdict: 'book',
        cpl: 0, loss: 0, swing: 0, wpd: 0, acc: null,
        best: 12, played: 12, bestUci: 'e2e4', bestSan: 'e4',
      }],
      white: { accuracy: 100, counts: {} },
      black: { accuracy: 100, counts: {} },
    },
  };
  assert.equal(canon.isStaleAnalysis(entry), false, 'a complete envelope is accepted');
});

test('parsePgnReplay replays a setup game from its real origin', () => {
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
  const pgn = `[SetUp "1"]\n[FEN "${fen}"]\n\n1.d4 exd4 2.Nxd4 *`;
  const moves = replay.parsePgnReplay(pgn, canon.resolveInitialFen({ pgnText: pgn }));
  assert.deepEqual(moves.map((m) => m.san), ['d4', 'exd4', 'Nxd4']);
  const g = new Chess(fen);
  for (const m of moves) g.move(m.san);
  assert.equal(moves[moves.length - 1].fen, g.fen());
});

test('parsePgnReplay still defaults to the standard position', () => {
  const moves = replay.parsePgnReplay(MORPHY_PGN);
  assert.deepEqual(moves.map((m) => m.san), MORPHY_SANS);
});

/* ── analyzeGmGame: canonical rows in, replay entries out ──────────────────
 * A position-aware stub engine answers every search, so the mapping (and only
 * the mapping) is exercised: passthrough of every classification field, plus
 * the white-perspective display derivations. */

function fensFor(sans, initFen = 'start') {
  const g = new Chess(initFen === 'start' ? undefined : initFen);
  const fens = [g.fen()];
  for (const san of sans) {
    g.move(san);
    fens.push(g.fen());
  }
  return fens;
}

/* Stub: every position's best move IS the played move, at a fixed white-persp
 * cp, except where `alter` overrides a FEN. */
function stubEngine(sans, { alter = {} } = {}) {
  const fens = fensFor(sans);
  const g = new Chess();
  const playedByFen = {};
  sans.forEach((san, i) => {
    const mv = g.move(san);
    playedByFen[fens[i]] = mv.from + mv.to + (mv.promotion || '');
  });
  const line = (uci, score) => ({
    rank: 0, uci, score, evaluation: { type: 'cp', value: score }, mate: null, depth: 18, pv: [uci],
  });
  return {
    searchTopMoves: async (fen) => {
      const played = playedByFen[fen];
      const over = alter[fen];
      const best = (over && over.best) || played;
      const score = over && over.score != null ? over.score : 20;
      const tops = [line(best, score), line('a7a6', score - 60), line('h7h6', score - 90)];
      tops.forEach((t, i) => { t.rank = i + 1; });
      return tops;
    },
    evaluateGame: async () => ({ evaluation: { type: 'cp', value: 0 }, score: 0, mate: null, depth: 18 }),
  };
}

test('analyzeGmGame maps every canonical field through and derives the display fields', async () => {
  const sans = ['e4', 'e5', 'Nf3'];
  const fens = fensFor(sans);
  // On the third position the engine prefers d4 over the played Nf3.
  const engine = stubEngine(sans, { alter: { [fens[2]]: { best: 'd2d4', score: 40 } } });
  const out = await mod.analyzeGmGame('start', sans, { engine });

  assert.equal(out.length, 3);
  assert.deepEqual(out.map((m) => m.san), sans);
  /* Canonical ply is 0-based (the pipeline logs `pl.ply + 1` as the move
     number); the replay reads entries by array index, never by this field. */
  assert.deepEqual(out.map((m) => m.ply), [0, 1, 2]);

  // Classification fields are the canonical row untouched.
  for (const m of out) {
    assert.ok(m.verdict, 'verdict passes through');
    assert.equal(typeof m.cpl, 'number');
    assert.equal(typeof m.wpd === 'number' || m.wpd === null, true);
    assert.ok(Array.isArray(m.lines) && m.lines.length > 0, 'engine lines pass through');
  }

  // Display derivations.
  assert.equal(out[0].wasBest, true);
  assert.equal(out[0].bestSan, 'e4');
  assert.equal(out[0].evalAfter, out[0].played, 'white keeps mover perspective');
  assert.equal(out[2].wasBest, false);
  assert.equal(out[2].bestSan, 'd4', 'best SAN resolved from the canonical bestUci');
  assert.equal(out[2].bestFrom, 'd2');
  assert.equal(out[2].bestTo, 'd4');

  // Black's score is flipped to White's point of view, exactly once.
  assert.equal(out[1].played != null, true);
  assert.equal(out[1].evalAfter, -(out[1].played), 'black mover-perspective becomes white-perspective');
});

test('analyzeGmGame grades the whole Morphy game without inventing moves', async () => {
  const engine = stubEngine(MORPHY_SANS);
  const out = await mod.analyzeGmGame('start', MORPHY_SANS, { engine });
  assert.equal(out.length, MORPHY_SANS.length);
  assert.deepEqual(out.map((m) => m.san), MORPHY_SANS);
  assert.ok(out.every((m) => m.wasBest), 'stub best == played on every ply');
  assert.equal(out[out.length - 1].bestSan, 'Rd8#');
});

test('analyzeGmGame reports progress and honours cancellation', async () => {
  const engine = stubEngine(['e4', 'e5']);
  const seen = [];
  const out = await mod.analyzeGmGame('start', ['e4', 'e5'], {
    engine,
    onProgress: (p) => seen.push(p),
  });
  assert.equal(out.length, 2);
  assert.ok(seen.length > 0, 'progress reported');
  assert.ok(seen.every((p) => p.total === 2), 'total is the move count');

  const cancelled = await mod.analyzeGmGame('start', ['e4', 'e5'], {
    engine,
    shouldAbort: () => true,
  });
  assert.deepEqual(cancelled, [], 'a cancelled run resolves empty');
});

/* Mate-score perspective mapping is covered with the real engine in
 * analysis-parity (Scholar's/Fool's mate through all three adapters).
 *
 * ── describeAnalysis: the replay card's move-by-move text ─────────────────
 * Inputs are canonical verdicts now, so coverage is per verdict-branch: every
 * branch names the engine's preference, never prints a placeholder, and a
 * best move is never described as a blunder. `formatEval` prints a typographic
 * minus (U+2212), so negative expectations below use it. */
const MINUS = '−';
const ply = (over) => ({
  ply: 1, player: 'w', san: 'e4', uci: 'e2e4', verdict: 'best', sigma: null,
  forced: false, bestSan: null, sacrifice: false, sacrificeProtected: false,
  cpl: 0, loss: 0, swing: 0, wpd: 0, acc: 100, best: 20, played: 20,
  bestUci: 'e2e4', depth: 18, lines: [], wasBest: true,
  bestFrom: 'e2', bestTo: 'e4', evalAfter: 0, mateAfter: null, ...over,
});

test('describeAnalysis never calls a best move a blunder', () => {
  for (const wasBest of [true, false]) {
    const text = mod.describeAnalysis(ply({ wasBest, verdict: 'best', bestSan: 'Qxd5', loss: -40, evalAfter: 30 }));
    assert.doesNotMatch(text, /blunder/i, `wasBest=${wasBest} must not read as a blunder`);
    assert.doesNotMatch(text, /mistake|inaccuracy/i, `wasBest=${wasBest} must not read as a weaker grade`);
  }
  const better = mod.describeAnalysis(ply({ wasBest: false, verdict: 'best', bestSan: 'Qxd5', loss: -40, evalAfter: 30 }));
  assert.match(better, /Qxd5/, 'names the engine pick that was bettered');
  assert.doesNotMatch(better, /0\.40 pawns/, 'a negative loss is not quoted as a cost');
});

test('describeAnalysis covers every verdict with no placeholder text', () => {
  for (const verdict of ['sigma', 'great', 'best', 'excellent', 'good', 'book', 'miss', 'inaccuracy', 'mistake', 'blunder']) {
    const text = mod.describeAnalysis(ply({ wasBest: false, verdict, bestSan: 'e4', loss: 40, evalAfter: -30 }));
    assert.match(text, /e4|theory|sacrifice|slip/i, `${verdict} says something move-specific`);
    assert.doesNotMatch(text, /undefined|NaN|\[object/, `${verdict} has no placeholder text`);
  }
});

test('describeAnalysis calls a sigma move brilliant, never a blunder', () => {
  const text = mod.describeAnalysis(ply({
    wasBest: true, verdict: 'sigma', bestSan: 'Bxg3', loss: 0, evalAfter: -346,
    sigma: { type: 'bishop_sacrifice', label: 'Bishop Sacrifice', piece: 'b', rank: 2, fromSquare: 'd6', toSquare: 'g3' },
  }), 'b');
  assert.match(text, /brilliant/i);
  assert.match(text, /sacrifice/i);
  assert.doesNotMatch(text, /blunder/i);
});

test('describeAnalysis says the engine agreed when the move was best', () => {
  const text = mod.describeAnalysis(ply({ wasBest: true, verdict: 'best', bestSan: 'Nf3', evalAfter: 25 }));
  assert.match(text, /first choice/i);
  assert.match(text, /\+0\.3/, 'quotes the evaluation after the move');
});

test('describeAnalysis names the move the engine wanted instead', () => {
  const text = mod.describeAnalysis(ply({ wasBest: false, verdict: 'mistake', bestSan: 'Bb5+', loss: 165, evalAfter: -40 }), 'w');
  assert.match(text, /Bb5\+/);
  assert.match(text, /1\.65 pawns/, 'reports the size of the error');
  assert.match(text, /White/, 'names the side that played it');
  assert.doesNotMatch(text, /\+1\.65/, 'a loss is a magnitude, never signed with +');
});

test('describeAnalysis reads as a blunder, not as a generic note', () => {
  const blunder = mod.describeAnalysis(ply({ wasBest: false, verdict: 'blunder', bestSan: 'Qd7', loss: 640, evalAfter: -520 }));
  assert.match(blunder, /blunder/i);
  assert.match(blunder, /6\.40 pawns/);
  assert.match(blunder, new RegExp(`${MINUS}5\\.2`), 'quotes the collapsed evaluation');
});

test('describeAnalysis distinguishes good from inaccuracy', () => {
  const good = mod.describeAnalysis(ply({ wasBest: false, verdict: 'good', bestSan: 'd4', loss: 8, evalAfter: 12 }));
  const inaccuracy = mod.describeAnalysis(ply({ wasBest: false, verdict: 'inaccuracy', bestSan: 'd4', loss: 40, evalAfter: -30 }));
  assert.doesNotMatch(good, /slips|error|blunder/i);
  assert.match(inaccuracy, /slips/i);
});

test('describeAnalysis announces the mating move', () => {
  const text = mod.describeAnalysis(ply({ wasBest: true, verdict: 'best', mateAfter: 1, evalAfter: 10000, bestSan: 'Rd8#' }));
  assert.match(text, /mates|checkmate/i);
  const blackMate = mod.describeAnalysis(ply({ mateAfter: -1, evalAfter: -100000 }), 'b');
  assert.match(blackMate, /mates|checkmate/i);
});

test('describeAnalysis still says checkmate when the engine scored nothing', () => {
  const unscored = { ply: 33, evalAfter: null, mateAfter: null, wasBest: false };
  const text = mod.describeAnalysis(unscored, 'w', { endedInMate: true });
  assert.match(text, /mates|checkmate/i);
  const black = mod.describeAnalysis(unscored, 'b', { endedInMate: true });
  assert.match(black, /Black/i);
});

test('describeAnalysis never invents a number the engine did not give', () => {
  const unscored = mod.describeAnalysis(ply({ verdict: 'good', loss: null, evalAfter: null, mateAfter: null, wasBest: false, unanalysed: true }));
  assert.doesNotMatch(unscored, /undefined|NaN|\d+\.\d+ pawns/, 'no number is quoted without a score');
  const stillRunning = mod.describeAnalysis(null);
  assert.match(stillRunning, /reading/i);
});

test('describeAnalysis keeps a losing evaluation signed from White point of view', () => {
  const text = mod.describeAnalysis(ply({ wasBest: false, verdict: 'inaccuracy', loss: 40, evalAfter: -30, bestSan: 'Nc6' }));
  assert.match(text, new RegExp(`${MINUS}0\\.3`), 'a losing eval keeps its sign');
});
