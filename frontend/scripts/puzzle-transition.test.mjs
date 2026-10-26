/* createTransitionGuard contract tests (fake-timer driven). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTransitionGuard } from '../src/lib/puzzleTransition.js';

function makeFakeTimers() {
  let id = 0;
  const pending = new Map();
  const clock = {
    setTimer(fn, ms) {
      const t = { id: ++id, fn, ms };
      pending.set(t.id, t);
      return t.id;
    },
    clearTimer(timerId) {
      const t = pending.get(timerId);
      if (t) t.cleared = true;
    },
    fire(timerId) {
      const t = pending.get(timerId);
      if (!t || t.cleared) return;
      pending.delete(timerId);
      t.fn();
    },
    fireEarliest() {
      let best = null;
      for (const t of pending.values()) if (!t.cleared && (!best || t.id < best.id)) best = t;
      if (best) this.fire(best.id);
    },
    pendingCount() {
      return [...pending.values()].filter((t) => !t.cleared).length;
    },
    pending,
  };
  return clock;
}

test('fires exactly once after delayMs', () => {
  const clock = makeFakeTimers();
  const guard = createTransitionGuard(2000, clock);
  let fired = 0;
  assert.equal(guard.schedule('p1', () => fired++), true);
  assert.equal(fired, 0, 'must not fire before the delay elapses');
  clock.fire(pendingIdOf(clock));
  assert.equal(fired, 1);
});

test('a duplicate schedule for the same puzzle is rejected (single flight)', () => {
  const clock = makeFakeTimers();
  const guard = createTransitionGuard(2000, clock);
  let fired = 0;
  assert.equal(guard.schedule('p1', () => fired++), true);
  assert.equal(guard.schedule('p1', () => fired++), false, 'duplicate must not schedule');
  clock.fire(pendingIdOf(clock));
  clock.fireEarliest();
  assert.equal(fired, 1, 'only one transition despite two solve events');
});

test('scheduling a new puzzle cancels the pending transition of the old one', () => {
  const clock = makeFakeTimers();
  const guard = createTransitionGuard(2000, clock);
  const calls = [];
  guard.schedule('p1', () => calls.push('p1'));
  guard.schedule('p2', () => calls.push('p2'));
  clock.fire(pendingIdOf(clock));
  assert.deepEqual(calls, ['p2']);
  assert.equal(clock.pendingCount(), 0);
});

test('cancel() stops a pending transition and frees the key for reuse', () => {
  const clock = makeFakeTimers();
  const guard = createTransitionGuard(2000, clock);
  const calls = [];
  guard.schedule('p1', () => calls.push('p1'));
  guard.cancel();
  assert.equal(clock.pendingCount(), 0);
  clock.fireEarliest();
  assert.deepEqual(calls, []);
  // after cancel the same key can be scheduled again
  assert.equal(guard.schedule('p1', () => calls.push('p1')), true);
});

test('after firing, the same key can be scheduled again', () => {
  const clock = makeFakeTimers();
  const guard = createTransitionGuard(2000, clock);
  const calls = [];
  guard.schedule('p1', () => calls.push('p1'));
  clock.fire(pendingIdOf(clock));
  assert.equal(guard.schedule('p1', () => calls.push('p1:v2')), true);
  clock.fire(pendingIdOf(clock));
  assert.deepEqual(calls, ['p1', 'p1:v2']);
});

function pendingIdOf(clock) {
  const ids = [...clock.pending.entries()].filter(([, t]) => !t.cleared).map(([id]) => id);
  assert.equal(ids.length, 1, 'expected exactly one pending timer');
  return ids[0];
}