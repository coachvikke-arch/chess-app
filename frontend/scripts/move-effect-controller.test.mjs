/* EffectController state machine.
 *
 * Run: node --test scripts/move-effect-controller.test.mjs
 *
 * Covers the Task-2 contract: idle -> running -> finished -> idle, cleanup()
 * as the only reset, stale runIds ignored, one timer set per run, and hidden
 * squares released at settle then cleared completely on cleanup.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { EffectController, EFFECT_STATE } from '../src/effects/moveEffect/controller.js';
import { T } from '../src/effects/moveEffect/config.js';

function controllerWithTimers() {
  let seq = 0;
  const timers = new Map();
  const api = {
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    tick(ms) {
      for (const [id, timer] of Array.from(timers)) {
        if (timer.ms <= ms) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    pending() { return timers.size; },
  };
  return { controller: new EffectController({ timers: api }), timers: api };
}

test('idle -> running -> finished -> idle, with cleanup as the only reset', () => {
  const { controller } = controllerWithTimers();
  assert.equal(controller.state, EFFECT_STATE.idle);

  controller.start(1, { type: 'brilliant', source: 'keyboard', moveIndex: 3 });
  assert.equal(controller.state, EFFECT_STATE.running);
  assert.equal(controller.runId, 1);
  assert.equal(controller.request.type, 'brilliant');

  assert.equal(controller.finish(1), true);
  assert.equal(controller.state, EFFECT_STATE.finished);
  assert.equal(controller.request.type, 'brilliant', 'finished keeps the badge/popup payload');

  controller.cleanup('position-changed');
  assert.equal(controller.state, EFFECT_STATE.idle);
  assert.equal(controller.runId, null);
  assert.equal(controller.request, null);
});

test('a stale runId can never finish the current run', () => {
  const { controller } = controllerWithTimers();
  controller.start(7, { type: 'checkmate' });
  assert.equal(controller.finish(6), false);
  assert.equal(controller.state, EFFECT_STATE.running);
  assert.equal(controller.finish(7), true);
  assert.equal(controller.finish(7), false, 'finishing twice is a no-op');
  controller.cleanup();
});

test('starting while running cancels and cleans the previous run first', () => {
  const { controller, timers } = controllerWithTimers();
  const reasons = [];
  controller.subscribe(({ reason }) => reasons.push(reason));

  controller.start(1, { type: 'brilliant', source: 'undo' });
  controller.start(2, { type: 'checkmate', source: 'redo' });

  assert.equal(controller.runId, 2);
  assert.equal(controller.state, EFFECT_STATE.running);
  assert.equal(timers.pending(), 2, 'only the new run owns timers');
  assert.deepEqual(reasons, ['subscribe', 'start', 'restart', 'start']);

  controller.cleanup('test-end');
});

test('hidden squares are released at settle and cleared on cleanup', () => {
  const { controller, timers } = controllerWithTimers();
  controller.start(1, { type: 'checkmate' });
  assert.equal(controller.hiddenSquares.size, 64, 'the overlay owns every piece while moving');

  timers.tick(T.settle);
  assert.equal(controller.hiddenSquares.size, 0, 'settle hands the real pieces back');
  assert.equal(controller.state, EFFECT_STATE.running, 'the badge phase is still running');

  timers.tick(T.end);
  assert.equal(controller.state, EFFECT_STATE.finished);

  controller.start(2, { type: 'brilliant' });
  assert.equal(controller.hiddenSquares.size, 64);
  controller.cleanup('position-changed');
  assert.equal(controller.hiddenSquares.size, 0);
  assert.equal(timers.pending(), 0, 'cleanup leaves no timers behind');
});

test('cleanup is idempotent and only emits when there was something to reset', () => {
  const { controller } = controllerWithTimers();
  let emits = 0;
  controller.subscribe(({ reason }) => { if (reason !== 'subscribe') emits += 1; });

  controller.cleanup('nothing');
  assert.equal(emits, 0);

  controller.start(1, { type: 'promotion' });
  controller.cleanup('position-changed');
  controller.cleanup('position-changed');
  assert.equal(emits, 2, 'start + one cleanup');
});
