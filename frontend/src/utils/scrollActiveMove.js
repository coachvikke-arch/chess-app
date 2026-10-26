/* ──────────────────────────────────────────────────────────────────────────
 * Keeping the active move in view — INSIDE the move list, and nowhere else.
 *
 * The bug this fixes: stepping through moves (next/prev, arrow keys, a click
 * on a move) made the whole PAGE jump. The cause was
 * `activeEl.scrollIntoView({ block: 'nearest' })`: scrollIntoView walks the
 * WHOLE ancestor chain and scrolls every scrollable box it finds — including
 * the document — so a move that was perfectly visible inside the score sheet
 * could still drag the window down (on mobile, where the sheet sits below the
 * fold, it dragged the page all the way to it).
 *
 * The rule here: the move list is the ONLY thing that may scroll. The helper
 * nudges the list's own scrollTop, and only when the active move is outside
 * the part of the list that is on screen. No smooth animation, no forced
 * centring — the move is kept just inside the edge with a small padding.
 *
 * Every call site (review page, the game-viewer card, the GM replay) goes
 * through this one function, so the three surfaces cannot drift apart.
 */

/** How much of the list's edge to leave between the move and the frame. */
export const ACTIVE_MOVE_PADDING = 8;

/**
 * Scroll `container` just enough to bring `activeEl` into view.
 *
 * @param {HTMLElement|null} container  the scrollable move list
 * @param {HTMLElement|null} activeEl   the active move inside it
 * @param {number} [padding]            px to leave between the move and the edge
 * @returns {boolean} true when the list was moved
 */
export function keepActiveMoveVisible(container, activeEl, padding = ACTIVE_MOVE_PADDING) {
  if (!container || !activeEl) return false;
  if (typeof container.getBoundingClientRect !== 'function') return false;
  if (typeof container.scrollTop !== 'number') return false;

  const listBox = container.getBoundingClientRect();
  if (!listBox.height) return false;

  const moveBox = activeEl.getBoundingClientRect();

  /* The band of the list that is actually on screen. On a phone the sheet can
     sit half below the fold, and "visible" has to mean visible to the reader —
     but the list must never be scrolled by a box that is off screen entirely,
     because there is nothing to reveal. */
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight || 0 : 0;
  const top = viewportHeight ? Math.max(listBox.top, 0) : listBox.top;
  const bottom = viewportHeight ? Math.min(listBox.bottom, viewportHeight) : listBox.bottom;
  if (bottom - top <= 0) return false;

  if (moveBox.top < top + padding) {
    /* Above the visible band: bring it down to `padding` from the top edge. */
    const delta = top + padding - moveBox.top;
    container.scrollTop = Math.max(0, container.scrollTop - delta);
    return true;
  }

  if (moveBox.bottom > bottom - padding) {
    /* Below the visible band: bring it up to `padding` from the bottom edge. */
    const delta = moveBox.bottom - (bottom - padding);
    container.scrollTop = container.scrollTop + delta;
    return true;
  }

  /* Already visible — leave the list exactly where it is. */
  return false;
}

/**
 * Find the active move inside `container` and keep it visible.
 *
 * @param {HTMLElement|null} container
 * @param {string} selector  the active-move selector (e.g. '.gr-mv.active')
 * @param {number} [padding]
 * @returns {boolean} true when the list was moved
 */
export function followActiveMove(container, selector, padding = ACTIVE_MOVE_PADDING) {
  if (!container || !selector) return false;
  if (typeof container.querySelector !== 'function') return false;
  const active = container.querySelector(selector);
  if (!active) return false;
  return keepActiveMoveVisible(container, active, padding);
}
