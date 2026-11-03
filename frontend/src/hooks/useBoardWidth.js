import { useCallback, useEffect, useRef, useState } from 'react';

/** Slack allowed when solving for the board, in px.
 *
 *  Fractional layout and the notation row land on sub-pixels, so a solve that is
 *  exactly on the boundary can still measure a pixel or two over and reintroduce
 *  the scrollbar it was meant to remove.
 */
const FIT_SLACK_PX = 6;

/* Absolute width floor. `min` above is the playability floor; the width solve may
   go down to WIDTH_MIN to keep the board inside the screen, and below that the
   area's own scroll is the safety valve. */
const WIDTH_MIN = 160;

const num = (v) => (Number.isFinite(v) ? v : 0);

/* ── classroom main-slot board size: ONE source for both boards ────────────
 * SharedChessBoard (the shared/classroom board, drill mode included) and
 * PvPPlayBoard ("My paired game") render in the SAME main-board slot and must
 * stay the same size: both fit that slot with the same hook family and these
 * same bounds, so a student switching between them sees no jump and a future
 * bound change cannot update one board but not the other. */
export const CLASSROOM_BOARD_MIN = 200;
export const CLASSROOM_BOARD_MAX = 806;
/* Paired/bot-game ceiling. The card stacks players → board → score sheet in a
   single centred column, so the board is the focus and may use the full card
   width. Width-only fitting still shrinks it on small screens, so it stays
   square, responsive and inside the screen. */
export const PAIRED_BOARD_MAX = 560;

/**
 * Largest board box that fits its container on BOTH axes, for a page that must
 * not scroll.
 *
 * WHY THIS EXISTS
 *
 * `useBoardWidth` only ever looks at `window.innerWidth`. On a short window
 * (a 768px laptop, a half-height browser) a 530px board plus its notation row
 * needs more height than the viewport has, so the page grew past it and scrolled -
 * which is exactly what a fixed game screen must not do.
 *
 * WHY IT MEASURES INSTEAD OF COMPUTING
 *
 * What is on screen is the board plus whatever the caller stacks with it
 * (notation, badges). The extra height above the board box is read off the DOM and
 * subtracted, so the solve stays correct when that decoration changes.
 *
 * WHAT `size` MEANS
 *
 * The OUTER box — frame included. ChessBoard carves the frame out of it, so a
 * board fits its space exactly and toggling the frame preference in Settings does
 * not move or resize anything on the page.
 *
 * `min` is a floor, not a promise: below it the board would be too small to play,
 * so the caller is told to let that region scroll instead. Refusing to shrink
 * past the floor is better than silently producing an unusable board or clipping
 * the controls off the screen.
 *
 * Returns `{ areaRef, fitRef, size }`:
 *   - `areaRef` goes on the padded container whose free space is being fitted
 *   - `fitRef` goes on the child sized to `size`, so its extra height above
 *     `size` can be measured as the decoration around the board
 *   - `size` is the `outerWidth` to hand the board
 */
