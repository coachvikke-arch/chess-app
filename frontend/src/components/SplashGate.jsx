import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { gsap } from 'gsap';
import LogoIntro, { markLogoIntroSeen } from './LogoIntro';

/* ─────────────────────────────────────────────────────────────────────────────
   SplashGate — the three states the launch has.

     INTRO           LogoIntro owns the screen: the brand animation, nothing else.
     READY_TO_LOGIN  the animation has finished; "Swipe up to Login" is offered.
     LOGIN           the swipe landed — /login mounts under the curtain and the
                     curtain is flung off the top of the screen.

   The gate, not the animation, decides when a gesture counts: input is ignored
   until INTRO is over, a gesture has to clear both a distance and (for a short
   flick) a velocity, and the first accepted gesture latches so nothing can
   transition twice. Touch, mouse, trackpad and keyboard all feed the same
   `login()` call, and the curtain is a single element that both drags and
   leaves — so the reveal is one motion, not a swap.

   Timings and thresholds live in SWIPE; colours in styles/logo-intro.css.
   ─────────────────────────────────────────────────────────────────────────── */

export const PHASE = {
  INTRO: 'INTRO',
  READY_TO_LOGIN: 'READY_TO_LOGIN',
  LOGIN: 'LOGIN',
};

/** Pixels and seconds. `*Ratio` values are fractions of the viewport height. */
export const SWIPE = {
  /** a drag over this much of the screen height is always a swipe */
  distanceRatio: 0.18,
  minDistance: 60,
  /** a shorter one counts only as a flick above this speed (px per ms)... */
  velocity: 0.5,
  /** ...and only once it has actually travelled this far */
  minFlick: 55,
  /** how much of the drag reaches the curtain; the rest is rubber-banded */
  damping: 0.34,
  /** cumulative upward wheel delta that counts as one swipe */
  wheel: 150,
  wheelWindow: 800,
  leave: 0.62,
  promptFade: 0.2,
};

export default function SplashGate({ onDismiss }) {
  const [phase, setPhase] = useState(PHASE.INTRO);
  const curtainRef = useRef(null);
  const promptRef = useRef(null);
  const navigate = useNavigate();

  /* Claim the "shown this session" flag immediately, so a reload or a back
     gesture in the middle of the transition never plays the intro again. */
  useEffect(() => {
    markLogoIntroSeen();
  }, []);

  const committed = useRef(false);
  const callbacks = useRef({ onDismiss });
  callbacks.current = { onDismiss };

  /* Every tween the gesture can start is tracked here and killed on unmount. */
  const liveTweens = useRef([]);
  useEffect(
    () => () => {
      liveTweens.current.forEach((t) => t.kill());
      liveTweens.current = [];
    },
    []
  );

  const settle = (t) => liveTweens.current.push(t);

  const login = () => {
    if (committed.current) return;
    committed.current = true;
    setPhase(PHASE.LOGIN);

    /* The destination is mounted while the curtain is still covering it, so the
       page the swipe reveals is already the login page — no intermediate frame. */
    navigate('/login');

    const tl = gsap.timeline({
      onComplete: () => callbacks.current.onDismiss?.(),
    });
    if (promptRef.current) {
      tl.to(
        promptRef.current,
        { opacity: 0, y: -18, duration: SWIPE.promptFade, ease: 'power1.out' },
        0
      );
    }
    tl.to(curtainRef.current, { yPercent: -100, duration: SWIPE.leave, ease: 'power3.inOut' }, 0.04);
    settle(tl);
  };

  /* ── drag (touch, pen, mouse) ───────────────────────────────────────────── */
  const drag = useRef(null);

  const onPointerDown = (e) => {
    /* one gesture at a time: a second finger must not hijack the drag */
    if (phase !== PHASE.READY_TO_LOGIN || !e.isPrimary) return;
    drag.current = {
      id: e.pointerId,
      start: e.clientY,
      at: performance.now(),
      dy: 0,
      v: 0,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety; the gesture still tracks without it */
    }
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || !e.isPrimary || d.id !== e.pointerId) return;
    const dy = Math.max(0, d.start - e.clientY);
    const now = performance.now();
    const dt = Math.max(16, now - d.at);
    /* smooth the per-event speed: one jittery sample should not read as a flick */
    d.v = d.v * 0.5 + ((dy - d.dy) / dt) * 0.5;
    d.at = now;
    d.dy = dy;
    gsap.set(curtainRef.current, { y: -dy * SWIPE.damping });
    if (promptRef.current) {
      gsap.set(promptRef.current, { opacity: Math.max(0, 1 - dy / 180) });
    }
  };

  /** `commit` is false when the pointer was taken away from us (pointercancel):
      a gesture the browser ended for us never navigates. */
  const release = (commit) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const h = window.innerHeight || 1;
    const far = d.dy > Math.max(SWIPE.minDistance, h * SWIPE.distanceRatio);
    const flick = d.v > SWIPE.velocity && d.dy > SWIPE.minFlick;
    if (commit && (far || flick)) {
      login();
      return;
    }
    settle(
      gsap.to(curtainRef.current, {
        y: 0,
        duration: 0.42,
        ease: 'power3.out',
        onComplete: () => {
          if (!promptRef.current || committed.current) return;
          gsap.to(promptRef.current, { opacity: 1, duration: 0.3, ease: 'power2.out' });
        },
      })
    );
  };

  /* ── wheel / trackpad ──────────────────────────────────────────────────── */
  const wheel = useRef({ sum: 0, at: 0, timer: 0 });

  const onWheel = (e) => {
    if (phase !== PHASE.READY_TO_LOGIN || committed.current) return;
    const up = -e.deltaY;
    const now = performance.now();
    const w = wheel.current;
    if (up <= 0 || now - w.at > SWIPE.wheelWindow) {
      w.sum = Math.max(0, up);
      w.at = now;
    } else {
      w.sum += up;
      w.at = now;
    }
    const travel = Math.min(w.sum, 340);
    gsap.set(curtainRef.current, { y: -travel * SWIPE.damping });
    if (w.sum >= SWIPE.wheel) {
      clearTimeout(w.timer);
      w.sum = 0;
      login();
      return;
    }
    clearTimeout(w.timer);
    w.timer = setTimeout(() => {
      w.sum = 0;
      settle(gsap.to(curtainRef.current, { y: 0, duration: 0.36, ease: 'power3.out' }));
    }, 180);
  };

  /* ── keyboard ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (phase !== PHASE.READY_TO_LOGIN) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        login();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
    /* login() only reads refs and navigates, so it is safe to keep the first one. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(
    () => () => {
      clearTimeout(wheel.current.timer);
    },
    []
  );

  return (
    <div
      className="sg-root"
      data-phase={phase}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => release(true)}
      onPointerCancel={() => release(false)}
      onWheel={onWheel}
    >
      <div className="sg-curtain" ref={curtainRef}>
        <LogoIntro onComplete={() => setPhase(PHASE.READY_TO_LOGIN)} />
      </div>

      {phase !== PHASE.INTRO && (
        <div className="sg-prompt" ref={promptRef}>
          <span className="sg-chev" aria-hidden="true">
            <i />
            <i />
          </span>
          <span className="sg-text">Swipe up to Login</span>
        </div>
      )}
    </div>
  );
}
