/* ──────────────────────────────────────────────────────────────────────────
 * Stepping through moves must never move the PAGE.
 *
 * The regression: the review surfaces kept the active move in view with
 * `activeEl.scrollIntoView({ block: 'nearest' })`. scrollIntoView walks the
 * WHOLE ancestor chain and scrolls every scrollable box it finds — including
 * the document — so every move change dragged the window (on a phone, where
 * the score sheet sits below the fold, it dragged the page down to it).
 *
 * The rule now: the move list is the only thing that may scroll, and only when
 * the active move is outside it. These are static source assertions on purpose:
 * the bug is a property of WHICH element gets scrolled, which is exactly what
 * regressed.
 *
 * Run: node --test scripts/review-scroll-containment.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { keepActiveMoveVisible, followActiveMove, ACTIVE_MOVE_PADDING } from '../src/utils/scrollActiveMove.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const HELPER = read('src/utils/scrollActiveMove.js');
const REVIEW = read('src/pages/GameReview.jsx');
const CARD = read('src/components/GameViewerCard.jsx');
const REPLAY = read('src/components/GameReplay.tsx');
const KEYS = read('src/hooks/useReviewKeys.js');
const ARROW_KEYS = read('src/hooks/useArrowKeys.js');
const CSS = read('src/index.css');

/* Comments explain WHY the old call was wrong, so the negative assertions have
   to look at the code, not at the prose around it. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ── nothing scrolls the document ────────────────────────────────────────── */

test('no review surface calls scrollIntoView', () => {
  for (const [name, src] of [['GameReview', REVIEW], ['GameViewerCard', CARD], ['GameReplay', REPLAY]]) {
    assert.doesNotMatch(code(src), /\.scrollIntoView\s*\(/,
      `${name} must not use scrollIntoView: it scrolls the document as well`);
  }
});

test('no review surface scrolls the window', () => {
  for (const [name, src] of [['GameReview', REVIEW], ['GameViewerCard', CARD], ['GameReplay', REPLAY]]) {
    assert.doesNotMatch(code(src), /window\.scrollTo/,
      `${name} must not scroll the window when the move changes`);
  }
});

/* ── the helper moves the LIST and nothing else ──────────────────────────── */

test('the helper only writes the container scrollTop', () => {
  assert.match(HELPER, /export function keepActiveMoveVisible/);
  assert.match(HELPER, /container\.scrollTop\s*=/,
    'the list scrollTop is the one thing the helper may change');
  assert.doesNotMatch(code(HELPER), /scrollIntoView/);
  assert.doesNotMatch(code(HELPER), /window\.scroll/);
  assert.doesNotMatch(code(HELPER), /\.scrollTo\(/,
    'no smooth or programmatic scroll: only a scrollTop assignment');
});

test('the helper keeps the move inside the edge with a small padding', () => {
  assert.match(HELPER, /ACTIVE_MOVE_PADDING = 8/);
  assert.match(HELPER, /moveBox\.top < top \+ padding/);
  assert.match(HELPER, /moveBox\.bottom > bottom - padding/);
});

test('the helper is exported for every surface to share', () => {
  assert.match(HELPER, /export function followActiveMove/);
  assert.match(HELPER, /container\.querySelector\(selector\)/);
});

/* ── every surface uses it ───────────────────────────────────────────────── */

test('the review page follows the active move inside its move list', () => {
  assert.match(REVIEW, /import \{ followActiveMove \} from '\.\.\/utils\/scrollActiveMove'/);
  assert.match(REVIEW, /followActiveMove\(movelistRef\.current, '\.gr-mv\.active'\)/);
  /* The list must be re-followed when the analysis lands, not only when the
     index changes: the rows are rendered from the verdicts. */
  assert.match(REVIEW, /\}, \[activeIdx, mode, verdicts\]\)/);
});

test('the game-viewer card follows the active move inside its score sheet', () => {
  assert.match(CARD, /import \{ followActiveMove \} from '\.\.\/utils\/scrollActiveMove'/);
  assert.match(CARD, /followActiveMove\(scoreRef\.current, '\.cp-score-cell\.is-active'\)/);
});

test('the GM replay (auto-play) uses the same helper', () => {
  assert.match(REPLAY, /import \{ keepActiveMoveVisible \} from '\.\.\/utils\/scrollActiveMove'/);
  assert.match(REPLAY, /keepActiveMoveVisible\(moveListRef\.current, activeTokenRef\.current\)/);
});

