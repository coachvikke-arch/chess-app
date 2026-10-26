/**
 * Shared on-board move feedback for puzzle solving — ONE module used by BOTH:
 *   1. Assigned/homework puzzles (PuzzlePlayer → Puzzles page)
 *   2. Live classroom drill puzzles (SharedChessBoard drill mode ← PuzzleDrillArea)
 *
 * No puzzle logic lives here: callers validate the move with utils/puzzleSolve
 * first, then call `show(type, square, extra)` (or the `resolveMoveFeedback`
 * helper) purely to announce the outcome on the board.
 *
 * Exports:
 *  - resolveMoveFeedback({ status, move, game, isReply }) → { type, text, sub } | null
 *      Pure priority decision: checkmate > check > solved > excellent/correct >
 *      wrong. Opponent replies only surface check / checkmate (never praise).
 *  - useMoveFeedback({ soundOn, duration, suppressFeedbackDuringEffect })
 *      → { feedback, show, clear }
 *      Owns the visible badge + auto-hide timer + optional sound cue. While a
 *      MoveEffect runs, `show` drops the badge instead of queuing it.
 *  - <MoveFeedbackOverlay feedback orientation onDone /> (default export)
 *      Absolutely-positioned, pointer-events:none badge anchored to the move's
 *      destination square. Respects board orientation, clamps near edges,
 *      auto-hides after ~1.2s, honours prefers-reduced-motion, mobile-safe.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { playSound } from '../../utils/sound.js';
import {
  isMoveEffectRunning,
  subscribeMoveEffectState,
} from '../../effects/moveEffect/runtime.js';
import { isQuietMoveEvent } from '../../utils/moveFeedback.js';
import './moveFeedback.css';

export const FEEDBACK_DURATION_MS = 1200;

/* "Brilliant!" is intentionally absent: a brilliant move is celebrated by the
   board animation only, never by a text bubble. */
const EXCELLENT_TEXTS = ['Excellent!', 'Great move!', 'Perfect!'];

function pickExcellent() {
  return EXCELLENT_TEXTS[Math.floor(Math.random() * EXCELLENT_TEXTS.length)];
}

function safeInCheck(game) {
  try { return !!game?.inCheck?.(); } catch { return false; }
}

function safeIsCheckmate(game) {
  try { return !!game?.isCheckmate?.(); } catch { return false; }
}

/** Small secondary label for special-move kinds (capture / promotion / castle / e.p.). */
function specialSub(move) {
  if (!move) return null;
  const flags = move.flags || '';
  /* A promotion is announced by the board animation, not by a text bubble. */
  if (move.promotion && isQuietMoveEvent('promotion')) return null;
  if (flags.includes('k') || flags.includes('q')) return 'Castling!';
  if (flags.includes('e')) return 'En passant!';
  if (move.captured) return 'Captured!';
  return null;
}

/**
 * Decide which single feedback to show (priority order — mate beats praise).
 *
 * @param {object} args
 * @param {'correct'|'wrong'|'solved'} args.status  solver result from puzzleSolve
 * @param {object} args.move   chess.js verbose move (needs { to, captured, promotion, flags })
 * @param {object} args.game   Chess instance AFTER the move was applied
 * @param {boolean} args.isReply  true for the opponent's auto-played reply
 * @returns {{ type, text, sub } | null}  null = show nothing (quiet reply move)
 */
export function resolveMoveFeedback({ status, move, game, isReply = false } = {}) {
  const square = move?.to || null;
  if (!square) return null;

  if (status === 'wrong') {
    return { type: 'wrong', square, text: 'Not quite, try again', sub: null };
  }

  const checkmate = safeIsCheckmate(game);
  const check = !checkmate && safeInCheck(game);

  /* A mate is announced by the BOARD ANIMATION, so this module has no mate
     bubble at all (the shared flag — utils/moveFeedback.js — is what says a
     mate is a quiet event). A puzzle finished by mate therefore falls through
     to the "Puzzle Solved!" line below: the puzzle feedback is kept, the mate
     bubble is not. */
  if (checkmate && !isQuietMoveEvent('checkmate')) {
    return { type: 'checkmate', square, text: 'Checkmate!', sub: specialSub(move) };
  }
  if (check) {
    return { type: 'check', square, text: 'Check!', sub: specialSub(move) };
  }

  /* Opponent replies are quiet unless they give check/mate. */
  if (isReply) return null;

  if (status === 'solved') {
    return { type: 'solved', square, text: 'Puzzle Solved!', sub: specialSub(move) };
  }
  if (status === 'correct') {
    return { type: 'excellent', square, text: pickExcellent(), sub: specialSub(move) };
  }
  return null;
}

const SOUND_FOR = {
  checkmate: 'celebrate',
  check: 'check',
  solved: 'victory',
  excellent: 'good',
  correct: 'good',
  wrong: 'bad',
};

