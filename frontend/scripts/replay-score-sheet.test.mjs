/**
 * Score-sheet end status.
 *
 * The PGN `Result` token says WHO won but never WHY - "1-0" covers checkmate,
 * resignation, time forfeit and everything else. Chess.com's own `Termination`
 * tag is no better ("Normal" for an ordinary win). `describeGameEnd` therefore
 * derives the reason from the RULES of the final position.
 *
 * These assertions matter because a WRONG "won by checkmate" is worse than no
 * status at all: it looks authoritative. Every fixture below is built by
 * actually playing the moves to the claimed ending, then parsed back through the
 * real `parsePgnReplay`, so the FEN the rules are checked against is the one the
 * app would see in production.
 *
 * Run with: npm run test:replay-score-sheet
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* The module under test is TypeScript and the suite runs plain `node --test`
   with no flags, so Node cannot load it. Strip the types here rather than
   duplicating the logic into a .js copy that could drift from the real one. */
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.ts')) {
      const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'strip' });
      return { format: 'module', source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const { Chess } = await import('chess.js');
const { describeGameEnd, parsePgnReplay } = await import(
  pathToFileURL(join(root, 'src', 'lib', 'chessReplay.ts')).href
);

/** Play real moves to the ending under test, then parse the PGN back. */
function played(build) {
  const c = new Chess();
  build(c);
  const pgn = c.pgn();
  return { pgn, moves: parsePgnReplay(pgn) };
}

/**
 * A game that ends `byEnd`, plus the SAN list that reaches it.
 *
 * `describeGameEnd` deliberately REPLAYS the moves rather than trusting a
 * caller-supplied final FEN, so every fixture has to be a real, legal game that
 * genuinely arrives at the claimed ending - asserted here, so a broken fixture
 * fails as a fixture problem rather than as a mystery in the helper.
 */
function gameEndingAt(startFen, sans, assert) {
  const c = new Chess(startFen);
  for (const san of sans) c.move(san);
  assert(c, `fixture must really end as claimed; reached ${c.fen()}`);
  return { fen: c.fen(), sans: c.history() };
}

test('stalemate is a draw, not a win', () => {
  /* Qd5-f7 leaves Kh8 with no move and no check. */
  const { sans } = gameEndingAt(
    '7k/8/6K1/3Q4/8/8/8/8 w - - 0 1',
    ['Qf7'],
    (c) => assert.ok(c.isStalemate(), 'fixture must be stalemate, not mate'),
  );
  const end = describeGameEnd('1/2-1/2', '', sans, '7k/8/6K1/3Q4/8/8/8/8 w - - 0 1');
  assert.equal(end.winner, 'Draw');
  assert.equal(end.reason, 'by stalemate');
  assert.equal(end.headline, 'Draw by stalemate');
});

test('insufficient material is a draw', () => {
  const start = '8/8/8/8/8/5k2/8/5NK1 w - - 0 1';
  const { sans } = gameEndingAt(start, ['Nh2'], (c) =>
    assert.ok(c.isInsufficientMaterial(), 'fixture must be K+N vs K'),
  );
  const end = describeGameEnd('1/2-1/2', '', sans, start);
  assert.equal(end.winner, 'Draw');
  assert.equal(end.reason, 'by insufficient material');
});

test('the fifty-move rule is read off the halfmove clock', () => {
  /* A start FEN already 100 plies in, plus one quiet rook move = 101. Reachable
     by replay, unlike shuffling pieces round for 50 moves, which would hit
     threefold repetition first and for good reason. */
  const start = '4k3/8/8/8/8/8/8/R3K2R w - - 100 60';
  const { sans } = gameEndingAt(start, ['Rh2'], (c) => {
    assert.equal(Number(c.fen().split(' ')[4]), 101, 'halfmove clock must be past 100');
    assert.ok(!c.isThreefoldRepetition(), 'must not trip the repetition rule first');
  });
  const end = describeGameEnd('1/2-1/2', '', sans, start);
  assert.equal(end.reason, 'by the fifty-move rule');
  assert.equal(end.winner, 'Draw');
});

/** Produce a PGN carrying a `[Termination "..."]` tag.
 *
 *  chess.js writes `[Event "?"]`, so splicing onto an existing Event line works
 *  for a generated PGN but fails for an empty one. Prepend when there is no
 *  Event line, and verify the tag really landed rather than silently no-opping. */
function withTag(pgn, value) {
  const tag = `[Termination "${value}"]`;
  const base = pgn || '';
  const tagged = /^\[Event/m.test(base)
    ? base.replace(/^\[Event/m, `${tag}\n[Event`)
    : `${tag}\n${base}`;
  if (!tagged.includes(tag)) throw new Error('withTag failed to inject the Termination tag');
  return tagged;
}

test('checkmate is reported as a win for the mating side', () => {
  /* Scholar's mate. Black is to move and is mated, so White won. */
  const { pgn, moves } = played((c) => {
    c.move('e4'); c.move('e5'); c.move('Bc4'); c.move('Nc6'); c.move('Qh5'); c.move('Nf6'); c.move('Qxf7#');
  });
  const end = describeGameEnd('1-0', pgn, moves);
  assert.equal(end.winner, 'White');
  assert.equal(end.reason, 'by checkmate');
  assert.equal(end.headline, 'White won by checkmate');
  assert.equal(end.confidence, 'rules');
});

test('the mated side is never named the winner', () => {
  /* Fool's mate: Black mates White. */
  const { pgn, moves } = played((c) => {
    c.move('f3'); c.move('e5'); c.move('g4'); c.move('Qh4#');
  });
  const end = describeGameEnd('0-1', pgn, moves);
  assert.equal(end.winner, 'Black');
  assert.equal(end.reason, 'by checkmate');
  assert.notEqual(end.winner, 'White');
});

test('threefold repetition is detected from the move history', () => {
  /* Shuffle both knights back and forth; the start position occurs three times. */
  const { pgn, moves } = played((c) => {
    for (const s of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) c.move(s);
  });
  const end = describeGameEnd('1/2-1/2', pgn, moves);
  assert.equal(end.reason, 'by threefold repetition');
  assert.equal(end.winner, 'Draw');
});

test('a decisive result with no derivable reason never invents one', () => {
  const { pgn, moves } = played((c) => { c.move('d4'); c.move('d5'); });
  const end = describeGameEnd('1-0', pgn, moves);
  assert.equal(end.winner, 'White');
  assert.equal(end.reason, '', 'no reason may be asserted');
  assert.equal(end.confidence, 'result-only');
  /* The helper stays silent about the reason; the "reason not stated" caveat is
     the UI's job and is asserted against the source below. */
  assert.equal(end.headline, 'White won');
});

test('the UI admits when the reason is unknown instead of leaving a bare win', () => {
  /* The profile viewer is the only surface that renders a score sheet now. */
  const src = readFileSync(join(root, 'src', 'pages', 'ChessProfile.jsx'), 'utf8');
  assert.match(src, /reason not stated/, 'an unstated reason is labelled, not hidden');
  assert.match(src, /endInfo\.confidence === 'result-only'/, 'only unknown reasons are flagged');
});

test("chess.com's 'Normal' termination tag is treated as no information", () => {
  const { pgn, moves } = played((c) => { c.move('d4'); c.move('d5'); });
  const tagged = withTag(pgn, 'Normal');
  assert.match(tagged, /Termination "Normal"/, 'fixture must carry the tag');
  const end = describeGameEnd('1-0', tagged, moves);
  assert.equal(end.confidence, 'result-only', 'Normal must not be shown as a reason');
});

test('a specific Termination tag is surfaced, marked as pgn-sourced', () => {
  const { pgn, moves } = played((c) => { c.move('d4'); c.move('d5'); });
  const end = describeGameEnd('1-0', withTag(pgn, 'Time forfeit'), moves);
  /* Normalised into a readable phrase, not pasted in raw. */
  assert.equal(end.reason, 'by a time forfeit');
  assert.equal(end.confidence, 'pgn');
});

test('rules beat metadata: a mate is a mate even if Termination says Normal', () => {
  const { pgn, moves } = played((c) => {
    c.move('e4'); c.move('e5'); c.move('Bc4'); c.move('Nc6'); c.move('Qh5'); c.move('Nf6'); c.move('Qxf7#');
  });
  const end = describeGameEnd('1-0', withTag(pgn, 'Normal'), moves);
  assert.equal(end.reason, 'by checkmate');
  assert.equal(end.confidence, 'rules');
});

test('an empty or unknown result degrades to Unknown rather than guessing', () => {
  const { pgn, moves } = played((c) => { c.move('d4'); c.move('d5'); });
  for (const bad of ['', undefined, '*', 'garbage']) {
    assert.equal(describeGameEnd(bad, pgn, moves).winner, 'Unknown', `result "${bad}"`);
  }
});

test('a game with no moves does not throw', () => {
  const end = describeGameEnd('1-0', '', []);
  assert.equal(end.winner, 'White');
  assert.equal(end.confidence, 'result-only');
});

test('a player-prefixed Termination clause does not stutter into the headline', () => {
  /* THE REAL REPORTED CASE. Chess.com exported
     `[Termination "m0nk3ym4t3 won - game abandoned"]`, and pasting that straight in
     produced the headline:

       "Black won by m0nk3ym4t3 won - game abandoned"

     which states the winner three times and is not a sentence. The player's name
     is already carried by the result token and the score-sheet rows. */
  const tag = 'm0nk3ym4t3 won - game abandoned';
  const end = describeGameEnd('0-1', withTag('', tag), []);
  assert.equal(end.reason, 'by abandonment');
  assert.equal(end.headline, 'Black won by abandonment');
  assert.doesNotMatch(end.headline, /m0nk3ym4t3/, 'the player name must not be repeated');
  assert.doesNotMatch(end.headline, /\bwon\b.*\bwon\b/, 'the winner must not be stated twice');
});

test('provider Termination values are normalised into plain English', () => {
  const cases = [
    /* Both shapes Chess.com actually emits for a decisive game. */
    ['m0nk3ym4t3 won - game abandoned', 'by abandonment'],
    ['andresmanquepierda won by resignation', 'by resignation'],
    ['andresmanquepierda won by checkmate', 'by checkmate'],
    ['bhuvan lost by resignation', 'by resignation'],
    /* And ones with no player clause at all. */
    ['Time forfeit', 'by a time forfeit'],
    ['Rules infraction', 'by a rules infraction'],
    ['50 move rule', 'by the fifty-move rule'],
    ['Time win', 'by on time'],
    ['Resignation', 'by resignation'],
    ['Abandoned', 'by abandonment'],
  ];
  for (const [tag, expected] of cases) {
    const end = describeGameEnd('0-1', withTag('', tag), []);
    assert.equal(end.reason, expected, `Termination "${tag}"`);
  }
});

test('a bare "<player> won" tag yields no reason rather than a stutter', () => {
  /* The player clause is the whole tag, so nothing is left to say. Returning the
     raw text would produce "Black won by white won". */
  for (const tag of ['White won', 'Black won', 'm0nk3ym4t3 won']) {
    const end = describeGameEnd('1-0', withTag('', tag), []);
    assert.equal(end.reason, '', `"${tag}" carries no reason`);
    assert.equal(end.confidence, 'result-only');
  }
});

test('the required separator stops "Time forfeit" being eaten', () => {
  /* The regression risk in that regex: if the dash/phrase separator were
     optional, the verb would match the "forfeit" in "Time forfeit" and strip the
     entire string - turning a specific reason into no reason. */
  assert.equal(describeGameEnd('0-1', withTag('', 'Time forfeit'), []).reason, 'by a time forfeit');
  assert.equal(describeGameEnd('0-1', withTag('', 'Rules infraction'), []).reason, 'by a rules infraction');
  /* No leading verb, so nothing may be stripped from these at all. */
  assert.equal(describeGameEnd('0-1', withTag('', 'Timeout'), []).reason, 'by a time forfeit');
});

test('an unknown Termination value is kept, not discarded', () => {
  /* A genuine unfamiliar reason must still reach the player rather than being
     silently dropped - just cleaned of punctuation and casing. */
  const end = describeGameEnd('0-1', withTag('', 'Disconnected.'), []);
  assert.equal(end.reason, 'by disconnected');
  assert.equal(end.confidence, 'pgn');
});

test("'Normal' still yields no reason at all", () => {
  const end = describeGameEnd('0-1', withTag('', 'Normal'), []);
  assert.equal(end.reason, '');
  assert.equal(end.confidence, 'result-only');
});

test('the GM replay does NOT render a score sheet', () => {
  /* The score sheet lives in the PROFILE viewer only. It was briefly added to
     the GM replay as well, where it was not wanted: the GM board already names
     both players on the strips either side of the square and prints the result
     token on White's strip, so the card was a second, larger restatement of the
     same facts directly above them. */
  const src = readFileSync(join(root, 'src', 'components', 'GameReplay.tsx'), 'utf8');
  assert.doesNotMatch(src, /scoresheet/, 'the GM replay must not render a score sheet');
  /* And the now-unused import must go with it, rather than lingering as dead
     code that a linter would eventually flag. */
  assert.doesNotMatch(src, /describeGameEnd/, 'the unused import must be removed');
});

test('the GM replay still shows both players and the result on the board strips', () => {
  /* Removing the card must not remove the information it duplicated. */
  const src = readFileSync(join(root, 'src', 'components', 'GameReplay.tsx'), 'utf8');
  assert.match(src, /gm-player-strip/, 'the player strips are still rendered');
  assert.match(src, /topPlayer/, 'top player is still named');
  assert.match(src, /bottomPlayer/, 'bottom player is still named');
  /* The result token rides with White's strip. */
  assert.match(src, /topMeta = topIsWhite \? game\.result/);
});

test('a bare SAN string list works as well as a ReplayMove list', () => {
  /* The profile viewer parses PGNs with `pgnTools.parsePgn`, which yields SAN
     strings, while the GM replay yields ReplayMove objects. Both must get the
     same answer - accepting only one shape is how the score sheet ends up
     silently missing from half the app. */
  const c = new Chess();
  c.move('e4'); c.move('e5'); c.move('Bc4'); c.move('Nc6'); c.move('Qh5'); c.move('Nf6'); c.move('Qxf7#');
  const sans = c.history();

  const fromStrings = describeGameEnd('1-0', c.pgn(), sans);
  const fromObjects = describeGameEnd('1-0', c.pgn(), parsePgnReplay(c.pgn()));

  assert.equal(fromStrings.reason, 'by checkmate');
  assert.equal(fromStrings.headline, fromObjects.headline);
  assert.deepEqual(fromStrings, fromObjects, 'both input shapes must agree exactly');
});

test('a partial or corrupt move list never reports a rules-based reason', () => {
  /* Replaying half a game lands on a MID-GAME position. Reporting that position's
     status as the ending would be a confident, wrong answer - e.g. a truncated
     run that happens to stop before a mating move would silently drop the mate
     and call it a plain win. Anything not replayed in full degrades to the
     result alone. */
  const c = new Chess();
  for (const s of ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']) c.move(s);
  const sans = c.history();

  /* Truncated: the mate never happened in what we can replay. */
  const truncated = describeGameEnd('1-0', c.pgn(), sans.slice(0, 5));
  assert.equal(truncated.confidence, 'result-only');
  assert.equal(truncated.reason, '', 'a partial replay must not assert a reason');

  /* Corrupt: a bogus token partway through. */
  const corrupt = describeGameEnd('1-0', c.pgn(), [...sans.slice(0, 3), 'Zz9', ...sans.slice(3)]);
  assert.equal(corrupt.confidence, 'result-only');
  assert.equal(corrupt.reason, '');
});

test('a non-standard start FEN is replayed from its real origin', () => {
  /* Chess960-style/custom origins: replaying from the standard start would throw
     or, worse, produce a legal-but-meaningless game whose end position would be
     reported as this game's ending. */
  const custom = new Chess('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
  custom.move('e4'); custom.move('Kd7');
  const sans = custom.history();
  const end = describeGameEnd('1-0', custom.pgn(), sans, custom.fen());
  /* Whatever the ending, it must be derived from the right game, not a crash. */
  assert.ok(['rules', 'pgn', 'result-only'].includes(end.confidence));
  assert.notEqual(end.headline, '');
});

test('the profile viewer shows the score sheet, and outside the board column', () => {
  const src = readFileSync(join(root, 'src', 'pages', 'ChessProfile.jsx'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');

  assert.match(code, /describeGameEnd\(/, 'the profile viewer derives the end status');
  /* This viewer's data uses different field names from the GM replay, so the
     wiring must be proven against THIS component's shape. */
  assert.match(code, /game\.white_name/, 'uses this viewer\'s player field');
  assert.match(code, /game\.black_name/, 'uses this viewer\'s player field');
  assert.match(code, /parsed\.result/, 'takes the result from the parsed PGN');
  assert.match(code, /parsed\.initFen/, 'forwards the start FEN');
});

test('the profile viewer renders no card above the board', () => {
  /* It used to: a `.scoresheet` card above the board showed both names, and the
     viewer header prints them too while the side panel prints them with their
     colours. Three renderings of the same two names on one screen.

     The score sheet now lives ONLY in the side panel (`cp-score*`), so nothing
     may render between `.cp-viewer-head` and `.cp-viewer-body`.

     This also keeps the LAYOUT GUARD honest: the board column is styled
     `.cp-viewer-body > div:first-child`, so any element inserted as the first
     child of the body inherits the board's flex basis and squeezes the board out
     of its column. Asserting there is nothing there covers that too. */
  const src = readFileSync(join(root, 'src', 'pages', 'ChessProfile.jsx'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');

  assert.doesNotMatch(code, /className="scoresheet"/, 'no above-board card');
  assert.doesNotMatch(code, /scoresheet/, 'no .scoresheet* usage at all');

  const head = code.indexOf('cp-viewer-head');
  const body = code.indexOf('<div className="cp-viewer-body">');
  assert.ok(head > -1 && body > -1, 'header and body both render');
  const between = code.slice(head, body);
  assert.doesNotMatch(
    between,
    /className="scoresheet/,
    'nothing may sit between the viewer header and the board/move-list body',
  );
  assert.doesNotMatch(
    code,
    /cp-viewer-body">\s*<(?!div ref=\{boardColRef\})/,
    'the board column must remain the first child of .cp-viewer-body',
  );
});

test('the profile score sheet lives in the side panel', () => {
  const src = readFileSync(join(root, 'src', 'pages', 'ChessProfile.jsx'), 'utf8');
  const side = src.indexOf('<div className="cp-viewer-side">');
  assert.ok(side > -1, 'the side panel exists');
  const panel = src.slice(side);
  assert.match(panel, /cp-score-head/, 'the panel carries the score-sheet heading');
  assert.match(panel, /cp-score-result/, 'and the result / end status');
  assert.match(panel, /cp-score-row--head/, 'and the sticky column head');
  /* The result line must read the same single source of truth the card used. */
  assert.match(panel, /endInfo\.headline/, 'result reason comes from endInfo');
  assert.match(panel, /endInfo\.result/, 'result token comes from endInfo');
});

test('the player names appear once inside the score sheet panel', () => {
  /* THE DUPLICATION THIS FIXES.
     The panel printed the players TWICE: a prominent heading line
     ("Bhuvan2905 vs Andresmanquepierda") and again as the sticky column head
     ("# | Bhuvan2905 | Andresmanquepierda"). Scrolling a long game then kept a
     THIRD visible copy pinned to the top of the table.

     Which one survives is a design choice the player has to make, so it is asked
     rather than guessed - see the sibling test for the chosen shape. This test
     only pins the invariant: exactly ONE place inside the panel may name them. */
  const src = readFileSync(join(root, 'src', 'pages', 'ChessProfile.jsx'), 'utf8');
  const side = src.indexOf('<div className="cp-viewer-side">');
  assert.ok(side > -1, 'the side panel exists');
  const panel = src.slice(side, src.indexOf('\n      </div>\n    </div>\n  );', side));

  const inHeading = /cp-score-vs[\s\S]{0,300}?\{whiteLabel\}[\s\S]{0,300}?\{blackLabel\}/.test(panel);
  const inColumnHead = /cp-score-row--head[\s\S]{0,400}?\{whiteLabel\}[\s\S]{0,300}?\{blackLabel\}/.test(panel);

  assert.ok(
    inHeading || inColumnHead,
    'the score sheet must still name both players somewhere',
  );
  assert.ok(
    !(inHeading && inColumnHead),
    'the panel names the players in BOTH the heading and the column head - that is the duplication',
  );
});

test('the modal title is kept: a heading is not a score sheet', () => {
  /* An earlier pass removed this title on the theory that it duplicated the score
     sheet. That was wrong: the title says WHICH game is open, the score sheet
     describes the game RECORD (players, result, moves). Removing it also left the
     `.cp-viewer-title` rule orphaned. Asserted so it is not "tidied away" again. */
  const src = readFileSync(join(root, 'src', 'pages', 'ChessProfile.jsx'), 'utf8');
  const css = readFileSync(join(root, 'src', 'index.css'), 'utf8');
  assert.match(src, /cp-viewer-title[^>]*>\{game\.white_name\} vs \{game\.black_name\}/,
    'the modal title names the fixture again');
  assert.ok(css.includes('.cp-viewer-title'), 'and its rule must not be orphaned');
});

test('the retired .scoresheet stylesheet is gone', () => {
  const css = readFileSync(join(root, 'src', 'index.css'), 'utf8');
  /* Dead rules for a component that no longer exists are just noise the next
     reader has to rule out. */
  assert.doesNotMatch(css, /\.scoresheet/, 'the .scoresheet rules must be removed');
  assert.doesNotMatch(css, /\.cp-viewer > \.scoresheet/, 'and its spacing rule');
  /* The board-strip colour word is a separate, still-used rule - guard it. */
  assert.ok(css.includes('.gm-strip-color'), 'gm-strip-color is still used and must survive');
});
