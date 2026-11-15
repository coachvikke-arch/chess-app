import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useBot } from "./BotContext.jsx";
import { HIDDEN_ROUTES, moodImages, normalizeMood, PNG_FALLBACK } from "./botConfig";
import "./bot.css";

const MateBot = lazy(() => import("./MateBot.jsx"));

const POS_KEY = "mz-bot-pos";
const SIZE = () => (window.innerWidth < 640 ? 80 : 110);
const EDGE = 14;
const clamp = (x, y) => {
  const s = SIZE();
  return { x: Math.min(Math.max(0, x), window.innerWidth - s), y: Math.min(Math.max(0, y), window.innerHeight - s) };
};

export default function Bot() {
  const { enabled, authenticated, userRole, suppressed, current, dismiss } = useBot();
  const { pathname } = useLocation();
  const hiddenRoute = HIDDEN_ROUTES.some((r) => pathname.includes(r));
  const publicAuthRoute = pathname === '/' || pathname === '/login' || pathname.startsWith('/reset-password');
  const [pos, setPos] = useState(() => {
    try { return clamp(...Object.values(JSON.parse(localStorage.getItem(POS_KEY)))); }
    catch { return clamp(window.innerWidth - 120, window.innerHeight - 140); }
  });
  const [flying, setFlying] = useState(false);
  const [gliding, setGliding] = useState(false);
  const drag = useRef(null);

  useEffect(() => {
    const onResize = () => setPos((p) => clamp(p.x, p.y));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const save = (p) => localStorage.setItem(POS_KEY, JSON.stringify(p));

  /* A class reminder flies the character to the screen edge it already sits
     closest to, so it stops covering the middle of the page. */
  const glideTo = current?.flyToEdge;
  useEffect(() => {
    if (!glideTo) return undefined;
    const s = SIZE();
    const leftEdge = pos.x + s / 2 < window.innerWidth / 2;
    const target = clamp(leftEdge ? EDGE : window.innerWidth - s - EDGE, pos.y);
    setGliding(true);
    setPos(target);
    save(target);
    const t = window.setTimeout(() => setGliding(false), 1200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  if (!authenticated || userRole !== 'student' || !enabled || suppressed || hiddenRoute || publicAuthRoute) return null;

  const down = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false };
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 5) {
      d.moved = true;
      setFlying(true);
    }
    if (d.moved) setPos(clamp(d.ox + dx, d.oy + dy));
  };
  const up = () => {
    if (drag.current?.moved) save(pos);
    drag.current = null;
    setFlying(false); // MateBot plays the soft landing
  };
  const key = (e) => {
    const step = 12;
    const m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!m) return;
    e.preventDefault();
    const p = clamp(pos.x + m[0], pos.y + m[1]);
    setPos(p); save(p);
  };

  const mood = normalizeMood(current?.mood);
  const onRight = pos.x > window.innerWidth / 2;
  const below = pos.y < 140;
  const look = current ? (onRight ? -1 : 1) : 0;

  return (
    <div
      className={`mzbot mood-${mood}`}
      data-mood={mood}
      style={{
        left: pos.x,
        top: pos.y,
        width: SIZE(),
        transition: gliding ? "left .9s cubic-bezier(.45,.05,.25,1), top .9s cubic-bezier(.45,.05,.25,1)" : "none",
      }}
    >
      {current && (
        <div className={`mzbot-bubble${onRight ? " r" : ""}${below ? " b" : ""}`} role="status" aria-live="polite">
          {current.onClick ? (
            <button type="button" className="mzbot-msg" onClick={() => { current.onClick(); dismiss(); }}>{current.message}</button>
          ) : (
            <span className="mzbot-msg">{current.message}</span>
          )}
          <button type="button" className="mzbot-x" aria-label="Close message" onClick={dismiss}>x</button>
        </div>
      )}
      <div
        className="mzb-body" tabIndex={0} role="img" aria-label="Mate Zone helper bot. Drag to move, or use arrow keys."
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
      >
        <Suspense fallback={<img className="mzb-png" src={moodImages[mood] || PNG_FALLBACK} alt="" draggable="false" />}>
          <MateBot mood={flying ? "fly" : mood} look={look} flying={flying} />
        </Suspense>
      </div>
    </div>
  );
}