export function useFittedSquare({ max = 530, min = 280, widthOnly = false } = {}) {
  const nodeRef = useRef(null);
  const fitRef = useRef(null);
  /* Callback ref that flips `bound` when the fit area mounts/unmounts.
     The area is not always present on first paint (e.g. the paired game
     renders its fallback until the game loads), so the measure below must
     re-run when the element actually appears - a plain useRef would have
     measured nothing once and then never again. */
  const [bound, setBound] = useState(false);
  const areaRef = useCallback((node) => {
    nodeRef.current = node;
    setBound(!!node);
  }, []);
  /* Start near the viewport width instead of at `max`: on a phone the first
     paint would otherwise render a 530px board and flash a horizontal scrollbar
     before the measured solve below corrects it. */
  const [size, setSize] = useState(() =>
    typeof window === 'undefined' ? max : Math.max(min, Math.min(max, window.innerWidth - 40)),
  );

  useEffect(() => {
    const area = nodeRef.current;
    if (!area) return undefined;

    const measure = () => {
      const cs = getComputedStyle(area);
      /* clientWidth/Height exclude the border, so the padding is subtracted to
         get the space the child may actually occupy. */
      const availW =
        area.clientWidth - num(parseFloat(cs.paddingLeft)) - num(parseFloat(cs.paddingRight));

      /* The width the board may occupy, in outer-box terms: no frame arithmetic,
         because the frame now lives inside what we hand the board. */
      const wCap = Math.max(WIDTH_MIN, Math.min(max, availW - FIT_SLACK_PX));

      /* Width-only mode: the caller's stage flows with the page (no fixed
         height), so there is no bounded height to fit against — the board is
         capped by the available WIDTH (and `max`) alone. Used by the paired
         game so its board lives in normal flow and the page scrolls instead of
         a fixed-height stage clipping it. */
      if (widthOnly) {
        const next = Math.max(min, wCap);
        setSize((prev) => (Math.abs(prev - next) >= 1 ? Math.round(next) : prev));
        return;
      }

      const availH =
        area.clientHeight - num(parseFloat(cs.paddingTop)) - num(parseFloat(cs.paddingBottom));

      /* Height the caller's decoration adds on top of the board box, read from
         what is on screen right now. Defaults to 0 before first paint. */
      const fit = fitRef.current;
      const rendered = fit ? fit.getBoundingClientRect().height : 0;
      const overhead = Math.max(0, rendered - size);

      const next = Math.max(min, Math.min(wCap, availH - overhead - FIT_SLACK_PX));

      /* Only commit a real change: re-rendering with the same size would
         re-run this effect through the ResizeObserver without ever settling. */
      setSize((prev) => (Math.abs(prev - next) >= 1 ? Math.round(next) : prev));
    };

    measure();

    /* Observe the container for both window resizes AND layout changes caused
       by the sidebar appearing or the result panel opening - a ResizeObserver
       on the container catches cases a window resize listener never fires for. */
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(area);
    }
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [max, min, size, widthOnly, bound]);

  return { areaRef, fitRef, size };
}

/**
 * Board width that fits inside an element, measured off that element.
 *
 * WHY THIS EXISTS
 *
 * `useFittedBoardWidth` derives the board from `window.innerWidth`, which is only
 * correct when the board owns the page. The drill cards sit in a multi-column
 * grid, so the space available to each board is whatever its column happens to
 * be - a number no viewport arithmetic can know, and the one that changes when
 * the column count changes.
 *
 * The answer is the OUTER box: the caller hands it to ChessBoard as `outerWidth`
 * and the frame is carved out of it, so a card with a 250px lane shows a board
 * that is 250px wide with the frame on and 250px wide with it off.
 *
 * `min` is a floor, as elsewhere: below it the position is too small to read, so
 * the region is allowed to overflow rather than showing an unusable sliver.
 */
export function useFittedWidthIn(ref, { max = 252, min = 120, slack = 4 } = {}) {
  const [width, setWidth] = useState(max);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const measure = () => {
      const next = Math.max(min, Math.min(max, el.clientWidth - slack));
      /* Same reasoning as useFittedSquare: only commit a real change, or the
         ResizeObserver re-runs this effect forever without settling. */
      setWidth((prev) => (Math.abs(prev - next) >= 1 ? Math.round(next) : prev));
    };

    measure();

    /* The element's width changes when the grid re-columns, not only when the
       window resizes, so the observer is what actually keeps this correct. */
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref, max, min, slack]);

  return width;
}

export default function useBoardWidth(max = 460, pad = 24) {
  const [w, setW] = useState(() =>
    typeof window !== 'undefined' ? Math.min(max, window.innerWidth - pad) : max
  );

  useEffect(() => {
    const update = () => setW(Math.min(max, window.innerWidth - pad));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [max, pad]);

  return w;
}

/**
 * Width for a ChessBoard rendered inside its responsive themed frame. The result
 * is the OUTER box — `.rem-outer` included — so the framed board fills the column
 * instead of bursting it, and the same number works with the frame switched off.
 * The Student shell shows its 240px sidebar from md (768px) up, so that is
 * subtracted there. Desktop stays at `max`.
 */
export function useFittedBoardWidth(max = 460) {
  const compute = () => {
    if (typeof window === 'undefined') return max;
    const iw = window.innerWidth;
    const shell = iw >= 768 ? 288 : 24; // 240px sidebar + gap + page pad, vs page pad only
    const pad = iw >= 768 ? 36 : 20;    // a little breathing room either side of the board
    return Math.max(200, Math.min(max, iw - shell - pad));
  };
  const [w, setW] = useState(compute);

  useEffect(() => {
    const update = () => setW(compute());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [max]);

  return w;
}