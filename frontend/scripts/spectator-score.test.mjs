// Regression tests for the spectator score sheet -
//   run with: node --test scripts/spectator-score.test.mjs   (from frontend/)
//
// The spectator move list used to be a bare numbered list with the players'
// names only printed once, above the board. On a 64-move game you scroll past
// the header and can no longer tell which side played which column.
//
// Asserted here:
//  1. The sheet carries the players' names in its own sticky header.
//  2. That header is OPAQUE and shares .spec-move-row's grid, or rows show
//     through it and the labels drift out of their columns.
//  3. The pairing is correct for a normal game AND for a game set up from a FEN
//     with Black to move (the case a naive i*2 loop silently mis-numbers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Chess } from 'chess.js';
import { buildScoreRows, gameStartsBlack } from '../src/lib/scoreSheet.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsx = readFileSync(join(ROOT, 'src', 'components', 'SpectatorBoard.jsx'), 'utf8');
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');

/* The game from the report, as SAN: Albin Countergambit, Black to move and win. */
const REPORTED_PGN = [
  'e4', 'e5', 'd4', 'Nc6', 'd5', 'Nce7', 'Bg5', 'f6', 'Bxf6', 'gxf6',
  'Qh5+', 'Ng6', 'Nf3', 'd6', 'Nh4', 'Ne7', 'Nxg6', 'Nxg6', 'Qe2', 'Bg7',
  'Qb5+', 'Bd7', 'Qd3', 'Qe7', 'Nc3', 'O-O', 'Be2', 'f5', 'exf5', 'Bxf5',
  'Qe3', 'Nf4', 'O-O', 'Bh6', 'Qg3+', 'Ng6', 'Bh5', 'Bxc2', 'Bxg6', 'Bxg6',
  'Nb5', 'Bg7', 'Rae1', 'a6', 'Nd4', 'Bh6', 'Qc3', 'Qh4', 'Ne6', 'Bf4',
  'g3', 'Qg4', 'f3', 'Qh3', 'Qxc7', 'Rf7', 'Qxd6', 'Bxg3', 'Re2', 'Bd3',
  'Ng5', 'Bxh2+',
];

/* After 1.e4: the natural place for a black-to-move game, so the moves that
   follow are the real Albin sequence shifted by one full move. */
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
const AFTER_E4_MOVES = ['e5', 'd4', 'Nc6', 'd5', 'Nce7', 'Bg5', 'f6'];

function historyOf(pgnMoves, { fen } = {}) {
  const g = new Chess();
  if (fen) g.load(fen);
  for (const san of pgnMoves) g.move(san);
  return g.history();
}

test('the sheet shows both player names in its own header', () => {
  assert.match(jsx, /<div className="spec-score-head"/,
    'the score sheet needs its own header row');
  assert.match(jsx, /\{\s*whiteName\s*\}\s*<\/span>/,
    'White name must be rendered inside the header, not just in .spec-sub');
  assert.match(jsx, /\{\s*blackName\s*\}\s*<\/span>/,
    'Black name must be rendered inside the header');
  /* names must come from the snapshot, with a fallback so a missing field
   * renders "White"/"Black" instead of a blank column */
  assert.match(jsx, /String\(snap\.whiteName \|\| ''\)\.trim\(\) \|\| 'White'/);
  assert.match(jsx, /String\(snap\.blackName \|\| ''\)\.trim\(\) \|\| 'Black'/);
  /* a long name must not push the grid apart */
  assert.match(jsx, /className="spec-score-label"/);
});

