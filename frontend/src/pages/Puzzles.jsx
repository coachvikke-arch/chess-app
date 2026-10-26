import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Chess } from 'chess.js';
import api from '../services/api';
import PuzzlePlayer from '../components/PuzzlePlayer';
import { pieceGlyph } from '../components/puzzle/PuzzlePopups';
import { Page, Chip, ConfirmDialog } from '../components/ui';
import { useFittedBoardWidth } from '../hooks/useBoardWidth';
import { createTransitionGuard } from '../lib/puzzleTransition';
import { revealAfterCheckmate } from '../effects/moveEffect';
import {
  assignmentPuzzlesSorted,
  assignmentResumeIndex,
  nextAssignmentPuzzleIndex,
  assignmentAllAttempted,
  assignmentSolvedCount,
} from '../lib/assignmentFlow';
import Button from '../components/Button';

const THEME_LABELS = {
  fork: 'Fork', pin: 'Pin', skewer: 'Skewer', sacrifice: 'Sacrifice',
  discoveredAttack: 'Discovered Attack', doubleCheck: 'Double Check',
  trappedPiece: 'Trapped Piece', deflection: 'Deflection',
  attraction: 'Attraction', intermezzo: 'Intermezzo',
  xrayAttack: 'X-Ray Attack', zugzwang: 'Zugzwang',
  hangingPiece: 'Hanging Piece', capturedDefender: 'Capture Defender',
  backRankMate: 'Back-Rank Mate', mateIn1: 'Mate in 1', mateIn2: 'Mate in 2',
  mateIn3: 'Mate in 3', mateIn4: 'Mate in 4', mateIn5: 'Mate in 5+',
  smotheredMate: 'Smothered Mate', operaMate: 'Opera Mate',
  rookEndgame: 'Rook Endgame', bishopEndgame: 'Bishop Endgame',
  pawnEndgame: 'Pawn Endgame', knightEndgame: 'Knight Endgame',
  queenEndgame: 'Queen Endgame',
  opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame',
  advantage: 'Advantage', crushing: 'Crushing', equality: 'Equality',
  oneMove: 'One-Move', short: 'Short (2 moves)', long: 'Long (3 moves)', veryLong: 'Very Long (4+)',
};

