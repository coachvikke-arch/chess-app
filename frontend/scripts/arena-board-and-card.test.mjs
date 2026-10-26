/* ──────────────────────────────────────────────────────────────────────────
 * The Play Arena's board, the game card's full-screen fit, the fixed rail and
 * the louder move effects.
 *
 * The regressions these guard, in order of how badly they hurt:
 *
 *  1. The card's grid row was left IMPLICIT, so it sized itself to its
 *     content — and the board is sized FROM that row. The board grew the row,
 *     the row grew the board, the ResizeObserver spun forever and the card
 *     froze: its copy and Analyze buttons stopped responding.
 *  2. The board's size ignored the themed frame around it, so the framed
 *     board overflowed its column and pushed the nav row (and the buttons in
 *     it) out of view.
 *  3. The Play Arena had TWO copies of the same board and TWO different
 *     completion cards.
 *
 * Run: node --test scripts/arena-board-and-card.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const CSS = read('src/index.css');
const ARENA = read('src/pages/AnalysisBoard.jsx');
const CARD = read('src/components/GameViewerCard.jsx');
const ARENA_BOARD = read('src/components/ArenaBoard.jsx');
const POPUP = read('src/components/PostGameResultPopup.jsx');
const SIDEBAR = read('src/components/Sidebar.jsx');
const STUDENT_SHELL = read('src/components/StudentAppShell.jsx');
const SOUND = read('src/utils/sound.js');
const EFFECT_CFG = read('src/effects/moveEffect/config.js');
const HOOK = read('src/hooks/useNavHeight.js');

/* ── 1. the card's layout must not feed back on itself ───────────────────── */

test('the card body has an EXPLICIT row, so the board cannot resize it', () => {
  const block = CSS.match(/\.cp-viewer-body \{[^}]*\}/);
  assert.ok(block, '.cp-viewer-body has no rule');
  assert.match(block[0], /grid-template-rows:\s*minmax\(0, 1fr\)/,
    'an implicit (auto) row sizes itself to its content - the board is sized from it, so it loops');
  assert.match(block[0], /overflow:\s*hidden/);
});

test('the board is sized from the column, with the frame and the nav row reserved', () => {
  assert.match(CARD, /function fitBoardToColumn\(col, row\)/);
  assert.match(CARD, /const frameOf = \(bw\) =>/,
    'the themed frame around the squares must be reserved');
  assert.match(CARD, /NAV_ALLOWANCE/,
    'the nav row (with the move controls) must be reserved');
  assert.match(CARD, /boardColRef\.current\.getBoundingClientRect\(\)/);
  assert.match(CSS, /\.cp-nav \{[^}]*flex-shrink:\s*0;/,
    'the nav row must never be squeezed out of the column');
});

test('the board is 20% bigger, and never cropped', () => {
  assert.match(CARD, /const BOARD_SCALE = 1\.2;/);
  assert.match(CARD, /fitted \* BOARD_SCALE/,
    'the board must be drawn larger than the free space');
  /* The WIDTH is a hard limit (a wider board would be cropped); the height may
     overflow, because the column scrolls and the nav row is pinned. */
  assert.match(CARD, /Math\.min\(fitted \* BOARD_SCALE, byWidth\)/);
  assert.match(CSS, /\.cp-viewer-board \{[^}]*overflow-y:\s*auto;/,
    'a board taller than the column must scroll, not be cut off');
  assert.match(CSS, /\.cp-nav \{[^}]*position:\s*sticky;/,
    'the nav row stays pinned while the board scrolls');
});

test('the card fills the screen', () => {
  const block = CSS.match(/\.cp-viewer \{[^}]*\}/);
  assert.ok(block, '.cp-viewer has no rule');
  assert.match(block[0], /width:\s*100vw/);
  assert.match(block[0], /height:\s*100dvh/);
  assert.match(block[0], /max-width:\s*none/);
  assert.match(block[0], /max-height:\s*none/);
  assert.match(CSS, /\.cp-viewer-body > \.cp-viewer-side \{[^}]*overflow-y:\s*auto;/,
    'only the side column scrolls');
});

