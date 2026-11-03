import { useMemo } from 'react';
import AnimatedBoard from './board/AnimatedBoard';
import BoardFrame, { boardSquaresFor, isRoyalFrame } from './BoardFrame';
import { useAuth } from '../context/AuthContext';
import { getPieceTheme, buildCustomPieces } from '../config/pieceTheme';
import { getBoardTheme, getBoardThemeStyles } from '../config/boardThemes';
import { ornateSquareStyles } from '../config/ornateTheme';

/**
 * StaticBoard — the one non-interactive position preview in the app.
 *
 * Puzzle cards, the homework cards, the review navigator and the assignment
 * drawer all used to carry their own copy of this board. Each copy read the
 * board theme but not the Board Frame, which is why a frame could be ON in
 * Settings and still missing from a card. This one reads both, wraps itself in
 * the shared `BoardFrame`, and takes the OUTER box like every other board:
 * `width` is the space the caller has, and the frame is carved out of it, so a
 * card measures the same with the frame on as with it off.
 *
 * `squareStyles` is merged OVER the theme's own square styling (the ornate
 * marble stays, a highlighted square lands on top) — that is how the review
 * drawer paints the square a replayed move landed on.
 */
export default function StaticBoard({
  fen,
  width,
  orientation = 'white',
  squareStyles = null,
  className = '',
}) {
  const { boardTheme: boardThemeId, pieceSet, hasCustomBoardColors, boardFrame } = useAuth();
  const boardTheme = getBoardTheme(boardThemeId);
  const themeStyles = getBoardThemeStyles(boardTheme);
  const framed = boardFrame !== false;
  const customPieces = useMemo(
    () => buildCustomPieces(getPieceTheme(pieceSet || 'cburnett')),
    [pieceSet],
  );
  const ornateSquares = useMemo(
    () => ornateSquareStyles(boardTheme),
    [boardTheme, hasCustomBoardColors],
  );
  const merged = useMemo(() => {
    if (!ornateSquares && !squareStyles) return undefined;
    return { ...(ornateSquares || {}), ...(squareStyles || {}) };
  }, [ornateSquares, squareStyles]);

  const outer = Math.max(120, Math.round(width));
  const squares = framed ? boardSquaresFor(outer) : outer;

  const diagram = (
    <AnimatedBoard
      position={fen}
      boardWidth={squares}
      boardOrientation={orientation}
      arePiecesDraggable={false}
      arePiecesAnimated={false}
      animationDuration={0}
      /* The band carries the coordinates when framed; bare, they live inside the
         edge squares like every other board in the app. */
      showBoardNotation={false}
      insideNotation={!framed}
      customPieces={customPieces}
      customDarkSquareStyle={themeStyles.darkSquareStyle || { backgroundColor: boardTheme.darkSq }}
      customLightSquareStyle={themeStyles.lightSquareStyle || { backgroundColor: boardTheme.lightSq }}
      customSquareStyles={merged}
      customBoardStyle={themeStyles.boardStyle || { borderRadius: '10px', overflow: 'hidden' }}
    />
  );

  if (!framed) return <div className={className}>{diagram}</div>;

  return (
    <BoardFrame
      outerWidth={outer}
      squares={squares}
      boardTheme={boardTheme}
      orientation={orientation}
      royalOrnate={isRoyalFrame(boardTheme)}
    >
      {diagram}
    </BoardFrame>
  );
}
