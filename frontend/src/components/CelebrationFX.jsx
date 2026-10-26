import { useMemo } from 'react';

export const PIECE_GLYPH = {
  w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' },
  b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' },
};

/** Map a chess.js piece type + color to a Unicode glyph. */
export function pieceGlyph(type, color) {
  const c = color === 'b' ? 'b' : 'w';
  return PIECE_GLYPH[c][type] || (c === 'b' ? '♚' : '♔');
}

/* No "Brilliant!" cheer: a brilliant move has its own board animation and must
   never also produce a popup/bubble. */
const CHEERS = ['Excellent!', 'Great move!', 'Nailed it!', 'Perfect!'];

function cheer() {
  return CHEERS[Math.floor(Math.random() * CHEERS.length)];
}

/* Sparkle burst directions (unit vectors) */
const SPARKS = [
  [-1, -1], [-1, 0.7], [0.7, -1], [1, 1],
  [-0.7, 1], [1, -0.7], [0, -1.35], [-1.35, 0],
];

/* ── board → pixel mapping (mirrors the move-badge math in ChessBoard) ──
   The FX layer is mounted inside `.chess-board-frame` (1px border + 12px of
   padding around the actual board), so squares start at that inset. */
const FRAME_INSET = 13;

function squareRect(square, squarePx, orientation) {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1], 10) - 1;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  return { x: FRAME_INSET + col * squarePx, y: FRAME_INSET + row * squarePx };
}

/**
 * Duolingo-style task-completion FX layered over a live chessboard.
 *
 * Props:
 *  - fx: { key, kind: 'correct'|'solved'|'checkmate',
 *          square, kingSquare, piece, msg, xp, streak }
 *        Keyed with a fresh value each time so the animation replays.
 *  - squarePx: rendered width of one board square (pixels).
 *  - orientation: 'white' | 'black'
 *
 * Pure presentational layer — pointer-events: none so the board stays usable.
 */
export default function CelebrationFX({ fx, squarePx = 52.5, orientation = 'white' }) {
  const sparks = useMemo(
    () =>
      SPARKS.map(([dx, dy], i) => ({
        i,
        dx: dx * squarePx * 0.42,
        dy: dy * squarePx * 0.42,
        delay: (i % 4) * 0.05,
      })),
    [fx?.key, squarePx], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!fx) return null;

  const kind = fx.kind || 'correct';
  const msg = fx.msg || (kind === 'checkmate' ? 'CHECKMATE!' : kind === 'solved' ? 'Solved!' : cheer());
  const xp = fx.xp ?? 10;
  const streak = fx.streak ?? 0;
  const piece = fx.piece || '♞';

  const drop = fx.square ? squareRect(fx.square, squarePx, orientation) : null;
  const king = fx.kingSquare ? squareRect(fx.kingSquare, squarePx, orientation) : null;

  return (
    <div className="cc-layer" aria-hidden="true">
      {/* ── destination square spotlight ── */}
      {drop && (
        <div className="cc-sq" style={{ left: drop.x, top: drop.y, width: squarePx, height: squarePx }}>
          <span className="cc-glow" />
          <span className="cc-ripple" />
          <span className="cc-ripple cc-r2" />
          {kind === 'checkmate' && <span className="cc-mate-ring" />}
          {sparks.map((sp) => (
            <span
              key={sp.i}
              className="cc-spark"
              style={{ '--dx': `${sp.dx}px`, '--dy': `${sp.dy}px`, animationDelay: `${sp.delay}s` }}
            />
          ))}
          <span className="cc-piece" style={{ fontSize: squarePx * 0.62 }}>{piece}</span>
        </div>
      )}

      {/* ── checkmate: highlight the mated king ── */}
      {kind === 'checkmate' && king && (
        <div className="cc-sq" style={{ left: king.x, top: king.y, width: squarePx, height: squarePx }}>
          <span className="cc-mate-ring" />
          <span className="cc-piece cc-kingpiece" style={{ fontSize: squarePx * 0.62 }}>♚</span>
        </div>
      )}

      {/* ── message + XP rising above the board ── */}
      <div className="cc-msgwrap">
        <span className={`cc-msg ${kind === 'checkmate' ? 'cc-mate-title' : ''}`}>
          {msg}
        </span>
        <span className="cc-xp">
          +{xp} XP
          {streak > 0 && <i className="cc-flame">🔥</i>}
        </span>
      </div>
    </div>
  );
}