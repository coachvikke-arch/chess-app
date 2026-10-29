import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUrlTab } from '../hooks/useUrlTab';
import { useAuth } from '../context/AuthContext';
import { Page, Card } from '../components/ui';
import Button from '../components/Button';
import InteractiveChessboard from '../features/boardVision/BoardVisionBoard';
import {
  AnalyticsPanels,
  LevelSelector,
  SessionResults,
  StudentProgress,
  TrainingModeCard,
  TrainingSettings,
  TrainingStats,
  TrainingTimer,
} from '../features/boardVision/BoardVisionComponents';
import { useBoardVisionSession } from '../features/boardVision/useBoardVisionSession.js';
import {
  ADAPTIVE_DEFAULTS,
  DEFAULT_SETTINGS,
  LEVELS,
  MODES,
  accuracyOf,
  adaptiveDecision,
  avgOf,
  levelById,
  levelUnlockStatus,
  modeById,
  recordSessionForProgress,
  targetReached,
  xpForSession,
} from '../features/boardVision/boardVisionLogic';
import {
  avgResponse,
  fetchRemoteProgress,
  loadProgress,
  overallAccuracy,
  saveProgress,
  saveRemoteProgress,
} from '../features/boardVision/boardVisionStore';

/**
 * Board Vision — student training page (additive; reuses Page/Card theme).
 * Views: dashboard (progress + levels + modes + settings) → training → results.
 */
