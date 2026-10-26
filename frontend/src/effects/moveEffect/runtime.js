/* ── MoveEffect runtime adapter ──────────────────────────────────────────────
 *
 * The authoritative lifecycle lives in controller.js (EffectController):
 *
 *   playMoveEffect()  -> beginMoveEffectRun()  -> controller.start()
 *   overlay onDone    -> endMoveEffectRun()    -> controller.finish()
 *   clearMoveEffects()-> clearMoveEffectRun()  -> controller.cleanup()
 *
 * This file keeps the public names every board/overlay already imports, so the
 * old ad-hoc run state (an `active` variable plus a watchdog) is gone. The
 * watchdog is no longer needed: cleanup() owns every timer and the controller
 * clears them when the overlay unmounts.
 */

import { EFFECT_STATE, effectController } from './controller.js';

let lastRequest = null;

function log(event, details = {}) {
  try {
    console.debug('[effect]', event, details);
  } catch { /* logging must never break the effect */ }
}

export function beginMoveEffectRun(request) {
  if (!request) return null;
  const run = effectController.start(request.id, request);
  lastRequest = run;
  return run;
}

export function endMoveEffectRun(request, reason = 'end') {
  if (request && request.id != null && effectController.request
    && effectController.request.id !== request.id) {
    log('stale-end-ignored', {
      activeRunId: effectController.request.id,
      staleRunId: request.id,
      reason,
    });
    return false;
  }
  return effectController.finish(request ? request.id : undefined, reason);
}

export function clearMoveEffectRun(reason = 'cleared') {
  return effectController.cleanup(reason);
}

export function getMoveEffectRun() {
  return effectController.request;
}

export function getLastMoveEffectRequest() {
  return lastRequest;
}

export function isMoveEffectRunning() {
  return effectController.state === EFFECT_STATE.running;
}

export function subscribeMoveEffectState(fn) {
  return effectController.subscribe(fn);
}

/** Run once after the current effect ends; runs immediately when idle. */
export function afterMoveEffectEnd(fn) {
  if (typeof fn !== 'function') return () => {};
  if (!isMoveEffectRunning()) { fn(); return () => {}; }
  let done = false;
  let unsubscribe = () => {};
  unsubscribe = subscribeMoveEffectState(({ running }) => {
    if (running || done) return;
    done = true;
    unsubscribe();
    fn();
  });
  return () => {
    if (done) return;
    done = true;
    unsubscribe();
  };
}

export function getMoveEffectRunId() {
  return effectController.runId;
}
