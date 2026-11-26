import { useEffect, useRef } from 'react';

/* Pointer tilt for the champion card. The pointer position is written straight
   to CSS custom properties on the closest [data-tilt-root] ancestor — rAF
   throttled, no React state — and the same root gets a `hov` class so CSS can
   light the card (veil, foil, name, glow) without touching React.

   `delay` swallows the first milliseconds while the card's entrance animation
   plays: tilting there would fight the fade-up transform. Leave wipes the
   variables, so the base .6s easing carries the card back even after a quick
   flick out of the card. */
export default function useTilt({ max = 9, delay = 600 } = {}) {
  const hitRef = useRef(null);
  const tiltRef = useRef(null);

  useEffect(() => {
    const hit = hitRef.current;
    const tilt = tiltRef.current;
    if (!hit || !tilt) return undefined;
    const root = tilt.closest('[data-tilt-root]') || tilt;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const point = { x: 0.5, y: 0.5 };
    let ready = delay <= 0;
    let raf = 0;

    const timer = ready ? 0 : window.setTimeout(() => { ready = true; }, delay);

    const paint = () => {
      raf = 0;
      root.style.setProperty('--rx', `${(0.5 - point.y) * 2 * max}deg`);
      root.style.setProperty('--ry', `${(point.x - 0.5) * 2 * max}deg`);
      root.style.setProperty('--mx', `${point.x * 100}%`);
      root.style.setProperty('--my', `${point.y * 100}%`);
    };

    const light = () => root.classList.add('hov');

    const onMove = (e) => {
      if (reduce.matches) return;
      const rect = hit.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      point.x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      point.y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      light();
      if (ready && !raf) raf = requestAnimationFrame(paint);
    };

    const reset = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      root.classList.remove('hov');
      root.style.removeProperty('--rx');
      root.style.removeProperty('--ry');
      root.style.removeProperty('--mx');
      root.style.removeProperty('--my');
    };

    /* A touch tap never gets a pointerleave when the browser claims the gesture
       for scrolling, so lift and cancel reset as well. */
    const onUp = (e) => {
      if (e.pointerType !== 'mouse') reset();
    };

    hit.addEventListener('pointerenter', light);
    hit.addEventListener('pointermove', onMove);
    hit.addEventListener('pointerleave', reset);
    hit.addEventListener('pointercancel', reset);
    hit.addEventListener('pointerup', onUp);

    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      hit.removeEventListener('pointerenter', light);
      hit.removeEventListener('pointermove', onMove);
      hit.removeEventListener('pointerleave', reset);
      hit.removeEventListener('pointercancel', reset);
      hit.removeEventListener('pointerup', onUp);
      root.classList.remove('hov');
    };
  }, [max, delay]);

  return { hitRef, tiltRef };
}
