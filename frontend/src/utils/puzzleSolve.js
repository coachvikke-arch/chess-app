/**
 * The rules for solving a chess puzzle, in one place.
 *
 * A puzzle is a starting FEN plus a flat UCI line that alternates solver /
 * opponent: index 0, 2, 4… is the solver's move and must be found, index
 * 1, 3, 5… is the opponent's reply and is played automatically once the solver's
 * move in front of it was right.
 *
 * Two surfaces solve puzzles against exactly these rules — the student's
 * homework trainer (`PuzzlePlayer`) and the live-classroom drill
 * (`SharedChessBoard`) — and they used to each carry their own copy. Two copies
 * of a rule this load-bearing is how one of them comes to believe a wrong move
 * should stick, or that the line is finished one ply early. Both call
 * `createSolver` now, so there is exactly one answer to "is this move right, and
 * are we done".
 *
 * What a caller owns, and what this owns:
 *  - this owns the ply count and the solution line,
 *  - the caller owns the Chess instance and does the rendering,
 *  - nothing here touches the network, the DOM, or React.
 *
 * The reply is deliberately a SEPARATE step (`judge` then `applyReply`), not
 * something `judge` does in passing. react-chessboard slides a piece only when a
 * position arrives as an external change; a two-ply jump in one commit is not
 * one, and animates nothing. Deferring the reply is what makes the board read as
 * move-by-move, and both surfaces now do it the same way.
 */
import { Chess } from 'chess.js';

/** How long a piece takes to slide to its new square, in seconds. The homework
 *  trainer and the live-classroom drill share this so a puzzle feels identical
 *  in both places. */
export const MOVE_ANIM_SECONDS = 0.25;

/** The same, in milliseconds, plus a frame for the browser to start the slide. */
export const MOVE_ANIM_MS = MOVE_ANIM_SECONDS * 1000 + 40;

/** "e2e4" / "e7e8q" for a chess.js verbose move (or an already-built string). */
export function uciOf(move) {
  if (typeof move === 'string') return move;
  if (!move) return '';
  return move.from + move.to + (move.promotion || '');
}

/** Is this ply one the SOLVER plays (true) or one the opponent plays (false)? */
export function isSolverPly(ply) {
  return ply % 2 === 0;
}

/**
 * Create a solver for one puzzle line.
 *
 * @param {string[]} solution Flat UCI line, solver first.
 * @returns {{
 *   solution: string[],
 *   getPly: () => number,
 *   remaining: () => number,
 *   reset: (toPly?: number) => void,
 *   expected: () => string|undefined,
 *   isSolverTurn: () => boolean,
 *   judge: (move: object, game: import('chess.js').Chess) => {
 *     status: 'wrong' | 'correct' | 'solved',
 *     san: string, uci: string,
 *     line: string[],
 *     wrongSan?: string,
 *     checkmate?: boolean,
 *     lastMove?: { from: string, to: string, pieceType?: string, color?: string },
 *   }
 * }}
 */
export function createSolver(solution = []) {
  const line = Array.isArray(solution) ? solution.filter((m) => typeof m === 'string' && m) : [];
  let ply = 0;
  /* The ply index of a defender's reply that `judge` armed but the caller has
     not played yet. Non-null means the board is mid-animation and the next
     attempt must wait for it. */
  let replyPly = null;

  return {
    solution: line,

    getPly: () => ply,

    remaining: () => Math.max(0, line.length - ply),

    reset: (toPly = 0) => {
      ply = Math.max(0, Math.min(toPly, line.length));
      replyPly = null;
    },

    /** The UCI the next move has to be, or undefined once the line is used up. */
    expected: () => line[ply],

    isSolverTurn: () => isSolverPly(ply),

    /** Is the defender's reply to the move just judged still waiting to be played? */
    hasPendingReply: () => replyPly != null,

    /**
     * Judge a move the caller has ALREADY applied to its game.
     *
     * A wrong move is undone here, so the board can never be left outside the
     * solution line, and it does NOT advance the ply — a guess must never count
     * towards finishing the puzzle. A right move advances the ply.
     *
     * The defender's reply is NOT played here. It is held back and reported as
     * `replyPending`, for the caller to play in its own tick via `applyReply`.
     *
     * Why the deferral matters: react-chessboard only slides a piece when the
     * position arrives as an EXTERNAL change; a change it recognises as the
     * user's own drag snaps instead. Applying the solver's move and the reply in
     * one synchronous handler therefore produced a single two-ply jump and
     * NEITHER move animated. Playing the reply a beat later is what makes the
     * reply slide, and it is also what the eye expects: your move, then theirs.
     */
    judge(move, game) {
      const uci = uciOf(move);
      const expected = line[ply];

      if (uci !== expected) {
        try { game.undo(); } catch { /* the game was already where we wanted it */ }
        return { status: 'wrong', san: move?.san || '', uci, line: line.slice(0, ply), replyPending: false };
      }

      ply += 1;
      const lastMove = move
        ? { from: move.from, to: move.to, pieceType: move.piece, color: move.color }
        : null;

      /* Arm the reply, if this was the solver's move and the line continues. */
      replyPly = (isSolverPly(ply - 1) && ply < line.length) ? ply : null;

      /* No reply left to play means the line ran out on this move. */
      const solved = replyPly == null && ply >= line.length && line.length > 0;
      return {
        status: solved ? 'solved' : 'correct',
        san: move?.san || '',
        uci,
        line: line.slice(0, ply),
        replyPending: replyPly != null,
        checkmate: solved ? isCheckmate(game) : false,
        lastMove,
      };
    },

    /**
     * Play the defender's reply that `judge` armed. Call this in a later tick,
     * after the board has already painted the solver's move, so the reply
     * arrives as its own external position change and animates.
     *
     * A reply that will not apply is left unplayed and the ply unadvanced, and
     * reports `played: false`, rather than pretending the defender answered.
     */
    applyReply(game) {
      if (replyPly == null) return { played: false, solved: false, san: '' };
      const reply = line[replyPly];
      let mv;
      try {
        mv = game.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] });
      } catch {
        replyPly = null;
        return { played: false, solved: false, san: '' };
      }
      if (!mv) {
        replyPly = null;
        return { played: false, solved: false, san: '' };
      }
      ply += 1;
      replyPly = null;
      const solved = ply >= line.length && line.length > 0;
      return {
        played: true,
        solved,
        san: mv.san,
        uci: reply,
        line: line.slice(0, ply),
        checkmate: solved ? isCheckmate(game) : false,
        lastMove: { from: mv.from, to: mv.to, pieceType: mv.piece, color: mv.color },
      };
    },
  };
}

/** Replay `count` plies of a UCI line from `fen`, returning the SAN of each. */
export function sanLine(fen, solution, count = solution?.length) {
  let game;
  try {
    game = new Chess(fen);
  } catch {
    return [];
  }
  const out = [];
  const upto = Math.min(count ?? 0, (solution || []).length);
  for (const u of (solution || []).slice(0, upto)) {
    let mv;
    try {
      mv = game.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });
    } catch {
      break;
    }
    if (!mv) break;
    out.push(mv.san);
  }
  return out;
}

/** The position after `count` plies of a UCI line — for jump-to-move. */
export function fenAtPly(fen, solution, count) {
  let game;
  try {
    game = new Chess(fen);
  } catch {
    return fen;
  }
  for (const u of (solution || []).slice(0, count)) {
    try {
      game.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });
    } catch {
      break;
    }
  }
  return game.fen();
}

function isCheckmate(game) {
  try {
    return game.isCheckmate();
  } catch {
    return false;
  }
}