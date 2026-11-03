import { frameBandFor, framePadFor, squaresForOuter, LABEL_MIN_SQUARES } from '../utils/boardFrame';
import { framePalette } from '../config/ornateTheme';

/**
 * BoardFrame — the themed Board Frame as one shared wrapper.
 *
 * This is the markup ChessBoard draws around its squares: the marble band that
 * carries the coordinate labels, the gold trim ring, and the inner frame. It
 * lives here, rather than inside ChessBoard, so a board that renders its own
 * squares (a static tactic diagram, a mini opening board, a piece-placer) can be
 * wrapped in the SAME frame instead of quietly never showing the user's Board
 * Frame setting. ChessBoard renders through this component, so the two cannot
 * drift apart.
 *
 * `outerWidth` is the box the frame may occupy; `squares` is the play area left
 * inside it. A caller that only knows the box asks for `boardSquaresFor(box)` and
 * sizes what it puts inside to that, which is what keeps a board the same size
 * with the frame on as with it off.
 */

/** Play area that fits inside the box a caller has, once the frame is drawn. */
export const boardSquaresFor = (outerWidth) => squaresForOuter(outerWidth);

/** The Royal Jade/Emerald themes carve a different inner frame; every caller has
    to pick the same one ChessBoard would. */
export const isRoyalFrame = (boardTheme) =>
  Boolean(boardTheme?.ornate) && boardTheme.variant === 'royal';

export default function BoardFrame({
  /* Total box the frame may occupy, band and borders included. */
  outerWidth,
  /* Play area inside it. Derived from `outerWidth` when the caller has not
     already solved for it. */
  squares,
  boardTheme,
  orientation = 'white',
  royalOrnate = false,
  showLabels = true,
  /* Extra classes for the inner frame (ChessBoard adds its own variant flags). */
  className = '',
  children,
}) {
  const boardWidth = Number.isFinite(squares) && squares > 0
    ? squares
    : squaresForOuter(outerWidth);
  const remC = frameBandFor(boardWidth);
  const framePad = framePadFor(boardWidth);
  const pal = framePalette(boardTheme);

  /* Coordinate labels sit on the band, centred on their square. The squares
     start `remC` (the band) + the inner frame's border + its own padding in
     from the `.rem-outer` edge, which is the origin absolute children get.
     On a thumbnail the band is too thin to hold them, so it stays plain. */
  const labels = [];
  if (showLabels && boardWidth >= LABEL_MIN_SQUARES) {
    const sq = boardWidth / 8;
    const origin = remC + framePad + 1.5;
    const farEdge = remC + 2 * (framePad + 1.5) + boardWidth;
    const sqC = (i) => origin + i * sq + sq / 2;
    const bandY = farEdge + remC * 0.5;
    const files = 'abcdefgh'.split('');
    for (let i = 0; i < 8; i++) {
      const f = orientation === 'white' ? i : 7 - i;
      labels.push(
        <span key={`rem-f${i}t`} className="rem-lab" style={{ left: sqC(i), top: remC * 0.5 }}>{files[f]}</span>,
        <span key={`rem-f${i}b`} className="rem-lab" style={{ left: sqC(i), top: bandY }}>{files[f]}</span>,
      );
    }
    for (let j = 0; j < 8; j++) {
      const r = orientation === 'white' ? 8 - j : 1 + j;
      const y = sqC(j);
      labels.push(
        <span key={`rem-r${j}l`} className="rem-lab" style={{ left: remC * 0.5, top: y }}>{r}</span>,
        <span key={`rem-r${j}rr`} className="rem-lab" style={{ left: farEdge + remC * 0.5, top: y }}>{r}</span>,
      );
    }
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <div
        className="rem-outer"
        style={{
          ['--rem-c']: `${remC}px`,
          ['--frame-pad']: `${framePad}px`,
          ['--rem-gold']: pal.gold,
          ['--rem-label']: pal.label,
          ['--rem-plinth-a']: pal.plinthA,
          ['--rem-plinth-b']: pal.plinthB,
        }}
      >
        {labels}
        <div className="rem-content">
          <div className={`chess-board-frame ${royalOrnate ? 'royal-ornate-frame' : 'themed-frame'} ${className}`.trim()}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
