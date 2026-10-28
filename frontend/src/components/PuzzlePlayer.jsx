import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import ChessBoard from './ChessBoard';
import { createSolver, MOVE_ANIM_SECONDS } from '../utils/puzzleSolve';
import {
  afterMoveEffectEnd,
  isMoveEffectRunning,
  revealAfterCheckmate,
  subscribeMoveEffectState,
} from '../effects/moveEffect';
/* Only the board-wrapper layout comes from here now; the orange badge styles in
   this file belong to the classroom drill, which still renders the overlay. */
import './puzzle/moveFeedback.css';

/**
 * Lichess-style puzzle player.
 *
 * The solver is the side to move in `fen`. The `solution` is a flat array of
 * UCI moves alternating solver/opponent, starting with the solver (index 0, 2, 4… =
 * solver moves; index 1, 3, 5… = opponent moves auto-played).
 *
 * The rules live in `utils/puzzleSolve.js` — the live-classroom drill solves
 * against the same module, so the two cannot drift apart.
 *
 * Props:
 *  - fen: string          initial position (solver to move)
 *  - solution: string[]   UCI solution line (solver first)
 *  - onSolved(moves, meta):     called when the solver completes the full line
 *  - onFailed(moves):     called when the solver makes a wrong move
 *  - onCorrectMove(move): called after each correct SOLVER move — { from, to, pieceType, color }
 *  - fx: object           passed straight through to ChessBoard (success FX overlay)
 *  - interactive: boolean  locks the board (visible but not playable) when false
 *  - points: number        awarded on solve — shown in the "Puzzle Solved!" badge
 *  - showStatus: boolean    the internal per-move line; false when the host page
 *                           owns that feedback (the homework solver does)
 *  - showMoveStrip: boolean the internal move chips under the board
 */