/**
 * Own the on-board badge lifecycle + optional sound cue.
 *
 * @param {object} opts
 * @param {boolean} opts.soundOn   play cue sounds (homework: true, live drill: false)
 * @param {number} opts.duration   auto-hide delay (default 1200ms)
 * @returns {{ feedback, show, clear }}
 *   feedback = { type, square, text, sub, points, key } | null
 *   show(type, square, extra = { text, sub, points }) — extra overrides resolver text
 */
export function useMoveFeedback({
  soundOn = true,
  duration = FEEDBACK_DURATION_MS,
  suppressFeedbackDuringEffect = true,
} = {}) {
  const [feedback, setFeedback] = useState(null);
  const timerRef = useRef(null);
  const soundRef = useRef(soundOn);
  const suppressRef = useRef(suppressFeedbackDuringEffect);
  soundRef.current = soundOn;
  suppressRef.current = suppressFeedbackDuringEffect;

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setFeedback(null);
  }, []);

  useEffect(() => clear, [clear]);

  /* A badge already on screen when a sigma effect starts is dropped (not
     queued); the outcome can still be shown by its own delayed reveal. */
  useEffect(() => {
    if (!suppressFeedbackDuringEffect) return undefined;
    return subscribeMoveEffectState(({ running }) => {
      if (running) clear();
    });
  }, [clear, suppressFeedbackDuringEffect]);

  const show = useCallback((type, square, extra = {}) => {
    if (!type || !square) return false;
    if (suppressRef.current && isMoveEffectRunning()) {
      try {
        console.debug('[MoveFeedback] suppressed-during-effect', { type, square });
      } catch { /* ignore */ }
      return false;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    const fb = {
      type,
      square,
      text: extra.text || null,
      sub: extra.sub || null,
      points: extra.points ?? null,
      key: Date.now() + Math.random(),
    };
    setFeedback(fb);
    if (soundRef.current) {
      const cue = SOUND_FOR[type];
      if (cue) {
        try { playSound(cue); } catch { /* audio unavailable */ }
      }
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setFeedback(null);
    }, duration);
    return true;
  }, [duration]);

  return { feedback, show, clear };
}

/** 'e4' → { file: 0-7, rank: 0-7 } or null. */
function squareXY(square) {
  if (!square || square.length < 2) return null;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  if (file < 0 || file > 7 || !(rank >= 0 && rank <= 7)) return null;
  return { file, rank };
}

const TYPE_ICON = {
  checkmate: '♛',
  check: '♚',
  solved: '🏆',
  excellent: '★',
  correct: '✓',
  wrong: '✗',
};

/**
 * Badge pinned to the destination square of the last move.
 *
 * Props:
 *  - feedback: { type, square, text, sub, points, key } | null (from useMoveFeedback)
 *  - orientation: 'white' | 'black' (board orientation — mirrors the anchor)
 *  - onDone: called when the badge auto-hides (optional)
 */
export default function MoveFeedbackOverlay({ feedback, orientation = 'white', onDone }) {
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const prevKeyRef = useRef(null);

  useEffect(() => {
    if (!feedback) {
      if (prevKeyRef.current !== null) {
        prevKeyRef.current = null;
        doneRef.current?.();
      }
    } else {
      prevKeyRef.current = feedback.key;
    }
  }, [feedback]);

  if (!feedback) return null;
  const xy = squareXY(feedback.square);
  if (!xy) return null;

  const col = orientation === 'white' ? xy.file : 7 - xy.file;
  const row = orientation === 'white' ? 7 - xy.rank : xy.rank;
  /* Centre on the square; clamp so wide badges stay inside the board near edges. */
  const left = Math.min(Math.max((col + 0.5) * 12.5, 15), 85);
  /* Near the top edge there is no room above — drop the badge below the square. */
  const below = row <= 1;
  const top = below ? (row + 1) * 12.5 : row * 12.5;

  const type = feedback.type || 'correct';
  const text = feedback.text || ({
    check: 'Check!',
    solved: 'Puzzle Solved!',
    excellent: 'Excellent!',
    correct: 'Good move',
    wrong: 'Not quite, try again',
  }[type] || 'Good move');

  return (
    <div className="mvfb-layer" aria-hidden="true">
      <div
        key={feedback.key}
        className={`mvfb-badge mvfb--${type}${below ? ' mvfb--below' : ''}${type === 'checkmate' ? ' mvfb--confetti' : ''}`}
        style={{ left: `${left}%`, top: `${top}%` }}
      >
        <span className="mvfb-main">
          <span className="mvfb-icon">{TYPE_ICON[type] || '✓'}</span>
          <span className="mvfb-text">{text}</span>
        </span>
        {type === 'solved' && feedback.points != null && Number(feedback.points) > 0 && (
          <span className="mvfb-points">+{feedback.points} pts</span>
        )}
        {feedback.sub && <span className="mvfb-sub">{feedback.sub}</span>}
      </div>
    </div>
  );
}
