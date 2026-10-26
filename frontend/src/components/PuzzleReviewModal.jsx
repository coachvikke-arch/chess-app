import { useOverlayHistory } from '../hooks/useOverlayHistory';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import api from '../services/api';
import { Spinner, Chip } from './ui';
import { MiniBoard } from './PuzzleCard';
import Button from './Button';

/**
 * The library's real MiniBoard, mounted only once the card scrolls into view.
 *
 * MiniBoard is a full react-chessboard instance and honours the viewer's saved
 * piece theme and board theme — which is exactly what we want here. The problem
 * is volume: an assignment can hold 70 puzzles, and mounting 70 boards at once
 * is slow enough that the grid renders blank. So each card observes itself and
 * only mounts its board when it is near the viewport, keeping a plain
 * placeholder until then.
 */
function LazyMiniBoard({ fen, width }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '400px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="w-full flex justify-center pointer-events-none">
      {visible ? (
        <div className="w-full max-w-[200px] flex flex-col items-center">
          <MiniBoard fen={fen} width={width} />
        </div>
      ) : (
        <div
          className="rounded bg-black/20"
          style={{ width, height: width }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}


/**
 * One puzzle as a card, styled like the library's PuzzleCard: the same amber
 * border/tint, the same mini board preview, the same chips.
 *
 * The board shows the position the student actually reached (their moves
 * replayed), or the correct line when "Show correct moves" is on — so a wrong
 * attempt is visible at a glance instead of just "✗". Moves are listed as
 * colour-coded chips underneath, per puzzle.
 */
function ReviewPuzzleCard({ item, number, selected, showCorrect, onSelect }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(140);

  // Same responsive sizing trick as PuzzleCard: measure the column, cap it so
  // the board stays small enough to fit three across.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(Math.min(el.clientWidth, 200));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const line = useMemo(
    () => (showCorrect ? item.correctReplay || [] : item.moves || []),
    [item, showCorrect]
  );

  // Replay the visible line so the preview is a real, legal position.
  const fen = useMemo(() => {
    if (!item.fen) return null;
    try {
      const g = new Chess(item.fen);
      for (const mv of line) {
        const applied = mv.uci
          ? g.move({ from: mv.uci.slice(0, 2), to: mv.uci.slice(2, 4), promotion: mv.uci.length > 4 ? mv.uci[4] : undefined })
          : g.move(mv.san || mv.move);
        if (!applied) break;
      }
      return g.fen();
    } catch {
      return item.fen;
    }
  }, [item.fen, line]);

  /* Three states the coach cares about: solved, attempted-but-wrong, or never
     attempted. The API reports `isCorrect` + `attemptCount`, so derive it here
     rather than trusting a single flag. */
  const outcome = item.isCorrect ? 'correct' : (item.attemptCount > 0 ? 'wrong' : 'todo');
  const OUTCOME = {
    correct: { label: 'Completed', cls: 'bg-green-500/15 border-green-500/40 text-green-500', mark: '✓' },
    wrong: { label: 'Failed', cls: 'bg-red-500/15 border-red-500/40 text-red-500', mark: '✗' },
    todo: { label: 'Not attempted', cls: 'bg-ivory-700/25 border-ivory-700/50 text-ivory-400', mark: '–' },
  }[outcome];

  return (
    <article
      ref={wrapRef}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
      }}
      title={`Puzzle ${number} — ${OUTCOME.label}`}
      className={`rounded-2xl border p-2.5 flex flex-col gap-2 cursor-pointer transition select-none h-full ${selected
          ? 'border-amber-500 bg-amber-400/25 shadow-[0_0_18px_rgba(245,158,11,0.3)]'
          : 'border-amber-500/40 bg-amber-400/[0.06] hover:border-amber-500/70 hover:bg-amber-400/15'
        }`}
    >
      <div className="flex items-center justify-between gap-1 px-0.5">
        <span className="text-xs font-semibold text-ivory-300 truncate">
          {selected && <span className="mr-1 text-amber-600">✓</span>}
          {number}
        </span>
        <span className={`text-[0.55rem] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${OUTCOME.cls}`}>
          {OUTCOME.mark} {OUTCOME.label}
        </span>
      </div>

      {fen ? (
        <LazyMiniBoard fen={fen} width={Math.max(120, Math.min(width, 200))} />
      ) : (
        <div className="w-full aspect-square grid place-items-center rounded-lg bg-black/20 text-[0.55rem] text-ivory-500">
          no board
        </div>
      )}

      {/* move chips for this puzzle */}
      <div className="px-0.5">
        <p className="text-[0.55rem] uppercase tracking-wider text-ivory-500 mb-1">
          {showCorrect ? 'Correct moves' : 'Student moves'}
        </p>
        {line.length === 0 ? (
          <p className="text-[0.6rem] text-ivory-500">
            {showCorrect ? 'No correct line available.' : 'No moves recorded.'}
          </p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-1">
              {line.map((mv, i) => {
                const correct = showCorrect ? true : !!mv.isCorrect;
                return (
                  <li key={i}>
                    <span
                      className={`text-[0.6rem] font-mono px-1.5 py-0.5 rounded-md border ${correct
                          ? 'bg-green-500/10 border-green-500/30 text-green-600'
                          : 'bg-red-500/10 border-red-500/30 text-red-500'
                        }`}
                      title={mv.expected ? `Expected: ${mv.expected}` : undefined}
                    >
                      {correct ? '✓' : '✗'} {i + 1}. {mv.san || mv.move}
                    </span>
                  </li>
                );
              })}
            </ul>
            {!showCorrect && (
              <p className="text-[0.55rem] text-ivory-500 mt-1">
                {line.filter((m) => m.isCorrect).length}/{line.length} moves correct
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1 mt-auto px-0.5">
        {item.difficulty && <Chip>{item.difficulty}</Chip>}
        <Chip>{item.pointsEarned}/{item.pointsValue} pts</Chip>
        {item.timeTaken > 0 && <Chip>{item.timeTaken}s</Chip>}
        {item.attemptCount > 1 && <Chip>{item.attemptCount} tries</Chip>}
      </div>
    </article>
  );
}

/**
 * Puzzle assignment review — every puzzle in the student's submission as a card,
 * in a 3-column grid: the position the student reached, their move sequence as
 * colour-coded chips, and an optional reveal of the correct line.
 *
 * There is no separate large board — each card carries its own board, so the
 * coach compares puzzles side by side instead of stepping through them one at a
 * time. Boards render from each puzzle's FEN and advance by replaying the shown
 * moves with chess.js, so every position is real and legal.
 */
export default function PuzzleReviewModal({ submissionId, onClose }) {
  useOverlayHistory('PuzzleReviewModal', true, onClose);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [showCorrect, setShowCorrect] = useState(false);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get(`/assignments/submissions/${submissionId}/review`)
      .then((res) => { if (alive) { setData(res.data); setIndex(0); } })
      .catch((e) => alive && setError(e.response?.data?.message || e.message || 'Failed to load the review'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [submissionId]);

  const puzzles = data?.puzzles || [];

  // Selecting a card only changes the highlight — every card shows its own
  // board and moves, so there is nothing else to drive.
  const selectPuzzle = (i) => { setIndex(i); };

  /* Card grid: keep the real index on each puzzle so selecting a filtered card
     still jumps to the right position in the full list. */
  const solvedCount = puzzles.filter((p) => p.isCorrect).length;


  const PUZZLE_FILTERS = useMemo(
    () => [
      { key: 'all', label: 'All', count: puzzles.length },
      { key: 'right', label: 'Completed', count: puzzles.filter((p) => p.isCorrect).length },
      { key: 'wrong', label: 'Failed', count: puzzles.filter((p) => !p.isCorrect && p.attemptCount > 0).length },
      { key: 'todo', label: 'Not attempted', count: puzzles.filter((p) => !(p.attemptCount > 0)).length },
    ],
    [puzzles]
  );

  const visiblePuzzles = useMemo(
    () =>
      puzzles
        .map((p, __index) => ({ ...p, __index }))
        .filter((p) => {
          if (filter === 'right') return p.isCorrect;
          if (filter === 'wrong') return !p.isCorrect && p.attemptCount > 0;
          if (filter === 'todo') return !(p.attemptCount > 0);
          return true;
        }),
    [puzzles, filter]
  );

  const markReviewed = async () => {
    setBusy(true);
    try {
      await api.patch(`/assignments/submissions/${submissionId}/review`, {
        status: 'reviewed',
        score: data?.summary?.totalPoints,
      });
    } catch { /* ignore */ }
    setBusy(false);
    onClose?.();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-[var(--z-modal-backdrop)] grid place-items-center bg-black/60 p-4">
        <div className="chess-card p-6"><Spinner text="Loading the submission…" /></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="fixed inset-0 z-[var(--z-modal-backdrop)] grid place-items-center bg-black/60 p-4" onClick={onClose}>
        <div className="chess-card p-6 max-w-md text-center" onClick={(e) => e.stopPropagation()}>
          <p className="text-sm text-red-600 mb-4">{error || 'Submission not found'}</p>
          <Button type="button" onClick={onClose} variant="primary" size="md">Close</Button>
        </div>
      </div>
    );
  }


  const { submission, summary } = data;

  return (
    <div className="fixed inset-0 z-[var(--z-modal-backdrop)] overflow-y-auto bg-black/60 grid place-items-center p-3 sm:p-4" onClick={onClose}>
      <div
        className="chess-card w-full max-w-6xl flex flex-col max-h-[95vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'board-pop .3s both' }}
      >
        {/* header */}
        <div className="p-4 border-b border-ivory-700/40">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="font-display text-lg font-semibold text-ivory-100">
              <span className="text-gold-400">♞</span> {submission.studentName}
            </h2>
            {/* min-w-0 + break-words: a long batch title is the widest item in
                this wrapping row, and without them it refuses to shrink and
                spills under the card's overflow-hidden edge. */}
            <span className="text-xs text-ivory-500 min-w-0 break-words">{submission.assignmentTitle}</span>
            <span className={`text-[0.6rem] px-2 py-0.5 rounded-full border ${['submitted', 'reviewed'].includes(submission.status)
                ? 'bg-green-500/10 border-green-500/30 text-green-600'
                : submission.status === 'overdue'
                  ? 'bg-red-500/10 border-red-500/30 text-red-500'
                  : 'bg-gold-500/10 border-gold-500/30 text-gold-500'
              }`}>
              {submission.status}
            </span>

            {/* `ml-auto` only from `sm` up. On phones this block wraps to its own
                line, and an auto left-margin there shoves it hard right while the
                title above is still sharing the row — the two collide. Left-
                aligning below `sm` keeps the stack clean and readable. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ivory-500 sm:ml-auto">
              <span>★ <span className="text-gold-400">{summary.totalPoints}</span> points</span>
              <span>⏱ {summary.totalTime}s</span>
              <span>🧩 {summary.puzzleCount} puzzles</span>
              <span>✓ {summary.solvedCount} solved ({summary.accuracy}%)</span>
            </div>
          </div>
        </div>

        {/* toolbar: filters + correct-moves toggle (the grid is the navigation) */}
        <div className="px-3 py-2 border-b border-ivory-700/30 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-[0.65rem] uppercase tracking-wider text-gold-400 font-semibold">
            Puzzles ({puzzles.length})
          </p>
          <span className="text-[0.6rem] text-ivory-500">
            {solvedCount}/{puzzles.length} solved
          </span>

          <div className="flex flex-wrap gap-1">
            {PUZZLE_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`text-[0.6rem] px-2 py-0.5 rounded-full border transition ${filter === f.key
                    ? 'border-gold-500/50 bg-gold-500/10 text-gold-400'
                    : 'border-ivory-700/40 text-ivory-500 hover:border-gold-500/30'
                  }`}
              >
                {f.label} ({f.count})
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-xs text-ivory-500 sm:ml-auto">
            <input
              type="checkbox"
              checked={showCorrect}
              onChange={(e) => setShowCorrect(e.target.checked)}
              className="accent-[#93c5fd]"
            />
            Show correct moves
          </label>
        </div>

        {/* 3-column card grid, scrolls on its own.
            min-h guards the collapse: the modal is `max-h-[95vh] flex flex-col`,
            and on a phone the wrapped header + toolbar can eat the whole budget.
            `flex-1` alone then resolves to ~0px and the grid disappears behind a
            tall empty gap, leaving only the footer. */}
        <div className="flex-1 min-h-[180px] overflow-y-auto p-3">
          {puzzles.length === 0 ? (
            <p className="chess-empty text-center py-12">This assignment has no puzzles.</p>
          ) : visiblePuzzles.length === 0 ? (
            <p className="chess-empty text-center py-12 text-xs">Nothing in this filter.</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {visiblePuzzles.map((p) => {
                const i = p.__index;
                return (
                  <li key={p.puzzleId}>
                    <ReviewPuzzleCard
                      item={p}
                      number={i + 1}
                      selected={i === index}
                      showCorrect={showCorrect}
                      onSelect={() => selectPuzzle(i)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>


        {/* footer */}
        <div className="p-3 border-t border-ivory-700/40 flex flex-wrap items-center gap-2">
          <Button type="button" onClick={onClose} variant="secondary" size="sm" className="!px-4 !py-1.5 text-xs">Close</Button>
          <Button type="button" onClick={markReviewed} disabled={busy} variant="primary" size="sm" className="!px-4 !py-1.5 text-xs ml-auto">
            {busy ? 'Saving…' : 'Mark as reviewed'}
          </Button>
        </div>
      </div>
    </div>
  );
}
