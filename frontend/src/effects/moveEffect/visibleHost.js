/* ──────────────────────────────────────────────────────────────────────────
 * WHICH BOARD a move effect plays on.
 *
 * Two boards can be mounted at the same time: the Play Arena's page board and
 * its full-screen Play Mode board (a portal above the page). An effect that
 * names no board used to go to "the last board the user touched" — which in
 * Play Mode is the board BEHIND the overlay. The effect therefore played where
 * nobody was looking, and because the effect run is global (one at a time) the
 * hidden board even STEALED the run from the visible one, so Play Mode showed
 * no animation at all.
 *
 * So the target is resolved in ONE place, in this order:
 *
 *   1. an explicit boardId   — the caller knows exactly which board it means
 *   2. the VISIBLE host      — the surface says which board is on top
 *   3. the last-touched host — the fallback for a single-board surface
 *
 * A surface with more than one board declares the visible one; a surface with
 * one board may declare it too, and then every unnamed effect is guaranteed to
 * land on it.
 *
 * Pure module on purpose: the effect core and the tests both import it, and it
 * must not drag React or the overlay in with it.
 */

let visibleHostId = null;

/**
 * Declare the board that effects must play on.
 *
 * @param {string|null} id  the host id of the board on top
 * @returns {Function} a restore function — call it when that board is no
 *   longer on top, and the previous target is restored (not dropped).
 */
export function setVisibleEffectHost(id) {
  const previous = visibleHostId;
  visibleHostId = id || null;
  return () => {
    if (visibleHostId === id) visibleHostId = previous;
  };
}

/** The board effects are currently addressed to, or null when none is declared. */
export function getVisibleEffectHost() {
  return visibleHostId;
}

/** Forget the visible host (on unmount). */
export function clearVisibleEffectHost(id) {
  if (!id || visibleHostId === id) visibleHostId = null;
}

/**
 * The ONE resolution chain.
 *
 * @param {object} args
 * @param {string|null} [args.explicitBoardId]  the caller's own board
 * @param {string|null} [args.visibleHostId]    the board currently on top
 * @param {string|null} [args.activeHostId]     the last board the user touched
 * @returns {string|null} the host the effect must play on
 */
export function resolveEffectTarget({
  explicitBoardId = null,
  visibleHostId: visible = null,
  activeHostId = null,
} = {}) {
  return explicitBoardId || visible || activeHostId || null;
}
