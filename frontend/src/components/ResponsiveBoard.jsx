import { useLayoutEffect, useRef, useState } from 'react';
import ChessBoard from './ChessBoard';
import { MIN_SQUARES, squaresForOuter } from '../utils/boardFrame';

/* ──────────────────────────────────────────────────────────────────────────
 * ONE responsive board sizer, shared by the Game Review page and the imported
 * game (Chess.com) review card.
 *
 * ChessBoard draws fixed-pixel squares, so "fill the container" has to be
 * solved in JS. The number this hands back is the OUTER box — themed frame
 * included — and ChessBoard carves the frame out of it, which is what makes a
 * board the same size with the frame on as with it off: the space is decided by
 * the layout, never by the decoration sitting inside it. The measurement is
 * repeated by a ResizeObserver, so rotation, a sidebar/panel opening, a tab
 * switch or a window resize all re-fit the board instead of leaving it stuck at
 * whatever the first paint happened to be.
 * ────────────────────────────────────────────────────────────────────────── */

/* Both bounds describe the outer box. */
export const MIN_BOARD = 200;
export const MAX_BOARD = 400;

/**
 * Width of the box a board may occupy inside `available` (and optionally
 * `maxHeight`).
 *
 * Historically this returned the play-area width and every caller then let the
 * frame hang outside it, so the same board measured ~90px wider with the frame on
 * than off. It now returns the outer box; `squaresForOuter` is what ChessBoard
 * applies to it, and is exported below for callers that lay something out
 * against the squares (overlays, plates).
 */
export function fitBoardWidth(available, { max = MAX_BOARD, maxHeight = Infinity } = {}) {
  if (!(available > 0)) return 0;
  return Math.floor(Math.max(MIN_BOARD, Math.min(max, available, maxHeight)));
}

/** Play area a board gets inside the box returned above, framed or bare. */
export const boardSquaresFor = (outer, { framed = true } = {}) =>
  (framed ? squaresForOuter(outer) : Math.max(MIN_SQUARES, Math.floor(outer)));

/**
 * Board that fills its container.
 *
 * The wrapper is `width: 100%` (optionally capped by maxWidth/height), and the
 * board is only rendered once that wrapper has a real measured width, so the
 * first paint never shows a 0px or a guessed-width board.
 */
export default function ResponsiveBoard({
  className = '',
  maxWidth = MAX_BOARD,
  maxHeight = Infinity,
  /* null means "no opinion", which is how ChessBoard distinguishes a caller that
     says nothing from one that forces a bare board. `false` used to be the
     default, and ChessBoard reads that as "frame forced ON" (`!frameless`) — so
     this component overrode the saved Board Frame preference for every page that
     did not pass the prop, Game Review among them. */
  frameless = null,
  ...boardProps
}) {
  const boxRef = useRef(null);
  const [outer, setOuter] = useState(0);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    let last = 0;

    const measure = () => {
      const available = box.clientWidth;
      if (available <= 0) return;
      const next = fitBoardWidth(available, { max: maxWidth, maxHeight });
      if (next === last) return;
      last = next;
      setOuter(next);
    };

    measure();

    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(box);
    }
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [maxWidth, maxHeight]);

  return (
    <div
      ref={boxRef}
      className={`responsive-board${className ? ` ${className}` : ''}`}
      style={{ width: '100%', maxWidth: Number.isFinite(maxWidth) ? maxWidth : undefined }}
    >
      {outer > 0
        ? <ChessBoard {...boardProps} frameless={frameless} outerWidth={outer} />
        : <div className="responsive-board-placeholder" aria-hidden="true" />}
    </div>
  );
}
