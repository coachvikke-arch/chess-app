/* The post-game result card must be sized by the VIEWPORT, never by the board.
 *
 * Run: node --test scripts/result-card-viewport.test.mjs
 *
 * WHY THIS EXISTS
 * ---------------
 * The page's first result overlay was `position: absolute; inset: 0` inside
 * `.ab-board-wrap` (`position: relative`, the chessboard's wrapper), so its box
 * WAS the board's box and a `width: min(30rem, 100%)` card ended up
 * board-sized — cramped on a phone, tiny on desktop. The one surviving card
 * (`PostGameResultPopup`) must therefore stay viewport-fixed with a viewport
 * ceiling, must stay SMALL and landscape, and must never reference a
 * board-size variable.
 *
 * These assertions read the shipped CSS and component source because the
 * property under test ("does the board influence the card's size?") is a
 * cascade question that cannot be settled without a browser.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src', 'index.css'), 'utf8');
const board = readFileSync(join(root, 'src', 'pages', 'AnalysisBoard.jsx'), 'utf8');
const popup = readFileSync(join(root, 'src', 'components', 'PostGameResultPopup.jsx'), 'utf8');

/* Pull a CSS rule out by selector, brace-balanced. The rule must start a line,
   so `.pgr-card` never matches `.pgr-card.is-win`. */
function ruleFor(selector) {
  const i = css.indexOf(`\n${selector} {`);
  assert.ok(i >= 0, `CSS rule for ${selector} must exist`);
  let depth = 0;
  for (let j = css.indexOf('{', i); j < css.length; j += 1) {
    if (css[j] === '{') depth += 1;
    else if (css[j] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(i, j + 1);
    }
  }
  throw new Error(`unbalanced braces for ${selector}`);
}

/* The @media block the popup ships in — not the first one in the stylesheet. */
function mediaBlock() {
  const at = css.indexOf('@media (max-width: 640px)', css.indexOf('.pgr-actions .app-btn'));
  assert.ok(at >= 0, 'the popup\'s small-viewport @media block must exist');
  let depth = 0;
  for (let j = css.indexOf('{', at); j < css.length; j += 1) {
    if (css[j] === '{') depth += 1;
    else if (css[j] === '}' && --depth === 0) return css.slice(at, j + 1);
  }
  throw new Error('unbalanced @media braces');
}

test('the result overlay is viewport-fixed, not positioned by the board', () => {
  const overlay = ruleFor('.pgr-overlay');
  assert.match(overlay, /position:\s*fixed/,
    'fixed is what keeps inset:0 resolving against the viewport');
  assert.doesNotMatch(overlay, /position:\s*absolute/,
    'absolute is exactly what made the old card board-sized');
  assert.match(overlay, /inset:\s*0/);
  assert.match(overlay, /z-index:\s*\d+/, 'the card must sit above the board chrome');
  assert.match(overlay, /place-items:\s*center/, 'centred, so it never hugs one edge');
  assert.match(overlay, /padding:\s*12px;/, 'a gutter keeps the card off the screen edges');
});

test('the card is bounded by the viewport, never by a board-size variable', () => {
  const card = ruleFor('.pgr-card');
  assert.match(card, /width:\s*100%/, 'fill the overlay up to the ceiling');
  assert.match(card, /max-width:\s*min\(600px, calc\(100vw - 24px\)\)/,
    '520-600px on desktop, one 12px gutter each side on a phone');
  assert.match(card, /max-height:\s*calc\(100dvh - 24px\)/,
    'a short window must bound the card, not push it past the screen');
  assert.match(card, /overflow-y:\s*auto/, 'and the card scrolls its own body');
  assert.doesNotMatch(card, /var\(\s*--board/, 'no board-derived width');
  assert.doesNotMatch(card, /aspect-ratio/, 'no board-shaped constraint');
  assert.doesNotMatch(card, /min\(30rem,\s*100%\)/, 'the old board-relative width is gone');
});

test('the card is landscape: two sections on one row, actions below', () => {
  const card = ruleFor('.pgr-card');
  assert.match(card, /display:\s*grid;/);
  assert.match(card, /grid-template-columns:\s*minmax\(0, 0\.85fr\) minmax\(0, 1\.15fr\)/);
  assert.match(card, /"summary players"\s*\n\s*"actions actions"/,
    'result and players share the top row — that is what keeps it horizontal');
  assert.match(card, /align-items:\s*center;/);
});

test('the card stays compact: no sticky footer, no tall blocks', () => {
  const actions = ruleFor('.pgr-actions');
  assert.match(actions, /display:\s*flex;/);
  assert.match(actions, /flex-wrap:\s*wrap;/, 'buttons wrap instead of clipping');
  assert.match(actions, /justify-content:\s*flex-end;/);
  assert.doesNotMatch(actions, /position:\s*sticky;/);
  assert.match(css, /\.pgr-player-avatar \{[^}]*width: 30px;/);
});

test('the card stacks only on a phone, and never overflows horizontally', () => {
  const block = mediaBlock();
  const card = block.slice(block.indexOf('.pgr-card {'));
  assert.match(card.slice(0, 260), /grid-template-columns: minmax\(0, 1fr\);/,
    'one column: the sections stack only where two would be unreadable');
  assert.match(card.slice(0, 260), /"summary"\s*\n\s*"players"\s*\n\s*"actions"/);
  assert.match(block, /\.pgr-actions \.app-btn \{ flex: 1 1 110px; \}/,
    'the buttons wrap into equal, tappable rows');
  assert.match(css, /\.pgr-card,\s*\n\.pgr-card \* \{\s*\n\s*box-sizing: border-box;/,
    'padding and borders are inside the width, so nothing can overflow');
});

test('exactly one completion card is mounted per surface', () => {
  const mounts = (board.match(/<PostGameResultPopup/g) || []).length;
  assert.equal(mounts, 1, 'the popup is written once and reused by both surfaces');
  assert.match(board, /\{!playMode && resultCard\}/, 'the page board shows it');
  assert.match(board, /<PostGameResultPopup[\s\S]{0,80}open=\{!resultDismiss && !resultRevealPending\}/,
    'and it only opens once the mate animation is done');
  assert.doesNotMatch(board, /className="[^"]*game-over-card/, 'the old page-only card is gone');
});

test('the category pill is gone with the rest of the statistics', () => {
  assert.ok(!/timeClassLabel/.test(popup), 'the card no longer prints a time class');
  assert.ok(!/pgr-pill/.test(css));
  assert.ok(!/>\s*Rapid\s*</.test(popup), 'and never hardcoded one');
});

test('the card keeps only result, reason, both players and actions', () => {
  for (const needle of ['pgr-title', 'pgr-reason', 'pgr-players', 'PlayerRow', 'Review game', 'secondary']) {
    assert.ok(popup.includes(needle), `the card must still render ${needle}`);
  }
  for (const gone of ['pgr-details', 'AnalysisBlock', 'pgr-analysis', 'pgr-close']) {
    assert.ok(!popup.includes(gone), `${gone} must not be rendered any more`);
  }
  assert.match(popup, /\{headline\}/);
  assert.match(popup, /\{displayReason\(reason\)\}/);
});