export default function PuzzlePlayer({
  fen, solution = [], onSolved, onFailed, onCorrectMove, fx, interactive = true,
  boardWidth = 420, points = 10, showStatus = true, showMoveStrip = true,
}) {
  const gameRef = useRef(null);
  if (!gameRef.current) gameRef.current = new Chess(fen);
  const solverRef = useRef(null);
  if (!solverRef.current) solverRef.current = createSolver(solution);

  const [, force] = useReducer((x) => x + 1, 0);
  const history = gameRef.current.history({ verbose: true });
  const playedCount = history.length;

  const solverWhite = useMemo(() => {
    try {
      const turn = (fen || '').trim().split(/\s+/)[1];
      return turn !== 'b'; // anything but black → white
    } catch { return true; }
  }, [fen]);

  const solvedRef = useRef(false);
  const brokenRef = useRef(false);
  /* The one lightweight feedback signal per move (replaces the old on-board
     orange popup). Auto-clears so it cannot linger into the next move. */
  const [flash, setFlash] = useState(null); // 'wrong' | 'correct' | 'solved'
  const flashTimerRef = useRef(null);
  /* A rejected move leaves the position unchanged (the solver undoes it), so
     the only place to show WHICH try was wrong is the two squares it used.
     Tinted red for a beat, then cleared by the same puzzle-change cleanup as
     every other transient cue. */
  const [wrongSquares, setWrongSquares] = useState(null);
  const wrongSquaresTimerRef = useRef(null);
  const flashWrongSquares = useCallback((move) => {
    if (!move?.from || !move?.to) return;
    if (wrongSquaresTimerRef.current) clearTimeout(wrongSquaresTimerRef.current);
    const tint = {
      backgroundColor: 'rgba(239, 68, 68, 0.5)',
      boxShadow: 'inset 0 0 0 3px rgba(239, 68, 68, 0.9)',
    };
    setWrongSquares({ [move.from]: tint, [move.to]: tint });
    wrongSquaresTimerRef.current = setTimeout(() => {
      wrongSquaresTimerRef.current = null;
      setWrongSquares(null);
    }, 700);
  }, []);
  /* A checkmate's "Puzzle solved!" line waits for the checkmate animation. */
  const revealCancelRef = useRef(null);
  const attemptRef = useRef(0);
  const setFlashBrief = useCallback((kind) => {
    if (isMoveEffectRunning()) {
      try {
        console.debug('[PuzzlePlayer] feedback-suppressed-during-effect', { kind });
      } catch { /* ignore */ }
      return false;
    }
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlash(kind);
    flashTimerRef.current = setTimeout(() => {
      flashTimerRef.current = null;
      setFlash(null);
    }, 1200);
    return true;
  }, []);

  /* Drop an inline badge the moment an effect starts; it is never queued. */
  useEffect(() => subscribeMoveEffectState(({ running }) => {
    if (!running || !flashTimerRef.current) return;
    clearTimeout(flashTimerRef.current);
    flashTimerRef.current = null;
    setFlash(null);
  }), []);

  const orientation = solverWhite ? 'white' : 'black';

  /* The defender's reply waits a beat after the solver's move. During that
     window the board is locked (`busy`) so no second attempt can be judged
     against a position the solver has not finished reading. The timer id lives
     in a ref and is cleared on unmount, on puzzle change and when the puzzle
     ends, so a stale reply can never play on the next puzzle. */
  const REPLY_DELAY_MS = 2000;
  const [replyPending, setReplyPending] = useState(false);
  const replyTimerRef = useRef(null);
  const cancelReply = useCallback(() => {
    if (replyTimerRef.current) {
      clearTimeout(replyTimerRef.current);
      replyTimerRef.current = null;
    }
    setReplyPending(false);
  }, []);

  // Reset the game whenever the puzzle changes
  useEffect(() => {
    attemptRef.current += 1;
    cancelReply();
    if (revealCancelRef.current) { revealCancelRef.current(); revealCancelRef.current = null; }
    if (flashTimerRef.current) { clearTimeout(flashTimerRef.current); flashTimerRef.current = null; }
    if (wrongSquaresTimerRef.current) { clearTimeout(wrongSquaresTimerRef.current); wrongSquaresTimerRef.current = null; }
    setFlash(null);
    setWrongSquares(null);
    gameRef.current = new Chess(fen);
    solverRef.current = createSolver(solution);
    solvedRef.current = false;
    brokenRef.current = false;
    force();
    return () => {
      cancelReply();
      if (revealCancelRef.current) { revealCancelRef.current(); revealCancelRef.current = null; }
    };
  }, [fen, solution, cancelReply]);

  function finish(result, game) {
    /* The puzzle is over: drop any reply that was still queued so it cannot
       land on the next puzzle. */
    cancelReply();
    solvedRef.current = true;
    force();
    if (onSolved) {
      onSolved(result.line, { checkmate: result.checkmate, lastMove: result.lastMove });
    }
  }

  function handleMove(move) {
    const game = gameRef.current;
    if (solvedRef.current || brokenRef.current) return;
    if (replyTimerRef.current) return;   // a reply is still animating in

    const solver = solverRef.current;
    const wasSolverTurn = solver.isSolverTurn();
    const result = solver.judge(move, game);

    if (result.status === 'wrong') {
      /* A wrong move must NOT restart or lock the puzzle.
         The solver has already undone it (judge calls game.undo()), so the
         piece snaps back on its own and the ply never advanced — the puzzle
         is still exactly where it was. We deliberately do NOT set brokenRef
         here: that used to flip status to 'failed', which made the board
         non-interactive and forced a Try-again reset. Now the student simply
         tries again from the same position, and the mistake is still reported
         through onFailed for the attempt stats. */
      if (onFailed) onFailed(result.line, result.san);
      flashWrongSquares(move);
      setFlashBrief('wrong');
      force();
      return;
    }

    /* Report the solver's own move, before the reply is folded in. */
    if (wasSolverTurn && onCorrectMove && move) {
      onCorrectMove({
        from: move.from,
        to: move.to,
        pieceType: move.piece,
        color: move.color,
        san: move.san,
      });
    }

if (result.status === 'solved') {
      if (result.checkmate) {
        /* The solved banner waits until the checkmate animation has landed. */
        if (revealCancelRef.current) revealCancelRef.current();
        revealCancelRef.current = revealAfterCheckmate(
          { to: result.lastMove?.to },
          () => {
            revealCancelRef.current = null;
            setFlashBrief('solved');
          },
        );
      } else if (isMoveEffectRunning()) {
        /* Promotion/brilliant: the banner waits for the overlay to finish too. */
        if (revealCancelRef.current) revealCancelRef.current();
        revealCancelRef.current = afterMoveEffectEnd(() => {
          revealCancelRef.current = null;
          setFlashBrief('solved');
        });
      } else {
        setFlashBrief('solved');
      }
      finish(result, game);
      return;
    }

    /* Correct but not finished. No on-board popup here any more — the light
       correct/wrong signal is the inline status line below plus the coloured
       move strip, so a single move never shows two feedbacks. */
    setFlashBrief('correct');
    force();
    if (!result.replyPending) return;
    setReplyPending(true);
    replyTimerRef.current = setTimeout(() => {
      replyTimerRef.current = null;
      setReplyPending(false);
      const replied = solver.applyReply(game);
      force();
      if (replied.played && replied.solved) finish(replied, game);
    }, REPLY_DELAY_MS);
  }

  const status = brokenRef.current ? 'failed' : solvedRef.current ? 'solved' : 'playing';
  const busy = replyPending;

  return (
    <div className="flex flex-col items-center">
      <div className="mvfb-wrap">
        <ChessBoard
          game={gameRef.current}
          mode="puzzle"
          onMove={handleMove}
          orientation={orientation}
          interactive={interactive && status === 'playing' && !busy}
          showLegalMoves={status === 'playing' && !busy}
          boardWidth={boardWidth}
          animationDuration={MOVE_ANIM_SECONDS}
          fx={fx}
          extraSquareStyles={wrongSquares || undefined}
        />
      </div>
      {/* The single lightweight per-move signal that replaced the orange
          on-board card popup: a short inline line. It never appears together
          with anything else for the same move. */}
      {showStatus && (
        <div className="mv-status" aria-live="polite">
          {flash === 'wrong' && <span className="mv-status-wrong">✗ Not quite — try again</span>}
          {flash === 'correct' && <span className="mv-status-correct">✓ Good move</span>}
          {flash === 'solved' && <span className="mv-status-solved result-reveal">★ Puzzle solved!{points ? ` +${points} pts` : ''}</span>}
          {busy && <span className="mv-status-waiting">…thinking</span>}
        </div>
      )}
      {showMoveStrip && history.length > 0 && (
        <div className="mt-3 text-center">
          <p className="text-xs text-ivory-500 mb-1">Moves</p>
          <div className="flex flex-wrap justify-center gap-1.5 max-w-md">
            {history.map((m, i) => (
              <span
                key={i}
                className={`px-2 py-0.5 rounded text-xs font-mono ${brokenRef.current && i === history.length - 1
                    ? 'bg-red-500/20 text-red-600'
                    : solvedRef.current && i === history.length - 1
                      ? 'bg-green-500/20 text-green-600'
                      : 'bg-black/5 text-ivory-500'
                  }`}
              >
                {m.san}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}