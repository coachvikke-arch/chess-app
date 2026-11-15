import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useBot } from "./BotContext.jsx";
import { HIDDEN_ROUTES, moodImages } from "./botConfig";
import "./bot.css";

const POS_KEY = "mz-bot-pos";
const SIZE = () => (window.innerWidth < 640 ? 80 : 110);
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
  const [waving, setWaving] = useState(true);
  const drag = useRef(null);
  const reduce = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  useEffect(() => {
    const onResize = () => setPos((p) => clamp(p.x, p.y));
    window.addEventListener("resize", onResize);
    const t = setTimeout(() => setWaving(false), 2400); // wave once when the bot first appears
    return () => { window.removeEventListener("resize", onResize); clearTimeout(t); };
  }, []);

  if (!authenticated || userRole !== 'student' || !enabled || suppressed || hiddenRoute || publicAuthRoute) return null;

  const save = (p) => localStorage.setItem(POS_KEY, JSON.stringify(p));
  const down = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false };
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 5) d.moved = true;
    if (d.moved) setPos(clamp(d.ox + dx, d.oy + dy));
  };
  const up = () => { if (drag.current?.moved) save(pos); drag.current = null; };
  const key = (e) => {
    const step = 12;
    const m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!m) return;
    e.preventDefault();
    const p = clamp(pos.x + m[0], pos.y + m[1]);
    setPos(p); save(p);
  };

  const mood = current?.mood || "calm";
  const onRight = pos.x > window.innerWidth / 2;
  const below = pos.y < 140;

  return (
    <div className={`mzbot mood-${mood}${reduce ? " still" : ""}`} style={{ left: pos.x, top: pos.y, width: SIZE() }}>
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
      {mood === "happy" && !reduce && (
        <div className="mzbot-confetti" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ "--i": i }} />)}</div>
      )}
      {mood === "sad" && !reduce && <span className="mzbot-drop" aria-hidden="true" />}
      <div
        className="mzbot-body" tabIndex={0} role="img" aria-label="Mate Zone helper bot. Drag to move, or use arrow keys."
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
      >
        <img className={waving ? "mzbot-img wave" : "mzbot-img"} src={moodImages[mood] || moodImages.calm} alt="" draggable="false" />
      </div>
    </div>
  );
}
