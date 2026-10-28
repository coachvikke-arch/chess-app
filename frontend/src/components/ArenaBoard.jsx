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
 *   effectHostId which board a move effect belongs to — the two boards are
 *                mounted at the same time and share one Chess instance, so an
 *                effect has to be addressed to the one the user is looking at
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
export default function ArenaBoard({
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