export default function BoardVision() {
  const { user } = useAuth();
  const userId = user?.id || user?.username || 'guest';
  const [progress, setProgress] = useState(() => loadProgress(userId));
  const [levelId, setLevelId] = useState('pawn');
  const [modeId, setModeId] = useState('find-square');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [customModes, setCustomModes] = useState(['find-square', 'square-color', 'spatial']);
  const [view, setView] = useUrlTab('view', 'dashboard'); // dashboard | training | results
  const [lastResult, setLastResult] = useState(null);
  const [resultMeta, setResultMeta] = useState(null);

  /* Server copy is the source of truth for a signed-in account; localStorage
     stays the instant/offline copy. The hydration effect runs once per user:
     it loads local progress immediately (so training never waits on the
     network), then replaces it with the server document when one exists, or
     uploads the local document ONE TIME when the server has nothing yet
     (migrating progress recorded before server persistence existed). */
  const remoteReady = useRef(false);
  const remoteTimer = useRef(null);

  useEffect(() => {
    let alive = true;
    remoteReady.current = false;
    const local = loadProgress(userId);
    setProgress(local);

    if (!user?.id) {
      remoteReady.current = true;
      return () => { alive = false; };
    }

    fetchRemoteProgress().then((remote) => {
      if (!alive) return;
      if (remote) {
        setProgress(remote);
        saveProgress(userId, remote);
      } else if (Number(local.totalSessions || 0) > 0) {
        saveRemoteProgress(local);
      }
      remoteReady.current = true;
    });

    return () => {
      alive = false;
      clearTimeout(remoteTimer.current);
    };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Every change lands in localStorage synchronously; the server write is
     debounced so a fast sequence of answers in a session does not spam the API.
     `remoteReady` gates it so the pre-hydration default cannot overwrite the
     server copy. */
  useEffect(() => {
    saveProgress(userId, progress);
    if (!remoteReady.current || !user?.id) return undefined;
    clearTimeout(remoteTimer.current);
    remoteTimer.current = setTimeout(() => { saveRemoteProgress(progress); }, 700);
    return () => clearTimeout(remoteTimer.current);
  }, [userId, progress, user?.id]);

  const freePractice = !!progress.freePractice;
  const level = levelById(levelId);

  // Custom mode draws from teacher/student-picked modes.
  const sessionSettings = useMemo(
    () => ({ ...settings, customModes: modeId === 'custom' ? customModes : undefined }),
    [settings, customModes, modeId],
  );

  const handleEnd = useCallback((result) => {
    const reached = targetReached(sessionSettings.target, result.correct, result.accuracy);
    const prevBest = progress.personalBests?.[modeId];
    const isPB = !prevBest || result.correct > prevBest.correct
      || (result.correct === prevBest.correct && result.accuracy > prevBest.accuracy);
    const xp = xpForSession(result);
    const today = new Date().toISOString().slice(0, 10);
    const lastDate = progress.lastTrainedDate;
    const dailyStreak = lastDate === today
      ? (progress.dailyStreak || 0)
      : (lastDate === yesterdayStr() ? (progress.dailyStreak || 0) + 1 : 1);
    const sessionId = `bv-${Date.now()}`;
    const modeStat = progress.modeStats?.[modeId] || { correct: 0, incorrect: 0, times: [] };
    setProgress((p) => ({
      ...p,
      totalSessions: (p.totalSessions || 0) + 1,
      totalCorrect: (p.totalCorrect || 0) + result.correct,
      totalIncorrect: (p.totalIncorrect || 0) + result.incorrect,
      responseTimes: [...(p.responseTimes || []), ...result.history.map((h) => h.ms)],
      bestStreak: Math.max(p.bestStreak || 0, result.bestStreak),
      lastTrainedDate: today,
      dailyStreak,
      personalBests: { ...(p.personalBests || {}), ...(isPB ? { [modeId]: { correct: result.correct, accuracy: result.accuracy } } : {}) },
      levels: recordSessionForProgress(p.levels, levelId, { accuracy: result.accuracy, reached }),
      sessions: [...(p.sessions || []), {
        id: sessionId, mode: modeId, level: levelId,
        startTime: new Date(Date.now() - settings.duration * 1000).toISOString(),
        endTime: new Date().toISOString(),
        correct: result.correct, incorrect: result.incorrect, accuracy: result.accuracy,
        avgMs: result.avgMs, medianMs: result.medianMs, bestStreak: result.bestStreak,
        targetMet: reached, xp, completed: true,
      }],
      mistakeCategories: mergeCounts(p.mistakeCategories, result.history.filter((h) => h.category).map((h) => h.category)),
      missedSquares: mergeCounts(p.missedSquares, result.history.filter((h) => !h.correct && /^[a-h][1-8]$/.test(h.expected)).map((h) => h.expected)),
      modeStats: { ...(p.modeStats || {}), [modeId]: { correct: modeStat.correct + result.correct, incorrect: modeStat.incorrect + result.incorrect, times: [...(modeStat.times || []), ...result.history.map((h) => h.ms)] } },
    }));
    // Unlock messaging
    const updatedLevels = recordSessionForProgress(progress.levels, levelId, { accuracy: result.accuracy, reached });
    const next = LEVELS[Math.min(level.index + 1, LEVELS.length - 1)];
    let nextUnlock = null;
    if (next.id !== level.id) {
      const q = updatedLevels[next.id]?.qualifyingSessions || 0;
      nextUnlock = q >= 2
        ? `✓ ${next.name} unlocked!`
        : `${next.name}: ${q}/2 qualifying sessions (70%+ with target reached).`;
    }
    setResultMeta({
      reached, isPB, xp, nextUnlock,
      recommendation: recommendNext(modeId, levelId, result),
    });
    setLastResult({ ...result, sessionId });
    setView('results');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelId, modeId, progress, sessionSettings, settings.duration]);

  if (view === 'training') {
    return (
      <Page title="Board Vision" piece="👁" sub="Train your eyes. Recognize every square. Visualize the board faster.">
        <TrainingView
          modeId={modeId}
          levelId={levelId}
          settings={sessionSettings}
          onEnd={handleEnd}
          onExit={() => setView('dashboard')}
        />
      </Page>
    );
  }

  if (view === 'results' && lastResult) {
    return (
      <Page title="Board Vision" piece="👁" sub="Train your eyes. Recognize every square. Visualize the board faster.">
        <SessionResults
          result={lastResult}
          settings={settings}
          levelId={levelId}
          modeId={modeId}
          isPersonalBest={resultMeta?.isPB}
          xp={resultMeta?.xp || 0}
          nextUnlock={resultMeta?.nextUnlock}
          recommendation={resultMeta?.recommendation}
          onPlayAgain={() => setView('training')}
          onDifferentMode={() => setView('dashboard')}
          onNextLevel={(nextId) => { setLevelId(nextId); setView('dashboard'); }}
          onDashboard={() => setView('dashboard')}
        />
      </Page>
    );
  }

  const lockInfo = levelUnlockStatus(progress.levels, level.index, freePractice);
  const modeAllowed = level.modes.includes(modeId) || modeId === 'custom';
  const startNote = lockInfo.locked
    ? lockInfo.reason
    : !modeAllowed
      ? `“${modeById(modeId).name}” unlocks at higher levels — pick a ${level.name} mode or change level.`
      : null;

  return (
    <Page title="Board Vision" piece="👁" sub="Train your eyes. Recognize every square. Visualize the board faster.">
      <div className="bv-page">
        <div className="bv-local-note" role="note">
          <span aria-hidden="true">☁️</span>
          <span>Progress is saved to <strong>your account</strong> and kept on this device as an offline backup, so it follows you across devices.</span>
        </div>
        <StudentProgress progress={progress} avgMs={avgResponse(progress)} currentLevelId={levelId} />
        <Card title="Choose your level" piece="♙">
          <LevelSelector
            levelsProgress={progress.levels}
            selectedLevel={levelId}
            freePractice={freePractice}
            onSelect={(id) => {
              setLevelId(id);
              const lv = levelById(id);
              if (!lv.modes.includes(modeId) && modeId !== 'custom') setModeId(lv.modes[0]);
            }}
          />
        </Card>
        <Card title={`${level.icon} ${level.name} training modes`} piece="🎯" sub={level.focus}>
          <div className="bv-modes">
            {MODES.map((m) => (
              <TrainingModeCard
                key={m.id}
                mode={m}
                selected={modeId === m.id}
                bestAccuracy={progress.personalBests?.[m.id]?.accuracy}
                onSelect={(id) => {
                  setModeId(id);
                  if (id === 'custom') return;
                  // Jump level hint: keep selection but warn via startNote.
                }}
              />
            ))}
          </div>
          {modeId === 'custom' && (
            <div style={{ marginTop: '0.8rem' }}>
              <p className="bv-setting-label">Custom mix (teacher-style: combine modes)</p>
              <div className="bv-seg">
                {MODES.filter((m) => m.id !== 'custom').map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="bv-seg-btn"
                    aria-pressed={customModes.includes(m.id)}
                    onClick={() => setCustomModes((c) => (c.includes(m.id) ? c.filter((x) => x !== m.id) : [...c, m.id]))}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
        <TrainingSettings
          value={settings}
          onChange={setSettings}
          modeId={modeId}
          onStart={() => setView('training')}
          startDisabled={!!lockInfo.locked || !modeAllowed || (modeId === 'custom' && customModes.length === 0)}
          startNote={startNote || (modeId === 'custom' && customModes.length === 0 ? 'Pick at least one mode for the custom mix.' : `Overall accuracy ${overallAccuracy(progress)}% · ${progress.totalSessions || 0} sessions`)}
        />
        <AnalyticsPanels progress={progress} />
      </div>
    </Page>
  );
}

/* ── Training view ─────────────────────────────────────────────────── */
function TrainingView({ modeId, levelId, settings, onEnd, onExit }) {
  const session = useBoardVisionSession({ mode: modeId, level: levelId, settings, onEnd });
  const started = useRef(false);
  useEffect(() => {
    if (!started.current) { started.current = true; session.start(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [selected, setSelected] = useState(null);
  const [typed, setTyped] = useState('');
  const [mark, setMark] = useState(null); // { square, ok }
  const q = session.question;
  const totalMs = (settings.duration || 20) * 1000;

  useEffect(() => {
    setSelected(null);
    setTyped('');
    setMark(null);
  }, [session.qIndex]);

  // Show correct/error marker from feedback.
  useEffect(() => {
    if (!session.feedback || !q) { return; }
    if (session.feedback.ok && /^[a-h][1-8]$/.test(String(q.answer))) {
      setMark({ square: String(q.answer).toLowerCase(), ok: true });
    } else if (!session.feedback.ok && /^[a-h][1-8]$/.test(String(q.answer)) && (q.kind === 'tap-square')) {
      setMark({ square: String(q.answer).toLowerCase(), ok: false });
    }
  }, [session.feedback, q]);

  // Adaptive hint engine (rule-based): uses rolling session stats.
  const adapt = useMemo(() => {
    const attempts = session.correct + session.incorrect;
    return adaptiveDecision({
      accuracy: session.accuracy,
      avgMs: session.avgMs,
      mistakeStreak: currentMistakeStreak(session.history),
      attempts,
      consistency: consistencyOf(session.history),
    }, ADAPTIVE_DEFAULTS);
  }, [session.correct, session.incorrect, session.accuracy, session.avgMs, session.history]);

  const tapSquare = (sq) => {
    if (session.phase !== 'running') return;
    if (q?.kind === 'tap-square' || q?.kind === 'tap-square-any') {
      setSelected(sq);
      session.answer(sq);
    }
  };

  const pieces = useMemo(() => {
    if (!q?.board) return {};
    // Flash-memory hides the memorized position after the interval.
    if (q.mode === 'flash-memory' && !session.flashVisible) return {};
    if (settings.showPieces === false && q.mode !== 'find-piece' && q.mode !== 'piece-plus-square' && q.mode !== 'attack-defense') return {};
    return q.board;
  }, [q, session.flashVisible, settings.showPieces]);

  const blindStage = q?.mode === 'blindfold' ? (q.meta?.blindStage || 1) : 0;
  const highlight = q?.mode === 'coordinate-recognition' || q?.mode === 'square-color' ? (q.meta?.highlight || null) : null;
  const showCoords = q?.mode === 'blindfold' ? blindStage < 1 : settings.showCoordinates;

  return (
    <div className="bv-page">
      <Card title={`${levelById(levelId).icon} ${levelById(levelId).name} · ${modeById(modeId).name}`} piece="⚔">
        <div className="bv-train-head">
          <TrainingTimer timeLeftMs={session.timeLeftMs} totalMs={totalMs} paused={session.phase === 'paused'} />
          <div className="bv-actions" style={{ justifyContent: 'flex-end' }}>
            {session.phase === 'running' && <Button type="button" variant="secondary" size="md" onClick={session.pause} aria-label="Pause">⏸ Pause</Button>}
            {session.phase === 'paused' && <Button type="button" variant="primary" size="md" onClick={session.resume} aria-label="Resume">▶ Resume</Button>}
            <Button type="button" variant="danger" size="md" onClick={() => { session.exit(); onExit(); }} aria-label="Exit training">✕ Exit</Button>
          </div>
        </div>
      </Card>

      {session.phase === 'paused' && (
        <Card title="Paused" piece="⏸" sub="Your remaining time is preserved.">
          <div className="bv-actions" style={{ justifyContent: 'flex-start' }}>
            <Button type="button" variant="primary" size="md" onClick={session.resume}>Resume</Button>
            <Button type="button" variant="secondary" size="md" onClick={() => { session.exit(); onExit(); }}>Exit to dashboard</Button>
          </div>
        </Card>
      )}

      {q && session.phase !== 'paused' && (
        <>
          <p className="bv-prompt" role="status">{instructionText(q, settings.orientation)}</p>
          {(adapt.action === 'targeted-practice' || adapt.action === 'simplify') && (
            <p className="bv-head-sub" style={{ textAlign: 'center' }} role="note">
              {adapt.action === 'targeted-practice'
                ? '⚠ Repeated mistakes — finish this round, then replay this mode for targeted practice.'
                : '💡 Simplifying + hints on. Take your time.'}
            </p>
          )}
          {q.mode === 'flash-memory' && session.flashVisible && (
            <p className="bv-head-sub" style={{ textAlign: 'center' }} role="status">⚡ Memorize the position…</p>
          )}
          {q.mode === 'flash-memory' && !session.flashVisible && (
            <p className="bv-head-sub" style={{ textAlign: 'center' }} role="status">Now answer from memory.</p>
          )}
          <InteractiveChessboard
            orientation={session.orientation}
            pieces={pieces}
            highlight={highlight}
            selected={selected}
            lastResult={mark}
            revealSquare={!session.feedback?.ok && session.feedback?.reveal ? null : (session.feedback && !session.feedback.ok && q.kind === 'tap-square' ? String(q.answer).toLowerCase() : null)}
            showCoordinates={showCoords}
            blindStage={blindStage}
            highContrast={settings.highContrast}
            highlightSelected={settings.highlightSelected}
            disabled={session.phase !== 'running'}
            ariaBoardLabel={`Board Vision board, ${session.orientation} orientation`}
            onSquareTap={tapSquare}
          />
          {/* Answer controls per question kind */}
          {(q.kind === 'choose-name' || q.kind === 'choose-color') && q.choices && (
            <div className="bv-choices" role="group" aria-label="Answer choices">
              {q.choices.map((c) => (
                <button key={c} type="button" className="bv-choice-btn" disabled={session.phase !== 'running'} onClick={() => session.answer(c)}>
                  {q.kind === 'choose-color' ? (c === 'light' ? '○ Light' : '● Dark') : c}
                </button>
              ))}
            </div>
          )}
          {q.kind === 'choose-name' && q.meta?.keyboard && (
            <form
              className="bv-keyboard-input"
              onSubmit={(e) => { e.preventDefault(); if (typed.trim()) session.answer(typed.trim()); }}
            >
              <label htmlFor="bv-type">Or type the square:</label>
              <input
                id="bv-type"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="e4"
                maxLength={2}
                autoComplete="off"
                disabled={session.phase !== 'running'}
              />
              <Button type="submit" variant="primary" size="md" disabled={session.phase !== 'running'}>Answer</Button>
            </form>
          )}
          <div className="bv-actions">
            {!session.hint && (adapt.action === 'hint' || adapt.action === 'simplify') && (
              <Button type="button" variant="secondary" size="md" onClick={session.useHint}>💡 Show hint</Button>
            )}
          </div>
          {session.hint && <p className="bv-head-sub" style={{ textAlign: 'center' }} role="note">{session.hint}</p>}
          <div className="bv-feedback" aria-live="polite">
            {session.feedback && (
              <span className={session.feedback.ok ? 'bv-feedback-good' : 'bv-feedback-bad'}>
                {session.feedback.ok ? `✓ ${session.feedback.message}` : `✕ ${session.feedback.message} ${session.feedback.reveal || ''}`}
              </span>
            )}
          </div>
          <TrainingStats
            timeLeftMs={session.timeLeftMs}
            correct={session.correct}
            incorrect={session.incorrect}
            accuracy={session.accuracy}
            streak={session.streak}
            bestStreak={session.bestStreak}
            avgMs={session.avgMs}
          />
          <p className="bv-head-sub" style={{ textAlign: 'center' }}>
            Perspective: squares are always named by <strong>file a–h and rank 1–8</strong>, so answers stay correct when the board is flipped.
            {adapt.note ? ` · Rule-based difficulty: ${adapt.note}` : ''}
          </p>
        </>
      )}
    </div>
  );
}

function instructionText(q, orientationSetting) {
  const ori = orientationSetting === 'random' ? 'random orientation' : `${orientationSetting} orientation`;
  return `${q.prompt}  (${ori})`;
}

function currentMistakeStreak(history) {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].correct) break;
    n++;
  }
  return n;
}

function consistencyOf(history) {
  if (history.length < 4) return 1;
  const halves = [history.slice(0, Math.floor(history.length / 2)), history.slice(Math.floor(history.length / 2))];
  const acc = (h) => (h.length ? h.filter((x) => x.correct).length / h.length : 0);
  return 1 - Math.abs(acc(halves[0]) - acc(halves[1]));
}

function recommendNext(modeId, levelId, result) {
  if (result.accuracy < 55) return `${modeById(modeId).name} again at ${levelById(levelId).name} (rebuild accuracy)`;
  if (result.accuracy < 85) return `${modeById(modeId).name} — push accuracy past 85%`;
  const lv = levelById(levelId);
  const next = LEVELS[Math.min(lv.index + 1, LEVELS.length - 1)];
  if (next.id !== lv.id) return `${modeById(modeId).name} at ${next.name}`;
  return 'Custom Challenge — mix every mode';
}

function mergeCounts(base, keys) {
  const out = { ...(base || {}) };
  for (const k of keys) out[k] = (out[k] || 0) + 1;
  return out;
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Re-exported for tests that import page helpers indirectly.
export { accuracyOf, avgOf };