test('the header is sticky, opaque, and shares the row grid', () => {
  const head = /\.spec-score-head \{([^}]*)\}/.exec(css);
  assert.ok(head, '.spec-score-head must be styled');
  const body = head[1];
  assert.match(body, /position:\s*sticky/, 'the header must stay put while the sheet scrolls');
  assert.match(body, /z-index:\s*\d/,
    'a sticky header needs a z-index or the moves paint over it');

  const grid = /grid-template-columns:\s*22px 1fr 1fr/;
  const rowGrid = /\.spec-move-row \{([^}]*)\}/.exec(css);
  assert.match(body, grid, 'the header grid must match the move rows');
  assert.match(rowGrid[1], grid, 'the row grid must still be 22px 1fr 1fr');
  assert.match(body, /gap:\s*6px/);

  /* Translucent background is the classic sticky-header bug: the list behind is
     rgba(255,255,255,0.8), so an inherited/translucent header shows the rows
     scrolling underneath it. Both themes must state a solid colour. */
  const dark = /\.spec-score-head \{[^}]*background:\s*(#[0-9a-f]{3,8})/i.exec(css);
  assert.ok(dark, 'the base header needs an explicit opaque background');
  const light = /\.spec-overlay \.spec-score-head \{([^}]*)\}/.exec(css);
  assert.ok(light, 'the light-theme header needs an override');
  assert.match(light[1], /background:\s*#fff/,
    'the light header must be solid white, not inherit/translucent');
});

test('the reported game pairs into correctly numbered rows', () => {
  const history = historyOf(REPORTED_PGN);
  assert.equal(history.length, 62, 'the reported game has 62 plies to this point');

  const rows = buildScoreRows(history, false);
  assert.equal(rows.length, 31);
  assert.deepEqual(rows[0], { label: '1.', white: 'e4', black: 'e5', whitePly: 0, blackPly: 1 });
  assert.deepEqual(rows[10], { label: '11.', white: 'Qb5+', black: 'Bd7', whitePly: 20, blackPly: 21 });
  assert.deepEqual(rows[21], { label: '22.', white: 'Rae1', black: 'a6', whitePly: 42, blackPly: 43 });
  /* last row is half full: Black has not answered move 31 */
  assert.deepEqual(rows[30], { label: '31.', white: 'Ng5', black: 'Bxh2+', whitePly: 60, blackPly: 61 });

  /* every ply must appear exactly once, in order - no dropped or shifted move */
  assert.deepEqual(rows.flatMap((r) => [r.white, r.black]).filter(Boolean), history);
});

test('a game that starts with Black to move is numbered correctly', () => {
  const history = historyOf(AFTER_E4_MOVES, { fen: AFTER_E4 });
  assert.equal(gameStartsBlack(new Chess(AFTER_E4)), true);

  const rows = buildScoreRows(history, true);

  /* the opening move is Black's, and must sit in the BLACK column as "1..." */
  assert.deepEqual(rows[0], { label: '1...', white: null, black: 'e5', whitePly: null, blackPly: 0 });
  /* White's reply is the SECOND move, and the rhythm then runs 2,2,3,3,4,4 */
  assert.deepEqual(rows[1], { label: '2.', white: 'd4', black: 'Nc6', whitePly: 1, blackPly: 2 });
  assert.deepEqual(rows[2], { label: '3.', white: 'd5', black: 'Nce7', whitePly: 3, blackPly: 4 });
  assert.deepEqual(rows[3], { label: '4.', white: 'Bg5', black: 'f6', whitePly: 5, blackPly: 6 });
  assert.deepEqual(rows.map((r) => r.label), ['1...', '2.', '3.', '4.']);

  /* no move may be lost or reordered by the black-first layout */
  assert.deepEqual(rows.flatMap((r) => [r.white, r.black]).filter(Boolean), history);
});

test('a truncated game keeps its row height on the half-filled row', () => {
  const rows = buildScoreRows(['e4'], false);
  assert.deepEqual(rows, [{ label: '1.', white: 'e4', black: null, whitePly: 0, blackPly: null }]);
  assert.deepEqual(buildScoreRows([], false), []);
  assert.deepEqual(buildScoreRows(null, false), []);
});

test('the black-first test comes from the PGN FEN tag, not a guess', () => {
  assert.equal(gameStartsBlack(null), false);
  assert.equal(gameStartsBlack(new Chess()), false, 'no FEN tag means a normal game');

  const black = new Chess(AFTER_E4);
  assert.equal(gameStartsBlack(black), true);

  /* a PGN that carries the FEN in its header must be detected too */
  const tagged = new Chess();
  tagged.loadPgn(`[FEN "${AFTER_E4}"]\n\n1... e5 2. d4 Nc6 3. d5 Nce7 4. Bg5 f6`);
  assert.equal(gameStartsBlack(tagged), true);
});