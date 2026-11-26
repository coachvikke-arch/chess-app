import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import logoUrl from '../assets/logo.png';

/* ─────────────────────────────────────────────────────────────────────────────
   LogoIntro — the logo.mp4 brand animation, rebuilt in code.

   Nothing here is a video: the ring, the knight, its eye, the flash, the lens
   flare, the edge glow, the particle shockwave, the star dust, the wordmark,
   the tagline and the sweep are each their own layer, and one GSAP master
   timeline conducts them. The component is the whole splash: a full-screen
   navy field with the lockup dead centre and nothing else on screen.

   When the timeline reaches the end of its build it calls onComplete and the
   parent (SplashGate) is allowed to offer the way in. The lockup then rests —
   the ring keeps breathing, the eye keeps pulsing, the dust keeps twinkling —
   until the gate lifts the whole surface away.

   Every colour lives in styles/logo-intro.css (:root), every timing lives in
   INTRO_TIMELINE below — retune the sequence without touching the tweens.
   ─────────────────────────────────────────────────────────────────────────── */

export const INTRO_SESSION_KEY = 'matezone_logo_intro';

/** Seconds. `at` is the absolute position on the master timeline. */
export const INTRO_TIMELINE = {
  glow: { at: 0.0, dur: 0.4 },
  ringBottom: { at: 0.05, dur: 0.62 },
  ringTop: { at: 0.5, dur: 0.55 },
  ringComet: { at: 0.05, dur: 1.0 },
  flash: { at: 0.45, dur: 0.3 },
  knight: { at: 0.45, dur: 0.3 },
  flare: { at: 0.55, dur: 0.22 },
  edgeGlow: { at: 0.6, dur: 0.55 },
  shockwave: { at: 0.9 },
  haloPulse: { at: 0.9, dur: 1.0 },
  eyePulse: { at: 0.9, dur: 0.9 },
  dust: { at: 1.0 },
  markShrink: { at: 1.85, dur: 0.55 },
  wordmark: { at: 1.95, dur: 0.4 },
  shine: { at: 2.15, dur: 0.5 },
  tagline: { at: 2.3, dur: 0.5 },
  sweep: { at: 2.7, dur: 0.6 },
  bloom: { at: 2.7, dur: 0.6 },
  idle: { at: 3.3, dur: 0.6 },
  /** The build is over: from here the gate may show "Swipe up to Login". */
  end: { at: 4.6 },
  /** Reduced motion: one fade in, then rest. */
  reduced: { at: 0.05, dur: 0.5, end: 1.5 },
};

/** The palette, mirrored here so jobs/tests can read it; CSS vars are the source. */
export const INTRO_COLORS = {
  navyTop: '#0A2145',
  navyMid: '#04132B',
  navyDeep: '#020817',
  ring: '#1FC8FF',
  shockwave: '#3FB8C8',
  chrome: ['#FFFFFF', '#C5D2DE', '#8798A9', '#E6EEF5'],
  gem: '#2F66FF',
  zone: ['#8FE3FF', '#1FC8FF', '#0A8FD8'],
  tagline: '#9FB3C8',
};

/** Canvas population — halved on phones, devicePixelRatio capped at 2. */
export const INTRO_PARTICLES = {
  shockwave: 780,
  shockwaveMobile: 360,
  dust: 130,
  dustMobile: 65,
};

/* The mark is a broken circle with gaps at 3 and 9 o'clock, r=82 in a 200 box.
   Bottom arc first (starts bottom-right), then the top arc: drawn in that
   order it reads as one clockwise sweep. */
const ARC_BOTTOM = 'M 180.01 117.06 A 82 82 0 0 1 19.99 117.06';
const ARC_TOP = 'M 19.99 82.94 A 82 82 0 0 1 180.01 82.94';

/** True on the first landing-page mount of a browser session. */
export function shouldPlayLogoIntro() {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(INTRO_SESSION_KEY) !== '1';
  } catch {
    /* Storage blocked: a quiet page beats one that replays on every mount. */
    return false;
  }
}

/**
 * Records that this session has already been given the splash. The gate claims
 * the flag as soon as it mounts, so a reload or a back gesture mid-transition
 * never plays the intro a second time.
 */
export function markLogoIntroSeen() {
  try {
    sessionStorage.setItem(INTRO_SESSION_KEY, '1');
  } catch {
    /* nothing to persist */
  }
}

