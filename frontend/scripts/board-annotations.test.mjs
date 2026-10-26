/* Mobile touch annotations on the shared board.
 *
 * Run: node --test scripts/board-annotations.test.mjs
 *
 * Covers the pieces that are easy to get wrong and hard to see: the square
 * mapping in BOTH orientations (plus off-board points), the highlight toggle,
 * the mobile-only arrow toggle, and the backend permission rule that keeps
 * students from annotating. Pure helpers are imported directly; the wiring is
 * asserted against the source, matching the rest of this suite.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { squareFromPoint, squareCenter } from '../src/utils/boardGeometry.js';
import { toggleHighlight, HIGHLIGHT_COLORS } from '../src/utils/liveHighlights.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

/* ------------------------------------------------------------------ *
 * Square mapping — normal orientation
 * ------------------------------------------------------------------ */

test('white: the centre of each square maps back to itself', () => {
  const size = 800; // 100px squares
  const cases = [
    ['a8', 50, 50],
    ['h1', 750, 750],
    ['e4', 450, 450],
    ['a1', 50, 750],
    ['h8', 750, 50],
  ];
  for (const [square, x, y] of cases) {
    assert.equal(squareFromPoint(x, y, size, 'white'), square, `${square} at (${x},${y})`);
  }
});

test('white: corners map to the corner squares', () => {
  assert.equal(squareFromPoint(0, 0, 800, 'white'), 'a8');
  assert.equal(squareFromPoint(799, 799, 800, 'white'), 'h1');
});

test('off-board points map to null', () => {
  assert.equal(squareFromPoint(-1, 400, 800, 'white'), null);
  assert.equal(squareFromPoint(400, -1, 800, 'white'), null);
  assert.equal(squareFromPoint(400, 801, 800, 'white'), null, 'past the bottom edge');
  assert.equal(squareFromPoint(801, 400, 800, 'white'), null, 'past the right edge');
  assert.equal(squareFromPoint(400, 400, 0, 'white'), null, 'zero-size board');
});

/* ------------------------------------------------------------------ *
 * Square mapping — flipped (black) orientation
 * ------------------------------------------------------------------ */

test('flipped board mirrors both axes', () => {
  assert.equal(squareFromPoint(0, 0, 800, 'black'), 'h1');
  assert.equal(squareFromPoint(799, 799, 800, 'black'), 'a8');
  assert.equal(squareFromPoint(450, 450, 800, 'black'), 'd5');
  assert.equal(squareFromPoint(50, 50, 800, 'black'), 'h1');
});

test('normal and flipped mirror the same point to opposite squares', () => {
  const p = { x: 250, y: 550 };
  const white = squareFromPoint(p.x, p.y, 800, 'white');
  const black = squareFromPoint(p.x, p.y, 800, 'black');
  assert.equal(white, 'c3');
  assert.equal(black, 'f6');
});

/* ------------------------------------------------------------------ *
 * Square centre (used by the arrow overlay)
 * ------------------------------------------------------------------ */

test('square centres honour orientation', () => {
  assert.deepEqual(squareCenter('e4', 800, 'white'), { x: 450, y: 450 });
  assert.deepEqual(squareCenter('e4', 800, 'black'), { x: 350, y: 350 });
  assert.deepEqual(squareCenter('a8', 800, 'white'), { x: 50, y: 50 });
  assert.deepEqual(squareCenter('a8', 800, 'black'), { x: 750, y: 750 });
});

test('square centre rejects junk', () => {
  assert.equal(squareCenter('', 800, 'white'), null);
  assert.equal(squareCenter('z9', 800, 'white'), null);
  assert.equal(squareCenter(undefined, 800, 'white'), null);
});

/* ------------------------------------------------------------------ *
 * Highlight toggle (double-tap semantics)
 * ------------------------------------------------------------------ */

test('toggling the same square with the same colour removes it', () => {
  const added = toggleHighlight([], 'd5', HIGHLIGHT_COLORS.green);
  assert.equal(added.action, 'add');
  const removed = toggleHighlight(added.highlights, 'd5', HIGHLIGHT_COLORS.green);
  assert.equal(removed.action, 'remove');
  assert.deepEqual(removed.highlights, []);
});

/* ------------------------------------------------------------------ *
 * The app is wired to the mobile gestures
 * ------------------------------------------------------------------ */

test('the board implements double-tap, long-press arrow, and haptics', () => {
  const chess = read('src', 'components', 'ChessBoard.jsx');
  assert.match(chess, /DOUBLE_TAP_MS/, 'double-tap window');
  assert.match(chess, /DRAG_BUTTON_LONG_PRESS/, 'long-press arms an arrow drag');
  assert.match(chess, /navigator\.vibrate\?\.\(10\)/, 'haptic tick on long-press');
  assert.match(chess, /e\.pointerType !== 'mouse'/, 'gestures are touch-only');
  assert.match(chess, /touchPointerRef/, 'a second finger cancels the gesture');
  assert.match(chess, /onArrowDrawn\?\.\(dragFrom, dragTo, isTouch \? 'touch'/, 'the touch source is threaded through');
});

test('the shared board toggles a repeated touch arrow but adds on desktop', () => {
  const board = read('src', 'components', 'liveclass', 'SharedChessBoard.jsx');
  assert.match(board, /source === 'touch'/, 'touch drags are told apart');
  assert.match(board, /type: 'remove_arrow'/, 'a repeated touch arrow is removed');
});

/* ------------------------------------------------------------------ *
 * Permission rule (enforced on the backend, not just the UI)
 * ------------------------------------------------------------------ */

test('the server rejects annotations from non-instructors', () => {
  const socket = read('..', 'backend', 'src', 'socket', 'liveClassSocket.js');
  const handler = socket.slice(socket.indexOf("socket.on('board_annotation'"));
  assert.match(handler, /access\.isInstructor/, 'instructor check on the annotation event');
  assert.match(handler, /action_rejected[\s\S]*board_annotation/, 'rejected with the annotation action');
  assert.match(handler, /reason: 'Instructor only'/, 'and says why');
});

test('the board only exposes annotation callbacks to instructors', () => {
  const board = read('src', 'components', 'liveclass', 'SharedChessBoard.jsx');
  assert.match(board, /permissions\.canDrawAnnotations \? handleArrowDrawn : undefined/, 'arrow drawing is gated');
  assert.match(board, /permissions\.canDrawAnnotations \? handleSquareRightClick : undefined/, 'highlights are gated');
});
