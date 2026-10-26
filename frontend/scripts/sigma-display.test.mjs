/* ────────────────────────────────────────────────���─────────────────────────
 * Brilliant-move DISPLAY: the card must show the position AFTER the move, in
 * the canonical Brilliant colour, with the destination square highlighted.
 *
 * Pure helpers + rendering only. No verdict is derived anywhere here — the sigma
 * verdict is read from REVIEW_META, and the move's identity comes from the
 * stored ply/from/to the analysis pipeline produced.
 *
 * Run: node --test scripts/sigma-display.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  brilliantColor,
  brilliantDeepColor,
  sigmaMoveAfterFen,
  sigmaCardBoard,
  destinationBadge,
  plyToMoveIndex,
} from '../src/utils/sigmaDisplay.js';
import { reviewMetaFor, REVIEW_META } from '../src/utils/gameReview.js';
import { SIGMA_VERDICT, LEGACY_SIGMA_VERDICT } from '../src/utils/sigmaType.js';

const SANS = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'h6', 'O-O', 'Nf6', 'Nc3', 'b6',
  'd3', 'Bb7', 'Be3', 'Be7', 'h3', 'Nd4', 'Nxd4', 'exd4', 'Bxd4', 'c5', 'Be3',
  'd5', 'exd5', 'Nxd5', 'Nxd5', 'Bxd5', 'Bb5+', 'Kf8', 'c4', 'Be6', 'Qd2', 'a6',
  'Ba4', 'Bd6', 'Rad1', 'g5', 'Rfe1', 'Rg8', 'Re2', 'Ke7', 'Rde1', 'Qc7', 'Qc3',
  'g4', 'hxg4', 'Rxg4', 'Bxh6', 'Rag8', 'g3', 'Bxg3', 'fxg3', 'Qxg3+', 'Kf1', 'Qg1#'];

const BXG3_INDEX = SANS.indexOf('Bxg3');

/** chess.js get() returns {type,color}; tests want the bare piece letter. */
const pieceAt = (fen, square) => {
  const p = new Chess(fen).get(square);
  return p ? p.type : null;
};

/** The stored row the analysis pipeline writes for 25...Bxg3. */
function bxg3Row() {
  const g = new Chess();
  const fens = [g.fen()];
  const moves = [];
  for (const san of SANS) {
    moves.push(g.move(san));
    fens.push(g.fen());
  }
  const mv = moves[BXG3_INDEX];
  return {
    gameSource: 'chess_profile',
    gameId: 7,
    ply: BXG3_INDEX,          // 49 — 0-based review ply
    moveNumber: Math.floor(BXG3_INDEX / 2) + 1,  // 25
    moveSan: mv.san,
    fromSquare: mv.from,
    toSquare: mv.to,
    fenBefore: fens[BXG3_INDEX],
    playedBy: 'black',
  };
}

/* ── colour: one definition, reused ───────────────────────────────────────── */

test('the arrow colour is the canonical Brilliant badge colour', () => {
  const meta = reviewMetaFor(SIGMA_VERDICT);
  assert.ok(meta, 'the sigma meta exists');
  assert.equal(brilliantColor(), meta.color);
  assert.equal(brilliantColor(), reviewMetaFor(LEGACY_SIGMA_VERDICT)?.color,
    'both spellings resolve to one colour');
});

