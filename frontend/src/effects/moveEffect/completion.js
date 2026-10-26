/* ─�� completion ──────────────────────────────────────────────────────────
 * Cards ("Puzzle solved!", "Game over") must never appear on top of the
 * checkmate animation. The board reports the moment its overlay reaches the
 * end of the timeline; a surface that wants to show an outcome card can wait
 * for that signal instead of guessing a timeout.
 *
 * Split out of index.js so it can be tested without loading the React overlay.
 */

import { T } from './config.js';
import { prefersReducedMotion } from '../../config/boardAnimation.js';
import { endMoveEffectRun } from './runtime.js';

/* Longest an outcome card may be held back when no overlay reports back -
 * the animation's own end plus a small paint buffer. */
export const MOVE_EFFECT_REVEAL_FALLBACK_MS = T.end + 200;

const endListeners = new Set();
const endedIds = new Set();
/* A completion key is one ATTEMPT, not a square: undo/redo/rebuild can put the
   same mate back on the board and must not show the card a second time. */
const pendingKeys = new Set();
const shownKeys = new Set();

function rememberEnded(id) {
  if (id == null) return false;
  if (endedIds.has(id)) return true;
  endedIds.add(id);
  if (endedIds.size > 40) endedIds.delete(endedIds.values().next().value);
  return false;
}

/** Called by a board when its overlay finishes (or is torn down early). */
export function notifyMoveEffectEnd(request) {
  if (!request || !request.type) return;
  if (rememberEnded(request.id)) return;
  endMoveEffectRun(request, 'completion-signal');
  for (const fn of endListeners) {
    try { fn(request); } catch { /* one listener must not stop the rest */ }
  }
}

export function subscribeMoveEffectEnd(fn) {
  endListeners.add(fn);
  return () => endListeners.delete(fn);
}

/**
 * Run `show` once the checkmate animation for `to` has finished.
 *
 * - No checkmate overlay (reduced motion, another surface, or a board that is
 *   not mounted) resolves after the fallback window at the latest.
 * - Returns a cancel function; call it on unmount/puzzle change so a pending
 *   card can never fire into the next game.
 */
export function revealAfterCheckmate({ to = null, reduced, key = null } = {}, show) {
  if (typeof show !== 'function') return () => {};
  const completionKey = key == null ? null : String(key);
  if (completionKey && (shownKeys.has(completionKey) || pendingKeys.has(completionKey))) {
    return () => {};
  }
  if (completionKey) pendingKeys.add(completionKey);

  const noMotion = reduced == null ? prefersReducedMotion() : reduced;
  if (noMotion) {
    if (completionKey) {
      pendingKeys.delete(completionKey);
      shownKeys.add(completionKey);
    }
    show({ reduced: true });
    return () => {};
  }

  let done = false;
  let timer = null;
  let unsubscribe = () => {};

  const finish = (info) => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    timer = null;
    unsubscribe();
    if (completionKey) {
      pendingKeys.delete(completionKey);
      shownKeys.add(completionKey);
      if (shownKeys.size > 40) shownKeys.delete(shownKeys.values().next().value);
    }
    show(info || {});
  };

  unsubscribe = subscribeMoveEffectEnd((request) => {
    if (!request || request.type !== 'checkmate') return;
    if (to && request.to !== to) return;
    finish({ effect: request });
  });
  timer = setTimeout(() => finish({ fallback: true }), MOVE_EFFECT_REVEAL_FALLBACK_MS);

  return () => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    timer = null;
    unsubscribe();
    if (completionKey) pendingKeys.delete(completionKey);
  };
}
