/**
 * The replay's classification badge must appear AFTER the piece has moved.
 *
 * THE BUG THIS EXISTS FOR
 *
 * The badge is anchored to the destination square, which is correct. But it was
 * revealed in the same frame the ply changed, so on a quick step or an
 * auto-play tick the badge was on screen while the piece was still travelling.
 * Visually that reads as "the badge marks the square the piece was on before it
 * moved" - which is exactly how it was reported.
 *
 * The fix ties the badge delay to the SAME constant the board animation uses
 * (MOVE_ANIM_S), so they cannot drift apart again. This test asserts that
 * coupling, because the two values being independent is precisely what caused
 * the problem and nothing else would notice.
 *
 * Run with: npm run test:replay-badge-timing
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'src', 'components', 'GameReplay.tsx'), 'utf8');

test('a single constant defines the move animation duration', () => {
  assert.match(src, /const MOVE_ANIM_S = [\d.]+;/, 'MOVE_ANIM_S is not declared');
  assert.match(src, /const MOVE_ANIM_MS = MOVE_ANIM_S \* 1000/, 'the ms delay must derive from the seconds constant, not be hard-coded separately');
});

test('the board is animated with that same constant', () => {
  assert.match(src, /animationDuration=\{MOVE_ANIM_S\}/,
    'ChessBoard must use MOVE_ANIM_S, otherwise the badge and the piece can desynchronise again');
});

test('the badge delay is derived from the animation constant', () => {
  assert.match(src, /setTimeout\(\(\) => setBadgeLanded\(true\),\s*MOVE_ANIM_MS\)/,
    'the badge reveal timer must use MOVE_ANIM_MS');
});

test('the badge is suppressed until the piece has landed', () => {
  assert.match(src, /const \[badgeLanded, setBadgeLanded\] = useState\(false\)/);
  assert.match(src, /if \(!badgeLanded\) return null;/,
    'moveBadge must be null until the piece has landed');
  /* And the memo must depend on the flag, or it will not recompute. */
  assert.match(src, /\}, \[badgeLanded, ply, currentMove, currentAnalysis\]\);/,
    'the badge memo must list badgeLanded in its dependencies');
});

test('the reveal is reset on every ply change, not just the first', () => {
  const effect = src.slice(src.indexOf('const [badgeLanded'), src.indexOf('const moveBadge'));
  assert.match(effect, /\}, \[ply\]\);/, 'the reveal effect must key on ply');
  assert.match(effect, /setBadgeLanded\(false\)/, 'each new ply must hide the badge again before re-revealing it');
});

test('reduced-motion users are not left waiting', () => {
  assert.match(src, /prefers-reduced-motion: reduce/,
    'with animation disabled, the badge should appear immediately rather than after a wait');
});

test('the badge still marks the destination square, not the origin', () => {
  /* The timing fix must not have quietly moved the anchor to the from-square. */
  assert.match(src, /const to = currentMove\.to;/);
  assert.match(src, /square: to,/);
  assert.doesNotMatch(src, /const to = currentMove\.from;/);
});

test('the starting position shows no badge', () => {
  assert.match(src, /if \(ply === 0 \|\| !currentMove\?\.to\) return null;/);
});