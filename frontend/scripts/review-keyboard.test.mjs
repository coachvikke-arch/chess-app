/* Review keyboard navigation.
 *
 * Run: node --test scripts/review-keyboard.test.mjs
 *
 * The pure handler is tested directly; the two review surfaces are checked for
 * the wiring (one global listener, keyboard source, page hook disabled while the
 * full viewer card is open).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleReviewKey } from '../src/hooks/useReviewKeys.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(here, '..', 'src', p), 'utf8');

function keyEvent(key, overrides = {}) {
  return {
    key,
    defaultPrevented: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    target: { tagName: 'BODY' },
    prevented: false,
    preventDefault() { this.prevented = true; },
    ...overrides,
  };
}

function handlers() {
  const calls = [];
  return {
    calls,
    handlers: {
      prev: () => calls.push('prev'),
      next: () => calls.push('next'),
      first: () => calls.push('first'),
      last: () => calls.push('last'),
      flip: () => calls.push('flip'),
    },
  };
}

test('arrow and jump keys map to navigation', () => {
  const { calls, handlers: h } = handlers();
  for (const [key, expected] of [
    ['ArrowLeft', 'prev'],
    ['ArrowRight', 'next'],
    ['ArrowUp', 'first'],
    ['ArrowDown', 'last'],
    ['Home', 'first'],
    ['End', 'last'],
    ['f', 'flip'],
    ['F', 'flip'],
  ]) {
    const e = keyEvent(key);
    assert.equal(handleReviewKey(e, h), true, `${key} handled`);
    assert.equal(e.prevented, true, `${key} prevents page scroll`);
    assert.equal(calls.at(-1), expected);
  }
});

test('a move tree turns the vertical arrows into sibling switching', () => {
  /* Both sides of a branch are the moves played from the same position. A
     surface with a tree supplies these; a flat surface keeps Up/Down as
     first/last (the test above). */
  const calls = [];
  const h = {
    prev: () => calls.push('prev'),
    next: () => calls.push('next'),
    siblingPrev: () => calls.push('siblingPrev'),
    siblingNext: () => calls.push('siblingNext'),
    first: () => calls.push('first'),
    last: () => calls.push('last'),
  };
  assert.equal(handleReviewKey(keyEvent('ArrowUp'), h), true);
  assert.equal(handleReviewKey(keyEvent('ArrowDown'), h), true);
  assert.deepEqual(calls, ['siblingPrev', 'siblingNext']);
});

test('auto-repeat keeps stepping smoothly', () => {
  const { calls, handlers: h } = handlers();
  const e = keyEvent('ArrowRight', { repeat: true });
  assert.equal(handleReviewKey(e, h), true);
  assert.deepEqual(calls, ['next']);
});

test('typing targets and modifier chords are ignored', () => {
  const { calls, handlers: h } = handlers();
  for (const target of [
    { tagName: 'INPUT' },
    { tagName: 'TEXTAREA' },
    { tagName: 'SELECT' },
    { tagName: 'DIV', isContentEditable: true },
  ]) {
    assert.equal(handleReviewKey(keyEvent('ArrowLeft', { target }), h), false);
  }
  assert.equal(handleReviewKey(keyEvent('ArrowLeft', { ctrlKey: true }), h), false);
  assert.equal(handleReviewKey(keyEvent('ArrowLeft', { metaKey: true }), h), false);
  assert.equal(handleReviewKey(keyEvent('ArrowLeft', { altKey: true }), h), false);
  assert.deepEqual(calls, []);
});

test('unrelated keys and already-handled events are left alone', () => {
  const { calls, handlers: h } = handlers();
  const space = keyEvent(' ');
  assert.equal(handleReviewKey(space, h), false);
  assert.equal(space.prevented, false);

  const handled = keyEvent('ArrowLeft', { defaultPrevented: true });
  assert.equal(handleReviewKey(handled, h), false);
  assert.deepEqual(calls, []);
});

test('GameViewerCard drives the tree and tags keyboard effects', () => {
  const viewer = src('components/GameViewerCard.jsx');
  assert.match(viewer, /useReviewKeys\(\{/);
  /* Left/Right walk the CURRENT line, Up/Down switch between the moves played
     from the same position. The tree commits synchronously, so a held key
     accumulates instead of queueing one replay per press. */
  assert.match(viewer, /prev: \(\) => tree\.goBack\('keyboard'\)/);
  assert.match(viewer, /next: \(\) => tree\.goForward\('keyboard'\)/);
  assert.match(viewer, /siblingPrev: \(\) => tree\.goSibling\(-1, 'keyboard'\)/);
  assert.match(viewer, /siblingNext: \(\) => tree\.goSibling\(1, 'keyboard'\)/);
  assert.match(viewer, /first: \(\) => tree\.goToStart\('keyboard'\)/);
  assert.match(viewer, /last: \(\) => tree\.goToEnd\('keyboard'\)/);
  assert.match(viewer, /flip: \(\) => setOrientation/);
  assert.match(viewer, /playEffectForMove\(node\.ply, meta\.source/,
    'the effect is tagged with the navigation source');
});

test('GameReview drives the shared tree and tags keyboard effects', () => {
  const review = src('pages/GameReview.jsx');
  assert.match(review, /useReviewKeys\(\{/);
  /* Left/Right walk the CURRENT line, Up/Down switch between the moves played
     from the same position — the same wiring the shared card uses. */
  assert.match(review, /prev: \(\) => tree\.goBack\('keyboard'\)/);
  assert.match(review, /next: \(\) => tree\.goForward\('keyboard'\)/);
  assert.match(review, /siblingPrev: \(\) => tree\.goSibling\(-1, 'keyboard'\)/);
  assert.match(review, /siblingNext: \(\) => tree\.goSibling\(1, 'keyboard'\)/);
  assert.match(review, /first: \(\) => tree\.goToStart\('keyboard'\)/);
  assert.match(review, /last: \(\) => tree\.goToEnd\('keyboard'\)/);
  assert.match(review, /flip: \(\) => setOrientation/);
  assert.match(review, /\}, \{ enabled: !sigmaGame \}\);/);
  /* The effect is played for the node the tree landed on, tagged with the
     source that navigated (keyboard, score sheet, board, nav button). */
  assert.match(review, /playEffectForMove\(node\.ply, meta\.source/);
  /* One cursor for the whole page: the pointer is the ply on screen. */
  assert.match(review, /const activeIdx = tree\.currentPly;/);
  assert.match(review, /const activeLen = tree\.lineEndPly;/);
  /* And the shared list, not a second private grid. */
  assert.match(review, /<VariationMoveList[\s\S]{0,200}headless/);
  assert.doesNotMatch(review, /scoreRows/);
  assert.doesNotMatch(review, /data-gr-ply=/);
});
