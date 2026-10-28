/* ── MoveEffect public API ──────────────────────────────────────────────────
 *
 *   playMoveEffect({
 *     type: 'brilliant' | 'checkmate' | 'promotion',
 *     from, to,                 // algebraic squares
 *     piece,                    // chess.js type letter: 'p','n','b','r','q','k'
 *     boardOrientation,         // 'white' | 'black'
 *     // optional:
 *     color, promotionPiece, sacrifice, kingSquare, captured, boardId
 *   })
 *
 * Boards register themselves as hosts (ChessBoard does this automatically) and
 * receive the request; the effect itself is mounted by the board so it lives
 * in the board's coordinate space, above the pieces and below the app chrome.
 * A request without `boardId` goes to the most recently interacted board.
 */

import MoveEffect from './MoveEffect.jsx';
import { effectConfig, MOVE_EFFECTS, T, RIPPLE, WOBBLE, G, SOUND, HAPTIC } from './config.js';
import { getVisibleEffectHost, resolveEffectTarget } from './visibleHost.js';
import {
  afterMoveEffectEnd,
  beginMoveEffectRun,
  clearMoveEffectRun,
  getLastMoveEffectRequest,
  getMoveEffectRun,
  getMoveEffectRunId,
  isMoveEffectRunning,
  subscribeMoveEffectState,
} from './runtime.js';

export { MoveEffect };
export { effectConfig, MOVE_EFFECTS, T, RIPPLE, WOBBLE, G, SOUND, HAPTIC };
export {
  setVisibleEffectHost,
  getVisibleEffectHost,
  clearVisibleEffectHost,
  resolveEffectTarget,
} from './visibleHost.js';
export {
  afterMoveEffectEnd,
  getLastMoveEffectRequest,
  getMoveEffectRun,
  getMoveEffectRunId,
  isMoveEffectRunning,
  subscribeMoveEffectState,
};

/* ── host registry ────────────────────────────────────────────────────────── */

const hosts = new Map();        // id → last active timestamp
let activeHostId = null;
const listeners = new Set();
let seq = 0;

export function registerMoveEffectHost(id) {
  hosts.set(id, Date.now());
  if (!activeHostId) activeHostId = id;
  return () => {
    hosts.delete(id);
    if (activeHostId === id) {
      activeHostId = hosts.keys().next().value || null;
    }
    /* A board that disappears mid-effect must not keep the global run alive or
       leave timers/audio running. Unregistering is a full cleanup, not just an
       "end" (which keeps the badge/popup until the position changes). */
    const run = getMoveEffectRun();
    if (run && (!run.targetHostId || run.targetHostId === id)) {
      clearMoveEffectRun('host-unregistered');
    }
  };
}

/** Called by a board on pointer-down so it becomes the default target. */
export function markMoveEffectHostActive(id) {
  if (!hosts.has(id)) return;
  hosts.set(id, Date.now());
  activeHostId = id;
}

export function subscribeMoveEffects(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Start (or restart) the effect. Returns the request object, whose `id` can be
 * used to key the overlay so a new request always remounts a fresh timeline.
 */
export function playMoveEffect(config) {
  if (!config || !config.type) return null;

  const request = {
    sacrifice: false,
    source: 'unknown',
    ...config,
    id: ++seq,
    /* ONE resolution chain (visibleHost.js): the caller's own board, then the
       board that is currently on top, then the last board the user touched.
       Without the middle step an effect played on the page behind the Play Mode
       overlay, and the hidden board stole the run from the visible one. */
    targetHostId: resolveEffectTarget({
      explicitBoardId: config.boardId,
      visibleHostId: getVisibleEffectHost(),
      activeHostId,
    }),
  };
  request.runId = request.id;
  request.dedupeKey = request.dedupeKey
    || [request.type, request.from, request.to, request.promotionPiece, request.fen]
      .filter(Boolean)
      .join('|');

  /* ONE trigger path, counter based: every call is a new run. The controller
     cancels + cleans the previous run first, so rapid navigation can never
     overlap two effects. Same-move replays are intentional and restart. */
  if (getMoveEffectRun()) clearMoveEffectRun('replaced');
  beginMoveEffectRun(request);

  for (const fn of listeners) {
    try { fn(request); } catch { /* one bad host must not stop the rest */ }
  }
  return request;
}

/** Remove the current effect from every host (e.g. the position was replaced). */
export function clearMoveEffects(reason = 'cleared') {
  clearMoveEffectRun(reason);
  for (const fn of listeners) {
    try { fn(null); } catch { /* ignore */ }
  }
}

export {
  MOVE_EFFECT_REVEAL_DELAY_MS,
  notifyMoveEffectEnd,
  subscribeMoveEffectEnd,
  revealAfterCheckmate,
} from './completion.js';
