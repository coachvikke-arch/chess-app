/* ──────────────────────────────────────────────────────────────────────────
 * Brilliant, checkmate and promotion: the ANIMATION plays, the BADGE and the
 * POPUP do not - except the "Checkmate" bubble, which is how a finished game
 * announces itself on the board.
 *
 * The rule lives in ONE module (utils/moveFeedback.js) so every surface asks
 * the same question. These are source assertions on purpose: the bug is a
 * property of WHICH decoration is drawn, and of it being drawn in more than
 * one place.
 *
 * What must SURVIVE: the dim, the flying piece, the ghost pieces, the ripple,
 * the square flashes, the highlights, the wobble, the promotion morph and the
 * king pulse. What must GO: the seal badge, the "BRILLIANT" pill, the "!"
 * coin on the square, the "PROMOTED" badge and the badge glyph next to a move
 * in a list or a score sheet. The checkmate bubble is the exception and stays.
 *
 * Run: node --test scripts/quiet-move-feedback.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isQuietMoveEvent, ANIMATION_ONLY_EVENTS } from '../src/utils/moveFeedback.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const FLAG = read('src/utils/moveFeedback.js');
const EFFECT = read('src/effects/moveEffect/MoveEffect.jsx');
const PLAY = read('src/effects/moveEffect/playForMove.js');
const BADGE = read('src/components/MoveBadge.jsx');
const REVIEW = read('src/pages/GameReview.jsx');
const CARD = read('src/components/GameViewerCard.jsx');
const REPLAY = read('src/components/GameReplay.tsx');
const PROMO = read('src/components/board/PromotionFX.jsx');
const PUZZLE = read('src/components/puzzle/MoveFeedbackOverlay.jsx');

/* ── the flag itself ─────────────────────────────────────────────────────── */

test('the flag names exactly the three animation-only events', () => {
  assert.deepEqual([...ANIMATION_ONLY_EVENTS].sort(), ['brilliant', 'checkmate', 'promotion']);
  assert.equal(isQuietMoveEvent('brilliant'), true);
  assert.equal(isQuietMoveEvent('checkmate'), true);
  assert.equal(isQuietMoveEvent('promotion'), true);
  assert.equal(isQuietMoveEvent('sigma'), true, 'sigma is the internal spelling of brilliant');
});

