// Regression tests for src/utils/positionDiff.js — the ONE "did exactly one
// legal move produce this position?" probe that AnimatedBoard uses to animate a
// ply and ChessBoard uses to sound/effect a move it did not play itself
// (run with: node --test scripts/board-position-diff.test.mjs, from frontend/).
//
// It replaces two private copies of the same function (AnimatedBoard.jsx and
// ChessBoard.jsx). The old shape asked the previous position for EVERY legal
// move and applied each one — `move(san)` + `fen()` + `undo()` — until the FEN
// matched. For a mid-game position that is 30-40 full legal-move generations per
// probe, and the game viewer probes up to three times per navigation, which is
// what made rapid Prev/Next freeze the page.
//
// The new shape narrows the legal list to the moves whose origin AND destination
// both appear in the placement diff before applying anything. These tests pin
// that the ANSWER is unchanged — same move, same null — on every case the
// geometry shortcut could plausibly get wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { exactlyOnePly, positionKey } from '../src/utils/positionDiff.js';

/** The implementation being replaced, kept here as the oracle. */
function oldExactlyOnePly(prevFen, nextFen) {
  if (!prevFen || !nextFen || prevFen === nextFen) return null;
  let prevGame;
  try { prevGame = new Chess(prevFen); } catch { return null; }
  const legal = prevGame.moves({ verbose: true });
  for (const m of legal) {
    try {
      prevGame.move(m.san);
      if (positionKey(prevGame.fen()) === positionKey(nextFen)) return m;
      prevGame.undo();
    } catch { /* keep scanning */ }
  }
  return null;
}

/** Play a SAN list, returning the FEN after every ply (index 0 = start). */
function fensOf(sans, initFen) {
  const g = initFen ? new Chess(initFen) : new Chess();
  const out = [g.fen()];
  for (const san of sans) {
    g.move(san);
    out.push(g.fen());
  }
  return out;
}

/**
 * Small games that put the diff in front of every move shape it has to see:
 *   castling   — the king AND the rook change squares (4 changed squares),
 *   en passant — from, to and the VICTIM's square (3 changed squares),
 *   promotion  — the destination gains a different piece type.
 * Each is seeded from a FEN so the sequence is short and provably legal.
 */
const FIXTURE_GAMES = [
  { name: 'castling', initFen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
    sans: ['O-O', 'O-O-O', 'Kg2', 'Kb8'] },
  { name: 'en passant', initFen: 'rnbqkb1r/pppp1ppp/5n2/4P3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3',
    sans: ['exd6', 'cxd6', 'Nc3', 'Nc6'] },
  { name: 'promotion to queen', initFen: '8/3P4/8/7k/8/8/8/7K w - - 0 1',
    sans: ['d8=Q', 'Kg6', 'Qg5+', 'Kf7'] },
  { name: 'promotion to knight', initFen: '8/3P4/8/7k/8/8/8/7K w - - 0 1',
    sans: ['d8=N', 'Kg6', 'Kg2', 'Kf6'] },
];

/** A deterministic pseudo-random game (long, so the mid-game is busy). */
function longGame(plies = 140, seedIn = 987654321) {
  let seed = seedIn;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const g = new Chess();
  const sans = [];
  while (!g.isGameOver() && sans.length < plies) {
    const ms = g.moves({ verbose: true });
    sans.push(ms[Math.floor(rnd() * ms.length)].san);
    g.move(sans[sans.length - 1]);
  }
  return sans;
}

/** A shape both implementations must answer identically. */
function sameAnswer(fenA, fenB, label) {
  const mine = exactlyOnePly(fenA, fenB);
  const theirs = oldExactlyOnePly(fenA, fenB);
  if (theirs === null) {
    assert.equal(mine, null, `${label}: expected null, got ${JSON.stringify(mine?.san)}`);
    return;
  }
  assert.ok(mine, `${label}: oracle found ${theirs.san}, new diff found nothing`);
  assert.equal(mine.san, theirs.san, `${label}: different move inferred`);
  assert.equal(mine.from, theirs.from, `${label}: different origin`);
  assert.equal(mine.to, theirs.to, `${label}: different destination`);
  /* Callers read the verbose shape (flags/captured/promotion) for sound,
     animation and the capture ghost — the object must stay a legal-move record. */
  assert.equal(typeof mine.flags, 'string', `${label}: verbose shape lost`);
}

test('every single-ply step of every fixture game matches the oracle', () => {
  let steps = 0;
  for (const game of FIXTURE_GAMES) {
    const fens = fensOf(game.sans, game.initFen);
    for (let i = 0; i + 1 < fens.length; i += 1) {
      sameAnswer(fens[i], fens[i + 1], `${game.name} ${game.sans[i]} (ply ${i + 1})`);
      steps += 1;
    }
  }
  assert.ok(steps > 12, `fixtures are too short (${steps} steps)`);
});

