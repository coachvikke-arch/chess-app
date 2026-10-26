import { useEffect, useRef } from 'react';

/**
 * Bind ← / → to the same move-navigation functions the on-screen buttons use.
 *
 * Design notes, because the naive version of this hook had two real bugs:
 *
 * 1. HANDLERS LIVE IN REFS, NOT IN THE EFFECT DEPS.
 *    Most call sites pass an inline arrow, e.g.
 *    `useArrowKeys(() => go(activeIdx - 1), () => go(activeIdx + 1))`.
 *    Putting those in the deps meant the listener was torn down and re-added on
 *    every single render. Worse, holding the handler in a closure captured the
 *    value of `activeIdx` from that render, so if two keydowns landed before
 *    React re-rendered (which is exactly what happens during OS key auto-repeat,
 *    ~30 ms apart) both computed the SAME target and navigation appeared to
 *    stick after one step. Reading the handler off a ref at keydown time means we
 *    always call the newest one, so held arrows advance one step per repeat.
 *
 * 2. WE IGNORE KEYS WE DID NOT CLAIM.
 *    Ctrl/Meta/Alt combos belong to the OS and the browser - Alt+Left is window
 *    Back on Windows, Ctrl+Arrow moves the caret by a word in many fields - so
 *    they are left alone. And `defaultPrevented` means some other listener (or a
 *    modal) already handled the event, so we defer to it instead of navigating
 *    a second time. Both matter because more than one component can be mounted
 *    at once and each would otherwise step the board twice.
 *
 * Typing is protected: inside an input, textarea, select, or contenteditable the
 * arrow keys stay plain cursor movement and we do nothing.
 *
 * Boundary handling belongs to the caller - we always call the same clamped
 * function the button calls, so a disabled Previous does nothing on the key too.
 */
export default function useArrowKeys(onPrev, onNext, { enabled = true } = {}) {
  const prevRef = useRef(onPrev);
  const nextRef = useRef(onNext);

  /* Runs after every commit so the refs always hold the newest closures.
     Deliberately has no dependency array. */
  useEffect(() => {
    prevRef.current = onPrev;
    nextRef.current = onNext;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => {
      /* Someone else already claimed this keystroke. */
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevRef.current?.();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextRef.current?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** True when the keystroke belongs to text entry rather than navigation. */
function isTypingTarget(el) {
  if (!el || typeof el.tagName !== 'string') return false;
  /* isContentEditable covers the focused editable element itself; closest()
     covers a caret inside a child of an editable host. */
  if (el.isContentEditable) return true;
  if (typeof el.closest === 'function' && el.closest('[contenteditable="true"]')) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}