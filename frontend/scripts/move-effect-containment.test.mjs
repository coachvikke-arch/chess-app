/* MoveEffect containment.
 *
 * Run: node --test scripts/move-effect-containment.test.mjs
 *
 * The overlay is the board and nothing else: it is clipped to the playing
 * surface (rounded corners included), every decoration is clamped inside that
 * rectangle, and the pill flips left when there is no room on the right.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  clampCentered,
  pillAnchor,
  squarePoint,
} from '../src/effects/moveEffect/timeline.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(here, '..', 'src', p), 'utf8');

const BOARD = 480;
const SQ = BOARD / 8;

test('a corner badge is shifted inward by exactly its half-size', () => {
  const badge = 0.52 * SQ;
  const topRight = clampCentered(BOARD, 0, badge, badge, BOARD);
  assert.equal(topRight.x, BOARD - badge / 2);
  assert.equal(topRight.y, badge / 2);
  assert.equal(topRight.x + badge / 2, BOARD, 'right edge stays on the board');
  assert.equal(topRight.y - badge / 2, 0, 'top edge stays on the board');

  const bottomLeft = clampCentered(0, BOARD, badge, badge, BOARD);
  assert.equal(bottomLeft.x, badge / 2);
  assert.equal(bottomLeft.y, BOARD - badge / 2);

  const inside = clampCentered(SQ * 4, SQ * 4, badge, badge, BOARD);
  assert.deepEqual(inside, { x: SQ * 4, y: SQ * 4 }, 'inner squares are untouched');
});

test('the pill grows right with room and flips left near the h-file', () => {
  const width = 1.55 * SQ;
  const height = 0.34 * SQ;

  const dFile = pillAnchor(SQ * 4, SQ * 4, width, height, BOARD);
  assert.equal(dFile.growLeft, false);
  assert.equal(dFile.origin, 'left center');
  assert.equal(dFile.left, SQ * 4);
  assert.ok(dFile.left + width < BOARD);

  const gFile = pillAnchor(SQ * 7, SQ * 4, width, height, BOARD);
  assert.equal(gFile.growLeft, true, 'g-file has no room for a right-growing pill');
  assert.equal(gFile.origin, 'right center');
  assert.equal(gFile.left + width, SQ * 7);
  assert.ok(gFile.left >= 0);

  const hFile = pillAnchor(BOARD, SQ * 4, width, height, BOARD);
  assert.equal(hFile.growLeft, true);
  assert.equal(hFile.left + width, BOARD);
});

test('the pill also stays inside on the top and bottom rows', () => {
  const width = 1.55 * SQ;
  const height = 0.34 * SQ;
  const top = pillAnchor(SQ * 4, 0, width, height, BOARD);
  assert.equal(top.top, height / 2);
  const bottom = pillAnchor(SQ * 4, BOARD, width, height, BOARD);
  assert.equal(bottom.top, BOARD - height / 2);
});

test('flipped boards use the visual position, so the h-file flips too', () => {
  const width = 1.55 * SQ;
  const height = 0.34 * SQ;
  const whiteH = squarePoint('h5', 'white');
  const blackH = squarePoint('h5', 'black');
  assert.equal(whiteH.x, 7.5);
  assert.equal(blackH.x, 0.5);
  const whiteCorner = whiteH.x * SQ;
  const blackCorner = blackH.x * SQ;
  assert.equal(pillAnchor(whiteCorner, SQ * 4, width, height, BOARD).growLeft, true);
  assert.equal(pillAnchor(blackCorner, SQ * 4, width, height, BOARD).growLeft, false);
});

test('the overlay layer is clipped, self-contained and touch-through', () => {
  const css = src('effects/moveEffect/moveEffect.css');
  const root = css.slice(css.indexOf('.me-root {'), css.indexOf('}', css.indexOf('.me-root {')));
  assert.match(root, /position:\s*absolute/);
  assert.doesNotMatch(root, /position:\s*fixed/);
  assert.match(root, /overflow:\s*hidden/);
  assert.match(root, /border-radius/);
  assert.match(root, /pointer-events:\s*none/);
  assert.match(root, /contain:\s*layout/);
  assert.match(root, /isolation:\s*isolate/);
  assert.match(root, /transform:\s*translateZ\(0\)/);
  assert.doesNotMatch(root, /100vw|100vh|100%/);
});

test('the overlay is the board rectangle, with the board radius', () => {
  const fx = src('effects/moveEffect/MoveEffect.jsx');
  assert.match(fx, /left:\s*inset,[\s\S]*?top:\s*inset,[\s\S]*?width:\s*boardWidth,[\s\S]*?height:\s*boardWidth/);
  assert.match(fx, /borderRadius:\s*radius/);
  assert.match(fx, /radius = 14/);
  assert.match(fx, /const sealPos = clampCentered\(cornerX, cornerY, badgePx, badgePx, boardWidth\)/);
  assert.match(fx, /const pillPos = pillAnchor\(sealPos\.x, sealPos\.y, geo\.pillW, geo\.pillH, boardWidth\)/);
  assert.match(fx, /const swordPos = clampCentered\(swordX, swordY, geo\.swordPx, geo\.swordPx, boardWidth\)/);
});

test('the board hands the overlay its own radius inside the board container', () => {
  const board = src('components/ChessBoard.jsx');
  assert.match(board, /const boardRadius = themeStyles\.boardStyle\?\.borderRadius \|\| \(flat \? '10px' : '14px'\)/);
  assert.match(board, /<MoveEffect[\s\S]*?radius=\{boardRadius\}/);
  assert.doesNotMatch(board, /createPortal\([\s\S]*?<MoveEffect/);
  assert.doesNotMatch(src('effects/moveEffect/MoveEffect.jsx'), /createPortal/);
});

test('all drawn layers sit inside the clipped root', () => {
  const fx = src('effects/moveEffect/MoveEffect.jsx');
  /* No layer opts back out of the board clip. */
  assert.doesNotMatch(fx, /overflow:\s*['"]visible['"]/);
  assert.doesNotMatch(fx, /position:\s*['"]fixed['"]/);
  const css = src('effects/moveEffect/moveEffect.css');
  assert.doesNotMatch(css, /\.me-(?:dim|ripple|piece|seal|pill|sword)[^{]*\{[^}]*position:\s*fixed/);
});
