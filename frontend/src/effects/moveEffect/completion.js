/* ── completion ──────────────────────────────────────────────────────────
 * Cards ("Puzzle solved!", "Game over") must never appear on top of the
 * checkmate animation. The board reports the moment its overlay reaches the
 * end of the timeline; a surface that wants to show an outcome card can wait
 * for that signal instead of guessing a timeout.
 *
 * The card is released after the mating effect has had its say - the landing
 * ripple plus the king-anchored "Checkmate" bubble at 600 ms - and not at the
 * very end of the 3.6 s choreography. Waiting for the timeline end put the
 * win/loss card more than four seconds after the mate, which read as "the
 * effect does nothing".
 *
 * Split out of index.js so it can be tested without loading the React overlay.
 */

import { T } from './config.js';
import { prefersReducedMotion } from '../../config/boardAnimation.js';
import { endMoveEffectRun } from './runtime.js';

/* How long a card waits at most: landing, the ripple sweep (T.settle) and
 * roughly a second of the Checkmate badge. */
export const MOVE_EFFECT_REVEAL_DELAY_MS = T.settle + 500;

const endListeners = new Set();
const endedIds = new Set();

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
 *   not mounted) resolves after `MOVE_EFFECT_REVEAL_DELAY_MS` at the latest.
 * - A duplicate registration is the caller's to prevent: every surface already
 *   cancels its previous wait before starting a new one, and each one keeps its
 *   own once-per-game guard. Deduping by position here instead left the gate
 *   stuck on the second game of a rematch - the same mate, already "shown",
 *   with `show` never called and the card hidden forever.
 * - Returns a cancel function; call it on unmount/puzzle change so a pending
 *   card can never fire into the next game.
 */
export function revealAfterCheckmate({ to = null, reduced } = {}, show) {
  if (typeof show !== 'function') return () => {};

  const noMotion = reduced == null ? prefersReducedMotion() : reduced;
  if (noMotion) {
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
    show(info || {});
  };

  unsubscribe = subscribeMoveEffectEnd((request) => {
    if (!request || request.type !== 'checkmate') return;
    if (to && request.to !== to) return;
    finish({ effect: request });
  });
  timer = setTimeout(() => finish({ fallback: true }), MOVE_EFFECT_REVEAL_DELAY_MS);

  return () => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    timer = null;
    unsubscribe();
  };
}
