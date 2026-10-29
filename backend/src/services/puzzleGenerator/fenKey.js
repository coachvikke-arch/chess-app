/* Puzzle identity: same piece placement + side to move = same puzzle.
 *
 * Castling rights, en-passant square and move counters are deliberately left
 * out. Two rows that differ only in those are the same exercise for a student,
 * and including them would let the generator save near-duplicates.
 */
function fenKeyOf(fen) {
  if (!fen) return null;
  const [placement, turn] = String(fen).trim().split(/\s+/);
  if (!placement) return null;
  return `${placement} ${turn === 'b' ? 'b' : 'w'}`;
}

module.exports = { fenKeyOf };
