/**
 * Board frame geometry — the ONE place the themed frame's size is known.
 *
 * A framed board is `.rem-outer` (2px border) around `.rem-content` (padding =
 * the marble band) around `.chess-board-frame` (its own padding + 1px border)
 * around the play area. Both the band and the frame's inner padding follow the
 * size of the squares, so a 300px board and a 3000px board look proportionally
 * identical and a 120px thumbnail still has a readable play area instead of
 * mostly border.
 *
 * Everything in the app sizes a board by the OUTER box it has been given and
 * carves the frame out of that (`outerWidth` on ChessBoard), which is what makes
 * a board measure the same with the frame on as with it off. Callers that have to
 * place something against a board — player plates, arrow overlays, badges — use
 * these helpers instead of re-deriving the chrome, because the three arithmetic
 * copies this replaces were each a few pixels wrong and no two pages agreed.
 */

/** px the frame's two borders add around the band, both sides together
    (`.rem-outer` 2px each side + `.chess-board-frame` 1px each side). */
export const FRAME_BORDER = 6;

/** Smallest play area the solver will ever return — a crash guard for a caller
    that asks for a box smaller than a board, not a design floor. */
export const MIN_SQUARES = 32;

/** Below this play-area size the band can no longer hold readable coordinates
    (`.rem-lab` is 60% of the band), so the frame thins its band instead of
    eating a third of a thumbnail. Boards under it still show the frame. */
export const LABEL_MIN_SQUARES = 110;

/** The marble band a board with a `squares`-wide play area draws on each side. */
export const frameBandFor = (squares) => (
  squares < LABEL_MIN_SQUARES
    ? Math.max(4, Math.round(squares * 0.075))
    : Math.min(46, Math.max(10, Math.round(squares * 0.082)))
);

/** The inner frame's own padding (each side) for a `squares`-wide play area. */
export const framePadFor = (squares) =>
  Math.min(12, Math.max(3, Math.round(squares * 0.04)));

/** Outer box of a framed board whose play area is `squares` wide. */
export const framedOuterFor = (squares) =>
  squares + 2 * frameBandFor(squares) + 2 * framePadFor(squares) + FRAME_BORDER;

/**
 * Largest play area whose framed outer box still fits `outer`.
 *
 * The band and the inner padding both follow the play area, which follows the
 * play area's own size, so there is no closed form that is exact at every
 * clamp. Start from the widest the box could possibly hold and step down until
 * the framed board genuinely fits — `framedOuterFor` is strictly increasing, so
 * the first size that fits is the largest one.
 */
export const squaresForOuter = (outer) => {
  if (!(outer > 0)) return MIN_SQUARES;
  let squares = Math.floor(outer) - FRAME_BORDER;
  while (squares > MIN_SQUARES && framedOuterFor(squares) > outer) squares -= 1;
  return Math.max(MIN_SQUARES, squares);
};

/** Where the play area starts inside `.rem-outer`, for a `squares`-wide board:
    the absolute coordinate labels and the arrow overlays are pinned to it.
    `.chess-board-frame.themed-frame` carries a 1.5px border before its padding. */
export const frameInsetFor = (squares) => frameBandFor(squares) + framePadFor(squares) + 1.5;
