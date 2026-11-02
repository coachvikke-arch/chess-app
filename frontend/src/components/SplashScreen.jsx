import { useEffect, useState } from 'react';
import emblemUrl from '../assets/logo-emblem.png';
import { APP_NAME } from '../config/brand';
import '../styles/splash-screen.css';

/* Start fetching the emblem while this module is being evaluated — that is, as
   soon as the entry chunk runs — so the splash's very first frame already has
   the pixels instead of animating an empty box in and swapping the image in
   behind it. */
const preloaded = new Image();
preloaded.src = emblemUrl;

const ENTER_MS = 500;
const PULSE_MS = 800;
const HOLD_MS = 150;
const EXIT_MS = 560;

/* Reduced motion: no travel at all, so the field only needs to be looked at for
   a beat before it fades. */
const REDUCED_SHOW_MS = 300;
const REDUCED_EXIT_MS = 250;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Full-screen first-load splash.
 *
 * Rendered once at the App root, above the routed content, so the landing page
 * mounts and lays out underneath it and is simply revealed as the white field
 * fades. It never replays on a route change because it is not inside the
 * location-keyed subtree.
 */
export default function SplashScreen() {
  const [phase, setPhase] = useState('enter');

  useEffect(() => {
    const reduced = prefersReducedMotion();

    let alive = true;
    /* "Ready" is not a guess about how long the landing page needs: React has
       committed it and the browser has had two frames to rasterise it. If that
       somehow lands later than the animation, the exit waits for it rather than
       fading onto a page that is still assembling. */
    let painted = false;
    requestAnimationFrame(() => requestAnimationFrame(() => { painted = true; }));

    const timers = [];
    if (!reduced) {
      timers.push(setTimeout(() => { if (alive) setPhase('pulse'); }, ENTER_MS));
    }

    const exitAt = reduced ? REDUCED_SHOW_MS : ENTER_MS + PULSE_MS + HOLD_MS;
    const began = performance.now();
    let frame;
    const tick = () => {
      if (!alive) return;
      if (performance.now() - began >= exitAt && painted) setPhase('exit');
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    /* rAF stops running in a hidden tab, so a tab opened in the background would
       otherwise still be wearing the splash when the user finally looks at it. */
    timers.push(setTimeout(() => { if (alive) setPhase('exit'); }, exitAt + 1200));

    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      cancelAnimationFrame(frame);
    };
    /* The sequence is a one-shot driven by wall-clock, not by props or state. */
  }, []);

  useEffect(() => {
    if (phase !== 'exit') return undefined;
    const reduced = prefersReducedMotion();
    const t = setTimeout(() => setPhase('gone'), (reduced ? REDUCED_EXIT_MS : EXIT_MS) + 40);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === 'gone') return null;

  return (
    <div className={`mz-splash is-${phase}`} aria-live="polite">
      <img
        className="mz-splash-logo"
        src={emblemUrl}
        alt=""
        width="512"
        height="512"
        draggable="false"
      />
      <span className="mz-splash-sr">{APP_NAME} is loading</span>
    </div>
  );
}
