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

test('GameViewerCard uses the full key set and tags keyboard effects', () => {
  const viewer = src('components/GameViewerCard.jsx');
  assert.match(viewer, /useReviewKeys\(\{/);
  assert.match(viewer, /prev: \(\) => go\(moveIndex - 1, true, 'keyboard'\)/);
  assert.match(viewer, /next: \(\) => go\(moveIndex \+ 1, true, 'keyboard'\)/);
  assert.match(viewer, /first: \(\) => go\(0, true, 'keyboard'\)/);
  assert.match(viewer, /last: \(\) => go\(parsed\.moves\.length, true, 'keyboard'\)/);
  assert.match(viewer, /flip: \(\) => setOrientation/);
  assert.match(viewer, /playEffectForMove\(target, source,/);
});

test('GameReview disables its page listener while the viewer card is open', () => {
  const review = src('pages/GameReview.jsx');
  assert.match(review, /useReviewKeys\(\{/);
  assert.match(review, /go\(activeIdx - 1, 'keyboard'\)/);
  assert.match(review, /go\(activeIdx \+ 1, 'keyboard'\)/);
  assert.match(review, /\}, \{ enabled: !sigmaGame \}\);/);
  assert.match(review, /playEffectForMove\(target, source,/);
  assert.match(review, /data-gr-ply=\{cell\.ply \+ 1\}/);
});
