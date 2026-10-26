/* The profile viewer must show the same board overlay the review page does.
 *
 * Regression guard for a silent-data-loss bug: `reviewGame` returns `uci`,
 * `bestUci` and `lines` for every ply, but the profile's runAnalysis built its
 * `verdicts` array with only { san, verdict, player, cpl, loss, acc }. Nothing
 * threw - the review ran, the score sheet filled in, accuracy appeared - but the
 * board was left with a faint colour tint and no badge and no arrows, because
 * the coordinates needed to place them had been thrown away two states earlier.
 *
 * Run: node --test scripts/profile-review-overlay.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const profile = read('src/pages/ChessProfile.jsx');
const reviewPage = read('src/pages/GameReview.jsx');
const gameReview = read('src/utils/gameReview.js');
const board = read('src/components/ChessBoard.jsx');

test('the per-move engine data survives into the stored verdicts', () => {
  const map = profile.slice(profile.indexOf('const verdicts = res.moves.map'));
  const block = map.slice(0, map.indexOf('}));') + 4);
  for (const field of ['uci:', 'bestUci:', 'lines:']) {
    assert.match(block, new RegExp(field), `verdicts dropped ${field}`);
  }
});

test('the classification badge is anchored to the played move destination', () => {
  assert.match(profile, /const moveBadge = useMemo/);
  assert.match(profile, /verdicts\[moveIndex - 1\]/);
  /* Anchored by the tail of the UCI - the square the piece landed on. */
  assert.match(profile, /const to = v\.uci\.slice\(2, 4\)/);
});

test('engine lines come from the row for the position on screen', () => {
  /* Row `moveIndex` is the move that comes NEXT from the visible position.
     Using moveIndex - 1 would draw suggestions for a position already left
     behind, so the arrows would disagree with the board. */
  assert.match(profile, /verdicts\[moveIndex\]/);
});

test('the board receives the badge and the arrows', () => {
  assert.match(profile, /moveBadge=\{moveBadge\}/);
  assert.match(profile, /customArrows=\{lineArrows\}/);
  assert.match(profile, /lineBadges=\{lineArrows\}/);
});

test('the overlay is no longer hardcoded empty', () => {
  /* This literal is what made the arrows permanently invisible. */
  assert.doesNotMatch(profile, /customArrows=\{\[\]\}/);
});

test('top lines are graded by opacity, not three different hues', () => {
  assert.match(profile, /rgba\(0, 128, 0, 1\).*rgba\(0, 128, 0, 0\.7\).*rgba\(0, 128, 0, 0\.45\)/s);
});

test('book moves simply have no arrows', () => {
  /* A theoretical row carries lines: [] / bestUci: null upstream, so the
     overlay must go quiet rather than invent a suggestion. */
  assert.match(gameReview, /lines: \[\]/);
  assert.match(profile, /if \(!ls\.length\) return \[\];/);
});

test('an older saved review without uci degrades quietly', () => {
  /* Reviews persisted before this change have no `uci`, so the badge guard has
     to be a null check, not an assumption. */
  assert.match(profile, /if \(!v \|\| !v\.uci \|\| v\.uci\.length < 4\) return null;/);
});

test('the board can actually render all three overlays', () => {
  assert.match(board, /moveBadge = null/);
  assert.match(board, /lineBadges = null/);
  assert.match(board, /customArrows = \[\]/);
  assert.match(board, /<MoveBadge verdict=\{moveBadge\.verdict\}/);
});

test('the profile viewer is not the only surface wired up any more', () => {
  /* Both review surfaces must stay in step; this is the parity check. */
  assert.match(reviewPage, /moveBadge=\{moveBadge\}/);
  assert.match(reviewPage, /lineBadges=\{rankedArrows\}/);
});