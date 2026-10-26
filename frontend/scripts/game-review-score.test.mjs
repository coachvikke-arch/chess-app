// Regression tests for the Game Review score sheet -
//   run with: node --test scripts/game-review-score.test.mjs   (from frontend/)
//
// Game Review's move list pairs each SAN with an engine verdict PER PLY
// (verdicts[ply]) and turns each cell into a button that jumps the board to
// that ply. It used to derive both from `rowIndex * 2 + column`, which is only
// correct when White opens - and the list carried no player names at all, so the
// "who played this side" answer existed once, above the board, then scrolled
// out of sight.
//
// Asserted here:
//  1. Names come from the history row and default safely when unknown.
//  2. Cells are keyed by PLY, so every verdict still lands on its own move -
//     including on a black-opening game.
//  3. The list is the gm replay score sheet: one pair per row, with a sticky
//     `# | White | Black` head inside the scroll container.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Chess } from 'chess.js';
import { buildScoreRows, fenStartsBlack, pgnPlayerName } from '../src/lib/scoreSheet.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const review = readFileSync(join(ROOT, 'src', 'pages', 'GameReview.jsx'), 'utf8');
const history = readFileSync(join(ROOT, 'src', 'pages', 'GameHistory.jsx'), 'utf8');
const backend = readFileSync(
  join(ROOT, '..', 'backend', 'src', 'controllers', 'gameHistoryController.js'), 'utf8',
);
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');

const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

test('the sheet header takes the names from the opened history row', () => {
/* `loadPgnText(text, names, origin)` grew a third `origin` argument when Sigma
     moves had to be filed against a real game row, so the two call forms are
     matched with the trailing arguments optional rather than pinned to the
     pre-origin signature. What matters is that the players are still passed. */
  assert.match(review, /loadPgnText\(g\.pgn, \{ white: g\.whiteName, black: g\.blackName \}(,|\))/,
    'opening a game from History must pass its players through');
  assert.match(review, /function loadPgnText\(text, names(,|\))/,
    'loadPgnText must accept the names rather than hard-coding them');
  assert.match(review, /names\?\.white \|\| ''/,
    'an unnamed source (a pasted or URL PGN) must leave the name empty, not invent one');
assert.match(review, /players\.white \|\| pgnPlayerName\(pgnText, 'White'\) \|\| ''\)\.trim\(\) \|\| 'White'/,
    'the header falls back to White');
assert.match(review, /players\.black \|\| pgnPlayerName\(pgnText, 'Black'\) \|\| ''\)\.trim\(\) \|\| 'Black'/,
    'the header falls back to Black');

/* the header must not be gated on analysis completing */
  assert.match(review, /role="columnheader" className="is-white"[\s\S]{0,120}?\{\s*whiteName\s*\}/,
    'the sheet must render a name for each side');
  assert.match(review, /role="columnheader" className="is-black"[\s\S]{0,120}?\{\s*blackName\s*\}/);
});

test('a long name ellipsizes in its column instead of stretching the sheet', () => {
  /* A player called "Kiranrd1898" is fine; one called "Sir Rameshbhai Sekhar
     Ramesh Babuji Naidu" must not push the Black column off the panel. The
     replay sheet clips each header cell, and so must this one. */
  assert.match(css, /\.gr-mvhead > span \{[^}]*overflow\s*:\s*hidden/,
    'header cells must clip their text');
  assert.match(css, /\.gr-mvhead > span \{[^}]*text-overflow\s*:\s*ellipsis/);
  assert.match(css, /\.gr-mvhead > span \{[^}]*white-space\s*:\s*nowrap/);
  assert.match(review, /title=\{`White — \$\{whiteName\}`\}/,
    'the full name stays available on hover once it is clipped');
  assert.match(review, /title=\{`Black — \$\{blackName\}`\}/);
});

