import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '../Button';
import { Chess } from 'chess.js';
import api from '../../services/api';
import { on } from '../../services/socket';
import { useAuth } from '../../context/AuthContext';
import { useLiveClass } from '../../context/LiveClassContext';
import SharedChessBoard from './SharedChessBoard';
import PvPPlayBoard from './PvPPlayBoard';
import ChessBoard from '../ChessBoard';
import { useFittedWidthIn } from '../../hooks/useBoardWidth';
import { revealAfterCheckmate } from '../../effects/moveEffect';

/* The Ask-quiz setup modal rides its own chunk: the click sets the open
   state first and renders the backdrop instantly, the form streams in. */
const QuizPuzzleModal = lazy(() => import('./QuizAskModal'));
function prefetchQuizAskModal() {
  import('./QuizAskModal').catch(() => {});
}

const POLL_MS = 2500;

/* One place decides what every drill surface says about a result, and with
   which colour — the instructor's grid, the student's card and the card border
   all read from here, so "completed" cannot be green on one screen and amber on
   the next. `tone` is what the CSS keys off; `label` is what a person reads. */
const STATUS_META = {
  solving: { label: 'Solving', tone: 'solving', cls: 'live-drill-st-solving' },
  completed: { label: 'Completed', tone: 'done', cls: 'live-drill-st-completed' },
  failed: { label: 'Failed', tone: 'bad', cls: 'live-drill-st-failed' },
  time_finished: { label: 'Failed — Time Finished', tone: 'bad', cls: 'live-drill-st-failed' },
};

const EMPTY_ME = { result: 'solving', moves: [], wrongMoves: [], attempted: 0, pointsEarned: 0, remainingMs: null };

