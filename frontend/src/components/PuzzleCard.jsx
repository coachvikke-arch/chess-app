import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import StaticBoard from './StaticBoard';
import { Chip } from './ui';

/* Static, non-interactive board preview using the user's board prefs AND board
   frame. Exported so other puzzle surfaces (e.g. the assignment review
   navigator) render the exact same mini board as the library cards.

   `width` is the OUTER box the card has; `squareStyles` is an optional per-square
   style map (e.g. { e4: {…} }) merged OVER the theme's own square styling, which
   is how the admin review drawer paints the square a replayed move landed on. */
export function MiniBoard({ fen, width, squareStyles }) {
  return <StaticBoard fen={fen} width={width} squareStyles={squareStyles} />;
}

/**
 * MiniBoard mounted only once its card scrolls near the viewport.
 *
 * A board is a full React subtree with 64 squares, and one assignment can carry
 * seventy puzzles — mounting them all at once is slow enough that the grid
 * paints blank. Each card observes itself and keeps a same-size placeholder
 * until it is close to view, so nothing shifts when the board arrives.
 */
export function LazyMiniBoard({ fen, width, squareStyles, maxWidth = 200 }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '400px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="w-full flex justify-center pointer-events-none">
      {visible ? (
        <div className="w-full flex flex-col items-center" style={{ maxWidth }}>
          <MiniBoard fen={fen} width={width} squareStyles={squareStyles} />
        </div>
      ) : (
        <div
          className="rounded bg-black/20"
          style={{ width, height: width }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

export function MoveNav({ moveCount, index, onChange }) {
  const btn =
    'h-8 w-8 grid place-items-center rounded-lg border border-ivory-700/50 bg-black/[0.04] text-sm ' +
    'hover:bg-black/5 hover:border-gold-500/40 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-black/[0.04] disabled:hover:border-ivory-700/50 transition';
  const fire = (fn) => (e) => {
    e.stopPropagation(); // don't toggle card selection when pressing nav buttons
    fn();
  };

  return (
    <div className="flex items-center justify-center gap-1.5 mt-1 select-none" onClick={(e) => e.stopPropagation()}>
      <button title="Go to first move" className={btn} disabled={index === 0} onClick={fire(() => onChange(0))}>⏮️</button>
      <button title="Go to previous move" className={btn} disabled={index === 0} onClick={fire(() => onChange(index - 1))}>◀️</button>
      <span className="min-w-[3rem] text-center text-[0.68rem] text-ivory-500 font-mono">{index}/{moveCount}</span>
      <button title="Go to next move" className={btn} disabled={index >= moveCount} onClick={fire(() => onChange(index + 1))}>▶️</button>
      <button title="Go to last move" className={btn} disabled={index >= moveCount} onClick={fire(() => onChange(moveCount))}>⏭️</button>
    </div>
  );
}

export default function PuzzleCard({ puzzle, selected, onSelect, onKey }) {
  const [index, setIndex] = useState(0);
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(240);

  // Size the board preview to the card's current width (responsive 1/2/4 columns).
  // Capped smaller so more cards fit per row while pieces stay crisp.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(Math.min(el.clientWidth, 200));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fen = useMemo(() => {
    const g = new Chess(puzzle.fen);
    for (let i = 0; i < index; i++) {
      const m = puzzle.uci?.[i];
      if (!m) break;
      try {
        g.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m.length > 4 ? m[4] : undefined });
      } catch {
        break;
      }
    }
    return g.fen();
  }, [puzzle.fen, puzzle.uci, index]);

  const moveCount = puzzle.uci?.length || 0;

  /* Side to move = the active-color field of the FEN (second token, 'w' | 'b').
     Derived per card so each puzzle shows its own position's turn. */
  const sideToMove = useMemo(() => {
    const active = String(puzzle.fen || '').trim().split(/\s+/)[1];
    return active === 'b' ? 'Black to move' : 'White to move';
  }, [puzzle.fen]);

  return (
    <article
      ref={wrapRef}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={onKey}
      className={`rounded-2xl border p-2.5 flex flex-col gap-2 cursor-pointer transition select-none ${selected
          ? 'border-amber-500 bg-amber-400/25 shadow-[0_0_18px_rgba(245,158,11,0.3)]'
          : 'border-amber-500/40 bg-amber-400/[0.06] hover:border-amber-500/70 hover:bg-amber-400/15'
        }`}
    >
      <h3 className="text-xs font-semibold px-0.5 truncate text-ivory-300" title={puzzle.title}>
        {selected && <span className="mr-1 text-amber-600">✓</span>}
        {puzzle.title}
      </h3>

      {/* Flexible wrapper keeps the fixed-width board horizontally centered no
          matter the column width (1/2/4-up) and vertically balanced between the
          title above and the controls below. */}
      <div className="w-full flex justify-center pointer-events-none">
        <div className="w-full max-w-[200px] flex flex-col items-center">
          <MiniBoard fen={fen} width={width} />
        </div>
      </div>

      <MoveNav moveCount={moveCount} index={index} onChange={setIndex} />

      <div className="flex flex-wrap items-center gap-1.5 mt-auto px-0.5">
        <Chip>{puzzle.level && puzzle.difficulty ? `${puzzle.difficulty}` : puzzle.difficulty}</Chip>
        <Chip>{sideToMove}</Chip>
      </div>
    </article>
  );
}