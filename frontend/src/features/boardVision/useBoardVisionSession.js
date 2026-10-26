import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  accuracyOf,
  avgOf,
  createAnswerLock,
  generateQuestion,
  medianOf,
  mistakeCategory,
  resolveOrientation,
  seededRng,
  targetReached,
  validateAnswer,
} from './boardVisionLogic';

/**
 * Training session state machine + timer.
 * - lock per question prevents double counting from rapid taps.
 * - timers cleaned up on pause / exit / unmount / restart.
 * - pause preserves remaining time; restart fully resets.
 * - no score updates after session end; async-race safe via runId ref.
 */
export function useBoardVisionSession({ mode, level, settings, seed = null, fixedQuestions = null, onEnd }) {
  const cfg = useMemo(() => ({ ...DEFAULT_SETTINGS, ...(settings || {}) }), [settings]);
  const [phase, setPhase] = useState('idle'); // idle | running | paused | ended
  const [question, setQuestion] = useState(null);
  const [qIndex, setQIndex] = useState(0);
  const [orientation, setOrientation] = useState('white');
  const [timeLeftMs, setTimeLeftMs] = useState((cfg.duration || 20) * 1000);
  const [correct, setCorrect] = useState(0);
  const [incorrect, setIncorrect] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [times, setTimes] = useState([]);
  const [history, setHistory] = useState([]); // { prompt, given, expected, correct, ms, category }
  const [feedback, setFeedback] = useState(null); // { ok, message, reveal }
  const [flashVisible, setFlashVisible] = useState(true);
  const [hint, setHint] = useState(null);

  const rngRef = useRef(null);
  const recentRef = useRef(new Set());
  // Per-question lock (rapid-tap protection). Single shared instance whose
  // semantics are unit-tested via createAnswerLock in boardVisionLogic.
  const lockRef = useRef(null);
  if (!lockRef.current) lockRef.current = createAnswerLock();
  const lockedRef = lockRef.current;
  const runIdRef = useRef(0);
  const qStartRef = useRef(0);
  const remainRef = useRef((cfg.duration || 20) * 1000);
  const endAtRef = useRef(0);
  const timerRef = useRef(null);
  const flashTimerRef = useRef(null);
  const qCounterRef = useRef(0);
  const fixedIdxRef = useRef(0);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  const clearTimers = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (flashTimerRef.current) { clearTimeout(flashTimerRef.current); flashTimerRef.current = null; }
  }, []);

  // Unmount cleanup.
  useEffect(() => () => clearTimers(), [clearTimers]);

  const nextQuestion = useCallback((runId) => {
    lockedRef.unlock();
    setFeedback(null);
    setHint(null);
    let q;
    if (fixedQuestions && fixedQuestions.length) {
      q = fixedQuestions[fixedIdxRef.current % fixedQuestions.length];
      fixedIdxRef.current += 1;
    } else {
      q = generateQuestion(mode, {
        rng: rngRef.current,
        level,
        orientation: orientationRef.current,
        recent: recentRef.current,
        customModes: cfg.customModes,
      });
    }
    qCounterRef.current += 1;
    qStartRef.current = Date.now();
    // Flash-memory: show the position, then hide after the interval.
    if (q.mode === 'flash-memory' && q.meta?.flashMap) {
      setFlashVisible(true);
      const ms = q.meta.flashMs || 2000;
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => {
        if (runIdRef.current === runId) setFlashVisible(false);
      }, ms);
    } else {
      setFlashVisible(true);
    }
    setQuestion(q);
    setQIndex((i) => i + 1);
  }, [mode, level, fixedQuestions, cfg.customModes]); // eslint-disable-line react-hooks/exhaustive-deps

  const orientationRef = useRef('white');
  orientationRef.current = orientation;

  const start = useCallback(() => {
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    rngRef.current = seed != null ? seededRng(seed) : Math.random;
    recentRef.current = new Set();
    fixedIdxRef.current = 0;
    qCounterRef.current = 0;
    lockedRef.unlock();
    const ori = resolveOrientation(cfg.orientation, rngRef.current === Math.random ? Math.random : rngRef.current);
    orientationRef.current = ori;
    setOrientation(ori);
    const total = (cfg.duration || 20) * 1000;
    remainRef.current = total;
    setTimeLeftMs(total);
    setCorrect(0);
    setIncorrect(0);
    setStreak(0);
    setBestStreak(0);
    setTimes([]);
    setHistory([]);
    setFeedback(null);
    setHint(null);
    setQIndex(0);
    setPhase('running');
    qStartRef.current = Date.now();
    endAtRef.current = Date.now() + total;
    clearTimers();
    timerRef.current = setInterval(() => {
      if (runIdRef.current !== runId) return;
      const left = endAtRef.current - Date.now();
      if (left <= 0) {
        remainRef.current = 0;
        setTimeLeftMs(0);
        finishRef.current(runId);
      } else {
        remainRef.current = left;
        setTimeLeftMs(left);
      }
    }, 100);
    // First question (orientation state set above; pass via ref for immediacy)
    const firstRng = rngRef.current;
    const recent = recentRef.current;
    let q;
    if (fixedQuestions && fixedQuestions.length) {
      q = fixedQuestions[0];
      fixedIdxRef.current = 1;
    } else {
      q = generateQuestion(mode, { rng: firstRng, level, orientation: ori, recent, customModes: cfg.customModes });
    }
    lockedRef.unlock();
    qCounterRef.current = 1;
    if (q.mode === 'flash-memory' && q.meta?.flashMap) {
      setFlashVisible(true);
      flashTimerRef.current = setTimeout(() => {
        if (runIdRef.current === runId) setFlashVisible(false);
      }, q.meta.flashMs || 2000);
    } else setFlashVisible(true);
    setQuestion(q);
    setQIndex(1);
  }, [cfg, level, mode, seed, fixedQuestions, clearTimers]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = useCallback((runId) => {
    if (runIdRef.current !== runId) return; // async-race guard
    clearTimers();
    lockedRef.lock(); // freeze scoring
    setPhase((p) => {
      if (p === 'ended') return p;
      return 'ended';
    });
  }, [clearTimers]);
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // Report results once when entering ended (no double-fire in StrictMode).
  const reportedRef = useRef(0);
  useEffect(() => {
    if (phase !== 'ended') return;
    if (reportedRef.current === runIdRef.current) return;
    reportedRef.current = runIdRef.current;
    onEndRef.current?.({
      correct, incorrect,
      accuracy: accuracyOf(correct, incorrect),
      avgMs: avgOf(times),
      medianMs: medianOf(times),
      bestStreak,
      history,
      questions: qCounterRef.current,
      targetMet: targetReached(cfg.target, correct, accuracyOf(correct, incorrect)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const pause = useCallback(() => {
    if (phase !== 'running') return;
    clearTimers();
    remainRef.current = Math.max(0, endAtRef.current - Date.now());
    setTimeLeftMs(remainRef.current);
    runIdRef.current += 1; // invalidate pending flash timeouts
    if (flashTimerRef.current) { clearTimeout(flashTimerRef.current); flashTimerRef.current = null; }
    setPhase('paused');
  }, [phase, clearTimers]);

  const resume = useCallback(() => {
    if (phase !== 'paused') return;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    endAtRef.current = Date.now() + remainRef.current;
    qStartRef.current = Date.now(); // fresh response-time window (pause excluded)
    clearTimers();
    timerRef.current = setInterval(() => {
      if (runIdRef.current !== runId) return;
      const left = endAtRef.current - Date.now();
      if (left <= 0) {
        remainRef.current = 0;
        setTimeLeftMs(0);
        finishRef.current(runId);
      } else {
        remainRef.current = left;
        setTimeLeftMs(left);
      }
    }, 100);
    setPhase('running');
  }, [phase, clearTimers]);

  const exit = useCallback(() => {
    runIdRef.current += 1;
    clearTimers();
    lockedRef.lock();
    setPhase('idle');
  }, [clearTimers]);

  const answer = useCallback((given) => {
    if (phase !== 'running') return; // no scoring unless running
    if (!question) return;
    if (!lockedRef.tryAcquire()) return; // rapid-tap protection
    const runId = runIdRef.current;
    const ms = Date.now() - qStartRef.current;
    const ok = validateAnswer(question, given);
    // Haptics (supported devices only)
    try {
      if (cfg.haptics && navigator.vibrate) navigator.vibrate(ok ? 20 : [40, 40, 40]);
    } catch { /* ignore */ }
    // Sound via WebAudio beep (no assets needed)
    try {
      if (cfg.sound) beep(ok);
    } catch { /* ignore */ }
    const category = mistakeCategory(question, given);
    setTimes((t) => [...t, ms]);
    setHistory((h) => [...h, {
      prompt: question.prompt,
      mode: question.mode,
      given: String(given),
      expected: String(question.answer),
      correct: ok,
      ms,
      category,
    }]);
    if (ok) {
      setCorrect((c) => c + 1);
      setStreak((s) => {
        const ns = s + 1;
        setBestStreak((b) => Math.max(b, ns));
        return ns;
      });
      setFeedback({ ok: true, message: feedbackText(question, true), reveal: null });
    } else {
      setIncorrect((c) => c + 1);
      setStreak(0);
      setFeedback({ ok: false, message: 'Not quite.', reveal: revealText(question) });
    }
    // Brief beat so feedback registers (and respects reduced motion), then next.
    setTimeout(() => {
      if (runIdRef.current !== runId) return;
      if (phase !== 'running') return;
      nextQuestion(runId);
    }, 650);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, question, cfg.haptics, cfg.sound, nextQuestion]);

  const useHint = useCallback(() => {
    if (phase !== 'running' || !question || hint) return;
    setHint(hintText(question));
  }, [phase, question, hint]);

  return {
    phase, question, qIndex, orientation,
    timeLeftMs, correct, incorrect,
    accuracy: accuracyOf(correct, incorrect),
    streak, bestStreak,
    avgMs: avgOf(times), times, history, feedback, flashVisible, hint,
    start, pause, resume, exit, answer, useHint,
  };
}

function revealText(question) {
  if (question.kind === 'tap-square-any' && question.meta?.accept?.length > 1) {
    return `One answer: ${question.answer} (${question.meta.accept.length} possible)`;
  }
  if (question.mode === 'square-color') return `Answer: ${question.answer}`;
  if (question.kind === 'choose-name' && question.mode === 'flash-memory') return `Answer: ${question.answer}`;
  if (question.mode === 'attack-defense' && question.meta?.accept?.length > 1) {
    return `One answer: ${question.answer} (${question.meta.accept.length} possible)`;
  }
  return null; // tap-the-square modes reveal via the board highlight instead
}

function feedbackText(question, ok) {
  if (!ok) return 'Not quite.';
  if (question.mode === 'square-color') return `Correct — ${question.answer}!`;
  return 'Correct!';
}

function hintText(question) {
  if (question.mode === 'square-color') {
    return 'Hint: add file number (a=1…) + rank. Even = light, odd = dark. a1 is dark.';
  }
  if (question.mode === 'spatial') return 'Hint: files run a–h left→right (white view); ranks run 1–8 bottom→top.';
  if (question.mode === 'blindfold') return 'Hint: count from the edge — files a–h, ranks 1–8.';
  if (question.mode === 'attack-defense') return 'Hint: check what the piece attacks from its square, one step at a time.';
  if (isSquareAnswer(question)) {
    const sq = String(question.answer);
    return `Hint: file ${sq[0]}, rank ${sq[1]}.`;
  }
  return 'Hint: eliminate one wrong option first.';
}

function isSquareAnswer(question) {
  return /^[a-h][1-8]$/.test(String(question.answer || ''));
}

let audioCtx = null;
function beep(ok) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audioCtx = audioCtx || new AC();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.value = ok ? 660 : 220;
  g.gain.value = 0.08;
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start();
  o.stop(audioCtx.currentTime + 0.15);
}
