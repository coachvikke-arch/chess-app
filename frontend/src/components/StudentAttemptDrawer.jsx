import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import api from '../services/api';
import { useOverlayHistory } from '../hooks/useOverlayHistory';
import { useReviewKeys } from '../hooks/useReviewKeys';
import { LazyMiniBoard, MiniBoard, MoveNav } from './PuzzleCard';
import Button from './Button';
import Portal from './Portal';

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/* One colour language for the whole drawer: a move that was not the solution is
   red, one that was is green — the same pair on the board square and the chip. */
const WRONG_BG = 'rgba(239, 68, 68, 0.62)';
const RIGHT_BG = 'rgba(22, 163, 74, 0.55)';

function fmtClock(seconds) {
  const s = Number(seconds) || 0;
  if (s <= 0) return '—';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
}

function fmtDate(value) {
  return value ? new Date(value).toLocaleDateString() : '—';
}

/** Apply one stored move (UCI or SAN) to a game; null when the board rejects it. */
function step(game, token) {
  if (!token) return null;
  try {
    if (UCI_RE.test(token)) {
      return game.move({
        from: token.slice(0, 2),
        to: token.slice(2, 4),
        promotion: token.length > 4 ? token[4] : undefined,
      });
    }
    return game.move(token);
  } catch {
    return null;
  }
}

/**
 * The position after every ply of one move line, plus the squares that ply
 * touched. Index 0 is the starting position, so a ply number is always a valid
 * index into the result and MoveNav can drive it directly.
 *
 * A line stops at the first move the board will not accept. That happens when a
 * student's stored try contains an illegal move, and the last real position is
 * still worth showing, so the frame is marked `dead` instead of throwing.
 */
function buildFrames(startFen, moves) {
  const frames = [{ fen: startFen, from: null, to: null, move: null }];
  let game;
  try {
    game = new Chess(startFen);
  } catch {
    return frames;
  }
  for (const mv of moves || []) {
    const applied = step(game, mv.uci || mv.move || mv.san);
    if (!applied) {
      frames.push({ fen: game.fen(), from: null, to: null, move: mv, dead: true });
      break;
    }
    frames.push({ fen: game.fen(), from: applied.from, to: applied.to, move: mv });
  }
  return frames;
}

/** Square highlight for the move that produced this frame. */
function frameStyles(frame) {
  if (!frame || !frame.from || !frame.to) return undefined;
  const bg = frame.move && frame.move.isCorrect === false ? WRONG_BG : RIGHT_BG;
  return { [frame.from]: { backgroundColor: bg }, [frame.to]: { backgroundColor: bg } };
}

