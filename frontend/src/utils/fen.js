/* FEN hygiene, dependency-free (introspectable by both the board and the
 * analysis layer without dragging the engine bundle into every page).
 *
 * chess.js 1.4.0 loads any syntactically valid FEN, but MOVE GENERATION throws
 * `TypeError: Cannot mix BigInt and other types` (its Zobrist hash `_movePiece`)
 * when the castling field advertises a right whose king and rook are not on
 * their home squares — e.g. `... b KQkq ...` on a mid-game position with no
 * rooks. That is a library bug (jhlywa/chess.js#577, #552) with no released fix,
 * and it is fatal here because the throw escapes a plain `isStalemate()`/`moves()`
 * call and takes the whole page down. */

/* Home squares backing each standard castling right:
   K = white O-O (e1/h1), Q = white O-O-O (e1/a1),
   k = black O-O (e8/h8), q = black O-O-O (e8/a8). */
const CASTLING_HOME = {
  K: ['e1', 'h1'], Q: ['e1', 'a1'],
  k: ['e8', 'h8'], q: ['e8', 'a8'],
};

/**
 * Strip castling rights a position does not actually support.
 *
 * The board itself is legal; only the rights are bogus (usually a FEN copied
 * with default `KQkq`, or a database row). Dropping the unsupported rights makes
 * the FEN safe to hand to chess.js while leaving every real position untouched.
 * A FEN that is not exactly six fields, or whose board is malformed, is returned
 * unchanged so the existing validity guards still decide what to do with it.
 */
export function sanitizeFen(fen) {
  const trimmed = String(fen || '').trim();
  if (!trimmed || trimmed === 'start') return trimmed;
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 6) return trimmed;
  const [placement, turn, castling, ep, half, full] = parts;
  const ranks = placement.split('/');
  if (ranks.length !== 8) return trimmed;

  const pieceAt = {};
  for (let r = 0; r < ranks.length; r += 1) {
    let file = 0;
    for (const ch of ranks[r]) {
      if (ch >= '1' && ch <= '8') {
        file += Number(ch);
      } else {
        if (file < 8) pieceAt[`${'abcdefgh'[file]}${8 - r}`] = ch;
        file += 1;
      }
    }
  }

  const supported = (right) => {
    const [kingSq, rookSq] = CASTLING_HOME[right];
    const white = right === right.toUpperCase();
    return pieceAt[kingSq] === (white ? 'K' : 'k')
      && pieceAt[rookSq] === (white ? 'R' : 'r');
  };

  if (castling === '-') return trimmed;
  const kept = [...castling].filter(supported).join('') || '-';
  if (kept === castling) return trimmed;
  return `${placement} ${turn} ${kept} ${ep} ${half} ${full}`;
}
