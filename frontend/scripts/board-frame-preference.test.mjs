// Pins the board-frame contract.
//   run with: npm run test:boardframe   (from frontend/)
//
// 1. The saved Board Frame preference is the ONLY thing that decides whether a
//    board draws a frame. ChessBoard used to also honour its own `flat` prop here,
//    and Play Arena passes `flat` — so Play Arena was the one page in the app that
//    ignored the setting. ResponsiveBoard's `frameless` also defaulted to `false`,
//    which ChessBoard reads as "frame forced ON" (`!frameless`), so every page that
//    did not pass the prop ignored "frame off" too. Both defaults are now `null`.
// 2. The frame is carved out of the box the page hands the board, so a board
//    measures the same with the frame on as with it off.
// 3. An offline launch crashed the service worker instead of showing anything:
//    the navigate fallback handed `Response.error()` to respondWith, which the
//    browser refuses, and the console got
//    "Failed to convert value to 'Response'".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = (rel) => readFileSync(join(ROOT, 'src', rel), 'utf8');
const SW = readFileSync(join(ROOT, 'public', 'sw.js'), 'utf8');

test('ResponsiveBoard sizes the box, never the decoration', () => {
  const s = SRC('components/ResponsiveBoard.jsx');
  assert.match(s, /frameless = null/, 'the default must be null, not false');
  /* The sizer used to read the preference itself and subtract the frame's band
     from the width it handed ChessBoard. That is what made a framed board
     ~90px smaller than a bare one: the frame was ADDED outside the measured box.
     Now the measured box IS the footprint and ChessBoard carves the frame out of
     it, so the sizer has no reason to know whether a frame is being drawn. */
  assert.doesNotMatch(s, /useAuth/, 'the sizer must not read the frame preference');
  assert.doesNotMatch(s, /frameOf|frameRemC|framedOuterWidth/, 'nor keep its own band arithmetic');
  assert.match(s, /fitBoardWidth\(available, \{ max: maxWidth, maxHeight \}\)/);
  assert.match(s, /\[maxWidth, maxHeight\]\);/, 'and toggling the frame must not re-run the fit');
  /* the box, and the untouched tri-state, both go to ChessBoard */
  assert.match(s, /frameless=\{frameless\} outerWidth=\{outer\}/);
});

test('no page board may veto the saved frame', () => {
  /* GameViewerCard used to pass `frameless={isMobileBoard}`, so a phone showed a
     bare board whatever Settings said. Only a caller drawing a thumbnail inside
     a card may force a bare board, and none of the pages listed in the brief do. */
  for (const rel of [
    'components/GameViewerCard.jsx',
    'components/PuzzlePlayer.jsx',
    'components/liveclass/SharedChessBoard.jsx',
    'components/ArenaBoard.jsx',
    'components/GameReplay.tsx',
  ]) {
    assert.doesNotMatch(SRC(rel), /frameless=\{/, `${rel} must leave the frame to the preference`);
  }
  assert.match(SRC('components/StaticBoard.jsx'), /const framed = boardFrame !== false;/,
    'the mini boards read the same preference from the same source');
});

test('ChessBoard reads null as the preference and a boolean as a force', () => {
  const s = SRC('components/ChessBoard.jsx');
  assert.match(s, /frameless = null,/);
  assert.match(s, /const showFrame = frameless === null \? boardFrame : !frameless;/,
    'frame visibility is the Settings toggle and nothing else');
  /* `flat` used to veto the frame on this line, which made Play Arena the one
     board in the app that ignored a student's choice — the page passes `flat`. */
  assert.doesNotMatch(s, /const showFrame = flat/, 'a flat LOOK must not mean a frameless board');
  assert.match(s, /const boardWidth = outerWidth === null/, 'callers hand it an outer box');
});

test('one outer footprint, with the frame and without it', async () => {
  /* The behavioural half of "the board size must be exactly the same with frame
     and without frame": the frame is carved out of the handed box, so the box
     never moves. `squaresForOuter` is what ChessBoard applies. */
  const { squaresForOuter, framedOuterFor } = await import('../src/utils/boardFrame.js');
  for (const outer of [240, 300, 360, 420, 560, 720]) {
    const squares = squaresForOuter(outer);
    assert.ok(squares < outer, `${outer}: the squares sit inside the box, not outside it`);
    const framed = framedOuterFor(squares);
    assert.ok(framed <= outer, `${outer}: the framed board is ${framed}, it must not spill the box`);
    assert.ok(framed >= outer - 24, `${outer}: the framed board is ${framed}, it must not waste the box`);
  }
});

test('the service worker hands respondWith a real Response, always', () => {
  assert.doesNotMatch(SW, /Response\.error\(\)/, 'a network-error object cannot be returned from respondWith');
  assert.match(SW, /const offlineStub = \(status\) => new Response\(/);
  /* Three paths can leave the worker with nothing to answer: the page load, an
     unseen hashed bundle, and a subresource that is neither cached nor reachable. */
  assert.equal((SW.match(/event\.respondWith\(/g) || []).length, 3);
  assert.equal((SW.match(/offlineStub\(\d+\)/g) || []).length, 3, 'every path has a fallback');
  assert.match(SW, /cached \|\| offlineStub\(503\)/);
  assert.match(SW, /\.catch\(\(\) => offlineStub\(504\)\)/);
  assert.match(SW, /\.catch\(\(\) => cached \|\| offlineStub\(504\)\)/);
});
