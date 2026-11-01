import { memo } from 'react';
import ChessBoard from './ChessBoard';

/*
 * The Play Arena's board — ONE component, used by both surfaces.
 *
 * The page board and the full-screen Play Mode board used to be two separate
 * <ChessBoard> blocks with the same twenty props, differing only in the size
 * and in which board the move effects were addressed to. Every future change
 * to the board's props therefore had to be made twice, and it was exactly
 * those two copies that drifted apart.
 *
 * So the board is rendered here, once, and the surfaces pass what actually
 * differs:
 *
 *   boardWidth   how big the square is (the page fits its column, Play Mode
 *                fits the full-screen area)
 *   effectHostId which board a move effect belongs to — both surfaces share one
 *                Chess instance, and only one of them is mounted at a time, so
 *                an effect has to be addressed to the board the user is looking at
 *
 * Everything else — the game, the orientation, the clocks' side, the opponent,
 * the engine, the badges, the sound — is the same in both places and is passed
 * straight through.
 *
 * One note on `soundOn`: it is NOT gated on the engine's thinking state. The
 * live engine searches for up to 5 seconds after every move, and that flag
 * stays true for the whole search — gating the board's sound on it muted the
 * player's own move for seconds at a time, which is what made "moves make no
 * sound". Engine analysis state has no business deciding whether a human move
 * is audible.
 */
function ArenaBoard({
  game,
  orientation = 'white',
  boardWidth = 420,
  effectHostId = null,
  onPositionChange = null,
  onMove = null,
  interactive = true,
  showLegalMoves = false,
  showNotation = true,
  soundOn,
  selfColor = null,
  highlightLastMove = true,
  lastMove = null,
  pieceTheme = 'auto',
  customArrows = [],
  engineOn = false,
  reviewVerdictColor = null,
  moveBadge = null,
  animationDuration = 0.25,
  flat = false,
}) {
  return (
    <ChessBoard
      game={game}
      mode="analysis"
      orientation={orientation}
      boardWidth={boardWidth}
      onPositionChange={onPositionChange}
      onMove={onMove}
      interactive={interactive}
      showLegalMoves={showLegalMoves}
      showNotation={showNotation}
      soundOn={soundOn}
      selfColor={selfColor}
      highlightLastMove={highlightLastMove}
      lastMove={lastMove}
      pieceTheme={pieceTheme}
      customArrows={customArrows}
      engineOn={engineOn}
      reviewVerdictColor={reviewVerdictColor}
      moveBadge={moveBadge}
      moveEffectHostId={effectHostId}
      animationDuration={animationDuration}
      flat={flat}
    />
  );
}

/*
 * Memoised, with one deliberate exception to the usual identity compare.
 *
 * `game` is a SHARED MUTABLE chess.js instance — the page hands the same object
 * to both surfaces, so `prev.game === next.game` is true even after the position
 * has changed. A plain React.memo would therefore freeze the board on the first
 * position. So the position is compared by FEN, which is what actually has to
 * repaint, and every other prop keeps normal identity compare.
 *
 * The point of doing this at all: the arena re-renders for reasons that have
 * nothing to do with the position (a panel opening, a clock state change, a
 * reaction toast). Before, each of those repainted the whole board — 64 squares,
 * the pieces, the overlays — which on a phone is what made the page feel like it
 * was hanging mid-game.
 */
export default memo(ArenaBoard, (prev, next) => {
  if (prev.game !== next.game) return false;          // a different game: always repaint
  if (prev.game && prev.game.fen() !== next.game.fen()) return false; // in-place move
  for (const key of Object.keys(next)) {
    if (key === 'game') continue;
    if (prev[key] !== next[key]) return false;
  }
  return true;
});