/**
 * Star dust + the shockwave. Own rAF loop, DPR-aware, resize-aware, and stopped
 * by destroy() so nothing outlives the overlay.
 */
function createField(canvas, { reduced }) {
  const c2d = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 1;
  let h = 1;
  let raf = 0;
  let last = 0;
  let clock = 0;
  let dust = [];
  let burst = [];

  function size() {
    w = canvas.clientWidth || window.innerWidth;
    h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seedDust(count) {
    dust = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.5 + Math.random() * 1.1,
      a: 0.1 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
      speed: 0.7 + Math.random() * 1.9,
      drift: -(0.04 + Math.random() * 0.1),
    }));
  }

  /* ring radius → 1.6x, with turbulence, then out. Positions come from the
     mark's live rect, so the burst is anchored to the art, not to guesses. */
  function explode(cx, cy, radius, count) {
    burst = Array.from({ length: count }, () => {
      const angle = Math.random() * Math.PI * 2;
      return {
        cx,
        cy,
        angle,
        r0: radius * (0.8 + Math.random() * 0.3),
        travel: radius * 0.62 * (0.7 + Math.random() * 0.8),
        r: 1 + Math.random() * 2,
        a: 0.15 + Math.random() * 0.35,
        ttl: 0.9 + Math.random() * 0.6,
        life: 0,
        wob: Math.random() * Math.PI * 2,
      };
    });
  }

  function frame(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    clock += dt;
    c2d.clearRect(0, 0, w, h);

    for (const d of dust) {
      const twinkle = 0.5 + 0.5 * Math.sin(clock * d.speed + d.phase);
      c2d.globalAlpha = d.a * (0.25 + 0.75 * twinkle);
      c2d.fillStyle = '#d6f2ff';
      c2d.beginPath();
      c2d.arc(d.x, d.y, d.r, 0, 6.2832);
      c2d.fill();
      d.y += d.drift;
      if (d.y < -4) {
        d.y = h + 4;
        d.x = Math.random() * w;
      }
    }

    if (burst.length) {
      c2d.fillStyle = INTRO_COLORS.shockwave;
      let alive = 0;
      for (const p of burst) {
        p.life += dt;
        if (p.life >= p.ttl) continue;
        alive += 1;
        const k = p.life / p.ttl;
        const eased = 1 - Math.pow(1 - k, 3);
        const rad = p.r0 + p.travel * eased;
        /* turbulence: a sideways wobble that grows as the shell ages */
        const wob = Math.sin(clock * 4 + p.wob) * k * 0.05;
        c2d.globalAlpha = p.a * (1 - k);
        c2d.beginPath();
        c2d.arc(
          p.cx + Math.cos(p.angle + wob) * rad,
          p.cy + Math.sin(p.angle + wob) * rad,
          p.r * (1 - k * 0.35),
          0,
          6.2832
        );
        c2d.fill();
      }
      if (!alive) burst = [];
    }

    c2d.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }

  size();
  if (!reduced) {
    seedDust(INTRO_PARTICLES.dust);
    raf = requestAnimationFrame(frame);
  }

  const onResize = () => {
    size();
    if (dust.length) seedDust(dust.length);
  };
  window.addEventListener('resize', onResize);

  return {
    explode,
    startDust(count) {
      if (!dust.length) seedDust(count);
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    },
    destroy() {
      cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener('resize', onResize);
    },
  };
}

