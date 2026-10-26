/* Live-classroom square highlights.
 *
 * Run: node --test scripts/live-board-highlight.test.mjs
 *
 * A right-click used to draw a circular ring on a square. It now fills the
 * whole square (edge-to-edge, under the piece) with a colour chosen by the
 * modifier keys, and the fill is broadcast so every student sees it. These
 * cover the pure colour/toggle helpers plus the wiring they replaced.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HIGHLIGHT_COLORS,
  DEFAULT_HIGHLIGHT_COLOR,
  highlightColorForModifiers,
  highlightSquareStyle,
  highlightsToSquareStyles,
  toggleHighlight,
} from '../src/utils/liveHighlights.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

/* ------------------------------------------------------------------ *
 * Colour from modifier keys
 * ------------------------------------------------------------------ */

test('no modifier gives red', () => {
  assert.equal(highlightColorForModifiers({}), HIGHLIGHT_COLORS.red);
  assert.equal(highlightColorForModifiers(), HIGHLIGHT_COLORS.red);
});

test('each modifier picks its own distinct colour', () => {
  assert.equal(highlightColorForModifiers({ shiftKey: true }), HIGHLIGHT_COLORS.green);
  assert.equal(highlightColorForModifiers({ ctrlKey: true }), HIGHLIGHT_COLORS.blue);
  assert.equal(highlightColorForModifiers({ metaKey: true }), HIGHLIGHT_COLORS.blue);
  assert.equal(highlightColorForModifiers({ altKey: true }), HIGHLIGHT_COLORS.yellow);
  const distinct = new Set(Object.values(HIGHLIGHT_COLORS));
  assert.equal(distinct.size, 4, 'the four colours are all different');
});

test('the plain highlight is red by default', () => {
  assert.equal(DEFAULT_HIGHLIGHT_COLOR, HIGHLIGHT_COLORS.red);
});

/* ------------------------------------------------------------------ *
 * Full-square fill, never a circle
 * ------------------------------------------------------------------ */

test('a highlight is a full-square tint with no radius or ring', () => {
  const style = highlightSquareStyle(HIGHLIGHT_COLORS.green);
  assert.ok(style.backgroundImage.includes(HIGHLIGHT_COLORS.green));
  assert.equal(style.borderRadius, 0);
  assert.equal(style.boxShadow, 'none');
});

test('an old highlight without a colour still tints red', () => {
  const style = highlightSquareStyle(undefined);
  assert.ok(style.backgroundImage.includes(DEFAULT_HIGHLIGHT_COLOR));
});

test('the tint is layered over the square base so light and dark squares differ', () => {
  const style = highlightSquareStyle(HIGHLIGHT_COLORS.green);
  assert.ok(style.backgroundImage.includes(HIGHLIGHT_COLORS.green), 'colour is a background layer');
  assert.equal(style.backgroundColor, undefined, 'no flat fill — the light/dark base is preserved');
  assert.equal(style.borderRadius, 0);
  assert.equal(style.boxShadow, 'none');
});

test('highlights map to per-square styles and empties are skipped', () => {
  const styles = highlightsToSquareStyles([
    { square: 'e4', color: HIGHLIGHT_COLORS.blue },
    { square: 'd5' },
    null,
    { color: '#fff' },
  ]);
  assert.deepEqual(Object.keys(styles), ['e4', 'd5']);
  assert.ok(styles.e4.backgroundImage.includes(HIGHLIGHT_COLORS.blue));
  assert.ok(styles.d5.backgroundImage.includes(DEFAULT_HIGHLIGHT_COLOR));
  assert.deepEqual(highlightsToSquareStyles(undefined), {});
});

/* ------------------------------------------------------------------ *
 * Toggle / recolour semantics
 * ------------------------------------------------------------------ */

test('clicking an empty square adds the highlight', () => {
  const { highlights, action } = toggleHighlight([], 'e4', HIGHLIGHT_COLORS.red);
  assert.equal(action, 'add');
  assert.deepEqual(highlights, [{ square: 'e4', color: HIGHLIGHT_COLORS.red }]);
});

test('clicking the same square with the same colour removes it', () => {
  const start = [{ square: 'e4', color: HIGHLIGHT_COLORS.red }];
  const { highlights, action } = toggleHighlight(start, 'e4', HIGHLIGHT_COLORS.red);
  assert.equal(action, 'remove');
  assert.deepEqual(highlights, []);
});

test('clicking with a different colour recolours that square in place', () => {
  const start = [
    { square: 'e4', color: HIGHLIGHT_COLORS.red },
    { square: 'd5', color: HIGHLIGHT_COLORS.green },
  ];
  const { highlights, action } = toggleHighlight(start, 'e4', HIGHLIGHT_COLORS.blue);
  assert.equal(action, 'add');
  assert.equal(highlights.length, 2, 'no duplicate entry on the same square');
  assert.deepEqual(highlights[0], { square: 'e4', color: HIGHLIGHT_COLORS.blue });
  assert.deepEqual(highlights[1], { square: 'd5', color: HIGHLIGHT_COLORS.green });
});

/* ------------------------------------------------------------------ *
 * The app is wired to the helpers
 * ------------------------------------------------------------------ */

test('the shared board renders highlights as full-square fills', () => {
  const board = read('src', 'components', 'liveclass', 'SharedChessBoard.jsx');
  assert.match(board, /highlightsToSquareStyles\(annotations\?\.highlights\)/, 'fills come from the helper');
  assert.match(board, /highlightColorForModifiers\(modifiers\)/, 'colour follows the modifiers');
  assert.match(board, /toggleHighlight\(prev\?\.highlights, sq, color\)/, 'toggle drives add/remove');
  assert.match(board, /data: \{ square: sq, color \}/, 'the colour is broadcast with the square');
  assert.doesNotMatch(board, /borderRadius: '50%'/, 'the old circle ring is gone');
});

test('the generic board threads modifiers and supports mobile long-press', () => {
  const chess = read('src', 'components', 'ChessBoard.jsx');
  assert.match(chess, /onSquareRightClick\(dragFrom, \{/, 'right-click passes the modifier keys');
  assert.match(chess, /pointerType !== 'mouse'/, 'touch press-and-hold is detected');
  assert.match(chess, /LONG_PRESS_MS/, 'and bounded by a press timer');
});

test('the server upserts a highlight per square instead of stacking', () => {
  const socket = read('..', 'backend', 'src', 'socket', 'liveClassSocket.js');
  assert.match(socket, /annotations\.highlights = \(annotations\.highlights \|\| \[\]\)\.filter\(\s*\(h\) => h\.square !== data\.square\s*\)/, 'existing square is replaced');
});