function formatClock(ms) {
  if (ms == null) return '—';
  const secs = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Puzzle rating, if this drill came from a library puzzle. */
function ratingOf(drill) {
  const r = drill?.puzzle?.rating;
  const n = Number(r);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/* One ply of the list. A button when the board can jump to it, plain text
   otherwise — so the same list renders for a viewer with no board to drive. */
function MovePly({ san, ply, tone, viewPly, onJump }) {
  if (!onJump) return <span className={`live-drill-move live-drill-move-${tone}`}>{san}</span>;
  const isCurrent = viewPly === ply;
  return (
    <button
      type="button"
      title={`Show ${san}`}
      aria-current={isCurrent || undefined}
      className={`live-drill-move live-drill-move-${tone}${isCurrent ? ' is-current' : ''}`}
      onClick={() => onJump(ply)}
    >
      {san}
    </button>
  );
}

/**
 * The move list, as numbered pairs with the wrong guesses kept beside the step
 * they were made on.
 *
 * Pairing is done off the PLY index, never off a count of the student's moves:
 * a two-move solve is four plies and must read `1. w b 2. w b`. Anything that
 * rebuilds this by doubling a move count mis-numbers it, and a mis-numbered
 * score sheet looks authoritative while being wrong.
 */
function MoveRows({ moves, wrongs, viewPly = null, livePly = null, onJump = null }) {
  const correct = [];
  for (const san of moves || []) {
    if (correct.length === 0 || correct[correct.length - 1] !== san) correct.push(san);
  }
  const wrongByStep = new Map();
  for (const w of wrongs || []) {
    if (!w?.san) continue;
    const step = Number.isFinite(w.step) ? w.step : 0;
    if (!wrongByStep.has(step)) wrongByStep.set(step, []);
    wrongByStep.get(step).push(w.san);
  }

  if (correct.length === 0 && wrongByStep.size === 0) {
    return <p className="live-drill-none">No moves yet — your first move shows up here.</p>;
  }

  /* A step guessed wrong before anything landed still gets a row, so the
     numbering does not jump when the first right move finally arrives. */
  const lastWrongStep = [...wrongByStep.keys()].reduce((a, b) => Math.max(a, b), -1);
  const stepCount = Math.max(Math.ceil(correct.length / 2), lastWrongStep + 1);

  const rows = [];
  for (let step = 0; step < stepCount; step++) {
    const solverSan = correct[step * 2];
    const replySan = correct[step * 2 + 1];
    const wrong = wrongByStep.get(step) || [];
    rows.push(
      <li key={step} className="live-drill-moverow">
        <span className="live-drill-movenum">{step + 1}.</span>
        <span className="live-drill-movebody">
          {solverSan
            ? <MovePly san={solverSan} ply={step * 2} tone="good" viewPly={viewPly} onJump={onJump} />
            : <span className="live-drill-move live-drill-move-empty">—</span>}
          {replySan && <MovePly san={replySan} ply={step * 2 + 1} tone="reply" viewPly={viewPly} onJump={onJump} />}
          {wrong.map((san, i) => (
            <span key={i} className="live-drill-move live-drill-move-bad" title={`Wrong guess ${i + 1}`}>✗ {san}</span>
          ))}
        </span>
      </li>
    );
  }

  /* Reviewing an earlier position: say so, and offer the way back. */
  if (onJump && viewPly != null && livePly != null && viewPly !== livePly) {
    rows.push(
      <li key="live" className="live-drill-moverow">
        <span className="live-drill-movenum" />
        <span className="live-drill-movebody">
          <button type="button" className="live-drill-move live-drill-move-live" onClick={() => onJump(livePly)}>
            ⟲ Back to now
          </button>
        </span>
      </li>
    );
  }

  return <ol className="live-drill-movelist">{rows}</ol>;
}

/* Tiny per-card board: replays the student's correct moves (SAN) from the
   puzzle's start position so the instructor sees exactly where they are.

   The width is measured off this element rather than fixed. The cards sit four
   across, so the space available is a fraction of the drill area that changes
   with the column count - a hard-coded 252px overflowed its card the moment the
   grid went to four columns, and the board is the one thing on the card that
   cannot shrink to fit. */
function MiniDrillBoard({ fen, moves }) {
  const boardRef = useRef(null);
  const width = useFittedWidthIn(boardRef, { max: 252 });
  const game = useMemo(() => {
    const g = new Chess(fen);
    for (const san of moves || []) {
      try {
        g.move(san.replace(/[+#]+$/, ''));
      } catch {
        break;
      }
    }
    return g;
  }, [fen, moves]);
  if (!fen) return null;
  return (
    <div className="live-drill-card-board" ref={boardRef}>
      <ChessBoard game={game} interactive={false} showLegalMoves={false} boardWidth={width} />
    </div>
  );
}

function DrillStatusCard({ student, timeLimitSeconds, fen, title }) {
  const meta = STATUS_META[student.result] || STATUS_META.solving;
  return (
    <div className={`live-drill-card live-drill-tone-${meta.tone}`}>
      <div className="live-drill-card-top">
        <span className="live-drill-name">{student.name || 'Student'}</span>
        <span className={`live-drill-pill ${meta.cls}`}>{meta.label}</span>
      </div>
      <div className="live-drill-meta">
        {timeLimitSeconds != null && (
          <span className="live-drill-stat" title="Time remaining">
            ⏱ {formatClock(student.remainingMs)}
          </span>
        )}
        <span className="live-drill-stat" title="Points">
          ★ {student.pointsEarned > 0 ? `+${student.pointsEarned}` : student.pointsEarned}
        </span>
        <span className="live-drill-stat" title="Attempts">
          ✗ {student.attempted || 0}
        </span>
      </div>
      <MiniDrillBoard fen={fen} moves={student.moves || []} />
      <p className="live-drill-cardtitle">{title}</p>
      <MoveRows moves={student.moves || []} wrongs={student.wrongMoves || []} />
    </div>
  );
}

function InstructorDrillView({ drill, onEnd }) {
  const students = [...(drill.students || [])].sort((a, b) => rank(a) - rank(b) || (a.name || '').localeCompare(b.name || ''));
  function rank(s) {
    if (s.result === 'completed') return 0;
    if (s.result === 'failed' || s.result === 'time_finished') return 1;
    return 2;
  }
  return (
    <>
      <div className="live-drill-toolbar">
        <span className="live-drill-breadcrumb">
          <span className="live-drill-breadcrumb-all">All</span>
          <span className="live-drill-breadcrumb-sep">›</span>
          <span className="live-drill-breadcrumb-name">{drill.puzzle?.title || 'Puzzle'}</span>
        </span>
        <span className="live-drill-toolbar-stat">
          {drill.timeLimitSeconds != null && `⏱ ${drill.timeLimitSeconds}s`}
        </span>
        <Button type="button" variant="secondary" size="sm" onClick={onEnd}>✕ End drill</Button>
      </div>
      <div className="live-drill-grid">
        {students.map((s) => (
          <DrillStatusCard
            key={s.userId}
            student={s}
            timeLimitSeconds={drill.timeLimitSeconds}
            fen={drill.puzzle?.fen}
            title={drill.puzzle?.title}
          />
        ))}
      </div>
    </>
  );
}

/**
 * The student's drill card — the vertical panel beside the board.
 *
 * It carries, in order: the puzzle, what it is worth, how many tries are gone,
 * where the attempt stands, and every move played. Read-only on purpose: the
 * shared board is ONE position broadcast to the whole room, so a student's
 * attempts cannot be driven off it without every other student watching. The
 * card is how they follow their own solve without the drill taking the board.
 *
 * `onJumpPly` is the one control here that touches the board, and it only ever
 * moves the DISPLAY backwards — see SharedChessBoard's drillViewPly.
 */
function StudentDrillStatus({ drill, progress, timeUp, viewPly, onJumpPly, onRetry }) {
  const meta = STATUS_META[progress.result] || STATUS_META.solving;
  const maxAttempts = drill.maxAttempts;
  const attempted = progress.attempted || 0;
  const points = progress.pointsEarned || 0;
  const moves = progress.moves || [];
  const wrongs = progress.wrongMoves || [];
  const rating = ratingOf(drill);
  const title = drill.puzzle?.title || 'Our Coach’s Puzzle';

  /* "0/3" plus the bar that shows it. A drill with no attempt cap has no
     denominator, so the bar shows progress through the LINE instead — the
     thing the student is actually trying to finish. */
  const totalPlies = Math.max(1, (drill.puzzle?.solution || []).length);
  const used = Math.max(attempted, moves.length);
  const pct = maxAttempts != null
    ? Math.min(100, Math.round((used / Math.max(1, maxAttempts)) * 100))
    : Math.min(100, Math.round((moves.length / totalPlies) * 100));
  const solved = progress.result === 'completed';
  const dead = progress.result === 'failed' || progress.result === 'time_finished';

  return (
    <div className={`live-drill-info-card live-drill-tone-${meta.tone}${solved || dead ? ' result-reveal' : ''}`}>
      <p className="live-drill-info-title" title={title}>{title}</p>

      <div className="live-drill-info-worth">
        {rating != null && (
          <span className="live-drill-info-rating" title={`Rated ${rating}`}>
            <span className="live-drill-info-star">★</span> {rating}
          </span>
        )}
        <span className={`live-drill-info-points${points > 0 ? ' is-earned' : ''}`} title="Points">
          {points > 0 ? `+${points}` : points} pts
        </span>
        {drill.timeLimitSeconds != null && (
          <span className={`live-drill-info-clock${timeUp ? ' is-out' : ''}`} title="Time remaining">
            ⏱ {formatClock(progress.remainingMs)}
          </span>
        )}
      </div>

      <div className="live-drill-info-progress">
        <div className="live-drill-info-prow">
          <span className="live-drill-info-plabel">
            {maxAttempts != null
              ? <>Tries <b>{attempted}/{maxAttempts}</b></>
              : <>Moves <b>{moves.length}/{totalPlies}</b></>}
          </span>
          {maxAttempts != null && <span className="live-drill-info-plabel-dim">{pct}%</span>}
        </div>
        <div
          className="live-drill-info-bar"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className={`live-drill-info-fill${solved ? ' is-done' : ''}`} style={{ width: `${solved ? 100 : pct}%` }} />
        </div>
      </div>

      <div className="live-drill-info-status">
        <span className={`live-drill-pill ${meta.cls}`}>
          {solved ? '✓ ' : dead ? '✗ ' : ''}{meta.label}
        </span>
        {onRetry && (solved || dead) && (
          <Button type="button" variant="primary" size="sm" onClick={onRetry} title="Start this puzzle again">
            ↻ Retry
          </Button>
        )}
      </div>

      <div className="live-drill-info-moves">
        <p className="live-drill-info-mlabel">Moves</p>
        <MoveRows
          moves={moves}
          wrongs={wrongs}
          viewPly={viewPly}
          livePly={moves.length || null}
          onJump={onJumpPly}
        />
      </div>
    </div>
  );
}

export default function PuzzleDrillArea() {
  const { user } = useAuth();
  const { classMeta, isInstructor, quizAsk, closeQuizAsk } = useLiveClass();
  const classId = classMeta?.id;

  /* Warm the Ask-quiz chunk while idle: by the time an "Ask quiz" button is
     pressed the modal code is already here, so the click only sets state. */
  useEffect(() => {
    if (!isInstructor) return undefined;
    let cancelled = false;
    const warm = () => { if (!cancelled) prefetchQuizAskModal(); };
    let idleId = null;
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(warm, { timeout: 4000 });
    } else {
      idleId = window.setTimeout(warm, 2500);
    }
    return () => {
      cancelled = true;
      if (typeof window.cancelIdleCallback === 'function' && idleId != null) window.cancelIdleCallback(idleId);
      else window.clearTimeout(idleId);
    };
  }, [isInstructor]);

  const [drill, setDrill] = useState(null);
  const [me, setMe] = useState(EMPTY_ME);
  const [timeUp, setTimeUp] = useState(false);
  /* Which ply of the solve the board is DISPLAYING. null = live. Lives here
     because the move list lives here too, so a click on a move and the card's
     "Back to now" are the same piece of state. */
  const [drillViewPly, setDrillViewPly] = useState(null);
  /* A mating solve posts immediately (the ledger must not lose the attempt),
     but its Completed card waits for the checkmate animation. The flag hides
     the server/poll result too, so a 2.5s refresh cannot reveal it early. */
  const [resultHidden, setResultHidden] = useState(false);
  const [drillNonce, setDrillNonce] = useState(0);
  const resultRevealCancelRef = useRef(null);
  /* Retry's counterpart to drillNonce on the drill object, for the ledger. */
  const solverResetNonceRef = useRef(0);
  const deadlineRef = useRef(null);
  const statusRef = useRef('solving');
  const progressRef = useRef(me);
  useEffect(() => { progressRef.current = me; }, [me]);

  const applyServer = useCallback((d) => {
    if (!d) {
      if (resultRevealCancelRef.current) { resultRevealCancelRef.current(); resultRevealCancelRef.current = null; }
      setResultHidden(false);
      setMe({ result: 'solving', moves: [], wrongMoves: [], attempted: 0, pointsEarned: 0, remainingMs: null });
      setTimeUp(false);
      deadlineRef.current = null;
      statusRef.current = 'solving';
      return;
    }
    const row = (d.students || []).find((s) => s.userId === user?.id);
    if (row && row.result !== 'solving') {
      statusRef.current = row.result;
      if (row.result === 'time_finished') setTimeUp(true);
    }
    if (!deadlineRef.current && d.timeLimitSeconds != null) {
      const nowMs = new Date(d.now).getTime();
      deadlineRef.current = nowMs + d.timeLimitSeconds * 1000;
    }
    setMe(row || EMPTY_ME);
  }, [user]);

  useEffect(() => {
    if (!classId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await api.get(`/classes/${classId}/puzzle-drill`, { cache: false });
        if (cancelled) return;
        setDrill(res.data.drill);
        applyServer(res.data.drill);
      } catch (_) { /* keep last state */ }
    };
    tick();
    const iv = window.setInterval(tick, POLL_MS);
    return () => { cancelled = true; window.clearInterval(iv); };
  }, [classId, applyServer]);

  useEffect(() => {
    if (!classId) return;
    const joinUser = (payload) => (payload.classId === classId ? payload.userId : null);
    const offs = [
      on('puzzle_drill_started', (payload) => {
        if (!payload || payload.classId !== classId) return;
        setDrill(payload.drill || null);
        applyServer(payload.drill || null);
      }),
      on('puzzle_drill_ended', (payload) => {
        if (!payload || payload.classId !== classId) return;
        setDrill(null);
        applyServer(null);
      }),
      on('puzzle_drill_progress', (payload) => {
        if (!payload || payload.classId !== classId) return;
        setDrill((prev) =>
          prev
            ? {
                ...prev,
                students: (prev.students || []).map((s) =>
                  s.userId === payload.userId
                    ? {
                        ...s,
                        result: payload.result ?? s.result,
                        moves: payload.moves ?? s.moves,
                        attempted: payload.attempted ?? s.attempted,
                        wrongMoves: payload.wrongMoves ?? s.wrongMoves,
                        pointsEarned: payload.pointsEarned ?? s.pointsEarned,
                      }
                    : s
                ),
              }
            : prev
        );
        if (joinUser(payload) === user?.id) {
          setMe((prev) => ({
            ...prev,
            result: payload.result ?? prev.result,
            moves: payload.moves ?? prev.moves,
            attempted: payload.attempted ?? prev.attempted,
            wrongMoves: payload.wrongMoves ?? prev.wrongMoves,
            pointsEarned: payload.pointsEarned ?? prev.pointsEarned,
          }));
          statusRef.current = payload.result ?? statusRef.current;
        }
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [classId, applyServer, user]);

  useEffect(() => {
    if (!drill?.timeLimitSeconds || deadlineRef.current == null) return;
    const iv = window.setInterval(() => {
      const left = deadlineRef.current - Date.now();
      if (left <= 0 && statusRef.current === 'solving') {
        const prev = progressRef.current;
        statusRef.current = 'time_finished';
        setTimeUp(true);
        setMe((prev_) => ({ ...prev_, result: 'time_finished', remainingMs: 0, moves: prev.moves || [], wrongMoves: prev.wrongMoves || [], attempted: prev.attempted || 0 }));
        api.post(`/classes/${classId}/puzzle-drill/progress`, {
          drillId: drill.id,
          result: 'time_finished',
          moves: prev.moves || [],
          wrongMoves: prev.wrongMoves || [],
          attempted: prev.attempted || 0,
        }).catch(() => {});
      }
      setMe((prev) => ({ ...prev, remainingMs: left > 0 ? left : 0 }));
    }, 1000);
    return () => window.clearInterval(iv);
  }, [drill, classId]);

  const post = useCallback((payload) => {
    if (!drill) return Promise.resolve();
    return api.post(`/classes/${classId}/puzzle-drill/progress`, { drillId: drill.id, ...payload }).catch(() => {});
  }, [drill, classId]);

  /* Send the line the board actually walked, not a guess at it. The board owns the
   ply count (it is the only thing that knows how far through the solution the
   student really is), so it hands the UCI it has consumed over and this turns
   that into the SAN strip. Rebuilding the strip from "how many solver moves were
   reported" instead was how a two-move solve came to be recorded as a finished
   one. */
  const pushMoves = useCallback(async (uciLine, attempted, result, wrongMoves) => {
    const uci = Array.isArray(uciLine) ? uciLine : [];
    const fullSan = drill?.puzzle?.san || [];
    let moves;
    try {
      const g = new Chess(drill?.puzzle?.fen);
      const out = [];
      for (const u of uci) {
        const mv = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });
        if (!mv) break;
        out.push(mv.san);
      }
      moves = out;
    } catch {
      moves = fullSan.slice(0, uci.length);
    }
    await post({ result, moves, attempted, wrongMoves: wrongMoves || [] });
    return moves;
  }, [drill, post]);

  const onCorrectMove = useCallback((_move, uciLine) => {
    pushMoves(uciLine, me.attempted, statusRef.current === 'completed' ? 'completed' : 'solving', me.wrongMoves)
      .then((moves) => setMe((prev) => ({ ...prev, moves, result: statusRef.current })));
  }, [me.attempted, me.wrongMoves, pushMoves]);

  const onSolved = useCallback((uciLine, meta = {}) => {
    statusRef.current = 'completed';
    const reveal = (moves) => {
      resultRevealCancelRef.current = null;
      setResultHidden(false);
      setMe((prev) => ({ ...prev, moves, result: 'completed', pointsEarned: drill?.points || 0 }));
    };
    pushMoves(uciLine, me.attempted, 'completed', me.wrongMoves).then((moves) => {
      if (meta.checkmate) {
        /* Hide the Completed card until the mating animation finishes. */
        setResultHidden(true);
        if (resultRevealCancelRef.current) resultRevealCancelRef.current();
        resultRevealCancelRef.current = revealAfterCheckmate(
          { to: meta.lastMove?.to },
          () => reveal(moves),
        );
      } else {
        reveal(moves);
      }
    });
  }, [me.attempted, me.wrongMoves, pushMoves, drill, drillNonce]);

  /* The board reports the line INCLUDING the move it just vetoed, so the played
     line is everything but that last ply — and the ply it reached says which
     solver move was being attempted. */
  const onFailed = useCallback((allUci, wrongSan) => {
    const playedLine = Array.isArray(allUci) ? allUci.slice(0, -1) : [];
    const step = Math.floor(playedLine.length / 2);
    const attempted = me.attempted + 1;
    const maxAttempts = drill?.maxAttempts;
    const result = maxAttempts != null && attempted >= maxAttempts ? 'failed' : 'solving';
    if (result === 'failed') statusRef.current = 'failed';
    const wrongMoves = wrongSan
      ? [...(me.wrongMoves || []), { san: wrongSan, step }]
      : [...(me.wrongMoves || [])];
    pushMoves(playedLine, attempted, result, wrongMoves).then((moves) => {
      setMe((prev) => ({
        ...prev,
        attempted,
        moves,
        wrongMoves,
        result,
        pointsEarned: result === 'failed' ? (drill?.negativePoints ? -drill.negativePoints : 0) : prev.pointsEarned,
      }));
    });
  }, [me.attempted, me.wrongMoves, pushMoves, drill]);

  /* A student who has solved (or run out of) this puzzle can start it again from
     the card. It clears THEIR OWN ledger only — the drill itself, and every
     other student's progress, is the instructor's to end. The board resets
     through `drillNonce`, which is a new key on the drill the board is handed. */
  const onRetry = useCallback(() => {
    if (resultRevealCancelRef.current) { resultRevealCancelRef.current(); resultRevealCancelRef.current = null; }
    setResultHidden(false);
    setMe(EMPTY_ME);
    setTimeUp(false);
    statusRef.current = 'solving';
    solverResetNonceRef.current += 1;
    setDrillNonce((n) => n + 1);
    post({ result: 'solving', moves: [], wrongMoves: [], attempted: 0, retry: true })
      .then(() => { statusRef.current = 'solving'; setMe(EMPTY_ME); });
  }, [post]);

  useEffect(() => () => {
    if (resultRevealCancelRef.current) {
      resultRevealCancelRef.current();
      resultRevealCancelRef.current = null;
    }
  }, []);

  const showSharedBoard = !drill || !isInstructor;
  /* While a mating solve is still animating, the card must read as still
     solving - whatever the ledger already says. */
  const shownMe = resultHidden ? { ...me, result: 'solving', pointsEarned: 0 } : me;
  /* The student's own drill progress, so it can ride along on the shared board.
     Null for the instructor and whenever no drill is running, so the slot
     collapses to nothing and the board keeps the whole stage. */
  const studentDrillStatus = !isInstructor && drill
    ? <StudentDrillStatus
        drill={drill}
        progress={shownMe}
        timeUp={timeUp}
        viewPly={drillViewPly}
        onJumpPly={setDrillViewPly}
        onRetry={onRetry}
      />
    : null;
  /* The drill as the board needs it: the position to load, the flat UCI line to
     validate against, when it is still playable, and the three outcomes. This is
     what makes "solve on the shared board" work — the board holds a private copy
     of the position and reports each attempt without broadcasting anything. */
  const drillSolver = !isInstructor && drill
    ? {
        /* Bumped by Retry so the board treats it as a different drill and starts
           the line — and its review position — from scratch. */
        nonce: drillNonce,
        fen: drill.puzzle?.fen,
        solution: drill.puzzle?.solution || [],
        interactive: shownMe.result === 'solving' && !timeUp,
        points: drill?.points ?? 10,
        onCorrectMove,
        onSolved,
        onFailed,
      }
    : null;

  return (
    <div className="live-drill-area">
      {showSharedBoard ? (
        <>
          {/* one main board: a paired STUDENT gets their PvP game here,
              the instructor/admin always keeps the Shared Board — paired
              games are only watched in the Spectate section below */}
          {isInstructor ? (
            <PvPPlayBoard classId={classId} fallback={<SharedChessBoard />} instructorView />
          ) : (
            <PvPPlayBoard
              classId={classId}
              fallback={(
                <SharedChessBoard
                  drill={drillSolver}
                  drillStatus={studentDrillStatus}
                  onDrillViewPly={setDrillViewPly}
                />
              )}
            />
          )}
        </>
      ) : (
        <InstructorDrillView
          drill={drill}
          onEnd={() => {
            api.post(`/classes/${classId}/puzzle-drill/end`).catch(() => {});
          }}
        />
      )}
      {quizAsk && isInstructor && (
        <Suspense fallback={(
          <div className="live-drill-modal-backdrop" aria-busy="true" aria-label="Loading quiz setup" onClick={closeQuizAsk}>
            <div className="live-drill-modal" onClick={(e) => e.stopPropagation()}>
              <div className="live-drill-modal-head">
                <span className="live-drill-modal-title">🎯 Ask quiz</span>
                <button type="button" className="live-drill-modal-x" onClick={closeQuizAsk}>✕</button>
              </div>
              <div className="live-course-skeleton" aria-hidden="true">
                <span className="live-course-skeleton-row" />
                <span className="live-course-skeleton-row" />
              </div>
            </div>
          </div>
        )}
        >
          <QuizPuzzleModal
            puzzle={quizAsk}
            classId={classId}
            onClose={closeQuizAsk}
            onStarted={(d) => {
              applyServer(d);
              setDrill(d);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}