export default function LogoIntro({ onComplete }) {
  const rootRef = useRef(null);
  const [reduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  /* Held in a ref so a parent re-render mid-flight cannot restart the timeline. */
  const callbacks = useRef({ onComplete });
  callbacks.current = { onComplete };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const html = document.documentElement;
    html.classList.remove('li-booting');
    /* Scroll stays frozen for as long as the splash holds the screen. */
    html.setAttribute('data-logo-intro', '');
    window.scrollTo({ top: 0, left: 0 });

    const q = (sel) => root.querySelector(sel);
    const brand = q('.li-brand');
    const mark = q('.li-mark');
    const compose = q('.li-compose');
    const mobile = window.innerWidth < 700;
    const T = INTRO_TIMELINE;

    const field = createField(q('.li-canvas'), { reduced });
    const side = [];
    /* Assigned by the full-motion branch: what "resting" means once the build
       is over, while the gate waits for the swipe. */
    let rest = () => {};

    const tl = gsap.timeline({
      onComplete: () => {
        rest();
        callbacks.current.onComplete?.();
      },
    });

    if (reduced) {
      /* No flash, no flare, no particles, no motion blur — the still logo fades
         in and the gate opens. */
      const R = T.reduced;
      tl.fromTo(q('.li-glow'), { opacity: 0 }, { opacity: 0.7, duration: 0.4 }, 0);
      tl.fromTo(
        q('.li-simple'),
        { opacity: 0, scale: 0.97 },
        { opacity: 1, scale: 1, duration: R.dur, ease: 'power2.out' },
        R.at
      );
      tl.set(root, { data: 'li-end' }, R.end);
    } else {
      const markH = mark.getBoundingClientRect().height || 320;
      const composeH = compose.getBoundingClientRect().height || 150;
      const SHRINK = 0.62;
      /* The mark shrinks toward its bottom edge so the wordmark lands against
         it with no gap; the lockup then shifts up by half its own height to sit
         centred, which is what "makes room for the wordmark" means visually. */
      const centreLift = ((1 - SHRINK) * markH + composeH) / 2;

      /* 1 — ambient glow */
      tl.fromTo(
        q('.li-glow'),
        { opacity: 0 },
        { opacity: 1, duration: T.glow.dur, ease: 'power2.out' },
        T.glow.at
      );

      /* 2 — ring draws clockwise, bottom arc then top arc, with a brighter
         leading comet along the same path */
      tl.fromTo(
        q('.li-ring'),
        { opacity: 0 },
        { opacity: 1, duration: 0.12 },
        T.ringBottom.at
      );
      tl.fromTo(
        q('.li-arc-bottom'),
        { strokeDashoffset: 100 },
        { strokeDashoffset: 0, duration: T.ringBottom.dur, ease: 'power2.out' },
        T.ringBottom.at
      );
      tl.fromTo(
        q('.li-arc-top'),
        { strokeDashoffset: 100 },
        { strokeDashoffset: 0, duration: T.ringTop.dur, ease: 'power2.out' },
        T.ringTop.at
      );
      tl.fromTo(
        q('.li-comet'),
        { strokeDashoffset: 100 },
        { strokeDashoffset: 0, duration: T.ringComet.dur, ease: 'power2.out' },
        T.ringComet.at
      );
      tl.fromTo(
        q('.li-comet'),
        { opacity: 0 },
        { opacity: 0.95, duration: 0.2, ease: 'power1.out' },
        T.ringComet.at
      );
      tl.to(q('.li-comet'), { opacity: 0, duration: 0.2 }, T.ringComet.at + T.ringComet.dur - 0.2);

      /* 4 — flash burst + the knight pulling itself into focus */
      tl.fromTo(
        q('.li-flash'),
        { scale: 0, opacity: 0 },
        { scale: 1.4, opacity: 1, duration: T.flash.dur * 0.55, ease: 'power2.out' },
        T.flash.at
      );
      tl.to(q('.li-flash'), { opacity: 0.4, scale: 1.7, duration: 0.28 }, T.flash.at + 0.17);
      tl.to(q('.li-flash'), { opacity: 0, scale: 2.1, duration: 0.5, ease: 'power1.in' }, T.flash.at + 0.45);
      tl.fromTo(
        q('.li-knight'),
        { opacity: 0, scale: 0.92, filter: 'blur(14px) brightness(3)' },
        {
          opacity: 1,
          scale: 1,
          filter: 'blur(0px) brightness(1)',
          duration: T.knight.dur,
          ease: 'power2.out',
        },
        T.knight.at
      );

      /* 5 + 6 — lens flare across the whole viewport, edge glow in and out */
      tl.fromTo(
        q('.li-flare'),
        { scaleX: 0, opacity: 0 },
        { scaleX: 1, opacity: 1, duration: T.flare.dur, ease: 'power3.out' },
        T.flare.at
      );
      tl.to(
        q('.li-flare'),
        { opacity: 0, duration: 0.45, ease: 'power1.in' },
        T.flare.at + T.flare.dur
      );
      tl.fromTo(
        q('.li-edge'),
        { opacity: 0 },
        { opacity: 1, duration: 0.2, ease: 'power2.out' },
        T.edgeGlow.at
      );
      tl.to(q('.li-edge'), { opacity: 0, duration: T.edgeGlow.dur - 0.2 }, T.edgeGlow.at + 0.2);

      /* 7 — particle shockwave, anchored to the ring as it actually renders */
      tl.call(
        () => {
          const r = mark.getBoundingClientRect();
          field.explode(
            r.left + r.width / 2,
            r.top + r.height / 2,
            r.width * 0.41,
            mobile ? INTRO_PARTICLES.shockwaveMobile : INTRO_PARTICLES.shockwave
          );
        },
        null,
        T.shockwave.at
      );

      /* ring glow breathing + the eye coming alive */
      tl.fromTo(
        q('.li-halo'),
        { opacity: 0 },
        { opacity: 0.85, duration: T.haloPulse.dur * 0.4, ease: 'power2.out' },
        T.haloPulse.at
      );
      tl.to(q('.li-halo'), { opacity: 0.4, duration: T.haloPulse.dur * 0.6 }, T.haloPulse.at + T.haloPulse.dur * 0.4);
      tl.fromTo(
        q('.li-eye'),
        { opacity: 0, scale: 0.6 },
        { opacity: 1, scale: 1.6, duration: T.eyePulse.dur * 0.4, ease: 'power2.out' },
        T.eyePulse.at
      );
      tl.to(
        q('.li-eye'),
        { opacity: 0.6, scale: 1, duration: T.eyePulse.dur * 0.6, ease: 'power2.inOut' },
        T.eyePulse.at + T.eyePulse.dur * 0.4
      );

      /* 8 — star dust: started here, and it keeps twinkling while the splash waits */
      tl.call(
        () => field.startDust(mobile ? INTRO_PARTICLES.dustMobile : INTRO_PARTICLES.dust),
        null,
        T.dust.at
      );

      /* the mark steps back so the wordmark can take the stage */
      tl.to(
        mark,
        { scale: SHRINK, transformOrigin: '50% 100%', duration: T.markShrink.dur, ease: 'power3.inOut' },
        T.markShrink.at
      );
      tl.to(
        brand,
        { y: -centreLift, duration: T.markShrink.dur, ease: 'power3.inOut' },
        T.markShrink.at
      );

      /* 9 — wordmark streaks in from the left with motion blur, no overshoot */
      tl.fromTo(
        q('.li-wordline'),
        { x: -window.innerWidth * 0.6, opacity: 0, filter: 'blur(18px)' },
        { x: 0, opacity: 1, filter: 'blur(0px)', duration: T.wordmark.dur, ease: 'expo.out' },
        T.wordmark.at
      );
      tl.fromTo(
        q('.li-streak'),
        { opacity: 0 },
        { opacity: 0.9, duration: 0.12 },
        T.wordmark.at
      );
      tl.to(q('.li-streak'), { opacity: 0, duration: T.wordmark.dur - 0.12 }, T.wordmark.at + 0.12);

      /* one chrome shine across MATE */
      tl.fromTo(
        q('.li-shine'),
        { left: '-40%', opacity: 0 },
        { left: '125%', opacity: 1, duration: T.shine.dur, ease: 'power1.inOut' },
        T.shine.at
      );
      tl.to(q('.li-shine'), { opacity: 0, duration: 0.14 }, T.shine.at + T.shine.dur);

      /* 10 — tagline builds, rules grow outward from the words */
      tl.fromTo(
        q('.li-tagrow'),
        { opacity: 0, y: 14, filter: 'blur(6px)' },
        {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: T.tagline.dur,
          ease: 'power2.out',
        },
        T.tagline.at
      );
      tl.fromTo(
        q('.li-rule-l'),
        { scaleX: 0 },
        { scaleX: 1, duration: T.tagline.dur, ease: 'power2.out' },
        T.tagline.at
      );
      tl.fromTo(
        q('.li-rule-r'),
        { scaleX: 0 },
        { scaleX: 1, duration: T.tagline.dur, ease: 'power2.out' },
        T.tagline.at
      );

      /* 11 — sweep across the tagline, and one bloom over the wordmark */
      tl.fromTo(
        q('.li-sweep'),
        { xPercent: -140, opacity: 0 },
        { xPercent: 320, opacity: 1, duration: T.sweep.dur, ease: 'power1.inOut' },
        T.sweep.at
      );
      tl.fromTo(
        q('.li-wordglow'),
        { opacity: 0 },
        { opacity: 0.85, duration: T.bloom.dur * 0.4 },
        T.bloom.at
      );
      tl.to(q('.li-wordglow'), { opacity: 0.3, duration: T.bloom.dur * 0.6 }, T.bloom.at + T.bloom.dur * 0.4);

      /* 3.3–4.5 settle: one ring breath, one eye pulse, dust still twinkling —
         both land back on their base values, so the screen the swipe lifts away
         is exactly the lockup that was built. */
      tl.to(
        mark,
        {
          scale: SHRINK * 1.035,
          duration: T.idle.dur,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: 1,
          transformOrigin: '50% 100%',
        },
        T.idle.at
      );
      tl.to(
        q('.li-eye'),
        { opacity: 1, duration: T.idle.dur, ease: 'sine.inOut', yoyo: true, repeat: 1 },
        T.idle.at
      );

      /* Resting state, started only when the build ends: the ring keeps
         breathing and the eye keeps pulsing while the gate waits for a swipe. */
      rest = () => {
        side.push(
          gsap.to(mark, {
            scale: SHRINK * 1.022,
            duration: 2.6,
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
            transformOrigin: '50% 100%',
          })
        );
        side.push(
          gsap.to(q('.li-halo'), {
            opacity: 0.62,
            duration: 2.1,
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
          })
        );
        side.push(
          gsap.to(q('.li-eye'), {
            opacity: 0.95,
            duration: 1.4,
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
          })
        );
      };
      tl.set(root, { data: 'li-end' }, T.end.at);
    }

    /* Hold the splash dark until the brand fonts and the artwork are actually
       available, so nothing animates against a half-rendered page. */
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      tl.play();
    };
    tl.pause();

    const img = new Image();
    const loaded = new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
      img.src = logoUrl;
      if (img.complete) resolve();
    });
    const fonts =
      document.fonts && document.fonts.load
        ? Promise.all([
            document.fonts.load('800 64px Orbitron'),
            document.fonts.load('500 20px Rajdhani'),
          ]).catch(() => null)
        : Promise.resolve();

    const bail = setTimeout(start, 1400);
    Promise.all([loaded, fonts]).then(() => {
      clearTimeout(bail);
      start();
    });

    return () => {
      clearTimeout(bail);
      side.forEach((t) => t.kill());
      tl.kill();
      field.destroy();
      html.removeAttribute('data-logo-intro');
      html.classList.remove('li-booting');
    };
  }, [reduced]);

  return (
    <div className="li-veil" ref={rootRef} aria-hidden="true" style={{ '--li-logo': `url(${logoUrl})` }}>
      <div className="li-backdrop" />
      <div className="li-glow" />
      <canvas className="li-canvas" />
      <div className="li-edge" />
      <div className="li-flare" />

      {/* The reduced-motion path swaps the whole lockup for one still logo, so
          the animated brand markup is not mounted at all — otherwise it sits in
          the veil's grid and pushes the still image off centre. */}
      {!reduced && (
        <div className="li-brand">
          <div className="li-mark">
            <div className="li-halo" />
            <svg className="li-ring" viewBox="0 0 200 200">
              <path className="li-arc li-arc-bottom" d={ARC_BOTTOM} pathLength={100} />
              <path className="li-arc li-arc-top" d={ARC_TOP} pathLength={100} />
              <path className="li-comet" d={`${ARC_BOTTOM} ${ARC_TOP}`} pathLength={100} />
            </svg>
            <div className="li-knight" />
            <div className="li-eye" />
            <div className="li-flash" />
          </div>

          <div className="li-compose">
            <div className="li-wordglow">Mate Zone</div>
            <div className="li-wordline">
              <span className="li-streak" />
              <span className="li-mate">
                M<span className="li-a">A<span className="li-gem" /></span>TE
                <span className="li-shine" />
              </span>
              <span className="li-zone">ZONE</span>
            </div>
            <div className="li-tagrow">
              <span className="li-rule li-rule-l" />
              <span>
                Play&nbsp;<span className="li-diamond">◆</span>&nbsp;Learn&nbsp;
                <span className="li-diamond">◆</span>&nbsp;Win
              </span>
              <span className="li-rule li-rule-r" />
              <span className="li-sweep" />
            </div>
          </div>
        </div>
      )}

      {reduced && <img className="li-simple" src={logoUrl} alt="" />}
    </div>
  );
}
