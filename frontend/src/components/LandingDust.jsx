import { useEffect, useRef, useState } from 'react';

const COUNT = 74;

/**
 * The star dust the intro leaves behind. It stays in the hero band at low
 * intensity so the brand animation and the landing page read as one scene
 * instead of a splash that ends. Purely decorative: it renders nothing when the
 * OS asks for reduced motion, and its loop parks itself when the band is
 * scrolled away or the tab is in the background.
 */
export default function LandingDust() {
  const canvasRef = useRef(null);
  const [reduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || reduced) return undefined;

    const c2d = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const dots = [];
    let w = 1;
    let h = 1;
    let raf = 0;
    let visible = true;
    let clock = 0;
    let last = 0;

    function size() {
      w = canvas.clientWidth || 1;
      h = canvas.clientHeight || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function seed() {
      dots.length = 0;
      for (let i = 0; i < COUNT; i += 1) {
        dots.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 0.4 + Math.random() * 1.1,
          a: 0.1 + Math.random() * 0.35,
          phase: Math.random() * Math.PI * 2,
          speed: 0.5 + Math.random() * 1.6,
          drift: -(0.03 + Math.random() * 0.08),
        });
      }
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (!visible) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      clock += dt;
      c2d.clearRect(0, 0, w, h);
      c2d.fillStyle = '#d6f2ff';
      for (const d of dots) {
        const tw = 0.5 + 0.5 * Math.sin(clock * d.speed + d.phase);
        c2d.globalAlpha = d.a * (0.2 + 0.8 * tw);
        c2d.beginPath();
        c2d.arc(d.x, d.y, d.r, 0, 6.2832);
        c2d.fill();
        d.y += d.drift;
        if (d.y < -3) {
          d.y = h + 3;
          d.x = Math.random() * w;
        }
      }
      c2d.globalAlpha = 1;
    }

    size();
    seed();
    raf = requestAnimationFrame(frame);

    let onScreen = true;
    const onResize = () => {
      size();
      seed();
    };
    const onVisibility = () => {
      visible = document.visibilityState === 'visible' && onScreen;
      last = 0;
    };
    const io =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(
            ([entry]) => {
              onScreen = entry.isIntersecting;
              visible = onScreen && document.visibilityState === 'visible';
              last = 0;
            },
            { threshold: 0 }
          )
        : null;
    io?.observe(canvas);

    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reduced]);

  if (reduced) return null;
  return <canvas className="li-dust" ref={canvasRef} aria-hidden="true" />;
}
