import { Chess } from 'chess.js';
import Button from './Button';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const PALETTE = [
  ['♔', 'K', 'w'], ['♕', 'Q', 'w'], ['♖', 'R', 'w'], ['♗', 'B', 'w'], ['♘', 'N', 'w'], ['♙', 'P', 'w'],
  ['♚', 'k', 'b'], ['♛', 'q', 'b'], ['♜', 'r', 'b'], ['♝', 'b', 'b'], ['♞', 'n', 'b'], ['♟', 'p', 'b'],
];

/* board representation used while setting up: an 8x8 grid of 'K,Q,R,B,N,P'
   (white) / 'k,q,r,b,n,p' (black) letters, or null for empty squares.
   Row 0 = rank 8 (top), Row 7 = rank 1 (bottom) — same as a FEN board. */

/** Build the placeholder-grid from a start FEN (board part only). */
export function startGrid() {
  return fenToGrid(START_FEN);
}

/** Parse a FEN's piece-placement field into the 8x8 grid above. */
export function fenToGrid(fen) {
  const rows = (fen || START_FEN).split(' ')[0].split('/');
  const grid = [];
  for (const r of rows) {
    const row = [];
    for (const ch of r) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) row.push(null);
      } else {
        row.push(ch);
      }
    }
    grid.push(row);
  }
  return grid;
}

/** Serialise the grid back into the piece-placement field of a FEN. */
export function gridToFen(grid) {
  return grid
    .map((row) => {
      let out = '';
      let empty = 0;
      for (const ch of row) {
        if (!ch) empty++;
        else {
          if (empty) { out += empty; empty = 0; }
          out += ch;
        }
      }
      if (empty) out += empty;
      return out;
    })
    .join('/');
}

/**
 * Validate the setup grid is loadable by chess.js so it can be applied to the
 * main board. We require exactly one king per side (so the load succeeds and
 * the position is a real game), but we deliberately do NOT demand full
 * legality — users may build study positions with extra/missing material,
 * both sides to play, etc. chess.js rejects a FEN on load if: a side has 0 or
 * more-than-one king, a pawn sits on rank 1/8, or both kings are in check at
 * once. We reproduce those load-safe rules here.
 */
export function validPosition(grid) {
  let wKing = 0;
  let bKing = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const ch = grid[r] && grid[r][c];
      if (!ch) continue;
      if (ch === 'K') wKing++;
      else if (ch === 'k') bKing++;
      /* pawns on promotion ranks (rank 8 = r 0, rank 1 = r 7) break load */
      if (ch.toLowerCase() === 'p' && (r === 0 || r === 7)) return false;
    }
  }
  const okCount = wKing === 1 && bKing === 1;
  if (!okCount) return false;
  try { new Chess(gridToFen(grid) + ' w - - 0 1'); return true; }
  catch { return false; }
}

/**
 * Convert the editing grid directly into a react-chessboard position map like
 * { e4: 'wP', a8: 'bK': ... } WITHOUT going through chess.js validation, so
 * any intermediate arrangement (even one with 0/2 kings) renders reliably for
 * BOTH colors. This is what the main board uses during setup mode.
 */
export function gridToPosition(grid) {
  const position = {};
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const ch = grid[r] && grid[r][c];
      if (!ch) continue;
      const file = String.fromCharCode(97 + c);
      const rank = 8 - r;
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      const type = ch.toUpperCase(); // react-chessboard expects wK/bQ, not wk/bq
      position[`${file}${rank}`] = `${color}${type}`;
    }
  }
  return position;
}

/**
 * Controlled setup panel — places pieces on the MAIN board, not a tiny preview.
 * State (grid, selected, error) lives in the parent; this component only renders
 * the piece palette + Reset/Clear/Apply controls. The parent sends square clicks
 * from the main board back in through `onToggle(r, c)`.
 */
export default function BoardSetup({
  grid,
  selected,
  onSelect,
  onApply,
  onReset,
  onClear,
  error,
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-medium text-ivory-100 flex items-center gap-2">
          <span className="text-gold-600">⚙</span> Setup on the main board
        </p>
      </div>

      <p className="text-xs text-ivory-700">
        Pick a piece below, then click squares on the big board to place it. Click the same square again to remove.
      </p>

      <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
        {PALETTE.map(([glyph, letter, color]) => (
          <button
            key={letter}
            type="button"
            onClick={() => onSelect(selected === letter ? null : letter)}
            className={`rounded-xl border py-2 text-2xl transition ${selected === letter
                ? 'border-gold-500/70 bg-gold-700/20 text-gold-700 shadow-[0_0_16px_rgba(125,211,252,0.2)]'
                : 'border-white/10 bg-white/[0.04] hover:border-gold-500/40'
              }`}
            style={
              selected === letter
                ? {}
                : color === 'b'
                  ? {
                    color: '#17130d',
                    textShadow: '0 0 0 1px #d9d2c2, 0 1px 3px rgba(0,0,0,0.9)',
                  }
                  : { color: '#f0f9ff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }
            }
          >
            {glyph}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onSelect(selected === '' ? null : '')}
          className={`rounded-xl border py-2 text-sm font-semibold transition ${selected === ''
              ? 'border-red-400/70 bg-red-500/15 text-red-200'
              : 'border-white/10 bg-white/[0.04] hover:border-red-400/40 text-ivory-100'
            }`}
          title="Remove pieces from clicked squares"
        >
          ⌫ Erase
        </button>
      </div>

      {error && <div className="chess-error !mb-0">{error}</div>}

      <div className="flex flex-wrap justify-end gap-2">
        {onReset && (
          <Button type="button" onClick={onReset} variant="secondary" size="sm" className="!px-4 !py-1.5 text-xs">
            Reset start
          </Button>
        )}
        {onClear && (
          <Button type="button" onClick={onClear} variant="secondary" size="sm" className="!px-4 !py-1.5 text-xs">
            Clear board
          </Button>
        )}
        <Button type="button" onClick={onApply} variant="primary" size="md" className="!px-5">Apply position ♞</Button>
      </div>
    </div>
  );
}