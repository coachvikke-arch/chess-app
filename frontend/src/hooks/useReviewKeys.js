/* ── Review keyboard navigation ─────────────────────────────────────────────
 *
 * ONE window-level listener for the review surfaces:
 *
 *   ArrowLeft  previous ply        ArrowUp / Home   first ply
 *   ArrowRight next ply            ArrowDown / End  last ply
 *   F          flip board
 *
 * The handler ignores typing targets and modifier chords, and calls
 * preventDefault() only for keys it actually handled (so arrow keys never
 * scroll the page while reviewing). `handleReviewKey` is exported as a pure
 * function so it can be unit-tested without React.
 */

import { useEffect, useRef } from 'react';

const NAV_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'f', 'F',
]);

export function isEditableTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * @param {KeyboardEvent} e
 * @param {{ prev: Function, next: Function, first: Function, last: Function, flip?: Function }} handlers
 * @returns {boolean} true when the key was handled
 */
export function handleReviewKey(e, handlers = {}) {
  if (!e || e.defaultPrevented) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (isEditableTarget(e.target)) return false;

  const key = e.key;
  if (!NAV_KEYS.has(key)) return false;

  let fn = null;
  if (key === 'ArrowLeft') fn = handlers.prev;
  else if (key === 'ArrowRight') fn = handlers.next;
  else if (key === 'ArrowUp' || key === 'Home') fn = handlers.first;
  else if (key === 'ArrowDown' || key === 'End') fn = handlers.last;
  else if (key === 'f' || key === 'F') fn = handlers.flip;

  if (typeof fn !== 'function') return false;

  e.preventDefault();
  fn(e);
  return true;
}

/**
 * Attach the review keys for as long as the calling surface is mounted.
 * Handlers are kept in a ref so a re-render never re-binds (and never leaves a
 * second listener behind).
 */
export function useReviewKeys(handlers, { enabled = true } = {}) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (e) => {
      handleReviewKey(e, ref.current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
