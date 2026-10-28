/**
 * TacticBoard — a static, read-only tactic diagram.
 *
 * Both the pieces AND the squares come from the shared theme registries, so a
 * tactic card shows exactly the board the reader has chosen everywhere else.
 * The diagram used to keep its own grey square pair; that made it the one
 * surface in the app that ignored the Board Theme setting. Highlights and
 * arrows are overlaid above the pieces.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import AnimatedBoard from '../../../components/board/AnimatedBoard';
import { useAuth } from '../../../context/AuthContext';
import { buildCustomPieces, getPieceTheme } from '../../../config/pieceTheme';
import { getBoardTheme, getBoardThemeStyles } from '../../../config/boardThemes';
import { ornateSquareStyles } from '../../../config/ornateTheme';

/** Colour tokens for the highlight washes, keyed by the data file's names. */
const HIGHLIGHT_FILL = {
  red: '#f3b6b6',
  orange: '#f6cf8a',
  green: '#cfe8c4',
};

/** Tactic arrow colour, kept from the original diagram. */
const ARROW_FILL = '#d9712f';

/** 'e4' -> { x, y } in board units (0..8), with a1 at the bottom-left. */
function squareToXY(square) {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const file = files.indexOf(square[0]);
  const rank = Number(square[1]);
  return { x: file, y: 8 - rank };
}

/** The original straight-line tactic arrow, unchanged. */
function Arrow({ from, to }) {
  const a = squareToXY(from);
  const b = squareToXY(to);
  const x1 = a.x + 0.5;
  const y1 = a.y + 0.5;
  let x2 = b.x + 0.5;
  let y2 = b.y + 0.5;

  /* Stop short of the target centre so the head does not sit on the piece: a
     knight arrow and a rook arrow otherwise end at visibly different distances
     from the square they name. */
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const trim = len > 1 ? 0.34 : 0.2;
  x2 -= (dx / len) * trim;
  y2 -= (dy / len) * trim;

  /* Head drawn as its own triangle rather than an SVG marker so the size is in
     board units and scales with the board instead of the stroke width. */
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 0.26;
  const wing = 0.16;
  return (
    <g stroke="none" fill={ARROW_FILL}>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={ARROW_FILL} strokeWidth={0.13} strokeLinecap="round" opacity="0.92"
      />
      <polygon
        points={[
          `${x2 + Math.cos(angle) * head},${y2 + Math.sin(angle) * head}`,
          `${x2 + Math.cos(angle + Math.PI / 2.4) * wing},${y2 + Math.sin(angle + Math.PI / 2.4) * wing}`,
          `${x2 + Math.cos(angle - Math.PI / 2.4) * wing},${y2 + Math.sin(angle - Math.PI / 2.4) * wing}`,
        ].join(' ')}
      />
    </g>
  );
}

/**
 * @param {string}  fen            position to draw
 * @param {object[]} arrows        [{from,to}] — hidden while null
 * @param {object[]} highlights    [{square,color}] — hidden while null
 */
export default function TacticBoard({
  fen,
  arrows = null,
  highlights = null,
  className = '',
}) {
  const { boardTheme: boardThemeId, pieceSet } = useAuth();
  const boardTheme = getBoardTheme(boardThemeId);
  const themeStyles = getBoardThemeStyles(boardTheme);
  const customPieces = useMemo(
    () => buildCustomPieces(getPieceTheme(pieceSet || 'cburnett')),
    [pieceSet],
  );
  const ornateSquares = useMemo(() => ornateSquareStyles(boardTheme), [boardTheme]);

  const squareStyles = useMemo(() => {
    /* Ornate themes paint their marble through per-square styles, so the card's
       own highlight wash is merged ON TOP of that base instead of replacing it. */
    const styles = { ...(ornateSquares || {}) };
    for (const highlight of highlights || []) {
      if (highlight?.square) {
        styles[highlight.square] = {
          ...(styles[highlight.square] || {}),
          backgroundColor: HIGHLIGHT_FILL[highlight.color] || highlight.color,
        };
      }
    }
    return styles;
  }, [highlights, ornateSquares]);

  /* react-chessboard needs a pixel width, while the card column is fluid. Measure
     the wrapper once it mounts and on resize, so the diagram always fills it. */
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const update = () => setWidth(el.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={wrapRef}
      className={`tactic-board ${className}`.trim()}
      role="img"
      aria-label="Tactic position"
      style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1' }}
    >
      {width > 0 && (
        <AnimatedBoard
          position={fen}
          boardWidth={Math.round(width)}
          boardOrientation="white"
          arePiecesDraggable={false}
          arePiecesAnimated={false}
          animationDuration={0}
          areArrowsAllowed={false}
          showNotation
          customPieces={customPieces}
          customLightSquareStyle={themeStyles.lightSquareStyle || { backgroundColor: boardTheme.lightSq }}
          customDarkSquareStyle={themeStyles.darkSquareStyle || { backgroundColor: boardTheme.darkSq }}
          customSquareStyles={squareStyles}
          customArrows={[]}
          customBoardStyle={{
            ...(themeStyles.boardStyle || {}),
            width: '100%',
            height: '100%',
            borderRadius: '0.6rem',
            overflow: 'hidden',
          }}
        />
      )}
      {/* Original tactic arrows, drawn above the themed board. */}
      <svg
        viewBox="0 0 8 8"
        aria-hidden="true"
        focusable="false"
        style={{
          position: 'absolute', top: 0, left: 0,
          width: '100%', height: '100%', pointerEvents: 'none',
        }}
      >
        {(arrows || [])
          .filter((arrow) => arrow?.from && arrow?.to && arrow.from !== arrow.to)
          .map((arrow, i) => (
            <Arrow key={`${arrow.from}-${arrow.to}-${i}`} from={arrow.from} to={arrow.to} />
          ))}
      </svg>
    </div>
  );
}
