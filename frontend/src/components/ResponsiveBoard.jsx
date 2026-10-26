import { useLayoutEffect, useRef, useState } from 'react';
import ChessBoard from './ChessBoard';

/* ──────────────────────────────────────────────────────────────────────────
 * ONE responsive board sizer, shared by the Game Review page and the imported
 * game (Chess.com) review card.
 *
 * ChessBoard draws fixed-pixel squares, so "fill the container" has to be
 * solved in JS: measure the space the board actually has, subtract the themed
 * frame that ChessBoard wraps around those squares, and hand the result back as
 * `boardWidth`. The measurement is repeated by a ResizeObserver, so rotation,
 * a sidebar/panel opening, a tab switch or a window resize all re-fit the
 * board instead of leaving it stuck at whatever the first paint happened to be.
 * ────────────────────────────────────────────────────────────────────────── */

export const MIN_BOARD = 160;
export const MAX_BOARD = 560;

/* Mirrors ChessBoard's own band arithmetic and the frame's padding/borders.
   `frameRemC` is the marble band on each side of the squares. */
export const frameRemC = (bw) => Math.min(46, Math.max(20, Math.round(bw * 0.082)));

/* Total width the themed frame adds around a `bw`-wide square area. The +31 is
   the frame's real chrome: rem-content band padding (2 × remC), the frame's
   12px padding (24), and the frame/rem-outer borders (~7). Three pixels of
   slack keep fractional layout from producing a horizontal scrollbar. */
export const frameOf = (bw) => 2 * frameRemC(bw) + 34;

/** Outer width of a framed board whose play area is `bw` wide. */
export const framedOuterWidth = (bw) => bw + 2 * frameRemC(bw) + 31;

/**
 * Largest play-area width that fits `available` (and optionally `maxHeight`)
 * once ChessBoard's frame is added. The frame's band size is itself derived
 * from the board width, so this solves by a few converging passes.
 */
export function fitBoardWidth(available, { max = MAX_BOARD, maxHeight = Infinity, frameless = false } = {}) {
  if (!(available > 0)) return 0;
  const widthCap = Math.min(available, max);
  if (frameless) {
    return Math.floor(Math.max(MIN_BOARD, Math.min(widthCap, maxHeight)));
  }
  let bw = Math.min(widthCap, maxHeight);
  for (let i = 0; i < 6; i += 1) {
    /* The frame must fit INSIDE the available width and height too, otherwise
       a framed board can render wider than its wrapper (clipped or spilling). */
    const next = Math.min(widthCap, maxHeight) - frameOf(bw);
    if (Math.abs(next - bw) < 1) { bw = next; break; }
    bw = next;
  }
  return Math.floor(Math.max(MIN_BOARD, bw));
}

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
  frameless = false,
  ...boardProps
}) {
  const boxRef = useRef(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    let last = 0;

    const measure = () => {
      const available = box.clientWidth;
      if (available <= 0) return;
      const next = fitBoardWidth(available, { max: maxWidth, maxHeight, frameless });
      if (next === last) return;
      last = next;
      setWidth(next);
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
  }, [maxWidth, maxHeight, frameless]);

  return (
    <div
      ref={boxRef}
      className={`responsive-board${className ? ` ${className}` : ''}`}
      style={{ width: '100%', maxWidth: Number.isFinite(maxWidth) ? maxWidth : undefined }}
    >
      {width > 0
        ? <ChessBoard {...boardProps} frameless={frameless} boardWidth={width} />
        : <div className="responsive-board-placeholder" aria-hidden="true" />}
    </div>
  );
}
