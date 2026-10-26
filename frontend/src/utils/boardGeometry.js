/* Pure board geometry shared by the shared-board pointer handlers and the
 * annotation overlay. Kept framework-free so the square mapping can be unit
 * tested for both orientations (and for off-board points) without a DOM. */

export const FILES = 'abcdefgh';

/* Map a point (px, relative to the board's top-left corner) to a square name,
 * or null when the point is outside the board. `orientation` flips the mapping
 * for the black perspective. `width`/`height` are the rendered board size. */
export function squareFromPoint(x, y, width, orientation = 'white', height = width) {
  if (!(width > 0)) return null;
  if (x < 0 || y < 0 || x > width || y > height) return null;
  const cell = width / 8;
  const col = Math.floor(x / cell);
  const row = Math.floor(y / cell);
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  if (orientation === 'white') return FILES[col] + String(8 - row);
  return FILES[7 - col] + String(row + 1);
}

/* Centre of a square in px on a `size`-wide board, honouring orientation.
 * Returns null for an unknown square. White: file a→left, rank 1 → bottom.
   Black: both axes mirrored. */
export function squareCenter(square, size, orientation = 'white') {
  if (!square || square.length < 2) return null;
  const fileIdx = FILES.indexOf(square[0]);
  const rankIdx = parseInt(square[1], 10) - 1;
  if (fileIdx < 0 || rankIdx < 0 || rankIdx > 7) return null;
  const cell = size / 8;
  const col = orientation === 'white' ? fileIdx : 7 - fileIdx;
  const row = orientation === 'white' ? 7 - rankIdx : rankIdx;
  return { x: col * cell + cell / 2, y: row * cell + cell / 2 };
}