test('both sigma spellings share ONE meta object, so the colours cannot drift', () => {
  assert.equal(REVIEW_META[SIGMA_VERDICT], REVIEW_META[LEGACY_SIGMA_VERDICT]);
  assert.notEqual(brilliantColor(), '#f59e0b', 'not the old hardcoded amber');
  assert.match(brilliantColor(), /^#[0-9a-f]{6}$/i);
  assert.match(brilliantDeepColor(), /^#[0-9a-f]{6}$/i);
});

/* ── the after-move position ──────────────────────────────────────────────── */

test('the card board shows the position AFTER 25...Bxg3', () => {
  const row = bxg3Row();
  /* White's g-pawn is already on g3 here (White played g3 the ply before), so
     this sacrifice is a piece capture ONTO an occupied square — which is exactly
     why drawing fenBefore showed g3 still holding that pawn instead of the
     bishop. The bishop is the thing that must end up on g3. */
  assert.equal(pieceAt(row.fenBefore, 'd6'), 'b', 'the bishop is still on d6 in fenBefore');
  assert.equal(pieceAt(row.fenBefore, 'g3'), 'p', 'g3 still holds the pawn being captured');

  const board = sigmaCardBoard(row);
  assert.ok(board, 'a board could be derived');
  assert.equal(pieceAt(board.fen, 'g3'), 'b', 'g3 now holds the sacrificed bishop');
  assert.equal(pieceAt(board.fen, 'd6'), null, 'and d6 is empty');
  /* and it is exactly the position the game actually reached on the next ply */
  const uptoBxg3 = new Chess();
  for (const san of SANS.slice(0, BXG3_INDEX + 1)) uptoBxg3.move(san);
  assert.equal(board.fen, uptoBxg3.fen(), 'identical to the real next-ply position');
});

test('the board is the position after the move, not before it', () => {
  const row = bxg3Row();
  const board = sigmaCardBoard(row);
  assert.notEqual(board.fen, row.fenBefore, 'the drawn position differs from fenBefore');
  assert.equal(board.isAfter, true);
});

test('the arrow points from the real source to the real destination', () => {
  const board = sigmaCardBoard(bxg3Row());
  assert.equal(board.from, 'd6');
  assert.equal(board.to, 'g3');
  /* And those squares really are the move, in the drawn position. */
  assert.equal(board.fen, sigmaMoveAfterFen(bxg3Row()));
});

test('destinationBadge converts the destination square for the badge overlay', () => {
  assert.deepEqual(destinationBadge('d6', 'g3'), { square: 'g3', file: 6, rank: 2 });
  assert.deepEqual(destinationBadge('e2', 'e4'), { square: 'e4', file: 4, rank: 3 });
  assert.equal(destinationBadge('d6', null), null);
  assert.equal(destinationBadge('d6', 'x'), null);
});

test('a promoting move replays with its promotion piece', () => {
  const g = new Chess('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  const fenBefore = g.fen();
  g.move('a8=Q');
  const row = { fenBefore, fromSquare: 'a7', toSquare: 'a8', moveSan: 'a8=Q' };
  const after = new Chess(sigmaMoveAfterFen(row));
  assert.equal(pieceAt(sigmaMoveAfterFen(row),'a8'), 'q', 'the queen really is on a8');
});

test('an underpromotion replays with the knight', () => {
  const g = new Chess('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  const fenBefore = g.fen();
  const promo = g.moves({ verbose: true }).find((m) => m.to === 'a8' && m.promotion === 'n');
  assert.ok(promo, 'a knight promotion to a8 is available');
  g.move({ from: promo.from, to: promo.to, promotion: 'n' });
  const row = { fenBefore, fromSquare: promo.from, toSquare: promo.to, moveSan: 'a8=N' };
  assert.equal(pieceAt(sigmaMoveAfterFen(row), 'a8'), 'n', 'the knight, not the pawn, is on a8');
});

test('a move that cannot be replayed yields null, never a wrong position', () => {
  /* An illegal from/to pair, and a stored position that no longer describes a
     legal game — both must degrade to null so the card shows its explicit
     placeholder instead of drawing a position that never existed. */
  const g = new Chess();
  g.move('e4');
  const fenAfterE4 = g.fen();
  /* e2 no longer holds a pawn (White played e4), so e2e5 cannot be a move. */
  assert.equal(sigmaMoveAfterFen({ fenBefore: fenAfterE4, fromSquare: 'e2', toSquare: 'e5', moveSan: 'e2e5' }), null);
  /* e7e5 IS legal two-square pawn push — the helper must not reject real moves. */
  assert.ok(sigmaMoveAfterFen({ fenBefore: fenAfterE4, fromSquare: 'e7', toSquare: 'e5', moveSan: 'e5' }));
  /* A truncated/garbage FEN must not throw out of the renderer. */
  assert.equal(sigmaMoveAfterFen({ fenBefore: 'not-a-fen', fromSquare: 'd6', toSquare: 'g3', moveSan: 'Bxg3' }), null);
  assert.equal(sigmaMoveAfterFen({ fenBefore: '', fromSquare: 'd6', toSquare: 'g3', moveSan: 'Bxg3' }), null);
  /* A plain, non-sacrificial move still replays — the helper is about geometry,
     not about whether the move deserves a badge. */
  const knightG = new Chess();
  knightG.move('e4');
  knightG.move('e5');
  const afterTwo = knightG.fen();
  const nf3 = knightG.moves({ verbose: true }).find((m) => m.from === 'g1');
  assert.ok(nf3, 'g1 knight can move');
  assert.ok(sigmaMoveAfterFen({
    fenBefore: afterTwo, fromSquare: nf3.from, toSquare: nf3.to, moveSan: nf3.san,
  }), 'a normal move replays fine');
});

test('an unusable row yields null so the caller can say so', () => {
  assert.equal(sigmaMoveAfterFen(null), null);
  assert.equal(sigmaMoveAfterFen({}), null);
  assert.equal(sigmaMoveAfterFen({ fenBefore: null, fromSquare: 'd6', toSquare: 'g3' }), null);
  /* from/to that are not a legal move in that position */
  assert.equal(sigmaMoveAfterFen({ fenBefore: 'start', fromSquare: 'd6', toSquare: 'g3' }), null);
  /* occupied destination with no capture — illegal */
  const g = new Chess();
  g.move('d4');
  g.move('d5');
  const fen2 = g.fen();
  /* from === to is not a legal move. */
  assert.equal(sigmaMoveAfterFen({ fenBefore: fen2, fromSquare: 'a1', toSquare: 'a1' }), null);
});

/* ── ply → move index: the off-by-one the bug report describes ─────────────── */

test('a brilliant ply resolves to the position AFTER that move', () => {
  const total = SANS.length;
  /* 25...Bxg3 is review ply 49 → replay 50 moves to have it on the board. */
  assert.equal(BXG3_INDEX, 49);
  assert.equal(plyToMoveIndex(BXG3_INDEX, total), 50);

  const g = new Chess();
  for (const san of SANS.slice(0, plyToMoveIndex(BXG3_INDEX, total))) g.move(san);
  const after = new Chess(g.fen());
  assert.equal(pieceAt(g.fen(),'g3'), 'b', 'Bxg3 is already played at that index');
  assert.equal(pieceAt(g.fen(),'d6'), null);
});

test('the index uses the ply, never the move number', () => {
  /* Move 25 is ply 49 (Black). Using the move number would select ply 25 —
     White's 13th move — and open the wrong position entirely. */
  const row = bxg3Row();
  assert.equal(row.moveNumber, 25);
  assert.notEqual(plyToMoveIndex(row.ply, 160), row.moveNumber);
  assert.equal(plyToMoveIndex(row.ply, 160), 50, 'Black ply 49 → 50 moves replayed');
});

test('the index is correct for White, Black, first and last move', () => {
  /* White's first move is ply 0 → replay 1. */
  assert.equal(plyToMoveIndex(0, 40), 1);
  /* Black's first move is ply 1 → replay 2 (not "move 1"). */
  assert.equal(plyToMoveIndex(1, 40), 2);
  /* The last move. */
  assert.equal(plyToMoveIndex(39, 40), 40);
});

test('the index is clamped and rejects nonsense', () => {
  assert.equal(plyToMoveIndex(500, 40), 40, 'past the end clamps to the end');
  assert.equal(plyToMoveIndex(-1, 40), 0);
  assert.equal(plyToMoveIndex(NaN, 40), 0);
  assert.equal(plyToMoveIndex(undefined, 40), 0);
});

test('an UNKNOWN move total must not collapse the index to zero', () => {
  /* The stored sigma row carries no move count. Clamping against an unknown
     length resolved to 0, which opened the game at its STARTING position — the
     very "board is on the wrong ply" symptom the conversion exists to prevent,
     now reintroduced through the other end. */
  for (const unknown of [undefined, null, 0, NaN, 'nope']) {
    assert.equal(plyToMoveIndex(49, unknown), 50, `${String(unknown)} must still resolve ply 49 → 50`);
    assert.equal(plyToMoveIndex(0, unknown), 1, `${String(unknown)}: first move → 1`);
  }
  /* And a KNOWN total still clamps. */
  assert.equal(plyToMoveIndex(49, 40), 40);
  assert.equal(plyToMoveIndex(3, 40), 4);
});

/* ── black-first / custom-FEN games ───────────────────────────────────────── */

test('a black-first custom-FEN game indexes by ply, not by row', () => {
  /* 1...k moves first: ply 0 is BLACK's opening move. */
  const fen = '4k3/8/8/8/8/5p2/8/4K3 b - - 0 1';
  const g = new Chess(fen);
  const fens = [g.fen()];
  const moves = [];
  /* Built from the legal move list so this test cannot rot into an illegal
     SAN — the point under test is the ply arithmetic, not the chess. */
  const legal = g.moves({ verbose: true });
  const first = legal.find((m) => !m.san.startsWith('K'));
  moves.push(g.move({ from: first.from, to: first.to }));
  fens.push(g.fen());
  const second = g.moves({ verbose: true })[0];
  moves.push(g.move({ from: second.from, to: second.to }));
  fens.push(g.fen());
  const opener = moves[0];
  const row = { fenBefore: fens[0], fromSquare: opener.from, toSquare: opener.to, moveSan: opener.san, ply: 0 };
  assert.equal(plyToMoveIndex(0, 2), 1, 'replay 1 move for ply 0');
  assert.equal(pieceAt(sigmaMoveAfterFen(row), opener.to), 'p', 'the pawn really moved');
  assert.equal(new Chess(sigmaMoveAfterFen(row)).turn(), 'w', 'White replies after Black opened');
});

/* ── the card must not silently fall back to the before position ──────────── */

test('sigmaCardBoard never returns the before position as its board', () => {
  const row = bxg3Row();
  const board = sigmaCardBoard(row);
  assert.notEqual(board.fen, row.fenBefore);
});

test('a white brilliant move and a black one both resolve after their own ply', () => {
  const g = new Chess();
  const fens = [g.fen()];
  for (const san of ['e4', 'e5', 'Qh5', 'Nf6']) {
    g.move(san);
    fens.push(g.fen());
  }
  /* White's Qh5: ply 2. Black's Nf6: ply 3. */
  const white = { fenBefore: fens[2], fromSquare: 'd1', toSquare: 'h5', moveSan: 'Qh5', ply: 2 };
  const black = { fenBefore: fens[3], fromSquare: 'g8', toSquare: 'f6', moveSan: 'Nf6', ply: 3 };
  const w = new Chess(sigmaCardBoard(white).fen);
  const b = new Chess(sigmaCardBoard(black).fen);
  assert.equal(pieceAt(sigmaMoveAfterFen(white),'h5'), 'q');
  assert.equal(pieceAt(sigmaMoveAfterFen(black),'f6'), 'n');
  assert.equal(plyToMoveIndex(white.ply, 4), 3);
  assert.equal(plyToMoveIndex(black.ply, 4), 4);
});

/* ── multiple brilliants in one game stay independent ─────────────────────── */

test('each brilliant in a game resolves to its own position', () => {
  const g = new Chess();
  const fens = [g.fen()];
  const moves = [];
  for (const san of SANS) {
    moves.push(g.move(san));
    fens.push(g.fen());
  }
  /* Two distinct sigma-looking plies (Rxg4 at 45, Bxg3 at 49). */
  const plies = [45, 49];
  const seen = plies.map((ply) => {
    const mv = moves[ply];
    const board = sigmaCardBoard({
      fenBefore: fens[ply], fromSquare: mv.from, toSquare: mv.to, moveSan: mv.san, ply,
    });
    return { ply, fen: board.fen, from: board.from, to: board.to };
  });
  assert.notEqual(seen[0].fen, seen[1].fen, 'the two cards show different positions');
  assert.notEqual(seen[0].to, seen[1].to);
  assert.notEqual(plyToMoveIndex(45, SANS.length), plyToMoveIndex(49, SANS.length));
});