function MoveChip({ mv, index, onClick }) {
  const wrong = mv.isCorrect === false;
  const cls = wrong
    ? 'bg-red-500/10 border-red-500/30 text-red-600'
    : 'bg-green-500/10 border-green-500/30 text-green-600';
  const label = `${index + 1}. ${mv.move || mv.san || '?'}`;
  const title = wrong && mv.expected ? `Wrong — expected ${mv.expected}` : (mv.isCorrect ? 'Correct' : undefined);

  if (!onClick) {
    return (
      <span className={`text-[0.6rem] font-mono px-1.5 py-0.5 rounded-md border ${cls}`} title={title}>
        {wrong ? '✗' : '✓'} {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`text-[0.6rem] font-mono px-1.5 py-0.5 rounded-md border transition hover:brightness-95 ${cls}`}
    >
      {wrong ? '✗' : '✓'} {label}
    </button>
  );
}

/* One assigned puzzle, as a card: its starting position, what the student did
   with it, and every try listed in order. Clicking opens the replay. */
function AttemptCard({ item, number, onOpen }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(200);
  const attempts = item.attempts || [];

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(Math.min(el.clientWidth - 20, 260));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const outcome = item.isCorrect
    ? { label: 'Solved', cls: 'bg-green-500/15 border-green-500/40 text-green-600', mark: '✓' }
    : attempts.length
      ? { label: 'Not solved', cls: 'bg-red-500/15 border-red-500/40 text-red-500', mark: '✗' }
      : { label: 'Not attempted', cls: 'bg-ivory-700/25 border-ivory-700/50 text-ivory-400', mark: '–' };

  const boardWidth = Math.max(120, width);

  return (
    <article
      ref={wrapRef}
      role="button"
      tabIndex={0}
      aria-label={`Puzzle ${number}, ${item.title || item.theme || 'untitled'} — ${outcome.label}. Open the move-by-move replay.`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
      }}
      className="rounded-2xl border border-ivory-700/50 bg-black/[0.03] p-2.5 flex flex-col gap-2 cursor-pointer transition select-none h-full hover:border-blue-500/60 hover:bg-blue-500/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-[0.7rem] font-semibold text-ivory-500">Puzzle {number}</span>
          <span className="block text-xs font-medium text-ivory-200 truncate">
            {item.title || item.theme || `Puzzle #${item.puzzleId}`}
          </span>
        </span>
        <span className={`text-[0.55rem] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${outcome.cls}`}>
          {outcome.mark} {outcome.label}
        </span>
      </div>

      <LazyMiniBoard fen={item.fen} width={boardWidth} />

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6rem] text-ivory-500">
        <span>{attempts.length === 1 ? '1 try' : `${attempts.length} tries`}</span>
        <span>· {item.pointsEarned}/{item.pointsValue} pts</span>
        <span>· {fmtClock(item.timeTaken)}</span>
      </div>

      {attempts.length === 0 ? (
        <p className="text-[0.62rem] text-ivory-500 italic px-0.5">No attempts yet</p>
      ) : (
        <ul className="flex flex-col gap-1 px-0.5">
          {attempts.map((a) => (
            <li key={a.attemptId ?? a.attemptNo} className="flex flex-wrap items-center gap-1">
              <span className="text-[0.58rem] font-semibold text-ivory-500 shrink-0 w-[3.2rem]">
                Try {a.attemptNo}
              </span>
              {(a.moves || []).length === 0 ? (
                <span className="text-[0.58rem] text-ivory-500">no moves recorded</span>
              ) : (
                a.moves.map((mv, i) => <MoveChip key={i} mv={mv} index={i} />)
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/* The expanded card: one large board, the student's own moves stepped through
   with prev/next, the move's squares painted by whether it was the solution,
   and the correct line listed beside it. */
function PuzzleReplay({ item, number, onBack }) {
  const attempts = item.attempts || [];
  const hasSolution = (item.correctReplay || []).length > 0;
  /* Open on the most recent try — that is what a coach is looking for after
     watching a student struggle; fall back to the solution when there is none. */
  const [attemptKey, setAttemptKey] = useState(() =>
    attempts.length ? String(attempts[attempts.length - 1].attemptNo) : 'solution'
  );
  const [ply, setPly] = useState(0);
  const boardRef = useRef(null);
  const [boardWidth, setBoardWidth] = useState(360);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const update = () => setBoardWidth(Math.min(el.clientWidth, 440));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const line = useMemo(() => {
    if (attemptKey === 'solution') {
      return (item.correctReplay || []).map((m) => ({ move: m.san, uci: m.uci, isCorrect: true }));
    }
    const attempt = attempts.find((a) => String(a.attemptNo) === attemptKey);
    return attempt ? attempt.moves || [] : [];
  }, [attemptKey, attempts, item]);

  const frames = useMemo(() => buildFrames(item.fen, line), [item.fen, line]);
  /* Switching line changes how many plies exist, so a stale index would sit past
     the end of the new one. */
  const safePly = Math.min(ply, frames.length - 1);
  const frame = frames[safePly];

  useReviewKeys({
    prev: () => setPly((p) => Math.max(0, Math.min(p, frames.length - 1) - 1)),
    next: () => setPly((p) => Math.min(frames.length - 1, p + 1)),
    first: () => setPly(0),
    last: () => setPly(frames.length - 1),
  });

  const current = frame && frame.move;
  const caption = !frame
    ? ''
    : safePly === 0
      ? 'Starting position'
      : frame.dead
        ? `${current.move || '?'} is not a legal move here — the board stops at the last real position`
        : `${attemptKey === 'solution' ? 'Solution' : `Try ${attemptKey}`} · move ${safePly} of ${line.length}: ${current.move || '?'}${
            current.isCorrect === false && current.expected ? ` (expected ${current.expected})` : ''
          }`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={onBack} variant="secondary" size="sm" className="!px-3 !py-1.5 text-xs shrink-0">
          ← All puzzles
        </Button>
        <p className="min-w-0 text-sm font-semibold text-ivory-200 truncate">
          Puzzle {number} — {item.title || item.theme || `#${item.puzzleId}`}
        </p>
      </div>

      <div className="sad-replay">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {attempts.map((a) => {
              const on = String(a.attemptNo) === attemptKey;
              return (
                <button
                  key={a.attemptId ?? a.attemptNo}
                  type="button"
                  onClick={() => { setAttemptKey(String(a.attemptNo)); setPly(0); }}
                  className={`text-[0.65rem] px-2.5 py-1 rounded-lg border font-medium transition ${
                    on ? 'border-blue-600 bg-blue-600 text-white' : 'border-ivory-700/50 text-ivory-500 hover:border-blue-500/60'
                  }`}
                >
                  Try {a.attemptNo} {a.result === 'correct' ? '✓' : '✗'}
                </button>
              );
            })}
            {hasSolution && (
              <button
                type="button"
                onClick={() => { setAttemptKey('solution'); setPly(0); }}
                className={`text-[0.65rem] px-2.5 py-1 rounded-lg border font-medium transition ${
                  attemptKey === 'solution'
                    ? 'border-green-600 bg-green-600 text-white'
                    : 'border-green-500/40 text-green-600 hover:bg-green-500/10'
                }`}
              >
                Correct solution
              </button>
            )}
          </div>

          <div ref={boardRef} className="w-full flex justify-center">
            <MiniBoard fen={frame ? frame.fen : item.fen} width={boardWidth} squareStyles={frameStyles(frame)} />
          </div>

          <MoveNav moveCount={line.length} index={safePly} onChange={setPly} />
          {caption && (
            <p
              className={`text-center text-[0.68rem] ${
                current && current.isCorrect === false ? 'text-red-600' : 'text-ivory-500'
              }`}
              role="status"
            >
              {caption}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          <section>
            <h3 className="text-[0.62rem] uppercase tracking-wider text-ivory-500 font-semibold mb-1.5">
              Correct solution
            </h3>
            {(item.correctMoves || []).length === 0 ? (
              <p className="text-[0.65rem] text-ivory-500">No solution line stored for this puzzle.</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {item.correctMoves.map((san, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { if (hasSolution) { setAttemptKey('solution'); setPly(i + 1); } }}
                    className="text-[0.62rem] font-mono px-1.5 py-0.5 rounded-md border bg-green-500/10 border-green-500/30 text-green-600 transition hover:brightness-95"
                    title={`Show move ${i + 1} on the board`}
                  >
                    {i + 1}. {san}
                  </button>
                ))}
              </div>
            )}
            {item.explanation && (
              <p className="mt-2 text-[0.68rem] leading-relaxed text-ivory-300 whitespace-pre-line">
                {item.explanation}
              </p>
            )}
          </section>

          <section>
            <h3 className="text-[0.62rem] uppercase tracking-wider text-ivory-500 font-semibold mb-1.5">
              Every try ({attempts.length})
            </h3>
            {attempts.length === 0 ? (
              <p className="text-[0.68rem] text-ivory-500 italic">No attempts yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {attempts.map((a) => (
                  <li key={a.attemptId ?? a.attemptNo} className="rounded-lg border border-ivory-700/40 bg-black/[0.03] p-2">
                    <p className="flex flex-wrap items-center gap-x-2 text-[0.6rem] text-ivory-500 mb-1">
                      <span className="font-semibold text-ivory-300">Try {a.attemptNo}</span>
                      <span className={a.result === 'correct' ? 'text-green-600' : 'text-red-500'}>
                        {a.result === 'correct' ? 'solved' : 'not solved'}
                      </span>
                      <span>· {a.pointsEarned || 0} pts</span>
                      <span>· {fmtClock(a.timeTaken)}</span>
                      <span>· {fmtDate(a.attemptedAt)}</span>
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {(a.moves || []).map((mv, i) => (
                        <MoveChip
                          key={i}
                          mv={mv}
                          index={i}
                          onClick={
                            String(a.attemptNo) === attemptKey
                              ? () => setPly(i + 1)
                              : () => { setAttemptKey(String(a.attemptNo)); setPly(i + 1); }
                          }
                        />
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="sad-skeleton" role="status" aria-label="Loading this student's attempts" aria-busy="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="sad-skeleton-card">
          <div className="sad-skeleton-line w-2/5" />
          <div className="sad-skeleton-board" />
          <div className="sad-skeleton-line w-3/4" />
          <div className="sad-skeleton-line w-1/2" />
        </div>
      ))}
    </div>
  );
}

/**
 * Per-student attempt detail for one puzzle assignment, opened from a student
 * row on the admin Homework page.
 *
 * Reads GET /api/assignments/submissions/:id/review, which already returns the
 * student's moves per try with a correct/incorrect verdict on each one, so this
 * is a viewer over data the student's own solving path already writes — no new
 * endpoint, no new table.
 *
 * Two views share one scroll container: the card grid and, when a card is
 * opened, that puzzle's replay. Opening a card therefore does not mount a second
 * overlay or repaint the backdrop.
 */
export default function StudentAttemptDrawer({ submissionId, student, badge, onClose }) {
  useOverlayHistory('StudentAttemptDrawer', true, onClose);
  const titleId = useId();
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  /* The row that opened this drawer gets focus back on close, so a keyboard
     coach does not lose their place in the student list. */
  const returnFocusRef = useRef(null);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openPuzzle, setOpenPuzzle] = useState(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    closeRef.current?.focus();
  }, []);

  useEffect(() => () => {
    const el = returnFocusRef.current;
    if (el && document.contains(el)) el.focus();
  }, []);

  /* The page behind must not scroll while the sheet is up, and the scrollbar
     width is paid back as padding so the layout does not jump. */
  useEffect(() => {
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    /* cache: false — a coach reopens this while students are still solving, and
       the 30s GET cache would show the tries they did a moment ago. */
    api.get(`/assignments/submissions/${submissionId}/review`, { cache: false })
      .then((res) => { if (alive) setData(res.data); })
      .catch((e) => { if (alive) setError(e.response?.data?.message || e.message || 'Failed to load the attempts'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [submissionId]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      /* Back out of the replay before back out of the drawer. */
      e.stopPropagation();
      if (openPuzzle !== null) setOpenPuzzle(null);
      else onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const nodes = panelRef.current?.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!nodes || nodes.length === 0) return;
    const list = [...nodes].filter((n) => n.offsetParent !== null);
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const puzzles = data?.puzzles || [];
  const totals = useMemo(() => {
    const tries = puzzles.reduce((n, p) => n + (p.attempts || []).length, 0);
    return { tries, anyAttempts: tries > 0 };
  }, [puzzles]);

  const pill = badge || { label: student.status, cls: 'bg-black/5 border-ivory-700/50 text-ivory-500' };
  const openItem = openPuzzle === null ? null : puzzles[openPuzzle];

  return (
    <Portal>
    <div className="attempt-modal-backdrop fixed inset-0 z-[var(--z-modal-backdrop)] flex items-center justify-center p-3 sm:p-5 lg:p-8" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="attempt-modal-card relative flex w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-ivory-700/50 bg-ink-900 shadow-2xl"
      >
        {/* ── student summary header ─────────────────────────────────────── */}
        <header className="shrink-0 border-b border-ivory-700/40 px-4 sm:px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-lg sm:text-xl font-semibold text-ivory-100 truncate">
                {student.name}
              </h2>
              <p className="mt-0.5 text-xs text-ivory-500 truncate">{student.email || ''}</p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 w-9 h-9 grid place-items-center rounded-lg text-xl text-ivory-500 hover:text-ivory-100 hover:bg-black/5 transition"
            >
              ✕
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.7rem] text-ivory-500">
            <span className={`px-2 py-0.5 rounded-full border text-[0.65rem] ${pill.cls}`}>{pill.label}</span>
            <span>
              Solved <span className="font-semibold text-ivory-200">{student.progressCompleted}/{student.progressTotal}</span>
            </span>
            <span>
              {loading ? '…' : totals.tries} total tri{totals.tries === 1 ? 'y' : 'es'}
            </span>
            <span>
              <span className="font-semibold text-gold-500">{student.score ?? student.points ?? 0}</span> pts
            </span>
            <span>⏱ {fmtClock(student.timeTaken)}</span>
            <span>✔ {fmtDate(student.submittedAt)}</span>
          </div>
        </header>

        {/* ── body: skeleton, error, replay or the card grid ─────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-5 py-4">
          {loading ? (
            <DrawerSkeleton />
          ) : error ? (
            <div className="chess-card text-center py-10">
              <p className="chess-error text-sm">{error}</p>
              <Button type="button" onClick={onClose} variant="secondary" size="sm" className="mt-3">Close</Button>
            </div>
          ) : openItem ? (
            <PuzzleReplay
              key={`${openItem.puzzleId}`}
              item={openItem}
              number={openPuzzle + 1}
              onBack={() => setOpenPuzzle(null)}
            />
          ) : puzzles.length === 0 ? (
            <p className="chess-empty text-center py-12">This assignment has no puzzles.</p>
          ) : (
            <>
              {!totals.anyAttempts && (
                <div className="mb-4 rounded-xl border border-ivory-700/50 bg-black/[0.03] px-4 py-5 text-center">
                  <span className="block text-3xl mb-1 text-gold-500/40">♞</span>
                  <p className="text-sm font-semibold text-ivory-200">No attempts yet</p>
                  <p className="text-[0.7rem] text-ivory-500 mt-1">
                    {student.name} has not played any move on this homework.
                  </p>
                </div>
              )}
              <ul className="sad-grid">
                {puzzles.map((p, i) => (
                  <li key={p.puzzleId}>
                    <AttemptCard item={p} number={i + 1} onOpen={() => setOpenPuzzle(i)} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* ── footer ─────────────────────────────────────────────────────── */}
        <footer className="shrink-0 border-t border-ivory-700/40 px-4 sm:px-5 py-3 flex flex-wrap items-center gap-2">
          <p className="text-[0.65rem] text-ivory-500 min-w-0 truncate">
            {openItem
              ? 'Use ← → to step through the moves'
              : 'Select a puzzle to replay the student’s moves'}
          </p>
          <Button type="button" onClick={onClose} variant="secondary" size="sm" className="!px-4 !py-1.5 text-xs ml-auto">
            Close
          </Button>
        </footer>
      </div>
    </div>
    </Portal>
  );
}
