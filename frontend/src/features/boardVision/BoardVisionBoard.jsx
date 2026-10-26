import { memo } from 'react';
import { boardGrid, pieceGlyph, squareColor } from './boardVisionLogic';
import './boardVision.css';

/**
 * InteractiveChessboard — lightweight 8x8 grid of real <button> squares.
 * (Deliberately NOT react-chessboard: vision drills need per-square taps,
 * highlights, hidden-coordinate and hidden-piece stages, and full keyboard
 * access — all trivial with buttons, painful with a drag-and-drop board.)
 *
 * - Exactly 64 squares, a1 dark, correct in both orientations.
 * - Keyboard accessible: every square is a button with an aria-label.
 * - Pieces render as chess glyphs (same set the app uses everywhere), never emoji.
 */
function InteractiveChessboard({
  orientation = 'white',
  pieces = {},
  highlight = null, // square to spotlight (question target for coordinate mode)
  selected = null,
  lastResult = null, // { square, ok } — success/error marker (icon + label, never color alone)
  revealSquare = null,
  showCoordinates = true,
  blindStage = 0, // 0 none, 1 hide coords, 2 hide pieces, 3 hide board
  highContrast = false,
  highlightSelected = true,
  disabled = false,
  ariaBoardLabel = 'Chessboard',
  onSquareTap,
}) {
  const grid = boardGrid(orientation);
  const hideCoords = blindStage >= 1;
  const hidePieces = blindStage >= 2;
  const hideBoard = blindStage >= 3;

  return (
    <div
      className={`bv-board-wrap${highContrast ? ' bv-hc' : ''}`}
      role="group"
      aria-label={ariaBoardLabel}
    >
      <div className={`bv-board${hideBoard ? ' bv-board-hidden' : ''}`} role="grid" aria-label={ariaBoardLabel}>
        {grid.map((row, ri) => row.map((sq, ci) => (
          <BoardSquare
            key={sq}
            square={sq}
            color={squareColor(sq)}
            piece={hidePieces ? null : pieces[sq]}
            showCoord={showCoordinates && !hideCoords && (ci === 0 || ri === 7 || (orientation === 'black' && (ci === 7 || ri === 0)))}
            coordLabel={sq}
            isHighlight={highlight === sq}
            isSelected={highlightSelected && selected === sq}
            result={lastResult && lastResult.square === sq ? lastResult : null}
            isReveal={revealSquare === sq}
            disabled={disabled}
            onTap={onSquareTap}
          />
        )))}
      </div>
      {hideBoard && (
        <p className="bv-board-hidden-note" role="status">
          Board hidden — answer from memory. Coordinates: files a–h, ranks 1–8.
        </p>
      )}
    </div>
  );
}

const BoardSquare = memo(function BoardSquare({
  square, color, piece, showCoord, coordLabel,
  isHighlight, isSelected, result, isReveal, disabled, onTap,
}) {
  const label = piece
    ? `${square}, ${(piece.color === 'w' ? 'white' : 'black')} ${pieceName(piece.type)}`
    : square;
  return (
    <button
      type="button"
      role="gridcell"
      aria-label={label}
      disabled={disabled}
      onClick={() => onTap?.(square)}
      className={[
        'bv-sq',
        color === 'light' ? 'bv-sq-light' : 'bv-sq-dark',
        isHighlight ? 'bv-sq-spot' : '',
        isSelected ? 'bv-sq-sel' : '',
        result ? (result.ok ? 'bv-sq-good' : 'bv-sq-bad') : '',
        isReveal ? 'bv-sq-reveal' : '',
      ].join(' ')}
    >
      {piece && (
        <span className={`bv-piece ${piece.color === 'w' ? 'bv-piece-w' : 'bv-piece-b'}`} aria-hidden="true">
          {pieceGlyph(piece)}
        </span>
      )}
      {showCoord && (
        <span className="bv-coord" aria-hidden="true">{coordLabel}</span>
      )}
      {result && (
        <span className={`bv-mark ${result.ok ? 'bv-mark-good' : 'bv-mark-bad'}`} aria-hidden="true">
          {result.ok ? '✓' : '✕'}
        </span>
      )}
      {isReveal && !result && (
        <span className="bv-reveal-ring" aria-hidden="true" title="Answer" />
      )}
    </button>
  );
});

function pieceName(t) {
  return { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }[t] || t;
}

export default memo(InteractiveChessboard);
