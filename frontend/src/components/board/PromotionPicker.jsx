import { useEffect, useId, useRef, useState } from 'react';
import { CBURNETT_SVGS } from '../cburnettPieces';

/* ── Promotion picker — the "board popup" ────────────────────────────────────
 *
 * A self-contained, reusable UI for choosing a promotion piece. It owns nothing
 * but its own presentation and timing: the caller keeps the game, the pending
 * move and the move logic, and simply hands in the square being promoted.
 *
 *   <PromotionPicker
 *     color="w" | "b"
 *     square="e8"                 // the promotion square (the pawn's target)
 *     orientation="white" | "black"
 *     boardWidth={420}            // px width of the board it floats over
 *     inset={12}                  // px padding between the board and its frame
 *     pieces={customPieces}       // optional: the board's own piece renderer
 *     reduced={false}             // prefers-reduced-motion
 *     onSelect={(code) => ...}    // 'q' | 'r' | 'b' | 'n'
 *     onCancel={() => ...}
 *   />
 *
 * Geometry: the four cards are stacked so the QUEEN sits on the promotion
 * square and the rest march toward the centre of the board. If the square is in
 * the bottom half of the displayed board (black promoting, or a flipped board)
 * the stack grows UPWARD so it never runs off the bottom edge.
 */

/* Promotion pieces ordered Q → R → B → N. */
export const PROMO_PIECES = [
  { code: 'q', name: 'Queen' },
  { code: 'r', name: 'Rook' },
  { code: 'b', name: 'Bishop' },
  { code: 'n', name: 'Knight' },
];

const FILES = 'abcdefgh';

/* Timing mirrors the spec: open ≈150ms, close ≈100ms, select feedback ≈90ms.
   The open/close durations live in the stylesheet keyframes; only the JS-side
   delays (close hand-off, pick feedback) need to match them. */
const CLOSE_MS = 100;
const PICK_MS = 90;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/* Fallback glyph renderer (the board's own set is preferred via `pieces`). */
function BuiltInPiece({ code, size }) {
  const svg = CBURNETT_SVGS[code];
  if (!svg) return null;
  return (
    <svg
      viewBox="1 1 43 43"
      width={size}
      height={size}
      style={{ display: 'block' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default function PromotionPicker({
  color = 'w',
  square,
  orientation = 'white',
  boardWidth = 420,
  inset = 0,
  pieces = null,
  reduced = false,
  onSelect,
  onCancel,
}) {
  const uid = useId().replace(/:/g, '');
  const wrapRef = useRef(null);
  const lockedRef = useRef(false);
  const timersRef = useRef([]);

  /* ── geometry ── */
  const sq = boardWidth / 8;
  const file = FILES.indexOf(square?.[0] ?? '');
  const rank = Number.parseInt(square?.[1] ?? '', 10);
  const valid = file >= 0 && rank >= 1 && rank <= 8;

  /* Displayed column/row of the promotion square, honouring orientation. */
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 8 - rank : rank - 1;

  /* Square in the bottom half of the displayed board → stack upward. */
  const stackUp = row >= 4;

  /* Same size as a square, but never below a 48px touch target and never so
     tall that four cards would overrun the board. */
  const card = Math.min(Math.max(Math.round(sq), 48), Math.round(boardWidth / 4));

  const order = stackUp ? [...PROMO_PIECES].reverse() : PROMO_PIECES;
  const queenIndex = order.findIndex((p) => p.code === 'q');

  /* Panel: a single column of four cards, Queen on the promotion square. */
  const panelH = card * order.length;
  const rawLeft = inset + (col + 0.5) * sq - card / 2;
  const rawTop = inset + (row + 0.5) * sq - (stackUp ? order.length - 0.5 : 0.5) * card;
  const left = clamp(rawLeft, inset, inset + boardWidth - card);
  const top = clamp(rawTop, inset, Math.max(inset, inset + boardWidth - panelH));

  const [active, setActive] = useState(queenIndex);
  const [phase, setPhase] = useState('open'); // 'open' | 'closing'
  const [picking, setPicking] = useState(null);

  /* Keep the Queen highlighted by default whenever the stack flips. */
  useEffect(() => { setActive(queenIndex); /* eslint-disable-next-line */ }, [queenIndex]);

  /* Focus the popup so Arrow keys / Enter / Esc work with no click needed. */
  useEffect(() => {
    wrapRef.current?.focus?.();
    const timers = timersRef.current;
    return () => { timers.forEach(clearTimeout); };
  }, []);

  function later(fn, ms) {
    timersRef.current.push(setTimeout(fn, ms));
  }

  function close(then) {
    if (lockedRef.current) return;
    lockedRef.current = true;
    if (reduced) { then?.(); return; }
    setPhase('closing');
    later(() => then?.(), CLOSE_MS);
  }

  function cancel() { close(onCancel); }

  function choose(code) {
    if (lockedRef.current) return;
    if (reduced) { lockedRef.current = true; onSelect?.(code); return; }
    setPicking(code);
    lockedRef.current = true;
    later(() => onSelect?.(code), PICK_MS);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation(); cancel(); return;
    }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault(); e.stopPropagation();
      const code = order[active]?.code;
      if (code) choose(code);
      return;
    }
    let d = 0;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') d = 1;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') d = -1;
    if (d) {
      e.preventDefault(); e.stopPropagation();
      setActive((a) => (a + d + order.length) % order.length);
    }
  }

  function renderGlyph(code) {
    const fn = pieces && pieces[code];
    const size = Math.round(card * 0.86);
    if (typeof fn === 'function') return fn({ squareWidth: size, square, isDragging: false });
    return <BuiltInPiece code={code} size={size} />;
  }

  if (!valid || !square) return null;

  return (
    <>
      {/* ── dim: a single scrim over the whole framed board; tap to cancel ── */}
      <div
        className={`pp-scrim${phase === 'closing' ? ' is-closing' : ''}`}
        onClick={cancel}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* ── the popup: four stacked cards ── */}
      <div
        ref={wrapRef}
        className={`pp${phase === 'closing' ? ' is-closing' : ''}`}
        role="menu"
        aria-label="Choose promotion piece"
        aria-orientation="vertical"
        aria-activedescendant={`pp-${uid}-${order[active]?.code}`}
        tabIndex={-1}
        style={{
          left,
          top,
          width: card,
          height: panelH,
          transformOrigin: stackUp ? '50% 100%' : '50% 0%',
          '--pp-close': `${CLOSE_MS}ms`,
        }}
        onKeyDown={onKeyDown}
      >
        {order.map((p, i) => {
          const code = `${color}${p.code.toUpperCase()}`;
          return (
            <button
              key={p.code}
              id={`pp-${uid}-${p.code}`}
              type="button"
              role="menuitem"
              aria-label={`Promote to ${p.name}`}
              className={`pp-card${active === i ? ' is-active' : ''}${picking === p.code ? ' is-picking' : ''}`}
              style={{ height: card, '--pp-i': i }}
              tabIndex={-1}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => choose(p.code)}
            >
              <span className="pp-glyph">{renderGlyph(code)}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
