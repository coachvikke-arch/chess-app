// Pins the two Settings-side frontend fixes.
//   run with: npm run test:boardframe   (from frontend/)
//
// 1. Board Frame never reached Game Review. ResponsiveBoard's `frameless` prop
//    defaulted to `false`, and ChessBoard reads an explicit `false` as "frame
//    forced ON" (`!frameless`) — only `null` means "follow the saved preference".
//    So every page that did not pass the prop ignored a student's "frame off".
// 2. An offline launch crashed the service worker instead of showing anything:
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

test('ResponsiveBoard leaves the frame decision to the saved preference', () => {
  const s = SRC('components/ResponsiveBoard.jsx');
  assert.match(s, /frameless = null/, 'the default must be null, not false');
  assert.match(s, /import \{ useAuth \} from '..\/context\/AuthContext';/);
  assert.match(s, /const framed = frameless === null \? boardFrame !== false : !frameless;/);
  /* The sizer has to measure the board the component will actually draw. */
  assert.match(s, /fitBoardWidth\(available, \{ max: maxWidth, maxHeight, frameless: !framed \}\)/);
  assert.match(s, /\[maxWidth, maxHeight, frameless, framed\]/);
  /* and it still has to hand the tri-state to ChessBoard, unchanged. */
  assert.match(s, /frameless=\{frameless\}/);
});

test('a caller that forces a bare board still gets one', () => {
  /* GameViewerCard sizes its own mobile board frameless; the new default must
     not turn that back into "follow the preference". */
  const s = SRC('components/GameViewerCard.jsx');
  assert.match(s, /frameless=\{isMobileBoard\}/);
});

test('ChessBoard still reads null as the preference and a boolean as a force', () => {
  const s = SRC('components/ChessBoard.jsx');
  assert.match(s, /frameless = null,/);
  assert.match(s, /const showFrame = flat \? false : \(frameless === null \? boardFrame : !frameless\);/);
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
