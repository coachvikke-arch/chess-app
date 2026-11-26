// Unit tests for src/utils/gamePgn.js - run with: node --test (from frontend/)
//
// The exported PGN has to survive a re-import: full tag pairs (players, result,
// date) and, for a custom-start game, the [SetUp]/[FEN] header. Dropping either
// produces a PGN that pastes into Chess.com as a different game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { buildFullPgn, buildGamePgn, buildRowPgn, sourceSiteLabel } from '../src/utils/gamePgn.js';

const GAME = {
  platform: 'chess.com',
  time_class: 'rapid',
  time_control: '900+10',
  game_date: '2026-10-04',
  white_name: 'vipulpatel9773',
  black_name: 'Nagavel_Krishnamoorthi',
  white_rating: 1200,
  black_rating: 1180,
  result: 'draw',
  opening: 'Caro-Kann Defense: Exchange Variation',
  eco: 'B13',
  game_url: 'https://www.chess.com/game/live/123',
};

const MOVES = ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Nf3', 'a6', 'c4', 'Bg4', 'h3', 'Bh5'];

test('buildGamePgn writes full tag pairs and the move list', () => {
  const pgn = buildGamePgn({ game: GAME, moves: MOVES, initialFen: 'start' });
  assert.match(pgn, /^\[Event "/);
  assert.match(pgn, /\[Site "https:\/\/www\.chess\.com\/game\/live\/123"\]/);
  assert.match(pgn, /\[Date "2026\.10\.04"\]/);
  assert.match(pgn, /\[White "vipulpatel9773"\]/);
  assert.match(pgn, /\[Black "Nagavel_Krishnamoorthi"\]/);
  assert.match(pgn, /\[WhiteElo "1200"\]/);
  assert.match(pgn, /\[BlackElo "1180"\]/);
  assert.match(pgn, /\[ECO "B13"\]/);
  assert.match(pgn, /\[Opening "Caro-Kann Defense: Exchange Variation"\]/);
  assert.match(pgn, /1\. e4 c6 2\. d4 d5/);
});

test('a draw exports as 1/2-1/2, never the UI word "draw"', () => {
  const pgn = buildGamePgn({ game: GAME, moves: MOVES, initialFen: 'start' });
  assert.match(pgn, /\[Result "1\/2-1\/2"\]/);
  assert.doesNotMatch(pgn, /"draw"/);
  assert.match(pgn, /1\/2-1\/2$/, 'the move text ends with the result token');
});

test('the stored result is the winning SIDE, and maps to the right token', () => {
  /* The platform importers store 'white'/'black'/'draw', so an untranslated
     export would ship the literal word and every game would look unfinished. */
  const cases = [['white', '1-0'], ['black', '0-1'], ['draw', '1/2-1/2']];
  for (const [stored, token] of cases) {
    const pgn = buildGamePgn({ game: { ...GAME, result: stored }, moves: MOVES, initialFen: 'start' });
    assert.ok(pgn.includes(`[Result "${token}"]`), `${stored} exports as ${token}`);
    assert.ok(pgn.endsWith(token), `${stored} closes with ${token}`);
    assert.doesNotMatch(pgn, new RegExp(`"${stored}"`), 'no raw stored word leaks into a tag');
  }
});

test('an unrecognised result exports as *, never as a guess', () => {
  for (const stored of [null, '', 'adjourned']) {
    const pgn = buildGamePgn({ game: { ...GAME, result: stored }, moves: MOVES, initialFen: 'start' });
    assert.ok(pgn.includes('[Result "*"]'), `${JSON.stringify(stored)} exports as *`);
  }
});

test('a custom-start game exports its SetUp/FEN header', () => {
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
  const pgn = buildGamePgn({ game: GAME, moves: ['d4', 'exd4', 'Nxd4'], initialFen: fen });
  assert.ok(pgn.includes('[SetUp "1"]'), 'SetUp header present');
  assert.ok(pgn.includes(`[FEN "${fen}"]`), 'FEN header carries the real start position');
  /* No FEN header for a standard game, or every export would claim a setup. */
  const standard = buildGamePgn({ game: GAME, moves: MOVES, initialFen: 'start' });
  assert.doesNotMatch(standard, /\[FEN/);
});

test('a quote or backslash in a name cannot break the tag pair', () => {
  const pgn = buildGamePgn({
    game: { ...GAME, white_name: 'The "Boss" \\ Guy' },
    moves: MOVES,
    initialFen: 'start',
  });
  assert.match(pgn, /\[White "The \\"Boss\\" \\\\ Guy"\]/);
});

test('the exported PGN re-imports as the same game', () => {
  /* Two very different origins. The move list is only legal from each one when
     the FEN header is present — the exact failure this export must prevent. */
  const CASES = [
  { start: 'start', source: ['e4', 'c6', 'd4', 'd5'] },
  { start: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', source: ['d4', 'exd4', 'Nxd4'] },
  ];
  for (const { start, source } of CASES) {
    const pgn = buildGamePgn({ game: GAME, moves: source, initialFen: start });
    const expected = new Chess(start === 'start' ? undefined : start);
    for (const san of source) expected.move(san);
    /* loadPgn (not load) is what a pasting site does: it reads the FEN tag and
       starts the whole game from it. */
    const loaded = new Chess();
    loaded.loadPgn(pgn, { strict: false });
    assert.deepEqual(loaded.history(), source, 'moves survive the round trip');
    assert.equal(loaded.fen(), expected.fen(), 'and land on the identical position');
  }
});

test('an empty or missing move list still produces a valid skeleton', () => {
  const pgn = buildGamePgn({ game: GAME, moves: [], initialFen: 'start' });
  assert.match(pgn, /\[White "vipulpatel9773"\]/);
  assert.doesNotMatch(pgn, /undefined/);
});

test('missing ratings are omitted rather than exported as "undefined"', () => {
  const pgn = buildGamePgn({ game: { ...GAME, white_rating: null, black_rating: undefined }, moves: MOVES, initialFen: 'start' });
  assert.doesNotMatch(pgn, /Elo/);
  assert.doesNotMatch(pgn, /undefined/);
});

/* ── buildFullPgn: the shared export every Copy PGN button uses ───────────── */

const IMPORTED = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.10.04"]
[Round "-"]
[White "alice"]
[Black "bob"]
[Result "1-0"]
[WhiteElo "1500"]
[BlackElo "1490"]
[TimeControl "600"]
[ECO "C50"]
[Opening "Italian Game"]
[Termination "Normal"]
[UTCDate "2026.10.04"]
[GameId "999"]

1. e4 e5 2. Nf3 Nc6 1-0`;

test('an imported game keeps its own headers and only gains Source/Link', () => {
  const pgn = buildFullPgn({ pgn: IMPORTED, link: 'https://www.chess.com/game/live/999' });
  assert.match(pgn, /\[Event "Live Chess"\]/);
  assert.match(pgn, /\[Site "Chess\.com"\]/, 'the original Site tag survives');
  assert.match(pgn, /\[White "alice"\]/);
  assert.match(pgn, /\[Black "bob"\]/);
  assert.match(pgn, /\[TimeControl "600"\]/);
  assert.match(pgn, /\[Opening "Italian Game"\]/);
  /* Tags outside the spec list survive. */
  assert.match(pgn, /\[UTCDate "2026\.10\.04"\]/);
  assert.match(pgn, /\[GameId "999"\]/);
  /* The two the importer omits are filled in. */
  assert.match(pgn, /\[Source "Chess\.com"\]/);
  assert.match(pgn, /\[Link "https:\/\/www\.chess\.com\/game\/live\/999"\]/);
  /* One tag pair each — nothing is written twice. */
  for (const name of ['Event', 'Site', 'White', 'Result', 'Source', 'Link']) {
    assert.equal(pgn.match(new RegExp(`^\\[${name} `, 'gm')).length, 1, `${name} written once`);
  }
});

test('placeholder values are replaced instead of exported', () => {
  const source = `[Event "?"]
[Site "?"]
[Date "????.??.??"]
[White "?"]
[Black "?"]
[Result "*"]

1. d4 d5 *`;
  const pgn = buildFullPgn({
    pgn: source,
    white: 'carol',
    black: 'dave',
    event: 'Club Rapid',
    date: '2026-11-02',
    result: 'black',
  });
  assert.doesNotMatch(pgn, /"\?"/);
  assert.doesNotMatch(pgn, /"\?\?\?\?\.\?\?\.\?\?"/);
  assert.match(pgn, /\[Event "Club Rapid"\]/);
  assert.match(pgn, /\[Date "2026\.11\.02"\]/);
  assert.match(pgn, /\[White "carol"\]/);
  assert.match(pgn, /\[Result "0-1"\]/);
  assert.ok(pgn.endsWith('0-1'));
});

test('an app game is built from saved data with every required tag', () => {
  const pgn = buildFullPgn({
    pgn: '1. e4 e5 2. Nf3 Nc6',
    white: 'Eve',
    black: 'Frank',
    whiteElo: 1200,
    blackElo: 1180,
    event: 'Blitz Cup',
    date: '2026-11-19',
    result: 'draw',
    timeControl: '300+2',
    termination: 'Draw agreed',
    source: 'Mate Zone',
  });
  assert.match(pgn, /\[Event "Blitz Cup"\]/);
  assert.match(pgn, /\[Site "Mate Zone"\]/);
  assert.match(pgn, /\[Date "2026\.11\.19"\]/);
  assert.match(pgn, /\[Round "-"\]/);
  assert.match(pgn, /\[White "Eve"\]/);
  assert.match(pgn, /\[Black "Frank"\]/);
  assert.match(pgn, /\[Result "1\/2-1\/2"\]/);
  assert.match(pgn, /\[WhiteElo "1200"\]/);
  assert.match(pgn, /\[BlackElo "1180"\]/);
  assert.match(pgn, /\[TimeControl "300\+2"\]/);
  assert.match(pgn, /\[Termination "Draw agreed"\]/);
  assert.match(pgn, /\[Source "Mate Zone"\]/);
  /* Headers, ONE blank line, movetext, result at the very end. */
  assert.match(pgn, /\]\n\n1\. e4 e5 2\. Nf3 Nc6/);
  assert.ok(pgn.endsWith('1/2-1/2'));
});

test('the header block never contains an empty tag value', () => {
  const pgn = buildFullPgn({ pgn: '1. e4 e5', result: '*' });
  assert.doesNotMatch(pgn, /\[[A-Za-z][A-Za-z0-9_]* ""\]/);
  assert.ok(pgn.endsWith('\n\n1. e4 e5 *'));
});

test('quotes and backslashes in headers are escaped, not dropped', () => {
  const pgn = buildFullPgn({ pgn: '1. e4 e5', white: 'The "Boss" \\ Guy', black: 'Plain' });
  assert.match(pgn, /\[White "The \\"Boss\\" \\\\ Guy"\]/);
});

test('the shared builder survives a re-import from both origins', () => {
  const cases = [
    { pgn: '1. e4 e5 2. Nf3 Nc6 1-0', initialFen: 'start', moves: ['e4', 'e5', 'Nf3', 'Nc6'] },
    {
      initialFen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
      pgn: '',
      moves: ['d4', 'exd4', 'Nxd4'],
    },
  ];
  for (const c of cases) {
    const pgn = buildFullPgn({ ...c, white: 'A', black: 'B', result: 'white', date: '2026-10-04' });
    const loaded = new Chess();
    loaded.loadPgn(pgn, { strict: false });
    assert.deepEqual(loaded.history(), c.moves, 'moves survive the round trip');
    assert.equal(loaded.header().Result, '1-0');
  }
});

test('a Game History row exports its tournament, round and date', () => {
  const row = {
    id: 'tournament_7',
    type: 'tournament',
    whiteName: 'Me',
    blackName: 'Rival',
    myColor: 'white',
    resultLabel: 'Win by checkmate',
    resultReason: 'checkmate',
    tournamentName: 'Academy Open',
    roundNo: 3,
    date: '2026-11-19T10:00:00.000Z',
    pgn: '1. f3 e5 2. g4 Qh4#',
  };
  const pgn = buildRowPgn(row, 'Me');
  assert.match(pgn, /\[Event "Academy Open"\]/);
  assert.match(pgn, /\[Round "3"\]/);
  assert.match(pgn, /\[White "Me"\]/);
  assert.match(pgn, /\[Black "Rival"\]/);
  assert.match(pgn, /\[Result "1-0"\]/);
  assert.match(pgn, /\[Termination "Checkmate"\]/);
  assert.match(pgn, /\[Date "2026\.11\.19"\]/);
  assert.ok(pgn.endsWith('1-0'));
});

/* ── original source site: an imported game is never relabelled "Mate Zone" ── */

test('sourceSiteLabel names the site a PGN actually came from', () => {
  assert.equal(sourceSiteLabel('https://www.pgnmentor.com/players/gukesh.zip'), 'PGNMentor.com');
  assert.equal(sourceSiteLabel('https://www.chess.com/game/live/123'), 'Chess.com');
  assert.equal(sourceSiteLabel('https://lichess.org/abcd1234'), 'Lichess');
  assert.equal(sourceSiteLabel('pgnmentor'), 'PGNMentor.com');
  assert.equal(sourceSiteLabel('Singapore'), 'Singapore', 'a plain [Site] value is kept as typed');
  for (const blank of ['', null, undefined, '?', '????.??.??']) {
    assert.equal(sourceSiteLabel(blank), '', `${JSON.stringify(blank)} means no original source`);
  }
});

test('a grandmaster game names its real source instead of this app', () => {
  const pgn = buildFullPgn({
    pgn: '1. e4 e6 2. d4 d5',
    white: 'D Gukesh',
    black: 'Ding Liren',
    event: 'WCh 2024',
    date: '2024',
    result: '0-1',
    site: 'PGNMentor.com',
    source: 'PGNMentor.com',
    link: 'https://www.pgnmentor.com/players/gukesh.zip',
  });
  assert.match(pgn, /\[Site "PGNMentor\.com"\]/);
  assert.match(pgn, /\[Source "PGNMentor\.com"\]/);
  assert.match(pgn, /\[Date "2024\.\?\?\.\?\?"\]/);
  assert.doesNotMatch(pgn, /"Mate Zone"/);
});

test('only a game with no original source falls back to Mate Zone', () => {
  const pgn = buildFullPgn({ pgn: '1. e4 e5', white: 'A', black: 'B', result: '1-0' });
  assert.match(pgn, /\[Site "Mate Zone"\]/);
});