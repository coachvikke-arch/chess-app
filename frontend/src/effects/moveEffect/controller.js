/* ── EffectController ─────────────────────────────────────────────────────────
 *
 * One state machine for the move effect:
 *
 *   idle -> running -> finished -> idle
 *
 * API: start(runId, moveData), cancel(), cleanup(), finish(runId).
 *
 * `runId` is a monotonically increasing number. Every callback (timeline end,
 * settle, audio, haptics, animation end) carries the runId it was created for
 * and is ignored when a newer run has taken over.
 *
 * `cleanup()` is the ONLY place that resets effect state. It clears hidden
 * squares, the timeline, badges, dim, ripple, flashes, highlights, wobble
 * transforms, audio and haptics, and the checkmate popup (the popup lives in
 * the overlay, which is unmounted by cleanup).
 *
 * The board position is never owned here: the controller only tracks which
 * real pieces must be hidden while the overlay draws its own copies.
 */

import { T } from './config.js';

export const EFFECT_STATE = {
  idle: 'idle',
  running: 'running',
  finished: 'finished',
};

const FILES = 'abcdefgh';
/* The overlay draws every piece for the wobble pass, so every real piece is
 * hidden while the effect runs. The set is cleared at `settle` (when the
 * overlay releases its own ghost pieces) and again by cleanup(). */
const ALL_SQUARES = (() => {
  const out = [];
  for (const f of FILES) {
    for (let r = 1; r <= 8; r += 1) out.push(`${f}${r}`);
  }
  return out;
})();

function defaultTimers() {
  return {
    setTimeout: (fn, ms) => {
      const id = setTimeout(fn, ms);
      /* Node test runs must not be held open by an effect timer. */
      if (id && typeof id.unref === 'function') id.unref();
      return id;
    },
    clearTimeout: (id) => clearTimeout(id),
  };
}

function log(event, details = {}) {
  try {
    console.debug('[effect]', event, details);
  } catch { /* logging must never break the effect */ }
}

export class EffectController {
  constructor({ timers } = {}) {
    const t = timers || defaultTimers();
    this._setTimeout = t.setTimeout;
    this._clearTimeout = t.clearTimeout;
    this._timers = new Map();
    this._listeners = new Set();
    this._state = EFFECT_STATE.idle;
    this._runId = null;
    this._request = null;
    this._hidden = new Set();
    this._reason = 'init';
  }

  get state() { return this._state; }
  get runId() { return this._runId; }
  get request() { return this._request; }
  get hiddenSquares() { return this._hidden; }

  snapshot(reason = this._reason) {
    return {
      state: this._state,
      running: this._state === EFFECT_STATE.running,
      request: this._request,
      runId: this._runId,
      hiddenSquares: Array.from(this._hidden),
      reason,
    };
  }

  emit(reason) {
    this._reason = reason;
    const snap = this.snapshot(reason);
    for (const fn of this._listeners) {
      try { fn(snap); } catch { /* one bad subscriber must not stop the rest */ }
    }
  }

  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    this._listeners.add(fn);
    try { fn(this.snapshot('subscribe')); } catch { /* ignore a broken initial read */ }
    return () => this._listeners.delete(fn);
  }

  _setTimer(key, fn, ms) {
    this._clearTimer(key);
    const id = this._setTimeout(() => {
      this._timers.delete(key);
      fn();
    }, ms);
    this._timers.set(key, id);
  }

  _clearTimer(key) {
    if (!this._timers.has(key)) return;
    try { this._clearTimeout(this._timers.get(key)); } catch { /* ignore */ }
    this._timers.delete(key);
  }

  _clearAllTimers() {
    for (const key of Array.from(this._timers.keys())) this._clearTimer(key);
  }

  /**
   * Start a new run. If one is active it is cancelled and cleaned up first, so
   * rapid navigation can never leave two effects (or their timers) alive.
   */
  start(runId, moveData = {}) {
    if (this._state !== EFFECT_STATE.idle) this.cleanup('restart');

    const request = { ...moveData, id: runId, runId };
    this._state = EFFECT_STATE.running;
    this._runId = runId;
    this._request = request;
    this._hidden = new Set(ALL_SQUARES);

    log('start', {
      runId,
      source: request.source || 'unknown',
      move: request.moveIndex ?? null,
      type: request.type || null,
    });
    this.emit('start');

    this._setTimer('settle', () => {
      if (this._runId !== runId) {
        log('stale-callback-ignored', { runId, activeRunId: this._runId, callback: 'settle' });
        return;
      }
      /* The overlay has released its ghost layer: give the real pieces back. */
      this._hidden = new Set();
      this.emit('settle');
    }, T.settle);

    this._setTimer('finish', () => this.finish(runId), T.end);
    return request;
  }

  /** The timeline ended: the overlay is finished, and cleanup follows shortly. */
  finish(runId, reason = 'finished') {
    if (this._state !== EFFECT_STATE.running) {
      log('stale-callback-ignored', { runId, activeRunId: this._runId, state: this._state, callback: 'finish' });
      return false;
    }
    if (runId != null && runId !== this._runId) {
      log('stale-callback-ignored', { runId, activeRunId: this._runId, callback: 'finish' });
      return false;
    }
    this._clearTimer('finish');
    this._state = EFFECT_STATE.finished;
    log('finished', {
      runId: this._runId,
      source: this._request?.source || 'unknown',
      type: this._request?.type || null,
    });
    this.emit(reason);

    /* No effect colour may stay behind after its move: everything (overlay
       highlights, checkmate popup, hidden-piece bookkeeping) is torn down a
       beat later even when no further move ever arrives. A move calls
       clearMoveEffects() first and this timer goes with it. */
    this._setTimer('auto-cleanup', () => {
      if (this._state === EFFECT_STATE.finished) this.cleanup('auto');
    }, T.hold);
    return true;
  }

  cancel(reason = 'cancelled') {
    if (this._state === EFFECT_STATE.idle && !this._request) return false;
    return this.cleanup(reason);
  }

  /** Reset EVERYTHING. After this the board is exactly as if no effect ran. */
  cleanup(reason = 'cleanup') {
    const previous = this._runId;
    const changed = this._state !== EFFECT_STATE.idle || this._request != null || this._hidden.size > 0;
    this._clearAllTimers();
    this._state = EFFECT_STATE.idle;
    this._runId = null;
    this._request = null;
    this._hidden = new Set();
    if (changed) {
      log('cleanup', { runId: previous, reason });
      this.emit(reason);
    }
    return changed;
  }
}

/* One controller for the app. Each ChessBoard host decides whether a run is
 * meant for it; the controller itself is board-agnostic. */
export const effectController = new EffectController();
