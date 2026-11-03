import { memo, useEffect, useMemo, useRef, useState } from 'react';
import BoardFrame, { boardSquaresFor, isRoyalFrame } from '../../components/BoardFrame';
import { useAuth } from '../../context/AuthContext';
import { getBoardTheme, getBoardThemeStyles } from '../../config/boardThemes';
import { ornateSquareStyles } from '../../config/ornateTheme';
import { LABEL_MIN_SQUARES } from '../../utils/boardFrame';
import { boardGrid, pieceGlyph, squareColor } from './boardVisionLogic';
import './boardVision.css';

/**
 * InteractiveChessboard — lightweight 8x8 grid of real <button> squares.
 * (Deliberately NOT react-chessboard: vision drills need per-square taps,
 * highlights, hidden-coordinate and hidden-piece stages, and full keyboard
 * access — all trivial with buttons, painful with a drag-and-drop board.)
 *
 * It keeps its own squares, so it borrows the app's two board settings rather
 * than hardcoding a palette: the squares are painted from the saved board theme
 * (including the ornate themes' per-square texture) and the grid is wrapped in
 * the shared BoardFrame when Board Frame is on. The frame is carved out of the
 * measured box, so toggling it changes neither the card nor the page.
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
  const { boardTheme: boardThemeId, boardFrame, hasCustomBoardColors } = useAuth();
  const boardTheme = getBoardTheme(boardThemeId);
  const themeStyles = useMemo(
    () => getBoardThemeStyles(boardTheme),
    [boardTheme, hasCustomBoardColors],
  );

  const grid = boardGrid(orientation);
  const hideCoords = blindStage >= 1;
  const hidePieces = blindStage >= 2;
  const hideBoard = blindStage >= 3;

  /* The grid is fluid (it fills its column up to 520px), while the frame's band
     and trim are pixel amounts derived from the play area. Measure the box, then
     solve for the squares that are left inside it. */
  const wrapRef = useRef(null);
  const [box, setBox] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setBox(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const framed = boardFrame !== false;
  const squares = box > 0 ? (framed ? boardSquaresFor(box) : box) : 0;
  const bandLabels = framed && squares >= LABEL_MIN_SQUARES && showCoordinates && !hideCoords;
  /* The drill's own black/white accessibility toggle outranks the saved theme,
     so in that mode the squares keep their CSS palette and nothing is painted
     over them. The map is memoised because each square is a memoized button —
     a fresh style object per render would re-render all sixty-four. */
  const painted = !highContrast;
  const squareStyles = useMemo(() => {
    if (!painted) return null;
    const ornate = ornateSquareStyles(boardTheme);
    const light = themeStyles.lightSquareStyle || { backgroundColor: boardTheme.lightSq };
    const dark = themeStyles.darkSquareStyle || { backgroundColor: boardTheme.darkSq };
    const map = {};
    for (const rank of '87654321') {
      for (const file of 'abcdefgh') {
        const sq = `${file}${rank}`;
        map[sq] = ornate?.[sq] || (squareColor(sq) === 'light' ? light : dark);
      }
    }
    return map;
  }, [painted, boardTheme, themeStyles]);

  const board = (
    <div
      className={`bv-board${hideBoard ? ' bv-board-hidden' : ''}`}
      role="grid"
      aria-label={ariaBoardLabel}
      style={{
        ...(squares > 0 ? { width: squares } : null),
        ...(painted ? themeStyles.boardStyle : null),
      }}
    >
      {grid.map((row, ri) => row.map((sq, ci) => (
        <BoardSquare
          key={sq}
          square={sq}
          color={squareColor(sq)}
          themeStyle={squareStyles?.[sq] || null}
          piece={hidePieces ? null : pieces[sq]}
          showCoord={showCoordinates && !hideCoords && !bandLabels && (ci === 0 || ri === 7 || (orientation === 'black' && (ci === 7 || ri === 0)))}
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
  );

  return (
    <div
      ref={wrapRef}
      className={`bv-board-wrap${highContrast ? ' bv-hc' : ''}`}
      role="group"
      aria-label={ariaBoardLabel}
    >
      {framed && squares > 0 ? (
        <BoardFrame
          squares={squares}
          boardTheme={boardTheme}
          orientation={orientation}
          royalOrnate={isRoyalFrame(boardTheme)}
          showLabels={bandLabels}
        >
          {board}
        </BoardFrame>
      ) : board}
      {hideBoard && (
        <p className="bv-board-hidden-note" role="status">
          Board hidden — answer from memory. Coordinates: files a–h, ranks 1–8.
        </p>
      )}
    </div>
  );
}

const BoardSquare = memo(function BoardSquare({
  square, color, themeStyle, piece, showCoord, coordLabel,
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
      style={themeStyle || undefined}
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
