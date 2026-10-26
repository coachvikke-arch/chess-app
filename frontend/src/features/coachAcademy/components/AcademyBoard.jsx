/**
 * AI Coach Training Academy — the board step.
 *
 * Step 3 of the training flow needs to do three different jobs depending on what
 * the topic carries:
 *
 *  - a static demo position with highlighted squares and an arrow
 *  - a practice position the coach plays on (their move only)
 *  - a practice position the coach must solve from scratch
 *
 * All three share one board, so they are one component with a `mode`. The board
 * itself is the app's existing `ChessBoard`, which already owns legal-move
 * enforcement and promotion dialogs — this component never re-implements chess
 * rules, it only decides who may move and what to say afterwards.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import ChessBoard from '../../../components/ChessBoard';
import { ActionButton, StepHeading } from './AcademyUI';

/** Squares from the topic's own annotations, so highlights follow the data. */
function highlightStyles(board, { showHighlight = true, from = null, to = null } = {}) {
  const styles = {};
  const squares = new Set([...(board?.highlight || [])]);
  if (from) squares.add(from);
  if (to) squares.add(to);
  if (showHighlight) {
    for (const sq of squares) {
      if (!/^[a-h][1-8]$/.test(sq)) continue;
      styles[sq] = { backgroundColor: 'rgba(93, 216, 251, 0.35)' };
    }
  }
  if (from && to) {
    styles[to] = { backgroundColor: 'rgba(250, 204, 21, 0.55)' };
  }
  return styles;
}

export default function AcademyBoard({
  n = 3,
  title = 'Board Demonstration',
  board: boardData,
  practice,
  mode = 'demo', // 'demo' | 'solve' | 'play'
  caption,
  onSolved,
  onAttempt,
  boardWidth = 420,
}) {
  const fen = practice?.fen || boardData?.fen || '';
  const captionText = caption ?? practice?.prompt ?? boardData?.caption ?? '';

  const [game, setGame] = useState(() => {
    try {
      return new Chess(fen);
    } catch {
      return null;
    }
  });

  /* Reset when the position changes (next practice item, new topic). */
  useEffect(() => {
    try {
      setGame(new Chess(fen));
    } catch {
      setGame(null);
    }
  }, [fen]);

  const [lastMove, setLastMove] = useState(null);
  const [solved, setSolved] = useState(false);
  const [tries, setTries] = useState(0);
  const attemptCount = useRef(0);

  /* A new position resets the solve state. */
  useEffect(() => {
    setSolved(false);
    setTries(0);
    setLastMove(null);
    attemptCount.current = 0;
  }, [practice?.id, boardData?.fen]);

  const sideToMove = useMemo(() => game?.turn() ?? 'w', [game]);

  const handleMove = useCallback(
    (move) => {
      setLastMove({ from: move.from, to: move.to });
      if (mode === 'solve') {
        attemptCount.current += 1;
        setTries(attemptCount.current);
        /* Any legal move counts as an attempt; the curriculum stores the plan in
           prose, so "solved" is awarded by the panel below, not by guessing a
           single move. Passing `false` here only marks practice as attempted. */
        onAttempt?.({ move, attempt: attemptCount.current });
      }
    },
    [mode, onAttempt],
  );

  const markSolved = useCallback(() => {
    if (solved) return;
    setSolved(true);
    onSolved?.({ tries: Math.max(1, tries), solution: practice?.solution });
  }, [solved, tries, practice, onSolved]);

  if (!fen || !game) {
    return (
      <div>
        <StepHeading n={n} title={title} />
        <p className="text-sm text-ivory-500">This topic has no playable position.</p>
      </div>
    );
  }

  const arrows = (boardData?.arrows || []).map(([f, t]) => [f, t, 'rgba(93,216,251,0.9)']);

  return (
    <div>
      <StepHeading n={n} title={title} />

      <div className="grid gap-5 lg:grid-cols-[auto,1fr] items-start">
        <div className="mx-auto lg:mx-0">
          <ChessBoard
            game={game}
            boardWidth={boardWidth}
            /* In 'demo' the coach is reading, not playing, so the board is
               explicitly non-interactive — otherwise every static illustration
               would quietly be a puzzle. */
            interactive={mode !== 'demo'}
            draggableColor={mode === 'solve' ? sideToMove : null}
            soundOn={false}
            frameless
            customArrows={arrows}
            lastMove={lastMove}
            extraSquareStyles={highlightStyles(boardData, {
              from: lastMove?.from,
              to: lastMove?.to,
            })}
            /* Click-to-move only (dragging is off on game boards), so tapping a
               piece reveals its legal squares and tapping one plays the move. */
            clickToMove
            onMove={handleMove}
          />
        </div>

        <div className="space-y-3">
          {captionText && <p className="text-sm text-ivory-300 leading-relaxed">{captionText}</p>}

          {practice?.hint && !solved && (
            <details className="rounded-xl border border-ivory-700/40 bg-black/[0.03] px-3 py-2">
              <summary className="text-xs font-semibold text-gold-400 cursor-pointer">Reveal hint</summary>
              <p className="text-sm text-ivory-300 mt-2">{practice.hint}</p>
            </details>
          )}

          {mode === 'solve' && !solved && (
            <div className="flex flex-wrap gap-2">
              <ActionButton onClick={markSolved}>Show solution</ActionButton>
              {tries > 0 && <span className="self-center text-xs text-ivory-500">{tries} move{tries > 1 ? 's' : ''} played</span>}
            </div>
          )}

          {solved && (
            /* Label and sentence share one line: the label is an inline run in
               the same paragraph, so the explanation reads as "Solution: ..."
               and wraps as a single block of prose instead of sitting under a
               stacked heading. */
            <div className="rounded-xl border border-green-500/40 bg-green-500/10 p-3">
              <p className="text-sm leading-relaxed text-ivory-300">
                <span className="mr-1 font-semibold text-green-200">Solution:</span>
                {practice?.solution}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}