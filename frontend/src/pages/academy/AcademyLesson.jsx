import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Chess } from 'chess.js';
import api from '../../services/api';
import ChessBoard from '../../components/ChessBoard';
import LessonCompleteCelebration from '../../components/LessonCompleteCelebration';
import { pieceGlyph } from '../../components/CelebrationFX';
import { Page, Card, Bar, Spinner } from '../../components/ui';
import { playSound } from '../../utils/sound';
import academyBase from '../../utils/academyBase';
import { useFittedBoardWidth } from '../../hooks/useBoardWidth';
import Button from '../../components/Button';

const TRAINING_BATCH_SIZE = 10;
const TRAINING_PASS_PCT = 70;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ── Square-name highlighting ─────────────────────────────────────────────────
   A board exercise's whole instruction is usually one sentence with one or two
   square references buried in it — "Move the Queen straight up the d-file to
   d7, where she pins Black's Queen." Rendered as plain text those read like
   ordinary words at the same size as everything around them, which is exactly
   what the student has to look up on the board. Pulling them out in a distinct
   colour and a larger size makes the target square the first thing the eye
   lands on, without rewriting a single word of the copy.

   The patterns are deliberately narrow. Only a file letter in an explicit
   "<file>-file" phrase, and a real square (<file><rank>, optionally with the
   SAN piece letter and a trailing +/#/#) are matched — a bare standalone letter
   like the "a" in "a knight" is left alone. */
const SQUARE_TOKEN = /\b(?:[KQRBN]?[a-h][1-8](?:[+#]{1,2})?|[a-h]-file\b)/g;

/** Split instruction text into plain runs and highlighted square-name runs. */
function splitSquares(text) {
  const source = String(text ?? '');
  const parts = [];
  let last = 0;
  SQUARE_TOKEN.lastIndex = 0;
  let m = SQUARE_TOKEN.exec(source);
  while (m) {
    if (m.index > last) parts.push({ square: false, text: source.slice(last, m.index) });
    parts.push({ square: true, text: m[0] });
    last = m.index + m[0].length;
    m = SQUARE_TOKEN.exec(source);
  }
  if (last < source.length) parts.push({ square: false, text: source.slice(last) });
  return parts;
}

/** Instruction/hint copy with every square name set larger and in the accent
 *  colour. Renders a plain run as a bare span so the surrounding paragraph's own
 *  type (size, weight, colour, leading) is inherited untouched. */
function HighlightedText({ text }) {
  const parts = splitSquares(text);
  return (
    <>
      {parts.map((part, i) => (
        part.square
          ? <b key={i} className="academy-square-name">{part.text}</b>
          : <span key={i}>{part.text}</span>
      ))}
    </>
  );
}

/* ── Single move exercise (board first, Exercise Moves card after it) ── */
function MoveExercise({ exercise, onAnswered, initialHinted = 0 }) {
  const [hintLevel, setHintLevel] = useState(initialHinted);
  const [result, setResult] = useState(null); // null | 'correct' | 'wrong'
  const [attempts, setAttempts] = useState(0);
  const [fx, setFx] = useState(null);
  const fxTimer = useRef(null);
  const game = useMemo(() => new Chess(exercise.fen), [exercise.fen]);
  const [boardKey, setBoardKey] = useState(0);
  const hints = exercise.hints || [];
  const startRef = useRef(Date.now());
  const boardWidth = useFittedBoardWidth(440);

  const reset = () => {
    setResult(null);
    setAttempts(0);
    setBoardKey((k) => k + 1);
  };

  const handleMove = (move) => {
    const san = move?.san;
    const correct = san === exercise.expectedSan;
    const timeMs = Date.now() - startRef.current;
    if (correct) {
      playSound('check');
      setResult('correct');
      setFx({
        key: Date.now(),
        kind: 'correct',
        square: move.to,
        piece: pieceGlyph(move.piece, move.color),
        msg: 'Brilliant!',
        xp: Math.max(10 - hintLevel * 2, 2),
      });
      clearTimeout(fxTimer.current);
      fxTimer.current = setTimeout(() => setFx(null), 1600);
      onAnswered({ correct: true, hintsUsed: hintLevel, timeMs, attempts: attempts + 1 });
    } else {
      playSound('illegal');
      game.undo();
      setAttempts((a) => a + 1);
      setResult('wrong');
    }
  };

  useEffect(() => () => clearTimeout(fxTimer.current), []);

  /* Board first in the DOM, then the Exercise Moves card: mobile stacks them
     (board on top), larger screens put the card beside the board. */
  return (
    <div className="grid gap-6 items-start lg:grid-cols-[minmax(0,auto)_minmax(0,1fr)]">
      {/* First: board (always first in DOM/order) */}
      <div className="flex justify-center min-w-0 w-full">
        <div key={boardKey} className="chess-reveal w-full max-w-full flex flex-col items-center">
          <ChessBoard
            game={game}
            boardWidth={boardWidth}
            interactive={result === null}
            showLegalMoves={false}
            clickToMove
            draggableColor={game.turn()}
            onMove={handleMove}
            customArrows={[]}
            fx={fx}
          />
          <p className="text-xs text-ivory-500 text-center mt-3">
            {game.turn() === 'w' ? 'White to move' : 'Black to move'}
          </p>
        </div>
      </div>

      {/* Second: Exercise Moves card (moves + description/instructions) */}
      <div className="min-w-0">
        <div className="rounded-2xl border border-ivory-700/50 bg-black/[0.04] p-5">
          <p className="text-[0.65rem] uppercase tracking-[0.18em] text-gold-400 font-bold mb-2">
            Exercise Moves
          </p>
          <p className="text-lg font-semibold text-ivory-100 leading-relaxed">
            <HighlightedText text={exercise.instruction} />
          </p>

          {/* The moves of this exercise, to be played on the board above */}
          <ol className="mt-4 space-y-2">
            <li
              className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-sm font-mono ${
                result === 'correct'
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600'
                  : 'border-ivory-700/50 bg-black/[0.03] text-ivory-300'
              }`}
            >
              <span className="font-bold text-ivory-500">1.</span>
              <span>{exercise.expectedSan}</span>
              {result === 'correct' && <span className="ml-auto">✓</span>}
            </li>
          </ol>

          {/* Hint escalation */}
          <div className="mt-4">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setHintLevel((h) => Math.min(h + 1, 3))}
              disabled={hintLevel >= 3 || result !== null}
            >
              💡 Hint {hintLevel + 1}/3{hintLevel > 0 ? ` · −${hintLevel * 2} XP` : ''}
            </Button>
            {hintLevel > 0 && hints[hintLevel - 1] && (
              <p className="mt-3 text-sm text-ivory-500 bg-black/[0.03] border border-ivory-700/50 rounded-xl p-3 chess-reveal">
                <HighlightedText text={hints[hintLevel - 1]} />
              </p>
            )}
          </div>

          {result === 'correct' && (
            <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm font-semibold text-emerald-600">
              ✓ Correct! +{Math.max(10 - hintLevel * 2, 2)} XP earned
            </div>
          )}
          {result === 'wrong' && (
            <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3">
              <p className="text-sm font-semibold text-red-600">✗ Not quite — wrong move. The position was reset.</p>
              <Button onClick={reset} variant="primary" size="sm" className="mt-3 !text-xs !py-1.5 !px-4">
                Retry move
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Quiz exercise ── */
function QuizExercise({ exercise, onAnswered }) {
  const [selected, setSelected] = useState(null);
  const [done, setDone] = useState(false);
  const startRef = useRef(Date.now());

  const pick = (i) => {
    if (done) return;
    setSelected(i);
    setDone(true);
    const correct = i === exercise.correct;
    if (correct) playSound('check');
    else playSound('illegal');
    onAnswered({ correct, hintsUsed: 0, timeMs: Date.now() - startRef.current, attempts: 1 });
  };

  return (
    <div>
      <div className="rounded-2xl border border-ivory-700/50 bg-black/[0.04] p-5">
        <p className="text-[0.65rem] uppercase tracking-[0.18em] text-gold-400 font-bold mb-2">Quiz</p>
        <p className="text-lg font-semibold text-ivory-100 leading-relaxed mb-4">{exercise.question}</p>
        <div className="flex flex-col gap-2">
          {exercise.options.map((opt, i) => {
            const isCorrect = done && i === exercise.correct;
            const isWrong = done && selected === i && i !== exercise.correct;
            return (
              <button
                key={i}
                onClick={() => pick(i)}
                disabled={done}
                className={`text-left px-4 py-3 rounded-xl border text-sm transition-all ${
                  isCorrect
                    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-700'
                    : isWrong
                      ? 'border-red-500/50 bg-red-500/15 text-red-600'
                      : done
                        ? 'border-ivory-700/40 bg-black/[0.02] text-ivory-500'
                        : 'border-ivory-700/50 bg-black/[0.03] text-ivory-500 hover:bg-black/[0.08] hover:border-gold-500/30'
                }`}
              >
                <span className="font-bold mr-2 text-ivory-500">{String.fromCharCode(65 + i)}.</span>
                {opt}
                {isCorrect && <span className="float-right">✓</span>}
                {isWrong && <span className="float-right">✗</span>}
              </button>
            );
          })}
        </div>
        {done && exercise.explanation && (
          <p className="mt-4 text-sm text-ivory-500 bg-black/[0.03] border border-ivory-700/50 rounded-xl p-3 chess-reveal">
            {exercise.explanation}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Info exercise (reading task) ── */
function InfoExercise({ exercise, onAnswered }) {
  const startRef = useRef(Date.now());
  return (
    <div className="rounded-2xl border border-ivory-700/50 bg-black/[0.04] p-5 max-w-2xl">
      <p className="text-lg font-semibold text-ivory-100 leading-relaxed">{exercise.text}</p>
      <Button
        onClick={() => onAnswered({ correct: true, hintsUsed: 0, timeMs: Date.now() - startRef.current, attempts: 1 })}
        variant="primary" size="md" className="mt-5"
      >
        I understand ✓
      </Button>
    </div>
  );
}

/* ── End-of-lesson celebration ── */
function LessonComplete({ lesson, xpEarned, lessonCompletedNow, newBadges, levelSlug, base }) {
  const navigate = useNavigate();
  return (
    <LessonCompleteCelebration
      xp={xpEarned}
      badges={newBadges || []}
      sub={lessonCompletedNow
        ? 'The lesson is fully mastered — great work!'
        : 'Nice work — every step counts!'}
      onContinue={() => navigate(base)}
      onBack={() => navigate(`${base}/level/${levelSlug}`)}
    />
  );
}

/* ── Retry screen for failed training session ── */
function TrainingFail({ onRetry, correct, total }) {
  return (
    <div className="max-w-xl mx-auto text-center py-10">
      <div className="text-6xl mb-4">💪</div>
      <h2 className="font-display text-2xl font-bold text-ivory-100">Almost there!</h2>
      <p className="text-ivory-500 mt-2">
        You scored <b className="text-gold-400">{correct}/{total}</b> ({Math.round((correct / total) * 100)}%). You need {TRAINING_PASS_PCT}% to pass.
      </p>
      <p className="text-sm text-ivory-500 mt-2">Take a breath, review the lessons, then try again.</p>
      <Button onClick={onRetry} variant="primary" size="md" className="mt-8">Try again</Button>
    </div>
  );
}

export default function AcademyLesson() {
  const { levelSlug, lessonSlug } = useParams();
  const location = useLocation();
  const base = academyBase(location.pathname);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  // session state (training only)
  const [sessionQueue, setSessionQueue] = useState(null);
  const [sessionIdx, setSessionIdx] = useState(0);
  const [sessionDone, setSessionDone] = useState(false);
  const [sessionStats, setSessionStats] = useState({ total: 0, correct: 0, start: Date.now() });
  const [sessionPost, setSessionPost] = useState(null);
  const [sessionFail, setSessionFail] = useState(false);

  // lesson flow
  const [activeExIdx, setActiveExIdx] = useState(0);
  const [xpEarned, setXpEarned] = useState(0);
  const [resultEvent, setResultEvent] = useState(null);
  const [showFinalSummary, setShowFinalSummary] = useState(false);
  const [notMastered, setNotMastered] = useState(false);
  const runAllCorrect = useRef(true);

  const exercises = data?.lesson?.exercises || [];
  const activeEx = exercises[activeExIdx];
  const isTraining = data?.lesson?.kind === 'training';

  const load = (slug, lslug) => {
    setData(null);
    setError(null);
    setSessionQueue(null);
    setSessionDone(false);
    setSessionFail(false);
    setSessionPost(null);
    setActiveExIdx(0);
    setXpEarned(0);
    setResultEvent(null);
    setShowFinalSummary(false);
    setNotMastered(false);
    runAllCorrect.current = true;
    api
      .get(`/academy/lessons/${slug}/${lslug}`, { cache: false })
      .then((res) => {
        setData(res.data);
        /* for training lessons, seed the batch immediately */
        if (res.data.lesson.kind === 'training' && res.data.lesson.exercises?.length) {
          setSessionQueue(shuffle(res.data.lesson.exercises).slice(0, TRAINING_BATCH_SIZE));
        }
      })
      .catch((err) => {
        const msg = err.response?.data?.message;
        if (err.response?.status === 403) setError({ locked: true, message: msg });
        else setError({ locked: false, message: msg || 'Failed to load lesson' });
      });
  };

  useEffect(() => load(levelSlug, lessonSlug), [levelSlug, lessonSlug]);

  /* Opening lessons open the dedicated opening page instead. */
  const navigate = useNavigate();
  useEffect(() => {
    if (data?.lesson?.kind === 'opening' && data?.lesson?.openingSlug) {
      navigate(`${base}/course/${data.lesson.openingSlug}`, { replace: true });
    }
  }, [data, navigate, base]);

  /* ── Training batch complete → post session ── */
  useEffect(() => {
    if (!isTraining || !sessionDone || sessionPost || sessionFail) return;
    const acc = sessionStats.total ? Math.round((sessionStats.correct / sessionStats.total) * 100) : 0;
    const passed = acc >= TRAINING_PASS_PCT;
    if (!passed) {
      setSessionFail(true);
      return;
    }
    let cancelled = false;
    api
      .post('/academy/sessions/complete', {
        levelSlug,
        lessonSlug,
        sessionKind: 'beginner-training',
        total: sessionStats.total,
        correct: sessionStats.correct,
        timeMs: Date.now() - sessionStats.start,
        exercises: [
          /* per-exercise results are recorded individually already */
        ],
      })
      .then((res) => {
        if (cancelled) return;
        setSessionPost(res.data);
        setXpEarned((x) => x + (res.data.xpEarned || 0));
      })
      .catch(() => {
        if (!cancelled) setSessionFail(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isTraining, sessionDone, sessionPost, sessionFail, sessionStats, levelSlug, lessonSlug]);

  /* Move on to the next lesson in the level. Returns true if one was found. */
  const goToNextLesson = async () => {
    try {
      const res = await api.get(`/academy/levels/${levelSlug}`, { cache: false });
      const lessons = res.data.lessons || [];
      const idx = lessons.findIndex((l) => l.slug === lessonSlug);
      const next = idx >= 0 ? lessons[idx + 1] : null;
      if (next) {
        navigate(`${base}/lessons/${levelSlug}/${next.slug}`, { replace: true });
        return true;
      }
    } catch {
      /* level list unavailable — fall through to the completion summary */
    }
    return false;
  };

  /* Answered an exercise → show the feedback briefly, then auto-advance.
     On the last exercise: move to the next lesson automatically (no summary /
     home screen in between). The summary only appears at the very end of a level. */
  useEffect(() => {
    if (!resultEvent || isTraining || notMastered || showFinalSummary) return;
    const delay = resultEvent.isLast ? 1500 : 1000;
    const t = setTimeout(() => {
      if (resultEvent.isLast) {
        if (!runAllCorrect.current) {
          setNotMastered(true);
          return;
        }
        goToNextLesson().then((foundNext) => {
          if (!foundNext) setShowFinalSummary(true);
        });
      } else {
        nextExercise();
      }
    }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultEvent, isTraining, notMastered, showFinalSummary]);

  if (error) {
    return (
      <Page title="Academy" piece="♘">
        <Card title={error.locked ? '🔒 Level locked' : 'Something went wrong'}>
          <p className="text-ivory-500">{error.message}</p>
        </Card>
      </Page>
    );
  }
  if (!data) return <Page title="Academy" piece="♘"><Spinner text="Loading lesson…" /></Page>;

  const { lesson, progress } = data;

  const handleExerciseAnswered = (result) => {
    if (isTraining && sessionQueue) {
      const correct = result.correct;
      setSessionStats((s) => ({ ...s, total: s.total + 1, correct: s.correct + (correct ? 1 : 0) }));
      api
        .post('/academy/exercises/complete', {
          levelSlug,
          lessonSlug,
          exerciseSlug: sessionQueue[sessionIdx].slug,
          correct,
          hintsUsed: result.hintsUsed || 0,
          timeMs: result.timeMs || 0,
        })
        .then((res) => setXpEarned((x) => x + (res.data.xpEarned || 0)))
        .catch(() => {});
      if (sessionIdx + 1 >= sessionQueue.length) {
        setSessionDone(true);
      } else {
        setSessionIdx((i) => i + 1);
      }
      return;
    }

    /* normal lesson flow */
    const ex = exercises[activeExIdx];
    if (!result.correct) runAllCorrect.current = false;
    api
      .post('/academy/exercises/complete', {
        levelSlug,
        lessonSlug,
        exerciseSlug: ex.slug,
        correct: result.correct,
        hintsUsed: result.hintsUsed || 0,
        timeMs: result.timeMs || 0,
      })
      .then((res) => {
        setXpEarned((x) => x + (res.data.xpEarned || 0));
        setResultEvent({
          type: 'answer',
          correct: result.correct,
          newBadges: res.data.newBadges || [],
          lessonCompletedNow: !!res.data.lessonCompletedNow,
          levels: res.data.levels,
          isLast: activeExIdx + 1 >= exercises.length,
        });
      })
      .catch(() => {});
  };

  const nextExercise = () => {
    setResultEvent(null);
    setActiveExIdx((i) => i + 1);
  };

  const handleVerdictNext = () => {
    if (resultEvent?.isLast) {
      if (!runAllCorrect.current) {
        setNotMastered(true);
        return;
      }
      goToNextLesson().then((foundNext) => {
        if (!foundNext) setShowFinalSummary(true);
      });
    } else {
      nextExercise();
    }
  };

  const renderActive = () => {
    if (isTraining && sessionQueue) {
      const ex = sessionQueue[sessionIdx];
      if (sessionDone) {
        return (
          <div className="py-10 text-center">
            <Spinner text="Recording your results…" />
          </div>
        );
      }
      return <MoveExercise key={sessionIdx} exercise={ex} onAnswered={handleExerciseAnswered} />;
    }

    if (!activeEx) {
      return (
        <LessonComplete
          lesson={lesson}
          levelSlug={levelSlug}
          base={base}
          xpEarned={xpEarned}
          lessonCompletedNow={resultEvent?.lessonCompletedNow}
          newBadges={resultEvent?.newBadges}
        />
      );
    }

    if (activeEx.type === 'info') return <InfoExercise exercise={activeEx} onAnswered={handleExerciseAnswered} />;
    if (activeEx.type === 'quiz') return <QuizExercise exercise={activeEx} onAnswered={handleExerciseAnswered} />;
    return <MoveExercise key={activeEx.slug} exercise={activeEx} onAnswered={handleExerciseAnswered} />;
  };

  /* × progress */
  const totalEx = isTraining && sessionQueue ? sessionQueue.length : exercises.length;
  const doneEx = isTraining && sessionQueue ? sessionIdx + (sessionDone ? 1 : 0) : activeExIdx;

  return (
    <Page
      title={lesson.title}
      piece={lesson.icon}
      sub={lesson.kind === 'training' ? 'Timed drilling session' : `Lesson · ${data.level.name} level`}
    >
      {/* progress bar */}
      {totalEx > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-ivory-500">
              {isTraining ? `Challenge ${Math.min(doneEx + 1, totalEx)} of ${totalEx}` : `Exercise ${Math.min(activeExIdx + 1, totalEx)} of ${totalEx}`}
            </span>
            <div className="flex items-center gap-3">
              <span className="text-gold-400 font-semibold">⚡ {xpEarned} XP</span>
              {isTraining && (
                <span className="text-ivory-500">
                  Score <b className="text-ivory-500">{sessionStats.correct}/{sessionStats.total}</b>
                </span>
              )}
            </div>
          </div>
          <Bar pct={(doneEx / totalEx) * 100} />
        </div>
      )}

      {/* exercise / content area — first, so the board sits at the top */}
      <div className="rounded-3xl border border-ivory-700/50 bg-ink-900/40 p-6">
        {notMastered ? (
          <div className="max-w-2xl mx-auto text-center py-10">
            <div className="text-6xl mb-4">📚</div>
            <h2 className="font-display text-2xl font-bold text-ivory-100">Almost there!</h2>
            <p className="text-ivory-500 mt-2">
              Some answers were wrong, so this lesson isn’t mastered yet — review the questions and try again.
            </p>
            <div className="flex gap-3 justify-center mt-8">
              <Button
                variant="primary" size="md"
                onClick={() => {
                  setNotMastered(false);
                  setActiveExIdx(0);
                  setResultEvent(null);
                  runAllCorrect.current = true;
                }}
              >
                Retry lesson
              </Button>
              <Button to={`${base}/level/${levelSlug}`} variant="secondary" size="md">Back to level</Button>
            </div>
          </div>
        ) : showFinalSummary ? (
          <LessonComplete
            lesson={lesson}
            levelSlug={levelSlug}
            base={base}
            xpEarned={xpEarned}
            lessonCompletedNow={resultEvent?.lessonCompletedNow}
            newBadges={resultEvent?.newBadges}
          />
        ) : sessionFail ? (
          <TrainingFail
            onRetry={() => {
              setSessionQueue(shuffle(sessionQueue).slice(0, TRAINING_BATCH_SIZE));
              setSessionIdx(0);
              setSessionDone(false);
              setSessionFail(false);
              setSessionStats({ total: 0, correct: 0, start: Date.now() });
            }}
            correct={sessionStats.correct}
            total={sessionStats.total}
          />
        ) : isTraining && sessionPost ? (
          <TrainingComplete
            acc={Math.round((sessionStats.correct / sessionStats.total) * 100)}
            xp={xpEarned}
            correct={sessionStats.correct}
            total={sessionStats.total}
            levelSlug={levelSlug}
            base={base}
            onRetry={() => {
              setSessionPost(null);
              setSessionQueue(shuffle(sessionQueue).slice(0, TRAINING_BATCH_SIZE));
              setSessionIdx(0);
              setSessionDone(false);
              setSessionStats({ total: 0, correct: 0, start: Date.now() });
            }}
          />
        ) : resultEvent && !isTraining ? (
          /* answered the exercise → verdict panel before next exercise */
          <div className="max-w-3xl">
            {resultEvent.type === 'answer' && (
              <Card title={resultEvent.correct ? '✓ Correct!' : 'Answered'}>
                <p className="text-ivory-500">
                  {resultEvent.correct
                    ? 'Well done — move to the next exercise.'
                    : 'The answer was marked. You can continue improving your score by replaying this lesson.'}
                </p>
                {resultEvent.newBadges?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {resultEvent.newBadges.map((b) => (
                      <span key={b.code} className="inline-flex items-center gap-1.5 rounded-full border border-gold-500/30 bg-gold-500/10 px-3 py-1 text-xs text-gold-400">
                        {b.icon} {b.name} +{b.xpValue} XP
                      </span>
                    ))}
                  </div>
                )}
                <Button variant="primary" size="md" className="mt-5" onClick={handleVerdictNext}>
                  {resultEvent.isLast ? 'Continue →' : 'Next exercise →'}
                </Button>
              </Card>
            )}
          </div>
        ) : (
          renderActive()
        )}
      </div>

      {/* lesson text (sections) for regular lessons — under the board */}
      {!isTraining && (
        <div className="grid lg:grid-cols-[1fr_320px] gap-6 mt-6">
          <div>
            {(lesson.sections || []).map((s, i) => (
              <div key={i} className="mb-5">
                <h3 className="font-display text-lg font-bold text-ivory-300 mb-2">{s.heading}</h3>
                <div className="space-y-2">
                  {s.body.map((p, j) => (
                    <p key={j} className="text-sm text-ivory-500 leading-relaxed">{p}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <aside className="rounded-2xl border border-gold-500/15 bg-gold-500/[0.04] p-4 h-fit">
            <p className="text-[0.65rem] uppercase tracking-[0.18em] text-gold-400 font-bold mb-2">Coach tip</p>
            <p className="text-sm text-ivory-500 leading-relaxed">{(lesson.tips || [''])[0]}</p>
          </aside>
        </div>
      )}
    </Page>
  );
}

function TrainingComplete({ acc, correct, total, xp, levelSlug, base }) {
  const navigate = useNavigate();
  return (
    <LessonCompleteCelebration
      xp={xp}
      streak={0}
      sub={`${correct}/${total} correct · ${acc}% accuracy — training passed at 70%`}
      onContinue={() => navigate(base)}
      onBack={() => navigate(`${base}/level/${levelSlug}`)}
    />
  );
}