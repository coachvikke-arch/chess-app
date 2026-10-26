/*
 * Shared puzzle-popup designs — ONE import point for every puzzle-solving
 * board in the app.
 *
 * The student homework board (`/student/puzzles` → Puzzles.jsx +
 * PuzzlePlayer.jsx) and the live-classroom drill board (PuzzleDrillArea →
 * SharedChessBoard drill mode) render the SAME two layers, imported from HERE:
 *
 *   1. MoveFeedbackOverlay (+ useMoveFeedback + resolveMoveFeedback) — the
 *      short on-board badge anchored to the move's destination square:
 *      Excellent / Check / Checkmate / "Not quite" / "Puzzle Solved! +N pts".
 *      Used by BOTH boards — it is the drill board's single move-by-move
 *      popup.
 *   2. CelebrationFX (+ pieceGlyph) — the Duolingo-style success FX
 *      (destination spotlight + ripple + cheer + XP) driven through
 *      ChessBoard's `fx` prop. Used by the homework board.
 *
 * Rules for both boards (kept identical by sharing, not by copying):
 *   - popups show only for the student who moved (the instructor's drill is
 *     null, so no overlay/fx can ever render there);
 *   - one badge + one FX at a time (single state each, cleared on puzzle change);
 *   - sounds come from the shared sound module (ON in homework via the global
 *     preference, OFF by default in drills with a board toggle);
 *   - side-panel chrome (Next / Retry / Hint / score strip) stays per-page —
 *     only the ON-BOARD popups are shared.
 */
import MoveFeedbackOverlay, {
  useMoveFeedback,
  resolveMoveFeedback,
  FEEDBACK_DURATION_MS,
} from './MoveFeedbackOverlay';
import CelebrationFX, { pieceGlyph, PIECE_GLYPH } from '../CelebrationFX';

export {
  MoveFeedbackOverlay,
  useMoveFeedback,
  resolveMoveFeedback,
  FEEDBACK_DURATION_MS,
  CelebrationFX,
  pieceGlyph,
  PIECE_GLYPH,
};
export default MoveFeedbackOverlay;
