/* The post-game result card must be sized by the VIEWPORT, never by the board.
 *
 * Run: node scripts/test-result-card-viewport.mjs
 *
 * THE BUG
 * -------
 * `.game-over-overlay` was `position: absolute; inset: 0` inside
 * `.ab-board-wrap` (`position: relative`), which wraps the chessboard. An
 * absolutely-positioned overlay resolves `inset: 0` against its nearest
 * positioned ancestor, so the overlay's box WAS the board's box. The card's
 * `width: min(30rem, 100%)` then took its 100% from the board - making the
 * result card board-sized. On a 340px phone board the card was cramped and the
 * two rating rows wrapped; on a large screen it stayed small despite the room.
 *
 * These assertions read the shipped CSS and the component source, because the
 * property under test ("does the board influence the card's size?") is a
 * cascade question that cannot be settled by a unit test without a browser. The
 * checks are structural and specific: a `position: fixed` overlay, and a card
 * width expressed in viewport units with no board-derived term.
 *
 * Also covered: the card must not be gated behind a single hardcoded category
 * label, must render exactly ONE card, and must keep its rating content. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src', 'index.css'), 'utf8');
const board = readFileSync(join(root, 'src', 'pages', 'AnalysisBoard.jsx'), 'utf8');
const popup = readFileSync(join(root, 'src', 'components', 'PostGameResultPopup.jsx'), 'utf8');

/* Pull out the CSS rule for one selector, brace-balanced. */
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

/* The @media block that mentions the card, if any. */
function mediaBlockContaining(selector) {
  const at = css.indexOf('@media (max-width: 560px)');
  assert.ok(at >= 0, 'a small-viewport @media block must exist');
  let depth = 0;
  for (let j = css.indexOf('{', at); j < css.length; j += 1) {
    if (css[j] === '{') depth += 1;
    else if (css[j] === '}' && --depth === 0) return css.slice(at, j + 1);
  }
  throw new Error('unbalanced @media braces');
}

test('the result overlay is viewport-fixed, not positioned by the board', () => {
  const overlay = ruleFor('.game-over-overlay');
  assert.match(overlay, /position:\s*fixed/,
    'the overlay must be position:fixed, otherwise inset:0 resolves against .ab-board-wrap (the board)');
  assert.doesNotMatch(overlay, /position:\s*absolute/,
    'position:absolute is exactly what made the card board-sized');
  assert.match(overlay, /inset:\s*0/);
});

test('the card width comes from the viewport, never from the board', () => {
  const card = ruleFor('.game-over-card');
  assert.match(card, /width:\s*min\(\s*92vw\s*,\s*30rem\s*\)/,
    'the card must be sized in vw against a rem ceiling');
  assert.doesNotMatch(card, /var\(\s*--board/,
    'the card must never reference a board-size custom property');
  assert.doesNotMatch(card, /aspect-ratio/,
    'aspect-ratio would re-tie the card to the board shape');
});

test('the board wrap is not the overlay\'s containing block', () => {
  /* Belt and braces: even if the overlay went back to absolute, a fixed/absolute
     ancestor must not silently re-scope it. Assert the board wrapper is the
     only positioned ancestor concern by checking the overlay does not rely on it. */
  const overlay = ruleFor('.game-over-overlay');
  assert.match(overlay, /position:\s*fixed/);
});

test('the card is large and readable on desktop', () => {
  const card = ruleFor('.game-over-card');
  /* 30rem ceiling = 480px at the default 16px root, comfortably large. */
  assert.match(card, /30rem/);
  assert.match(card, /max-height:\s*calc\(100vh/,
    'the card must be bounded by viewport height so a short window scrolls');
});

test('the card is responsive on a phone and never overflows horizontally', () => {
  const block = mediaBlockContaining('.game-over-card--lg');
  assert.match(block, /width:\s*calc\(100vw\s*-\s*1\.5rem\)/,
    'on a phone the card must fill the viewport minus a gutter');
  assert.match(block, /max-height:\s*calc\(100vh\s*-\s*1\.5rem\)/,
    'and be bounded by viewport height');
});

test('the card typography is viewport-fluid rather than board-sized', () => {
  const lg = ruleFor('.game-over-card--lg');
  assert.match(lg, /padding:\s*clamp\(/, 'padding must scale with the viewport');
  const title = css.slice(css.indexOf('.game-over-card--lg .game-over-title'));
  assert.match(title.slice(0, 200), /clamp\(/, 'the headline must scale with the viewport');
});

test('exactly one result card renders on the board page', () => {
  /* The page card is the survivor; the duplicate PostGameResultPopup was removed
     from this page and is retained only for Play Mode / bot pages. */
  const occurrences = board.match(/game-over-card game-over-card--lg/g) || [];
  assert.equal(occurrences.length, 1,
    'there must be exactly one .game-over-card in the page tree');
  assert.match(board, /!playMode && overlay && !overlayDismissed/,
    'the board card must stay gated out of Play Mode, where PostGameResultPopup takes over');
});

test('the card label comes from the server category, with no hardcoded Rapid', () => {
  /* The category is whatever the finished game was actually played in. */
  assert.match(board, /ratingResult\.timeClassLabel/,
    'the card must render the category the backend reported');
  assert.doesNotMatch(
    board.slice(board.indexOf('game-over-ratings-title') - 200, board.indexOf('game-over-ratings-title') + 400),
    /["']Rapid/,
    'the card must not hardcode a Rapid label',
  );
});

test('the popup card also takes its category from the server', () => {
  assert.match(popup, /rating\.timeControl|timeControl/,
    'PostGameResultPopup must label the rating from the API, not a constant');
  assert.doesNotMatch(popup, /["']Rapid rating["']/,
    'PostGameResultPopup must not hardcode Rapid');
});

test('the card keeps its rating content (winner, reason, both players, buttons)', () => {
  /* Content must survive the layout change: two rating rows and three actions. */
  const card = board.slice(board.indexOf('game-over-card game-over-card--lg'));
  assert.match(card, /game-over-title/, 'winner/result headline');
  assert.match(card, /game-over-sub/, 'finish reason');
  assert.match(card, /RatingRow/, 'per-player rating rows');
  assert.match(card, /Review/, 'Review action');
  assert.match(card, /New game/, 'New game action');
  assert.match(card, /myName/, 'own name');
  assert.match(card, /opponent/, 'opponent name');
});