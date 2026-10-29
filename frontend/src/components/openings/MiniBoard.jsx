import { useMemo } from 'react';
import { Card } from '../ui';
import AnimatedBoard from '../board/AnimatedBoard';
import { useAuth } from '../../context/AuthContext';
import { getPieceTheme, buildCustomPieces } from '../../config/pieceTheme';
import { getBoardTheme, getBoardThemeStyles } from '../../config/boardThemes';
import { ornateSquareStyles } from '../../config/ornateTheme';

/* Opening-library preview. It used to draw its own beige/brown squares with
   Unicode glyphs, which made the library the only board surface that ignored
   the user's chosen board and piece themes. It now renders the same themed
   board as every other preview, just smaller and non-interactive. */
export default function MiniBoard({ fen, orientation = 'white', size = 220 }) {
  const { boardTheme: boardThemeId, pieceSet } = useAuth();
  const boardTheme = getBoardTheme(boardThemeId);
  const themeStyles = getBoardThemeStyles(boardTheme);
  const customPieces = useMemo(
    () => buildCustomPieces(getPieceTheme(pieceSet || 'cburnett')),
    [pieceSet],
  );
  const ornateSquares = useMemo(() => ornateSquareStyles(boardTheme), [boardTheme]);

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-white/10"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <AnimatedBoard
        position={fen}
        boardWidth={size}
        boardOrientation={orientation}
        arePiecesDraggable={false}
        arePiecesAnimated={false}
        animationDuration={0}
        showNotation={false}
        customPieces={customPieces}
        customDarkSquareStyle={themeStyles.darkSquareStyle || { backgroundColor: boardTheme.darkSq }}
        customLightSquareStyle={themeStyles.lightSquareStyle || { backgroundColor: boardTheme.lightSq }}
        customSquareStyles={ornateSquares || undefined}
        customBoardStyle={themeStyles.boardStyle || { borderRadius: '8px', overflow: 'hidden' }}
      />
    </div>
  );
}

export function MiniBoardCard({ fen, orientation = 'white', size = 220, children }) {
  return (
    <Card className="bg-white/[0.02]" piece="♘">
      <div className="flex flex-col items-center gap-3">
        <MiniBoard fen={fen} orientation={orientation} size={size} />
        {children}
      </div>
    </Card>
  );
}