/* ── the lists are the things that scroll ────────────────────────────────── */

test('each move list is a bounded, scrollable box', () => {
  for (const cls of ['.gr-movelist', '.cp-score', '.gm-score']) {
    const block = CSS.match(new RegExp(`\\${cls} \\{[^}]*\\}`));
    assert.ok(block, `${cls} has no rule`);
    assert.match(block[0], /max-height:/, `${cls} needs a max-height`);
    assert.match(block[0], /overflow-y:\s*auto/, `${cls} must be the scroll container`);
  }
});

/* ── the keyboard cannot scroll the page either ─────────────────────────── */

test('the review keys prevent the default scroll', () => {
  assert.match(KEYS, /e\.preventDefault\(\)/,
    'arrow keys must be prevented, or the page scrolls as well as stepping');
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    assert.ok(KEYS.includes(key), `${key} is not handled by the review keys`);
  }
});

test('the replay arrow keys prevent the default scroll', () => {
  assert.match(ARROW_KEYS, /e\.preventDefault\(\)/);
});

/* ── the helper behaves ────────────────────────────────────────────────────
   A tiny stand-in for the move list: a viewport-sized box with a scrollTop,
   and one move somewhere inside it. The only thing that may change is the
   list's scrollTop — there is no window in this fake, which is the point: the
   helper has no way to reach the page.

   The helper clips the list's band to the viewport, so a viewport height has to
   exist for the tests to mean anything. */
globalThis.window = { innerHeight: 900 };

function fakeList({ top = 100, height = 300, scrollTop = 0, scrollHeight = 2000 } = {}) {
  return {
    scrollTop,
    scrollHeight,
    getBoundingClientRect: () => ({ top, bottom: top + height, height }),
  };
}

function fakeMove(list, offsetTop, offsetHeight = 24) {
  return {
    getBoundingClientRect: () => {
      const t = list.getBoundingClientRect().top + offsetTop - list.scrollTop;
      return { top: t, bottom: t + offsetHeight, height: offsetHeight };
    },
  };
}

test('a move that is already visible leaves the list alone', () => {
  const list = fakeList({ scrollTop: 200 });
  const move = fakeMove(list, 400); /* 400 - 200 = 200px into the visible box */
  const before = list.scrollTop;
  assert.equal(keepActiveMoveVisible(list, move), false);
  assert.equal(list.scrollTop, before, 'the list must not move for a visible move');
});

test('a move below the list is scrolled up to the bottom edge', () => {
  const list = fakeList({ top: 100, height: 300, scrollTop: 0 });
  const move = fakeMove(list, 900); /* 900px down inside a 300px box */
  assert.equal(keepActiveMoveVisible(list, move), true);
  /* The move's bottom must end up `padding` above the box's bottom. */
  const box = list.getBoundingClientRect();
  const m = move.getBoundingClientRect();
  assert.ok(Math.abs((box.bottom - m.bottom) - ACTIVE_MOVE_PADDING) <= 1,
    `expected ${ACTIVE_MOVE_PADDING}px of padding, got ${box.bottom - m.bottom}`);
  assert.ok(list.scrollTop > 0, 'the list must have scrolled');
});

test('a move above the list is scrolled down to the top edge', () => {
  const list = fakeList({ top: 100, height: 300, scrollTop: 500 });
  const move = fakeMove(list, 100); /* above the current viewport of the list */
  assert.equal(keepActiveMoveVisible(list, move), true);
  const box = list.getBoundingClientRect();
  const m = move.getBoundingClientRect();
  assert.ok(Math.abs((m.top - box.top) - ACTIVE_MOVE_PADDING) <= 1,
    `expected ${ACTIVE_MOVE_PADDING}px of padding, got ${m.top - box.top}`);
});

test('a list that is off screen is never scrolled', () => {
  const list = fakeList({ top: 5000, height: 300, scrollTop: 0 });
  const move = fakeMove(list, 900);
  assert.equal(keepActiveMoveVisible(list, move), false, 'there is nothing to reveal');
  assert.equal(list.scrollTop, 0);
});

test('followActiveMove finds the active move and nothing else moves', () => {
  const list = fakeList({ top: 100, height: 300, scrollTop: 0 });
  list.querySelector = (selector) => (selector === '.x.active' ? fakeMove(list, 900) : null);
  assert.equal(followActiveMove(list, '.x.active'), true);
  assert.ok(list.scrollTop > 0);
  assert.equal(followActiveMove(list, '.missing'), false);
});
