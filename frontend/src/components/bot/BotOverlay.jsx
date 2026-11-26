import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ClockBot from "./ClockBot";
import { useBot } from "./BotProvider";
import { POKE_PLAYERS } from "./botI18n";
import "./ClockBot.css";

const POS_KEY = "mz_bot_pos";
const DRAG_THRESHOLD = 5; // px before a press becomes a drag, so taps still poke

const readPos = () => {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY));
    if (v && Number.isFinite(v.x) && Number.isFinite(v.bottom)) return v;
  } catch { /* ignore broken value */ }
  return null;
};
const writePos = (pos) => {
  try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* private mode */ }
};

/** Floating bot over the whole app. Mount ONCE in the shared layout, inside <BotProvider>.
 *  Rendered through a portal on <body> so no shell container's overflow or
 *  transform can clip or re-anchor it. Visibility is controlled only from
 *  Settings; the bot itself is the only interactive part here. */
export default function BotOverlay({ size = 120, right = 16, bottom = 16 }) {
  const { mood, msg, react, t, visible, setMounted } = useBot();
  const [pos, setPos] = useState(readPos);
  const [dragging, setDragging] = useState(false);
  const [poked, setPoked] = useState(false);
  const dockRef = useRef(null);
  const dragRef = useRef(null);
  const movedRef = useRef(false);
  const clickTimes = useRef([]);
  const pokeTimer = useRef();

  const botH = size * 1.35;

  const clampPos = useCallback((p) => ({
    x: Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - size)),
    bottom: Math.min(Math.max(0, p.bottom), Math.max(0, window.innerHeight - botH)),
  }), [size, botH]);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, [setMounted]);

  /* Keep a dragged bot inside the window when the viewport shrinks. */
  useEffect(() => {
    if (!pos) return undefined;
    const onResize = () => setPos((p) => {
      const c = clampPos(p);
      writePos(c);
      return c;
    });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pos, clampPos]);

  useEffect(() => () => clearTimeout(pokeTimer.current), []);

  const onPointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const r = dockRef.current.getBoundingClientRect();
    dragRef.current = {
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      left: r.left,
      bottom: window.innerHeight - r.bottom,
    };
    movedRef.current = false;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!movedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    movedRef.current = true;
    setDragging(true);
    clickTimes.current = [];
    setPos({ x: d.left + dx, bottom: d.bottom - dy });
  };

  const endDrag = (e) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (movedRef.current) {
      setPos((p) => {
        const c = clampPos(p);
        writePos(c);
        return c;
      });
    }
  };

  const onBotClick = () => {
    if (movedRef.current) { movedRef.current = false; return; }
    const now = Date.now();
    const recent = clickTimes.current.filter((ts) => now - ts < 2200);
    recent.push(now);
    clickTimes.current = recent;
    if (recent.length >= 3) {
      clickTimes.current = [];
      const name = POKE_PLAYERS[Math.floor(Math.random() * POKE_PLAYERS.length)];
      react("angry", "pokeAngry", 4500, { name }, true);
      setPoked(true);
      clearTimeout(pokeTimer.current);
      pokeTimer.current = setTimeout(() => setPoked(false), 4500);
      return;
    }
    react("happy", "greet", 2500);
  };

  if (!visible) return null;

  const placed = pos ? clampPos(pos) : null;
  const top = placed ? window.innerHeight - placed.bottom - botH : window.innerHeight - bottom - botH;
  const below = top < 96;
  const style = placed
    ? { left: placed.x, bottom: placed.bottom, right: "auto" }
    : { right, bottom: `calc(${bottom}px + env(safe-area-inset-bottom, 0px))` };

  return createPortal(
    <div
      ref={dockRef}
      className={`cb-dock${below ? " below" : ""}${dragging ? " dragging" : ""}`}
      style={style}
      aria-live="polite"
    >
      {msg && !dragging && (
        <div
          className={`cb-bubble${poked ? " cb-bubble-hot" : ""}${placed && placed.x < 220 ? " cb-bubble-left" : ""}`}
          key={msg + mood}
        >
          {msg}
        </div>
      )}
      <button
        type="button"
        className={`cb-hit${dragging ? " dragging" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={onBotClick}
        aria-label={t("label")}
      >
        <ClockBot mood={mood} size={size} follow={!dragging} poked={poked} act={dragging ? "drag" : ""} />
      </button>
    </div>,
    document.body
  );
}
