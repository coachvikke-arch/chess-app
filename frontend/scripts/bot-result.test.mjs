/**
 * Result-direction regression guard.
 *
 * `classify()` in useBotGame reports the result from the HUMAN's point of view,
 * but it derives that by comparing `game.turn()` — which chess.js returns as
 * 'w'/'b' — against `humanColor`, which the hook holds as 'white'/'black'.
 * Those never compare equal, so the "who lost" test silently always failed and
 * every checkmate and flagfall was reported as a win for the player.
 *
 * The function is lifted out of the hook source rather than reimplemented here,
 * so this test cannot drift away from the real logic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Chess } from 'chess.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'hooks', 'useBotGame.js'), 'utf8');

const match = source.match(/function classify\(game, humanColor, cause = null\) \{[\s\S]*?\n\}/);
assert.ok(match, 'could not locate classify() in useBotGame.js — has it been renamed or moved?');

const classify = new Function(
  'game',
  'humanColor',
  'cause',
  match[0]
    .replace(/^function classify\(game, humanColor, cause = null\) \{/, '')
    .replace(/\}\s*$/, ''),
);

/* Fool's mate. White is mated, so it is 'w' to move and white has lost. */
const whiteMated = new Chess();
whiteMated.move('f3');
whiteMated.move('e5');
whiteMated.move('g4');
whiteMated.move('Qh4#');

/* For a flag the loser is whoever is to move, so drive `turn` directly rather
   than needing a position for each case. */
const position = (turn, over = {}) => ({
  turn: () => turn,
  isCheckmate: () => false,
  isStalemate: () => false,
  isInsufficientMaterial: () => false,
  isThreefoldRepetition: () => false,
  isDraw: () => false,
  ...over,
});

test('classify fixture is a real checkmate', () => {
  assert.equal(whiteMated.turn(), 'w', 'white must be the side to move in the fixture');
  assert.ok(whiteMated.isCheckmate(), 'fixture must be a checkmate');
});

test('checkmate reports the mated side as the loser', () => {
  assert.equal(classify(whiteMated, 'white', null).result, 'loss', 'player white was mated');
  assert.equal(classify(whiteMated, 'black', null).result, 'win', 'the bot was mated');
});

test('flagfall reports the side that ran out as the loser', () => {
  assert.equal(classify(position('w'), 'white', 'timeout').result, 'loss', 'player white flagged');
  assert.equal(classify(position('b'), 'black', 'timeout').result, 'loss', 'player black flagged');
  assert.equal(classify(position('w'), 'black', 'timeout').result, 'win', 'bot white flagged');
  assert.equal(classify(position('b'), 'white', 'timeout').result, 'win', 'bot black flagged');
});

test('resigning is always a loss, whichever colour the player had', () => {
  assert.equal(classify(position('w'), 'white', 'resignation').result, 'loss');
  assert.equal(classify(position('b'), 'black', 'resignation').result, 'loss');
});

test('drawn endings are draws for both colours', () => {
  for (const color of ['white', 'black']) {
    assert.equal(classify(position('w', { isStalemate: () => true }), color, null).result, 'draw');
    assert.equal(classify(position('w', { isInsufficientMaterial: () => true }), color, null).result, 'draw');
    assert.equal(classify(position('w', { isThreefoldRepetition: () => true }), color, null).result, 'draw');
    assert.equal(classify(position('w', { isDraw: () => true }), color, null).result, 'draw');
  }
});

test('a live position stays playing', () => {
  const got = classify(position('w'), 'white', null);
  assert.equal(got.status, 'playing');
  assert.equal(got.result, null);
});

/* The comparison that caused the bug: 'w' must not be equated with 'white'. */
test('classify does not compare turn() against the full colour name', () => {
  assert.doesNotMatch(
    match[0],
    /game\.turn\(\)\s*(?:===|!==)\s*humanColor(?!\[0\])/,
    'game.turn() returns "w"/"b"; comparing it to humanColor ("white"/"black") is always false',
  );
});