test('the fixtures actually exercise castling, en passant and promotion', () => {
  const found = { castle: 0, enPassant: 0, promotion: 0 };
  for (const game of FIXTURE_GAMES) {
    const fens = fensOf(game.sans, game.initFen);
    for (let i = 0; i + 1 < fens.length; i += 1) {
      const m = exactlyOnePly(fens[i], fens[i + 1]);
      if (!m) continue;
      if (m.flags.includes('k') || m.flags.includes('q')) found.castle += 1;
      if (m.flags.includes('e')) found.enPassant += 1;
      if (m.promotion) found.promotion += 1;
    }
  }
  assert.ok(found.castle >= 2, `no castling in the fixtures (${found.castle})`);
  assert.ok(found.enPassant >= 1, `no en passant in the fixtures (${found.enPassant})`);
  assert.ok(found.promotion >= 2, `no promotion in the fixtures (${found.promotion})`);
});

test('a castling step infers the KING move, not the rook', () => {
  /* The king and the rook both change squares, so both appear in the placement
     diff, but only the king move is in the legal list and only it reproduces
     the destination FEN. */
  const before = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const g = new Chess(before);
  g.move('O-O');
  sameAnswer(before, g.fen(), 'kingside castle');
  const inferred = exactlyOnePly(before, g.fen());
  assert.equal(inferred.from, 'e1');
  assert.equal(inferred.to, 'g1');
  assert.ok(inferred.flags.includes('k'));
});

test('an en-passant step finds the move even though three squares changed', () => {
  const before = 'rnbqkb1r/pppp1ppp/5n2/4P3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3';
  const g = new Chess(before);
  const played = g.move('exd6');
  const inferred = exactlyOnePly(before, g.fen());
  assert.ok(inferred, 'en-passant move was not recognised');
  assert.equal(inferred.to, played.to);
  assert.ok(inferred.flags.includes('e'), 'the en-passant flag must survive');
  assert.equal(inferred.captured, 'p');
});

test('a promotion reports the piece and the choice is told apart by the position', () => {
  /* d8=Q and d8=N share BOTH origin and destination, so the geometry filter
     cannot pick between them — the FEN verification has to. */
  const before = '8/3P4/8/7k/8/8/8/7K w - - 0 1';
  const queen = new Chess(before);
  queen.move('d8=Q');
  const viaQueen = exactlyOnePly(before, queen.fen());
  assert.equal(viaQueen.promotion, 'q');
  assert.equal(viaQueen.san, 'd8=Q');
  sameAnswer(before, queen.fen(), 'promote to queen');

  const knight = new Chess(before);
  knight.move('d8=N');
  const viaKnight = exactlyOnePly(before, knight.fen());
  assert.equal(viaKnight.promotion, 'n');
  assert.equal(viaKnight.san, 'd8=N');
  sameAnswer(before, knight.fen(), 'promote to knight');
});

test('two same-shape knights to one square are told apart by their origins', () => {
  /* Knights on c3 and e3 both reach d5 and the square is empty either way. The
     diff keeps only the origin that actually emptied, so the other knight must
     not be reported. */
  const before = '4k3/8/8/8/8/2N1N3/8/4K3 w - - 0 1';
  const g = new Chess(before);
  g.move('Ncxd5');
  const inferred = exactlyOnePly(before, g.fen());
  assert.equal(inferred.from, 'c3');
  assert.equal(inferred.to, 'd5');
  sameAnswer(before, g.fen(), 'knight origin disambiguation');
});

test('multi-ply jumps and backward steps are rejected exactly like the oracle', () => {
  const fens = fensOf(longGame(60));
  for (let i = 0; i + 2 < fens.length; i += 2) {
    /* two plies forward keeps the turn identical, one ply back flips it but
       almost never matches a legal move — both must return null */
    sameAnswer(fens[i], fens[i + 2], `jump over ply ${i + 1}`);
    sameAnswer(fens[i + 1], fens[i], `undo of ply ${i + 1}`);
  }
});

test('a whole busy game agrees with the oracle on every forward step', () => {
  const fens = fensOf(longGame(140));
  for (let i = 0; i + 1 < fens.length; i += 1) {
    sameAnswer(fens[i], fens[i + 1], `random ply ${i + 1}`);
  }
});

test('non-move inputs answer null and never throw', () => {
  const start = new Chess().fen();
  assert.equal(exactlyOnePly(null, start), null);
  assert.equal(exactlyOnePly(start, null), null);
  assert.equal(exactlyOnePly(start, start), null);
  assert.equal(exactlyOnePly('not a fen', start), null);
  assert.equal(exactlyOnePly(start, 'not a fen'), null);
  /* Same placement, different move counters: nothing physically moved. */
  assert.equal(
    exactlyOnePly('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 3 7'),
    null, 'counter-only difference must not invent a move');
  /* A position whose side to move is unchanged cannot be one ply away. */
  assert.equal(
    exactlyOnePly('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
      'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR b KQkq c6 0 2'),
    null, 'both FENs have Black to move — no single ply connects them');
});

test('the mating ply of a finished game is still recognised', () => {
  const g = new Chess('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1');
  const before = g.fen();
  g.move('Ra8#');
  assert.ok(g.isCheckmate(), 'fixture does not end in mate');
  /* The probe drives the sound and the move effect of the LAST ply, so a
     terminal position must not read as "no move happened". */
  const inferred = exactlyOnePly(before, g.fen());
  assert.equal(inferred.san, 'Ra8#');
  sameAnswer(before, g.fen(), 'back-rank mate');
});