test('names are viewer-independent, so an admin sees the same two columns', () => {
  /* myColor/opponentName are relative to the viewer and are useless over a
     fixed two-column sheet. The API must also send absolute white/black names. */
  assert.match(backend, /whiteName: g\.admin_color === 'white' \? g\.admin_name : g\.student_name/,
    'online games must resolve the admin colour to absolute column names');
  assert.match(backend, /blackName: g\.admin_color === 'white' \? g\.student_name : g\.admin_name/);
  assert.match(backend, /whiteName: myColor === 'white' \? g\.student_name : `Computer Lv/,
    'computer games need the student name from the users join');
  assert.match(backend, /JOIN users u ON u\.id = cg\.student_user_id/,
    'computer_games stores only an id, so the name needs a join');
  /* "You" would be right for the student and wrong on an admin's screen */
  assert.ok(!/whiteName:[^;]*'You'/.test(backend),
    'a hard-coded "You" would mislabel the sheet for an admin reviewing a student');
});

test('every move keeps its own ply, so verdicts cannot shift', () => {
  const SAN = ['e5', 'd4', 'Nc6', 'd5', 'Nce7', 'Bg5', 'f6'];
  const g = new Chess(AFTER_E4);
  SAN.forEach((s) => g.move(s));
  const plies = g.history();

  /* Fake the engine output: each ply carries its own index. If the render ever
     goes back to `row * 2 + column`, these stop lining up. */
  const verdicts = plies.map((san, ply) => ({ verdict: 'good', loss: ply * 100, san }));

  for (const startsBlack of [false, true]) {
    const rows = buildScoreRows(plies, startsBlack);
    const seen = [];
    for (const row of rows) {
      for (const cell of [{ p: row.whitePly, s: row.white }, { p: row.blackPly, s: row.black }]) {
        if (cell.p === null) continue;
        seen.push(cell.p);
        const v = verdicts[cell.p];
        assert.ok(v && v.san === cell.s,
          `ply ${cell.p} must resolve to its own verdict, got ${v && v.san}`);
      }
    }
    assert.deepEqual(seen, plies.map((_, i) => i),
      `plies must appear exactly once, in order (startsBlack=${startsBlack})`);
  }

  /* the click target is ply+1: the board cursor is 1-based */
  const rows = buildScoreRows(plies, true);
  const first = rows[0];
  assert.equal(first.blackPly + 1, 1, 'the opening black move jumps to cursor 1');
  assert.equal(rows[1].whitePly + 1, 2, 'white\'s reply is move 2 of the game');
});

test('the render reads the ply off the row, not off row * 2 + column', () => {
  assert.ok(!/const idx = i \* 2 \+ off/.test(review),
    'the original row*2+column indexing must be gone');
  assert.match(review, /cell\.ply \+ 1 === activeIdx/,
    'the active-move highlight must follow the real ply');
  assert.match(review, /verdicts\[cell\.ply\]/,
    'the verdict badge must follow the real ply');
  assert.match(review, /go\(cell\.ply \+ 1\)/,
    'the click target must follow the real ply');
  assert.match(review, /buildScoreRows\(moves, fenStartsBlack\(initialFen\)\)/,
    'rows must come from the shared, tested pairing');
});

test('the heading is the replay sheet: # | White | Black, sticky in the list', () => {
  /* The list is a single column now, so a real header is possible — and it is
     the only placement that labels the columns it heads. */
  const list = review.indexOf('className="gr-movelist"');
  const head = review.indexOf('className="gr-mvhead"');
  const firstRow = review.indexOf('className="gr-mvpair"');
  assert.notEqual(list, -1, '.gr-movelist must exist');
  assert.notEqual(head, -1, '.gr-mvhead must exist');
  assert.ok(list < head, 'the header lives inside the scrolling list');
  assert.ok(head < firstRow, 'the header comes before the first move pair');
  assert.ok(!/className="gr-score-top"/.test(review),
    'the band above the list is gone; the names label the columns now');

  /* both names, and the number column, in order */
  const block = review.slice(head, head + 700);
  assert.match(block, /role="columnheader">#</, 'the number column must be headed');
  assert.match(block, /className="is-white"[^}]*\{\s*whiteName\s*\}/,
    'White names the second column');
  assert.match(block, /className="is-black"[^}]*\{\s*blackName\s*\}/,
    'Black names the third');

  /* the result belongs with the panel title, not over the columns */
  assert.match(review, /gr-moves-head-right/);
  assert.match(review, /\{result && <span className="gr-score-result">\{result\}<\/span>\}/);
});

test('names are read from the session, then from the PGN still in the box', () => {
  /* A session restored from localStorage that predates the names has an empty
     `players`, while its PGN - complete with [White]/[Black] - is still held in
     `pgnText`. Without this fallback the sheet sits showing "White"/"Black" over
     a game whose real names are one field away. */
  assert.match(review, /players\.white \|\| pgnPlayerName\(pgnText, 'White'\)/,
    'the PGN in the textarea must still be able to name the players');
  assert.match(review, /players\.black \|\| pgnPlayerName\(pgnText, 'Black'\)/);
  assert.match(review, /\|\| 'White'/, 'and it still degrades to a plain label');
});

test('the start position sentinel is treated as white-first', () => {
  assert.equal(fenStartsBlack('start'), false);
  assert.equal(fenStartsBlack(''), false);
  assert.equal(fenStartsBlack(null), false);
  assert.equal(fenStartsBlack(new Chess().fen()), false);
  assert.equal(fenStartsBlack(AFTER_E4), true);
});

test('GameHistory forwards each row to onOpenGame unchanged', () => {
  /* if GameHistory reshaped the row, g.whiteName/g.blackName would be undefined
     and the header would silently fall back to White/Black */
  assert.match(history, /onOpenGame/,
    'GameHistory must still hand the loaded row to the callback');
  assert.ok(!/onOpenGame\(\{\s*pgn/.test(history),
    'GameHistory must not strip the player names off the row before calling back');
});
/* The reported case: a PGN pasted from Chess.com. */
const PASTED = `[Event "Kiranrd1898 vs. Nagavel1630"]
[Site "Chess.com"]
[Date "2026-03-23"]
[White "Kiranrd1898"]
[Black "Nagavel1630"]
[Result "0-1"]
[WhiteElo "979"]
[BlackElo "986"]
[TimeControl "600"]
[Termination "Nagavel1630 won by checkmate"]
1. e4 e5 2. d4 Nc6 3. d5 Nce7 4. Bg5 f6 5. Bxf6 gxf6 0-1`;

test('a pasted PGN supplies the names from its own [White]/[Black] tags', () => {
  /* This was the gap: the header showed the player names for games opened from
     History, but a PASTED game fell back to the literal words "White"/"Black" -
     because only the app's own stored PGNs (which carry no tags) were handled. */
  assert.equal(pgnPlayerName(PASTED, 'White'), 'Kiranrd1898');
  assert.equal(pgnPlayerName(PASTED, 'Black'), 'Nagavel1630');

  assert.match(review, /pgnPlayerName\(text, 'White'\) \|\| names\?\.white/,
    'the PGN tag must be tried first, then the history row');
  assert.match(review, /pgnPlayerName\(text, 'Black'\) \|\| names\?\.black/);

/* [WhiteElo]/[BlackElo] must never be mistaken for the name itself. */
  assert.equal(pgnPlayerName('[WhiteElo "979"]\n[BlackElo "986"]', 'White'), '',
    'an elo tag is not a player name');
});

test('an exporter that did not know a name is not printed as "?"', () => {
  /* Chess.com writes [White "?"] when it has no name. Showing a question mark
     over the column is worse than admitting we do not know, so the helper
     reports it as absent and the caller falls through to the next source. */
  assert.equal(pgnPlayerName('[White "?"]\n[Black "Real"]', 'White'), '');
  assert.equal(pgnPlayerName('[White "--"]', 'White'), '');
  assert.equal(pgnPlayerName('[White ""]', 'White'), '');
  assert.equal(pgnPlayerName('[White "   "]', 'White'), '');
  assert.equal(pgnPlayerName('[Black "Real"]', 'Black'), 'Real');
  assert.equal(pgnPlayerName('', 'White'), '');
  assert.equal(pgnPlayerName(null, 'White'), '');
});

test('app-stored PGNs still fall back to the history row names', () => {
  /* chess.js writes movetext only, so a game this app played has no tags at
     all and the names must come from the database row instead. */
  const stored = '1. e4 e5 2. Nf3 Nc6 1/2-1/2';
  assert.equal(pgnPlayerName(stored, 'White'), '');
  assert.equal(pgnPlayerName(stored, 'White') || 'Manivel M', 'Manivel M');
});

test('the load panel stays in the sidebar it was designed for', () => {
  /* A full-width strip above the board was tried and reverted: the load panel
     belongs beside the board, next to the controls that use it. It must live
     INSIDE .gr-side, after .gr-layout opens - and only once. */
  const layout = review.indexOf('className="gr-layout"');
  const side = review.indexOf('className="gr-side"');
  const load = review.indexOf('className="gr-load"');
  assert.notEqual(load, -1, '.gr-load must exist');
  assert.ok(layout < side && side < load,
    'the loader must sit inside .gr-side, after the layout and the sidebar open');

  assert.equal((review.match(/className="gr-load"/g) || []).length, 1,
    'the loader must not be duplicated - the strip must be gone for good');

  /* and the narrow sidebar box is back: no leftover wide-strip layout */
  assert.doesNotMatch(css, /\.gr-load \{[^}]*max-width:/,
    'the capped wide-strip rule must be gone with the strip');
  assert.doesNotMatch(css, /\.gr-load-body \{[^}]*grid-template-columns:/,
    'the horizontal wide-strip layout must be gone with the strip');
});