test('every other verdict is not quiet', () => {
  for (const v of ['best', 'great', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder']) {
    assert.equal(isQuietMoveEvent(v), false, `${v} must keep its badge`);
  }
  assert.equal(isQuietMoveEvent(''), false, 'an unknown verdict is not quiet');
});

test('the brilliant BADGE is not governed by this flag', () => {
  /* The flag silences the effect OVERLAY's own chrome (the seal, the pill, the
     bubble). The "!!" coin is the BOARD's classification badge and it is shown
     for every verdict, brilliant included - otherwise the board and the move
     list would lose the brilliant marker the user asked to keep. */
  assert.doesNotMatch(read('src/components/MoveBadge.jsx'), /isQuietMoveEvent|showsMoveBadge/);
  assert.doesNotMatch(read('src/pages/GameReview.jsx'), /showsMoveBadge/);
  assert.doesNotMatch(read('src/components/GameViewerCard.jsx'), /showsMoveBadge/);
});

/* ── the effect overlay: animation yes, chrome no ────────────────────────── */

test('the effect overlay hides its badge, pill and sword for quiet events', () => {
  assert.match(EFFECT, /const quiet = isQuietMoveEvent\(effect\?\.type\)/);
  assert.match(EFFECT, /\{!quiet && \(\s*<div\s*\n\s*ref=\{sealRef\}/,
    'the seal badge must be suppressed');
  assert.match(EFFECT, /\{!quiet && \(\s*<div\s*\n\s*ref=\{pillRef\}/,
    'the label pill must be suppressed');
  assert.match(EFFECT, /\{!quiet && cfg\.sacrificeBadge && effect\?\.sacrifice && \(/,
    'the sacrifice badge must be suppressed');
  assert.doesNotMatch(EFFECT, /\{!quiet && showCheckmatePopup/,
    'the checkmate bubble is the ONE exception: a mate must be announced');
  assert.match(EFFECT, /\{showCheckmatePopup && effect\?\.type === 'checkmate' && \(/,
    'the checkmate bubble must be drawn');
});

test('the animation layers are all still there', () => {
  for (const layer of ['me-dim', 'me-piece', 'me-fly', 'me-ripple', 'me-flash', 'me-hl']) {
    assert.ok(EFFECT.includes(layer), `${layer} must survive`);
  }
  assert.match(EFFECT, /cfg\.morph/, 'the promotion morph must survive');
  assert.match(EFFECT, /strongKingWobble/, 'the king wobble must survive');
});

/* ── the board badge ─────────────────────────────────────────────────────── */

test('the board badge is shown for a brilliant move again', () => {
  assert.doesNotMatch(BADGE, /showsMoveBadge|isQuietMoveEvent/,
    'the "!!" coin must be back on the square');
  assert.match(BADGE, /<RankIcon verdict=\{shown\} size="100%"/);
});

test('the badge is drawn ABOVE the effect overlay, so it shows with the animation', () => {
  /* The overlay dims the whole board while it runs. With the badge under it
     (z-40 vs z-45) the "!!" only became visible once the effect had cleaned
     up — the badge appeared AFTER the animation instead of with it. */
  const css = read('src/index.css');
  const badge = css.match(/\.move-badge \{[^}]*\}/);
  assert.ok(badge, '.move-badge has no rule');
  const z = Number((badge[0].match(/z-index:\s*(\d+)/) || [])[1]);
  const overlay = Number((read('src/effects/moveEffect/moveEffect.css')
    .match(/\.me-root \{[^}]*z-index:\s*(\d+)/s) || [])[1]);
  assert.ok(z > overlay,
    `the badge (z-${z}) must be above the effect overlay (z-${overlay})`);
});

/* ── the lists and the score sheets ──────────────────────────────────────── */

test('the move list shows the classification badge again', () => {
  /* The "!!" badge is the app's own classification badge and is back for every
     verdict, brilliant included (see the flag test above). */
  assert.match(REVIEW, /<RankBadge verdict=\{v\.verdict\} size=\{17\}/);
  assert.match(REVIEW, /<RankBadge verdict=\{row\.verdict\} size=\{17\}/);
});

test('the score sheets show the badge glyph again', () => {
  assert.match(CARD, /<span className="cp-score-badge-glyph">\{meta\.glyph\}<\/span>/);
  assert.match(REPLAY, /const notation = verdict\?\.verdict \? \(reviewMetaFor\(verdict\.verdict\)\?\.glyph \?\? ''\) : '';/);
  assert.match(REPLAY, /gm-eval-badge is-\$\{currentAnalysis\.verdict\}/);
});

/* ── the promotion badge and the puzzle bubble ───────────────────────────── */

test('the promotion badge is suppressed, its animation is not', () => {
  assert.match(PROMO, /const quiet = isQuietMoveEvent\('promotion'\)/);
  assert.match(PROMO, /\{!quiet && \(\s*<span\s*\n\s*className="pfx-badge"/);
  for (const layer of ['pfx-ripple', 'pfx-glow', 'pfx-king', 'pfx-arrow', 'pfx-hl']) {
    assert.ok(PROMO.includes(layer), `${layer} must survive`);
  }
});

test('the puzzle bubble no longer says Checkmate! or Promotion!', () => {
  /* The mate bubble is behind the shared flag, and the flag says a mate is a
     quiet event — so the bubble can never be produced. A puzzle finished by
     mate falls through to the "Puzzle Solved!" line instead. */
  assert.match(PUZZLE, /if \(checkmate && !isQuietMoveEvent\('checkmate'\)\)/,
    'the mate bubble must be behind the shared flag');
  assert.doesNotMatch(PUZZLE, /'Promotion!'/,
    'the promotion label is gone');
  assert.match(PUZZLE, /if \(move\.promotion && isQuietMoveEvent\('promotion'\)\) return null;/,
    'the promotion sub-label must be behind the shared flag');
  /* The other puzzle feedback is untouched. */
  assert.match(PUZZLE, /text: 'Puzzle Solved!'/);
  assert.match(PUZZLE, /text: 'Check!'/);
});

/* ── the event is still detected from the move data ──────────────────────── */

test('the effect is chosen from the move data, not from a badge', () => {
  assert.match(PLAY, /const isPromotion = Boolean\(move\.promotion\) \|\| san\.includes\('='\)/);
  assert.match(PLAY, /const isCheckmate = isMate \|\| san\.endsWith\('#'\)/);
  assert.match(PLAY, /isSigmaVerdict\(verdict\) \? 'brilliant'/);
});
