/**
 * Unit tests for src/utils/gameColour.js — colour-aware Game history helpers.
 *
 * Covers: white win, white loss, black win, black loss, draw,
 * username-not-found (unknown, never guessed), case-insensitive match,
 * plus PGN-style scores and per-colour stat buckets.
 *
 * Run: node --test scripts/game-colour.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'utils', 'gameColour.js'), 'utf8');

// The helper module uses ESM `export` — strip the keyword so the same source
// can be evaluated here without a build step. The test then cannot drift from
// the real implementation.
const compiled = source.replace(/^export\s+/gm, '');
const factory = new Function(`${compiled}\nreturn { getUserColour, getUserResult, getColourStats };`);
const { getUserColour, getUserResult, getColourStats } = factory();

const OWNER = 'Nagavel_Krishnamoorthi';
const whiteGame = (result, white = OWNER, black = 'Opponent_A') => ({
  white_name: white, black_name: black, account_username: OWNER, result,
});
const blackGame = (result, white = 'Opponent_A', black = OWNER) => ({
  white_name: white, black_name: black, account_username: OWNER, result,
});

test('white win: owner as White + 1-0 => win', () => {
  assert.equal(getUserColour(whiteGame('white'), OWNER), 'white');
  assert.equal(getUserResult(whiteGame('white'), OWNER), 'win');
  assert.equal(getUserResult(whiteGame('1-0'), OWNER), 'win');
});

test('white loss: owner as White + 0-1 => loss', () => {
  assert.equal(getUserColour(whiteGame('black'), OWNER), 'white');
  assert.equal(getUserResult(whiteGame('black'), OWNER), 'loss');
  assert.equal(getUserResult(whiteGame('0-1'), OWNER), 'loss');
});

test('black win: owner as Black + 0-1 => win', () => {
  assert.equal(getUserColour(blackGame('black'), OWNER), 'black');
  assert.equal(getUserResult(blackGame('black'), OWNER), 'win');
  assert.equal(getUserResult(blackGame('0-1'), OWNER), 'win');
});

test('black loss: owner as Black + 1-0 => loss', () => {
  assert.equal(getUserColour(blackGame('white'), OWNER), 'black');
  assert.equal(getUserResult(blackGame('white'), OWNER), 'loss');
  assert.equal(getUserResult(blackGame('1-0'), OWNER), 'loss');
});

test('draw: either colour + draw score => draw', () => {
  assert.equal(getUserResult(whiteGame('draw'), OWNER), 'draw');
  assert.equal(getUserResult(blackGame('draw'), OWNER), 'draw');
  assert.equal(getUserResult(whiteGame('1/2-1/2'), OWNER), 'draw');
  assert.equal(getUserResult(blackGame('½-½'), OWNER), 'draw');
});

test('username not found: colour is unknown, never guessed; result unknown', () => {
  const g = whiteGame('white', 'Someone_Else', 'Another_Player');
  assert.equal(getUserColour(g, OWNER), 'unknown');
  assert.equal(getUserResult(g, OWNER), 'unknown');
});

test('case-insensitive username match', () => {
  const g = whiteGame('white', 'nagavel_krishnamoorthi', 'Opponent_A');
  assert.equal(getUserColour(g, 'NAGAVEL_KRISHNAMOORTHI'), 'white');
  assert.equal(getUserResult(g, 'NaGaVeL_KrIsHnAmOoRtHi'), 'win');
  const b = blackGame('black', 'Opponent_A', 'NAGAVEL_Krishnamoorthi');
  assert.equal(getUserColour(b, OWNER), 'black');
  assert.equal(getUserResult(b, OWNER), 'win');
});

test('falls back to the row account_username when no username passed', () => {
  assert.equal(getUserColour(whiteGame('white'), undefined), 'white');
  assert.equal(getUserResult(blackGame('black')), 'win');
});

test('getColourStats buckets W/L/D per colour over filtered games', () => {
  const games = [
    whiteGame('white'), whiteGame('black'), whiteGame('draw'),
    blackGame('black'), blackGame('white'),
    whiteGame('white', 'Someone_Else', 'Another_Player'), // unknown -> skipped
  ];
  const s = getColourStats(games, OWNER);
  assert.deepEqual(s.white, { games: 3, wins: 1, losses: 1, draws: 1, winRate: 33 });
  assert.deepEqual(s.black, { games: 2, wins: 1, losses: 1, draws: 0, winRate: 50 });
});