/* ── 2. ONE board component, ONE completion card ────────────────────────── */

test('the Play Arena renders ONE board component in both surfaces', () => {
  assert.match(ARENA, /import ArenaBoard from '\.\.\/components\/ArenaBoard'/);
  assert.doesNotMatch(ARENA, /<ChessBoard/,
    'the board must not be written out twice any more');
  const uses = (ARENA.match(/<ArenaBoard/g) || []).length;
  assert.equal(uses, 2, 'the page board and the Play Mode board both use it');
  assert.match(ARENA_BOARD, /export default function ArenaBoard/);
  assert.match(ARENA_BOARD, /moveEffectHostId=\{effectHostId\}/);
});

test('there is ONE completion card, and it waits for the mate animation', () => {
  assert.doesNotMatch(ARENA, /game-over-overlay/,
    'the old page-only result card is gone');
  assert.match(ARENA, /<PostGameResultPopup/);
  assert.match(ARENA, /open=\{!resultDismiss && !resultRevealPending\}/,
    'the card must not open before the checkmate animation has finished');
  assert.match(ARENA, /\{!playMode && resultCard\}/,
    'the page shows the same card the Play Mode board shows');
  /* The rating moved into the one card, so nothing was lost with the old one. */
  assert.match(ARENA, /rating=\{resultPopupProps\.rating\}/);
  assert.match(POPUP, /rating\.opponent/,
    'both players\' rating rows are in the card');
});

/* ── 3. the rail is fixed ───────────────────────────────────────────────── */

test('the rail is pinned under the top bar and fills the viewport', () => {
  for (const [name, src] of [['admin', SIDEBAR], ['student', STUDENT_SHELL]]) {
    assert.match(src, /chess-rail/, `${name} rail`);
    assert.match(src, /sticky top-\[var\(--app-nav-h,84px\)\]/, `${name} rail sticks to the bar`);
    assert.match(src, /h-\[calc\(100dvh_-_var\(--app-nav-h,84px\)_-_1\.5rem\)\]/, `${name} rail height`);
    assert.match(src, /chess-rail-scroll/, `${name} rail scrolls its list only`);
  }
  assert.match(HOOK, /--app-nav-h/,
    'the bar height is measured, not hard-coded');
  assert.match(CSS, /\.chess-rail-scroll \{[^}]*scrollbar-width:\s*thin;/,
    'the inner scrollbar is styled, not hidden');
});

/* ── 4. the move effects are louder ─────────────────────────────────────── */

test('the master bus boosts the level and still limits it', () => {
  assert.match(SOUND, /const MASTER_GAIN = 1\.5;/);
  assert.match(SOUND, /g\.gain\.value = MASTER_GAIN;/);
  assert.match(SOUND, /limiter\.threshold\.value = -1;/,
    'the limiter must still catch the aggregate overshoot');
  assert.match(SOUND, /limiter\.ratio\.value = 20;/);
});

test('the move cues are louder', () => {
  assert.match(SOUND, /move: 0\.60, capture: 0\.55, castle: 0\.50, promotion: 0\.42/);
  assert.match(SOUND, /check: 0\.46/);
  assert.match(SOUND, /victory: 0\.56/);
  assert.match(EFFECT_CFG, /gainScale: 2\b/,
    'the sigma effect cue is louder too');
});

test('the mute switch and the volume slider still work', () => {
  assert.match(SOUND, /export function setSoundEnabled\(v\)/);
  assert.match(SOUND, /export function setSoundVolume\(v\)/);
  assert.match(SOUND, /export const getSoundVolume = \(\) => volume;/);
  assert.match(SOUND, /const VOLUME_MAX = 2;/);
});