export default function Puzzles() {
  const boardWidth = useFittedBoardWidth(420);
  const [assignments,   setAssignments]   = useState([]);
  const [current,      setCurrent]      = useState(null);
  const [wrongMove,    setWrongMove]    = useState(false);
  const [wrongMsg,     setWrongMsg]     = useState('');
  const [wrongCount,   setWrongCount]   = useState(0);
  const [boardKey,     setBoardKey]     = useState(0);
  const [startTime,    setStartTime]    = useState(null);
  const [showHint,     setShowHint]     = useState(false);
  const [exhausted,    setExhausted]    = useState(null);
  const [fx,           setFx]           = useState(null);
  const fxTimer = useRef(null);
  const nextTimer = useRef(null);
  const wrongTimer = useRef(null);
  /* The celebration card waits for the checkmate animation to finish. */
  const fxRevealCancel = useRef(null);
  const [moveLog,     setMoveLog]     = useState([]);
  const [puzzleDone,   setPuzzleDone]   = useState(false);
  const [loadError,    setLoadError]    = useState('');

  // Assignment submit flow
  const [submitDialog, setSubmitDialog] = useState(null); // { assignment, onConfirm }
  const [viewOnlyAssignment, setViewOnlyAssignment] = useState(null); // assignmentId locked for viewing
  // The assignment currently being worked through (puzzle solving happens in
  // the assignment solving view; this keeps Continue/View navigation in a real
  // solving context).
  const [activeAssignment, setActiveAssignment] = useState(null);
  // True once every puzzle in the active assignment has been attempted — the
  // "final review / hand it in" state. Not a submission by itself.
  const [assignmentComplete, setAssignmentComplete] = useState(false);
  /* Guarded 2s delay between a correct solve and the next assignment puzzle.
     Single-flight: duplicate solve events can never start the transition twice,
     and it is cancelled whenever the user leaves the puzzle. */
  const transitionGuardRef = useRef(null);
  if (!transitionGuardRef.current) transitionGuardRef.current = createTransitionGuard(2000);
  // Always-fresh nextPuzzle for the delayed transition (a setTimeout closure
  // must not capture a stale current).
  const nextPuzzleRef = useRef(null);

  /* ── data loading ──
     My Assignments is the only student entry point now, so the page loads just
     the assignment set (`/puzzles/my-assignments`). The standalone folder
     browsing view (`/puzzles/assigned`) is gone from this page; the endpoint
     itself is untouched for any other caller. */
  const load = useCallback(async () => {
    setLoadError('');
    try {
      const assignmentsRes = await api.get('/puzzles/my-assignments');
      setAssignments(assignmentsRes.data.assignments || []);
    } catch (err) {
      setLoadError(err.response?.data?.message || 'Failed to load assigned puzzles');
      setAssignments([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

/* ── panel reset ── */
  function resetSolvePanel() {
    clearTimeout(wrongTimer.current);
    clearTimeout(nextTimer.current);
    if (fxRevealCancel.current) { fxRevealCancel.current(); fxRevealCancel.current = null; }
    transitionGuardRef.current.cancel();
    setWrongMove(false);
    setWrongMsg('');
    setMoveLog([]);
    setExhausted(null);
    setPuzzleDone(false);
  }

  /* ── Assignment submit flow ── */
  const [pendingSubmit, setPendingSubmit] = useState(null);

  async function handleSubmitAssignment(assignment) {
    try {
      await api.post(`/puzzles/${assignment.assignmentId}/submit-assignment`);
      setPendingSubmit(null);
      // Refresh cards only AFTER the server confirms, then leave the solving
      // context so the card's new Submitted state is what the student sees.
      await load();
      if (activeAssignment?.assignmentId === assignment.assignmentId) closeAssignment();
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to submit assignment';
      alert(msg); // keep prior state — nothing was persisted, so the student can retry
    }
  }

  function openSubmitDialog(assignment) {
    setPendingSubmit(assignment);
  }

  function closeSubmitDialog() {
    setPendingSubmit(null);
  }

  function openPuzzle(p) {
    clearTimeout(nextTimer.current);
    transitionGuardRef.current.cancel();
    // Prefer the freshest copy of this puzzle (attemptResult may have just
    // changed after a solve/load) so a re-opened solved puzzle stays locked.
    const target = activeAssignment !== null
      ? assignments.find((a) => a.assignmentId === activeAssignment.assignmentId)
          ?.puzzles.find((x) => x.id === p.id) || p
      : p;
    setCurrent(target);
    resetSolvePanel();
    // Already solved before → hint available immediately. Applies to free-range
    // puzzles (`solved`) and to assignment puzzles already answered correctly
    // (`attemptResult === 'correct'`); review mode locks everything.
    const alreadyDone = viewOnlyAssignment !== null
      || (activeAssignment !== null && target.attemptResult === 'correct')
      || target.solved;
    if (alreadyDone) setPuzzleDone(true);
    // Admin-given tries already used up → lock it on load
    else if (target.maxAttempts != null && (target.attemptsUsed ?? 0) >= target.maxAttempts) {
      setPuzzleDone(true);
      setExhausted('Attempts exhausted — puzzle locked');
    }
    setBoardKey(0);
    setStartTime(Date.now());
  }

  function closePuzzle() {
    setCurrent(null);
    resetSolvePanel();
  }

  /* ── assignment solving context ── */
  function openAssignmentFromCard(a) {
    transitionGuardRef.current.cancel();
    const readOnly = a.status === 'submitted' || a.status === 'reviewed';
    setViewOnlyAssignment(readOnly ? a : null);
    setActiveAssignment(a);
    setAssignmentComplete(!readOnly && assignmentAllAttempted(a.puzzles));
    resetSolvePanel();
    const ordered = assignmentPuzzlesSorted(a.puzzles);
    const resume = assignmentResumeIndex(a.puzzles);
    const first = resume >= 0 ? ordered[resume] : ordered[0];
    if (first) openPuzzle(first);
  }

  function closeAssignment() {
    transitionGuardRef.current.cancel();
    setActiveAssignment(null);
    setViewOnlyAssignment(null);
    setAssignmentComplete(false);
    setCurrent(null);
    resetSolvePanel();
  }

  /* ── solution in SAN ── */
  const hintSan = useMemo(() => {
    if (!current || !current.solution?.length) return '';
    try {
      const g = new Chess(current.fen);
      return current.solution.map((u) => {
        const m = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
        return m.san;
      }).join(' → ');
    } catch { return current.solution.join(' '); }
  }, [current]);

  /* ── hint gating: only available once puzzle is done ── */
  const solvedCurrent = current?.solved ?? false;
  const setSolvedInActive = activeAssignment !== null && current?.attemptResult === 'correct';
  const inReviewMode = viewOnlyAssignment !== null;
  const canShowHint = puzzleDone || !!exhausted || solvedCurrent || setSolvedInActive || inReviewMode;

  /* ── next puzzle only available after current is done ── */
  const canGoNext   = puzzleDone || !!exhausted || solvedCurrent || setSolvedInActive || inReviewMode;

  /* ── locked = no tries left, already solved in the active assignment, or a
       read-only submitted/reviewed assignment (review mode) ── */
  const puzzleLocked = !!exhausted || inReviewMode || setSolvedInActive ||
    (current?.maxAttempts != null && (current?.attemptsUsed ?? 0) >= current.maxAttempts);

  function notifyDashboardRefresh() {
    window.dispatchEvent(new Event('puzzle-solved'));
  }

  /* ── Duolingo-style success FX ── */
  function triggerFx(payload) {
    setFx({ key: Date.now(), ...payload });
    clearTimeout(fxTimer.current);
    fxTimer.current = setTimeout(() => setFx(null), 1800);
  }

  function handleCorrectMove(move) {
    triggerFx({
      kind: 'correct',
      square: move.to,
      piece: pieceGlyph(move.pieceType, move.color),
      xp: 10,
    });
    if (move.san) setMoveLog((prev) => [...prev, { san: move.san, color: 'green' }]);
  }

  useEffect(() => () => {
    clearTimeout(fxTimer.current);
    clearTimeout(nextTimer.current);
    clearTimeout(wrongTimer.current);
    if (fxRevealCancel.current) { fxRevealCancel.current(); fxRevealCancel.current = null; }
    transitionGuardRef.current.cancel();
  }, []);

  /* ── attempt handlers ── */
  async function handleSolved(moves, meta = {}) {
    const isMate = !!meta.checkmate;
    const fxPayload = {
      kind: isMate ? 'checkmate' : 'solved',
      square: meta.lastMove?.to,
      kingSquare: isMate ? meta.kingSquare : null,
      piece: pieceGlyph(meta.lastMove?.pieceType, meta.lastMove?.color),
      msg: isMate ? 'CHECKMATE!' : 'Solved!',
      xp: 10,
    };
    /* A celebration on a mating move must not cover the mating animation. */
    if (isMate) {
      if (fxRevealCancel.current) fxRevealCancel.current();
      fxRevealCancel.current = revealAfterCheckmate(
        {
          to: meta.lastMove?.to,
          key: `puzzle:${current.id}:${startTime || 'attempt'}:${meta.lastMove?.to || 'mate'}`,
        },
        () => {
          fxRevealCancel.current = null;
          triggerFx(fxPayload);
        },
      );
    } else {
      triggerFx(fxPayload);
    }
    const timeTaken = Math.round((Date.now() - startTime) / 1000);
    try {
      // Solve inside the open assignment card: name it so the attempt credits
      // THIS assignment (shared folders must never credit a sibling card).
      const res = await api.post(`/puzzles/${current.id}/attempt`, {
        moves, timeTaken,
        assignmentId: activeAssignment?.assignmentId ?? null,
      });
      if (res.data.correct) {
        setPuzzleDone(true);
        setWrongMove(false);
        load();
        notifyDashboardRefresh();
        if (activeAssignment) {
          transitionGuardRef.current.schedule(current.id, () => nextPuzzleRef.current());
        } else {
          nextPuzzle();
        }
      } else if (res.data.blocked) {
        setWrongMove(false);
        setPuzzleDone(true);
        setExhausted(res.data.message || 'No attempts left for this puzzle.');
        load();
      }
    } catch { /* keep playing */ }
  }

  /* Wrong moves consume an admin-set try; when tries run out the puzzle locks */
  async function handleFailed(moves, wrongSan) {
    if (wrongSan) setMoveLog((prev) => [...prev, { san: wrongSan, color: 'red' }]);
    const newCount = wrongCount + 1;
    setWrongCount(newCount);
    const maxTries = current?.maxAttempts ?? null;
    const timeTaken = Math.round((Date.now() - startTime) / 1000);
    try {
      const res = await api.post(`/puzzles/${current.id}/attempt`, {
        moves, timeTaken,
        assignmentId: activeAssignment?.assignmentId ?? null,
      });
      const outOfTries = maxTries != null && newCount >= maxTries;
      if (res.data.blocked || res.data.attemptsExhausted || outOfTries) {
        clearTimeout(wrongTimer.current);
        setWrongMove(false);
        setWrongMsg('');
        setPuzzleDone(true);
        setExhausted('Attempts exhausted — puzzle locked');
        load();
        nextPuzzle();
      } else {
        const left = res.data.attemptsLeft ?? res.data.remainingAttempts;
        setWrongMove(true);
        setWrongMsg(left != null ? `${left} attempt${left === 1 ? '' : 's'} left` : '');
        clearTimeout(wrongTimer.current);
        wrongTimer.current = setTimeout(() => { setWrongMove(false); setWrongMsg(''); }, 1300);
      }
    } catch {
      setWrongMove(true);
      setWrongMsg('');
      clearTimeout(wrongTimer.current);
      wrongTimer.current = setTimeout(() => setWrongMove(false), 1300);
    }
  }

  /* ── "next puzzle" navigation — moves sequentially through the open assignment ── */
  function nextPuzzle() {
    clearTimeout(nextTimer.current);
    transitionGuardRef.current.cancel();
    if (!activeAssignment) return;
    const ordered = assignmentPuzzlesSorted(activeAssignment.puzzles);
    const nxt = nextAssignmentPuzzleIndex(activeAssignment.puzzles, current?.id);
    if (nxt >= 0) { openPuzzle(ordered[nxt]); return; }
    // Last assignment puzzle done → final review / submit-ready state.
    setAssignmentComplete(true);
  }
  nextPuzzleRef.current = nextPuzzle;

  /* ════════════════════════════ RENDER ════════════════════════════ */
  return (
    <Page
      piece="♞"
      title="My Assignments"
    >

      {/* Active puzzle header bar */}
      {current && (
        <div className="rounded-2xl border border-ivory-700/50 bg-black/[0.03] p-4 mb-6 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-2xl text-gold-400">♞</span>
            <div>
              <p className="font-semibold text-ivory-300">{current.title || current.set_name || current.setName || 'Puzzle'}</p>
              <p className="text-xs text-ivory-500">
                {THEME_LABELS[current.theme] || current.theme}
                {current.difficulty ? ` · ${current.difficulty}` : ''}
              </p>
              {(current.points != null || current.timeLimitSeconds != null || current.maxAttempts != null || current.negativePoints > 0) && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {current.points != null && (
                    <span className="text-[0.6rem] px-1.5 py-0.5 rounded-full bg-gold-700/20 border border-gold-500/40 text-gold-400">
                      {current.points} pts
                    </span>
                  )}
                  {current.negativePoints > 0 && (
                    <span className="text-[0.6rem] px-1.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-600">
                      -{current.negativePoints} if wrong
                    </span>
                  )}
                  {current.timeLimitSeconds != null && (
                    <span className="text-[0.6rem] px-1.5 py-0.5 rounded-full bg-black/5 border border-ivory-700/50 text-ivory-300">
                      ⏱ {current.timeLimitSeconds}s
                    </span>
                  )}
                  {current.maxAttempts != null && (
                    <span className="text-[0.6rem] px-1.5 py-0.5 rounded-full bg-black/5 border border-ivory-700/50 text-ivory-300">
                      {Math.max(current.maxAttempts - (current.attemptsUsed ?? 0), 0)}/{current.maxAttempts} tries left
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <Button onClick={closePuzzle} variant="secondary" size="sm" className="!px-3 !py-1.5 text-xs">✕ Close</Button>
        </div>
      )}

      {/* My Assignments view — the sole student entry point for puzzle
          assignments. Each assignment renders as its own card keyed by
          assignmentId, so two assignments that share a title or set never merge. */}
      {!activeAssignment && (
        <div className="space-y-4">
          <p className="text-xs text-ivory-500 mb-4">
            {assignments.length} assignment{assignments.length !== 1 ? 's' : ''} · Click to view puzzles
          </p>
          {loadError && <p className="chess-error text-sm">{loadError}</p>}
          {assignments.length === 0 ? (
            <div className="chess-card text-center py-12">
              <span className="block text-5xl mb-3 piece-glyph-spin text-gold-500/40">📋</span>
              <p className="chess-empty">No puzzle assignments yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {assignments.map((a) => (
                <div
                  key={a.assignmentId}
                  className={`chess-card p-4 rounded-xl border transition hover:-translate-y-0.5 ${
                    a.status === 'submitted' || a.status === 'reviewed'
                      ? 'border-green-500/40 bg-green-500/10'
                      : a.status === 'in_progress'
                        ? 'border-gold-500/30 bg-gold-700/10'
                        : 'border-ivory-700/50 bg-black/[0.04]'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-ivory-100 flex items-center gap-2">
                        <span className="text-gold-400">📋</span> {a.title}
                        {a.status === 'submitted' && (
                          <span className="text-[0.6rem] px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/30 text-green-600">
                            Submitted
                          </span>
                        )}
                        {a.status === 'reviewed' && (
                          <span className="text-[0.6rem] px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/30 text-green-600">
                            Reviewed
                          </span>
                        )}
                        {a.status === 'in_progress' && (
                          <span className="text-[0.6rem] px-2 py-0.5 rounded-full bg-gold-500/10 border border-gold-500/30 text-gold-500">
                            In Progress
                          </span>
                        )}
                        {a.status === 'pending' && (
                          <span className="text-[0.6rem] px-2 py-0.5 rounded-full bg-black/5 border-ivory-700/50 text-ivory-500">
                            Not Started
                          </span>
                        )}
                        {a.status === 'overdue' && (
                          <span className="text-[0.6rem] px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-600">
                            Overdue
                          </span>
                        )}
                      </h3>
                      <p className="text-sm text-ivory-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        <span>🧩 {a.progress.solved}/{a.progress.total} solved</span>
                        <span>Max attempts: <span className="text-ivory-300">{a.maxAttempts}</span></span>
                        {a.dueDate && <span>⚑ Due {new Date(a.dueDate).toLocaleDateString()}</span>}
                        <span>Created {new Date(a.createdAt).toLocaleDateString()}</span>
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-[0.65rem] text-ivory-500 shrink-0">
                          Progress: {a.progress.solved}/{a.progress.total}
                        </span>
                        <div className="flex-1 h-2 rounded-full bg-ivory-700/50 overflow-hidden">
                          <div
                            className="h-full bg-gold-500 rounded-full transition-all"
                            style={{ width: `${a.progress.pct}%` }}
                          />
                        </div>
                        <span className="text-[0.6rem] text-ivory-500 shrink-0">{a.progress.pct}%</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {a.status === 'in_progress' && a.progress.attempted > 0 && (
                        <Button
                          onClick={() => openSubmitDialog(a)}
                          variant="primary" size="md" className="!px-4 !py-2 text-sm"
                        >
                          Submit Assignment
                        </Button>
                      )}
                      {a.status === 'submitted' && (
                        <span className="text-xs text-green-600 flex items-center gap-1">
                          ✓ Submitted {a.submittedAt ? new Date(a.submittedAt).toLocaleDateString() : ''}
                        </span>
                      )}
                      {a.status === 'reviewed' && (
                        <span className="text-xs text-green-600 flex items-center gap-1">
                          ✓ Reviewed · {a.progress.solved}/{a.progress.total} pts
                        </span>
                      )}
                      {a.status === 'pending' && a.progress.attempted === 0 && (
                        <span className="text-xs text-ivory-500">Not started</span>
                      )}
                      <Button
                        onClick={() => openAssignmentFromCard(a)}
                        variant="secondary" size="sm" className="!px-3 !py-1.5 text-xs"
                      >
                        {a.status === 'submitted' || a.status === 'reviewed' ? 'View' : 'Continue'}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeAssignment && (
        <>
        {/* ════════════════════════════ ASSIGNMENT SOLVING VIEW ════════════════════════════ */}

        {/* Assignment solving header — the Submit Assignment button lives on the
            puzzle-solving page, is always visible in an active (non-review)
            assignment, and is disabled-with-explanation until every puzzle has
            been attempted. */}
        {activeAssignment && (
          <div className="rounded-2xl border border-ivory-700/50 bg-black/[0.03] p-4 mb-6 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="text-2xl text-gold-400">📋</span>
              <div>
                <p className="font-semibold text-ivory-100">{activeAssignment.title}</p>
                <p className="text-xs text-ivory-500">
                  {assignmentSolvedCount(activeAssignment.puzzles)}/{activeAssignment.puzzles.length} solved
                  {activeAssignment.maxAttempts != null && ` · Max ${activeAssignment.maxAttempts} tries per puzzle`}
                </p>
              </div>
            </div>
            {viewOnlyAssignment ? (
              <span className="text-xs text-green-600 flex items-center gap-1">
                ✓ {activeAssignment.status === 'reviewed' ? 'Reviewed' : 'Submitted'} · browsing read-only
              </span>
            ) : (
              <div className="flex flex-col items-end gap-1 shrink-0">
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => openSubmitDialog(activeAssignment)}
                    disabled={!assignmentAllAttempted(activeAssignment.puzzles)}
                    variant="primary" size="md" className="!px-4 !py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    title={assignmentAllAttempted(activeAssignment.puzzles)
                      ? 'Hand this assignment in for the coach to review'
                      : 'Attempt every puzzle before submitting'}
                  >
                    Submit Assignment
                  </Button>
                  <Button onClick={closeAssignment} variant="secondary" size="sm" className="!px-3 !py-1.5 text-xs">
                    ← Assignments
                  </Button>
                </div>
                {!assignmentAllAttempted(activeAssignment.puzzles) && (
                  <span className="text-[0.65rem] text-ivory-500">
                    Attempt all {activeAssignment.puzzles.length} puzzles to enable submit
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        <div className="grid md:grid-cols-5 gap-8">
          {/* ════ LEFT: assignment puzzle list ════ */}
          <div className="md:col-span-2 lg:col-span-1 min-w-0">

          {/* Active assignment → ordered puzzle list with per-puzzle result marks */}
          {activeAssignment ? (
            <>
              <button
                onClick={closeAssignment}
                className="text-xs chess-link mb-3 inline-flex items-center gap-1"
              >
                ← Back to assignments
              </button>
              <h2 className="font-display text-lg font-bold mb-1 flex items-center gap-2">
                <span className="text-xl text-gold-400">📋</span> {activeAssignment.title}
              </h2>
              <p className="text-xs text-ivory-500 mb-3">
                {assignmentSolvedCount(activeAssignment.puzzles)} / {activeAssignment.puzzles.length} solved
                {viewOnlyAssignment && (
                  <span className="ml-2 text-green-600">· {activeAssignment.status === 'reviewed' ? 'Reviewed' : 'Submitted'} — review only</span>
                )}
              </p>
<ul className="space-y-1.5 max-h-[26vh] overflow-y-auto pr-1">
  {assignmentPuzzlesSorted(activeAssignment.puzzles).map((p, i) => {
    const isActive = current?.id === p.id;
    return (
      <li key={p.id} style={{ animation: `fade-up .4s ${i * 0.04}s both` }}>
        <button
          onClick={() => openPuzzle(p)}
          className={`w-full text-left px-3 py-2 rounded-lg border transition hover:-translate-y-0.5 ${
            isActive
              ? 'border-gold-500/60 bg-gold-700/15 shadow-[0_0_20px_rgba(96,165,250,0.12)]'
              : 'border-ivory-700/50 bg-black/[0.04] hover:border-gold-500/30'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <span className={`w-6 h-6 shrink-0 rounded-full grid place-items-center text-[0.7rem] font-bold ${
              p.attemptResult === 'correct'
                ? 'bg-green-500/15 text-green-600 border border-green-500/40'
                : p.attemptResult === 'incorrect'
                  ? 'bg-red-500/10 text-red-600 border border-red-500/40'
                  : 'bg-gold-700/20 text-gold-400 border border-gold-500/40'
            }`}>
              {p.attemptResult === 'correct' ? '✓' : p.attemptResult === 'incorrect' ? '✗' : (p.orderIndex ?? i + 1)}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ivory-300 truncate">
                {p.setName || 'Puzzle'}
              </p>
              <p className="text-[0.62rem] text-ivory-500 capitalize truncate">
                {THEME_LABELS[p.theme] || p.theme || 'Tactics'}
                {p.difficulty ? ` · ${p.difficulty}` : ''}
              </p>
            </div>
            {p.attemptResult === 'correct' && (
              <span className="text-[0.55rem] px-1 py-0.5 rounded-full bg-green-500/10 border border-green-500/30 text-green-600 whitespace-nowrap shrink-0">
                ✓ Done
              </span>
            )}
          </div>
        </button>
      </li>
    );
  })}
</ul>
            </>
          ) : null}
        </div>

        {/* ════ RIGHT: board area ════ */}
        <div className="md:col-span-3 lg:col-span-4 flex flex-col items-center">
          {current ? (
            <div className="w-full flex flex-col items-center">

              {/* Theme / difficulty chips */}
              <div className="flex flex-wrap gap-2 mb-4">
                <Chip tone="gold">{THEME_LABELS[current.theme] || current.theme}</Chip>
                <Chip>{current.difficulty}</Chip>
                {current.themes && current.themes.length > 1 && current.themes.slice(0, 2).map((t) => (
                  <Chip key={t}>{THEME_LABELS[t] || t}</Chip>
                ))}
              </div>

              {/* Board + right-side options */}
              <div className="w-full flex flex-col gap-8 lg:items-start xl:flex-row xl:justify-center">

                {/* Board column */}
                <div className="flex flex-col items-center">
                  {/* Board — always visible; locked (not playable) once attempts are exhausted */}
                  <PuzzlePlayer
                    key={`${current.id}-${boardKey}`}
                    fen={current.fen}
                    solution={current.solution || []}
                    onSolved={handleSolved}
                    onFailed={handleFailed}
                    onCorrectMove={handleCorrectMove}
                    fx={fx}
                    boardWidth={boardWidth}
                    interactive={!puzzleLocked}
                    points={current?.points ?? 10}
                  />
                </div>

                {/* Right-side options panel */}
                <div className="xl:w-48 w-full flex flex-col gap-3 shrink-0">
                  {/* Your moves — permanent right/wrong list, one by one */}
                  <div className="rounded-lg border border-ivory-700/50 bg-black/[0.03] p-2.5">
                    <p className="text-[0.62rem] uppercase tracking-wider text-ivory-500 mb-1.5 font-semibold">
                      Your moves
                    </p>
                    {moveLog.length === 0 ? (
                      <p className="text-[0.65rem] text-ivory-500 leading-relaxed">
                        Right and wrong moves you try will appear here — they stay until you change puzzle.
                      </p>
                    ) : (
                      <ul className="space-y-1 max-h-44 overflow-y-auto pr-1">
                        {moveLog.map((m, i) => (
                          <li key={i} className="flex items-center gap-1.5 text-[0.7rem] font-mono">
                            <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${m.color === 'green' ? 'bg-green-400' : 'bg-red-400'}`} />
                            <span className={m.color === 'green' ? 'text-green-600' : 'text-red-600'}>{m.san}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Attempts exhausted — puzzle locked, board not playable */}
                  {exhausted && (
                    <div
                      className="px-3 py-3 rounded-xl border border-red-500/40 bg-red-500/10 text-red-600 text-sm text-center"
                      style={{ animation: 'board-pop .3s both' }}
                    >
                      <p className="font-semibold">⚑ {exhausted}</p>
                      {current.maxAttempts != null && (
                        <p className="mt-1 text-xs opacity-90">
                          You used all {current.maxAttempts} allowed {current.maxAttempts === 1 ? 'attempt' : 'attempts'}.
                        </p>
                      )}
                      <Button onClick={nextPuzzle} variant="primary" size="sm" fullWidth className="mt-2 !px-4 !py-1.5 text-xs w-full">
                        ⏭ Next puzzle
                      </Button>
                    </div>
                  )}
                  {/* Assignment finished — every puzzle attempted, nothing left
                      but to hand it in (review/retry any puzzle via the left
                      list). This is a submit-ready state, not a submission. */}
                  {activeAssignment && assignmentComplete && !viewOnlyAssignment && (
                    <div
                      className="px-3 py-3 rounded-xl border border-green-500/40 bg-green-500/10 text-green-600 text-sm text-center"
                      style={{ animation: 'board-pop .3s both' }}
                    >
                      <p className="font-semibold">✓ All {activeAssignment.puzzles.length} puzzles attempted</p>
                      <p className="mt-1 text-xs opacity-90">Review your answers above, then hand the assignment in.</p>
                      <Button onClick={() => openSubmitDialog(activeAssignment)} variant="primary" size="sm" fullWidth className="mt-2 !px-4 !py-1.5 text-xs w-full">
                        Submit Assignment
                      </Button>
                    </div>
                  )}
                  {/* Wrong move message */}
                  {wrongMove && (
                    <div
                      className="px-3 py-2 rounded-lg border border-red-500/40 bg-red-500/10 text-red-600 text-sm text-center font-semibold"
                      style={{ animation: 'board-pop .25s both' }}
                    >
                      ✗ Wrong move{wrongMsg ? ` · ${wrongMsg}` : ''}
                    </div>
                  )}
                  {/* Show / Hide solution */}
                  {canShowHint ? (
                    <Button
                      onClick={() => setShowHint((s) => !s)}
                      disabled={!hintSan}
                      variant="secondary" size="md" className="!px-4 !py-2 text-sm inline-flex items-center gap-1.5 justify-center"
                    >
                      <span>💡</span>
                      {showHint ? 'Hide solution' : 'Show solution'}
                    </Button>
                  ) : (
                    <span
                      className="text-xs border border-ivory-700/50 rounded-lg px-3 py-2 bg-black/[0.03] text-ivory-500 inline-flex items-center gap-1.5 opacity-60 cursor-not-allowed select-none"
                      title="Solve the puzzle or exhaust all attempts to unlock the hint"
                    >
                      🔒 Hint unlocks after you solve it or use all attempts
                    </span>
                  )}
                  {/* Next puzzle — once current is done while board is still showing */}
                  {canGoNext && !exhausted && !wrongMove && (
                    <Button
                      onClick={nextPuzzle}
                      variant="primary" size="md" className="!px-4 !py-2 text-sm inline-flex items-center gap-2 justify-center"
                    >
                      ⏭ Next puzzle
                    </Button>
                  )}

                  {/* Explanation */}
                  {current.explanation && !showHint && (
                    <p className="text-xs text-ivory-500 italic leading-relaxed">
                      "{current.explanation}"
                    </p>
                  )}

                  {/* Solution reveal panel */}
                  {showHint && hintSan && (
                    <div
                      className="px-4 py-3 rounded-xl border border-gold-500/60 bg-white text-ivory-100 shadow-[0_4px_16px_rgba(120,96,12,0.14)]"
                      style={{ animation: 'board-pop .3s both' }}
                    >
                      <p className="text-xs uppercase tracking-wider text-gold-600 mb-1.5 font-semibold flex items-center gap-1.5">
                        💡 Solution
                      </p>
                      <p className="font-mono text-base leading-relaxed text-ivory-100">{hintSan}</p>
                    </div>
                  )}
                </div>

              </div>

            </div>
          ) : (
            <div className="chess-empty mt-20 text-lg">
              <span className="block text-6xl mb-4 piece-glyph-spin text-gold-500/40">📁</span>
              Open an assignment puzzle from the list to begin.
            </div>
          )}
        </div>

      </div>

      </>

        )}

      {/* Submit Assignment Confirmation Dialog */}
      {pendingSubmit && (
        <ConfirmDialog
          open={true}
          title="Submit Assignment?"
          message={`Submit "${pendingSubmit.title}"? You can't solve this assignment again after submitting. ${pendingSubmit.progress.solved}/${pendingSubmit.progress.total} puzzles solved.`}
          onConfirm={() => handleSubmitAssignment(pendingSubmit)}
          onCancel={closeSubmitDialog}
          confirmText="Submit Assignment"
          cancelText="Cancel"
          variant="gold"
        />
      )}

    </Page>
  );
}
