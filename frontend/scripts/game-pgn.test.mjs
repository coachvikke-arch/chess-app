// Unit tests for src/utils/gamePgn.js - run with: node --test (from frontend/)
//
// The exported PGN has to survive a re-import: full tag pairs (players, result,
// date) and, for a custom-start game, the [SetUp]/[FEN] header. Dropping either
// produces a PGN that pastes into Chess.com as a different game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { buildGamePgn } from '../src/utils/gamePgn.js';

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