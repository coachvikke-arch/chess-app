import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import AnimatedBoard from './board/AnimatedBoard';
import { Chip } from './ui';
import { getPieceTheme, buildCustomPieces } from '../config/pieceTheme';
import { getBoardTheme, getBoardThemeStyles } from '../config/boardThemes';
import { ornateSquareStyles } from '../config/ornateTheme';
import { useAuth } from '../context/AuthContext';

/* Static, non-interactive board preview using the user's board prefs.
   Exported so other puzzle surfaces (e.g. the assignment review navigator)
   render the exact same mini board as the library cards. */
export function MiniBoard({ fen, width }) {
  const { boardTheme: boardThemeId, pieceSet } = useAuth();
  const boardTheme = getBoardTheme(boardThemeId);
  const customPieces = useMemo(() => buildCustomPieces(getPieceTheme(pieceSet || 'cburnett')), [pieceSet]);
  const themeStyles = getBoardThemeStyles(boardTheme);

  return (
    <AnimatedBoard
      position={fen}
      boardWidth={Math.max(120, Math.round(width))}
      boardOrientation="white"
      arePiecesDraggable={false}
      arePiecesAnimated={false}
      animationDuration={0}
      showNotation
      customPieces={customPieces}
      customDarkSquareStyle={themeStyles.darkSquareStyle || { backgroundColor: boardTheme.darkSq }}
      customLightSquareStyle={themeStyles.lightSquareStyle || { backgroundColor: boardTheme.lightSq }}
      /* Ornate themes are a marble texture, not two flat colours — without this
         the card would show a plainer board than the puzzle it opens. */
      customSquareStyles={ornateSquareStyles(boardTheme) || undefined}
      customBoardStyle={themeStyles.boardStyle || { borderRadius: '10px', overflow: 'hidden', boxShadow: '0 8px 18px rgba(15,23,42,0.25)' }}
    />
  );
}

function MoveNav({ moveCount, index, onChange }) {
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