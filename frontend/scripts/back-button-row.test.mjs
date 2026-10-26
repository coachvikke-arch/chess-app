/* ──────────────────────────────────────────────────────────────────────────
 * The Back control is a ROW of its own, under the top bar, above the content.
 *
 * The regression it guards: the button used to be a floating pill positioned
 * with a hard-coded offset, which put it in the wrong place on every surface
 * that is not a plain page (it sat over the sidebar, or in the outer margin
 * with nothing above it), and it floated OVER the content instead of pushing
 * it down.
 *
 * The rules, as source assertions:
 *   - the control renders a ROW (a block with the button inside it), not a
 *     floating pill;
 *   - the row is `sticky` and its top offset is the MEASURED height of the top
 *     bar, so it lands under the bar on every surface;
 *   - the app shells render the row themselves, inside the container that
 *     holds the sidebar, so it lines up with the sidebar's left edge and the
 *     content below it is pushed down instead of overlapped;
 *   - the public pages keep one row of their own.
 *
 * Run: node --test scripts/back-button-row.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const BUTTON = read('src/components/BackButton.jsx');
const SMART = read('src/hooks/useSmartBack.js');
const ADMIN = read('src/components/AppShell.jsx');
const STUDENT = read('src/components/AppShell.jsx');
const APP = read('src/App.jsx');
const CSS = read('src/index.css');

/* ── it is a row, not a floating pill ─────────────────────────────────────── */

test('the control renders a row that contains the button', () => {
  assert.match(BUTTON, /className=\{`chess-back-row/, 'the row element is missing');
  assert.match(BUTTON, /chess-back-btn/, 'the button inside the row is missing');
  assert.doesNotMatch(BUTTON, /fixed z-40 left-2\.5/,
    'the old floating pill placement must be gone');
  assert.doesNotMatch(BUTTON, /chess-back-float/,
    'the old gutter-positioned pill must be gone');
});

test('the row is sticky and offset by the measured bar height', () => {
  assert.match(CSS, /\.chess-back-row\s*\{[^}]*position:\s*sticky/,
    'the row must be sticky so it stays under the top bar while scrolling');
  assert.match(BUTTON, /useNavHeight/,
    'the row must measure the top bar instead of guessing its height');
  /* The measurement itself lives in the shared hook, so the row and the
     sidebars anchor to the same number. */
  const HOOK = read('src/hooks/useNavHeight.js');
  assert.match(HOOK, /document\.querySelector\('header\.nav-glass'\)/,
    'the measured bar is the sticky top bar');
  assert.match(HOOK, /--app-nav-h/,
    'the height is published for the stylesheets');
  assert.match(BUTTON, /style=\{\{ top: inShell \? 0 : navHeight == null \? FALLBACK_NAV_HEIGHT : navHeight \}\}/,
    'the row sticks at the content top inside a shell, and clears the bar elsewhere');
});

test('the button is a small ghost control', () => {
  const block = CSS.match(/\.chess-back-btn\s*\{[^}]*\}/);
  assert.ok(block, '.chess-back-btn has no rule');
  assert.match(block[0], /height:\s*2\.25rem/, 'the button must be about 32-36px tall');
  assert.match(block[0], /background:\s*transparent/, 'the button must be a ghost');
  assert.match(CSS, /\.chess-back-btn:hover\s*\{[^}]*\}/,
    'the button must have a hover highlight');
  assert.match(BUTTON, /←/, 'the button carries a chevron');
  assert.match(BUTTON, />\s*Back\s*</, 'the button carries the word Back');
});

test('the row sits below the bar and above the sidebar', () => {
  assert.match(CSS, /\.chess-back-row\s*\{[^}]*z-index:\s*30/,
    'the row must be under the top bar (z-40) and above the content');
});

/* ── the shells own their row ────────────────────────────────────────────── */

test('the admin shell renders the back row in the content area', () => {
  assert.match(ADMIN, /import BackButton from '\.\/BackButton'/);
  const at = ADMIN.indexOf('<BackButton ');
  assert.ok(at > 0, 'the shell does not render the row');
  /* The back button lives in the scrollable content area (admin-content),
     conditional on full-height mode. */
  assert.match(ADMIN, /\{!isFullHeight \&\& <BackButton/,
    'the row must sit inside the admin-content area, conditional on full-height mode');
});

test('the student shell renders the row in the content area', () => {
  assert.match(STUDENT, /import BackButton from '\.\/BackButton'/);
  const at = STUDENT.indexOf('<BackButton ');
  assert.ok(at > 0, 'the shell does not render the row');
  assert.match(STUDENT, /\{!isFullHeight \&\& <BackButton/,
    'the row must sit inside the content area, conditional on full-height mode');
});

/* ── the public pages keep one row ───────────────────────────────────────── */

test('the public pages render exactly one row of their own', () => {
  assert.match(APP, /\{!usesShell && \(\s*<BackButton className="max-w-\[90rem\] mx-auto px-3 sm:px-4" \/>/,
    'the public row must be rendered for the pages that have no shell');
  assert.match(APP, /const usesShell = isAdmin \|\| inStudentShell/,
    'the shell routes must not render a second row');
});

/* ── going back ──────────────────────────────────────────────────────────── */

test('Back goes to the previous page, or to the dashboard when there is none', () => {
  assert.match(BUTTON, /useSmartBack/,
    'the row delegates to the shared smart-back hook');
  assert.match(SMART, /hasInternalPrevious\(\)/,
    'the hook asks the in-app history boundary instead of window.history.length');
  assert.match(SMART, /navigate\(-1\)/, 'the previous in-app page is the first choice');
  assert.match(SMART, /navigate\(fallback, \{ replace: true \}\)/,
    'with no in-app history it replaces the entry with the dashboard');
  assert.match(SMART, /\/admin\/dashboard/);
  assert.match(SMART, /\/student\/dashboard/);
});
