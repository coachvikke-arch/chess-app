import { useEffect, useRef } from 'react';

/* The overlays that are open, innermost last.
 *
 * An overlay pushes ONE history entry when it opens so the browser Back button
 * closes the overlay instead of leaving the page. That entry is removed again
 * when the overlay closes for any other reason (the x button, the backdrop).
 *
 * WHY THE ENTRY IS NOT REMOVED SYNCHRONOUSLY
 * ------------------------------------------
 * React runs an effect twice on mount under <StrictMode>: mount, clean up,
 * mount again - for the SAME, still-open overlay. A cleanup that called
 * history.back() straight away therefore popped the entry while the overlay
 * was still open. The popstate that followed was read by this module's own
 * listener as "the user pressed Back", so the overlay closed itself the moment
 * it opened: a class card that did nothing when clicked, a Brilliant Move
 * card that never appeared.
 *
 * So the removal is DEFERRED by a tick and cancelled if the effect re-runs.
 * A real close still removes the entry - one tick later, which no user can
 * tell - and a StrictMode remount keeps the entry it already pushed. */
const overlays = [];

/* Tokens whose history entry is being removed by a back() that is already on
   its way. The unmount cleanup must not add a second one. */
const pendingBack = new Set();

function removeFromStack(entry) {
  const idx = overlays.indexOf(entry);
  if (idx !== -1) overlays.splice(idx, 1);
}

export function registerOverlay(id, closeFn, key) {
  /* A StrictMode remount re-runs the effect for the same still-open overlay.
     The entry it already pushed is re-used: a second push would leave two
     history entries for one overlay, and the user would have to press Back
     twice to get out of it. */
  let entry = key == null ? null : overlays.find((o) => o.key === key);
  if (entry) {
    entry.closeFn = closeFn;
  } else {
    entry = {
      id,
      key,
      closeFn,
      token: `${id}:${Math.random().toString(36).slice(2)}`,
    };
    overlays.push(entry);
    try {
      window.history.pushState({ overlay: entry.token }, '');
    } catch {}
  }

  const onPop = () => {
    const top = overlays[overlays.length - 1];
    if (top && top === entry) {
      removeFromStack(entry);
      entry.closeFn();
    }
  };
  entry.onPop = onPop;
  window.addEventListener('popstate', onPop);

  return {
    entry,
    token: entry.token,
    dispose: () => {
      window.removeEventListener('popstate', onPop);
      /* The entry stays in the stack until the deferred removal runs: a
         StrictMode remount re-uses it (one history entry per overlay), and a
         real close removes it a tick later. */
    },
  };
}

export function closeTopOverlay() {
  const top = overlays[overlays.length - 1];
  if (!top) return false;
  removeFromStack(top);
  /* This back() is ours; the unmount cleanup must not add a second one. */
  pendingBack.add(top.token);
  if (top.onPop) window.removeEventListener('popstate', top.onPop);
  try { window.history.back(); } catch {}
  try { top.closeFn(); } catch {}
  return true;
}

export function useOverlayHistory(id, isOpen, closeFn) {
  const closeRef = useRef(closeFn);
  closeRef.current = closeFn;
  /* One key per hook instance: it identifies THIS overlay across a StrictMode
     remount, so the remount re-uses the history entry instead of pushing a
     second one. */
  const keyRef = useRef(null);
  const genRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    if (keyRef.current == null) keyRef.current = `overlay:${Math.random().toString(36).slice(2)}`;

    /* A pending "remove my history entry" belongs to an earlier run of this
       effect: that run no longer owns the entry, so its timer is cancelled. */
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }

    const myGen = ++genRef.current;
    const { entry, token, dispose } = registerOverlay(id, () => closeRef.current?.(), keyRef.current);

    return () => {
      dispose();
      /* Remove the entry this overlay pushed - deferred, so a StrictMode
         remount can cancel it (see the note at the top of this file). */
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (genRef.current !== myGen) return;      // re-registered: the live run owns the entry
        removeFromStack(entry);
        if (pendingBack.has(token)) return;         // a back() is already on its way
        try {
          const state = window.history.state;
          /* Only our own entry: never step back over a tab change, another
             overlay or the previous route. */
          if (state && state.overlay === token) window.history.back();
        } catch {}
      }, 0);
    };
  }, [isOpen, id]);
}
