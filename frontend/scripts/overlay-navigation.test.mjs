/* ──────────────────────────────────────────────────────────────────────────
 * Overlays (class details, game viewers) must OPEN when they are clicked.
 *
 * The regression it guards: an overlay opened and closed itself in the same
 * tick, so a class card did nothing when clicked and a Brilliant Move card
 * never appeared. The cause was in the shared overlay hook:
 *
 *   1. the effect depended on an inline close handler, so every parent
 *      render tore the overlay down and pushed it again;
 *   2. the cleanup called history.back() SYNCHRONOUSLY. Under React
 *      StrictMode the effect is cleaned up and immediately re-run for the
 *      same still-open overlay, so the back() popped the entry the overlay
 *      had just pushed. The popstate that followed was read as "the user
 *      pressed Back", and the overlay closed itself;
 *   3. the overlay pushed a SECOND history entry while its open state was
 *      already a URL parameter (?class=<id>), so Back stepped over the list
 *      the overlay was opened from - and closing it re-opened it.
 *
 * The rules, as source assertions:
 *   - the close handler lives in a ref: the effect depends on the overlay's
 *     own lifecycle only;
 *   - the history entry is removed on a TIMER, and the timer is cancelled
 *     when the effect re-runs (the StrictMode remount);
 *   - a remount re-uses the entry it already pushed (one entry per overlay);
 *   - the cleanup only steps back over the entry IT pushed;
 *   - a surface that owns the URL says so: the modal does not push a second
 *     entry and closing replaces the URL entry.
 *
 * Run: node --test scripts/overlay-navigation.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const HOOK = read('src/hooks/useOverlayHistory.js');
const MODAL = read('src/components/ClassDetailModal.jsx');
const CLASSES = read('src/pages/ManageClasses.jsx');
const ATTENDANCE = read('src/pages/Attendance.jsx');
const SIGMA = read('src/components/SigmaMoves.jsx');
const REVIEW = read('src/pages/GameReview.jsx');

/* ── the overlay hook ────────────────────────────────────────────────────── */

test('the close handler is kept in a ref, so a parent render cannot re-register', () => {
  assert.match(HOOK, /closeRef\.current = closeFn/);
  assert.match(HOOK, /\}, \[isOpen, id\]\)/,
    'the effect must depend on the overlay lifecycle only');
});

test('the history entry is removed on a timer, not synchronously', () => {
  assert.match(HOOK, /setTimeout\(/,
    'the removal must be deferred: a synchronous back() pops the entry of a StrictMode remount');
  assert.match(HOOK, /clearTimeout\(timerRef\.current\)/,
    'a remount must cancel the pending removal');
  assert.match(HOOK, /if \(genRef\.current !== myGen\) return;/,
    'a re-registered overlay keeps its entry');
});

test('a remount re-uses the entry it already pushed', () => {
  assert.match(HOOK, /overlays\.find\(\(o\) => o\.key === key\)/,
    'the overlay must find its own entry instead of pushing a second one');
  assert.match(HOOK, /const keyRef = useRef\(null\)/);
});

test('the cleanup only steps back over the entry it pushed', () => {
  assert.match(HOOK, /state && state\.overlay === token/,
    'the marker check keeps the overlay off other pages entries');
  assert.match(HOOK, /pendingBack\.has\(token\)/,
    'a back() that is already on its way must not be doubled');
});

/* ── the class details ───────────────────────────────────────────────────── */

test('the class modal can hand its history entry to the URL', () => {
  assert.match(MODAL, /manageHistory = true/);
  assert.match(MODAL, /useOverlayHistory\('ClassDetailModal', manageHistory, onClose\)/);
});

test('the classes page uses ?class= as the one history entry', () => {
  assert.match(CLASSES, /useUrlView\('class'\)/);
  assert.match(CLASSES, /manageHistory=\{false\}/,
    'the URL entry is the history entry - no second one');
  assert.match(CLASSES, /onClose=\{\(\) => setDetailClassId\(null, \{ replace: true \}\)\}/,
    'closing replaces the entry, so Back does not re-open the class');
  assert.match(CLASSES, /String\(c\.id\) === String\(detailClassId\)/,
    'the class is found by its own row id, compared as strings');
});

test('the attendance register opens the class it names', () => {
  assert.match(ATTENDANCE, /onClick=\{\(\) => setDetailClassId\(cls\.id\)\}/,
    'the column header opens its own class');
  assert.match(ATTENDANCE, /String\(c\.id\) === String\(detailClassId\)/);
});

/* ── the brilliant moves ─────────────────────────────────────────────────── */

test('a Brilliant card still opens its game by the canonical identity', () => {
  assert.match(SIGMA, /onClick=\{\(\) => onOpenGame && onOpenGame\(m, \{ moveIndex: plyToMoveIndex\(m\.ply\) \}\)\}/);
  assert.match(REVIEW, /const ref = sigmaGameRef\(move\)/);
  assert.match(REVIEW, /gameRef=\{sigmaGame\.ref\}/);
  assert.match(REVIEW, /initialMoveIndex=\{sigmaGame\.moveIndex\}/);
  assert.match(REVIEW, /key=\{sigmaGame\.key\}/);
  assert.match(REVIEW, /key: `\$\{ref\.gameSource\}:\$\{ref\.gameId\}:\$\{move\.ply\}`/,
    'source + id + ply: two brilliant moves never share a card');
});

test('the ply conversion still refuses to collapse to the start position', () => {
  const DISPLAY = read('src/utils/sigmaDisplay.js');
  assert.match(DISPLAY, /const index = Math\.floor\(p\) \+ 1;/);
  assert.match(DISPLAY, /if \(!Number\.isFinite\(total\) \|\| total <= 0\) return index;/,
    'an unknown move total must not clamp the ply to zero');
});
