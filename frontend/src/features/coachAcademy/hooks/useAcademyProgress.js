/**
 * AI Coach Training Academy — React bridge over the progress store.
 *
 * The store (`services/academyStore.js`) is deliberately React-free: pure
 * functions plus imperative commands, scoped per coach. This hook is the only
 * place React and the store meet, which keeps every state rule testable in
 * plain node and keeps components declarative.
 *
 * Two things it adds over calling the store directly:
 *
 *  1. A single source of truth. The whole persisted state is read once and held
 *     in `state`, so a component never reads localStorage and never disagrees
 *     with a sibling about progress.
 *
 *  2. Training-time accounting. Time is only counted while a training page is
 *     actually mounted and the tab is visible — otherwise a forgotten tab would
 *     inflate the analytics page with hours the coach never spent.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import {
  loadState,
  resetAll,
  recordCriterion,
  recordPractice,
  recordTopicTest,
  recordAssessment,
  flagForRevision,
  saveNote,
  addTrainingTime,
  getChat,
  appendChat,
  clearChat,
  topicRecord,
  masteryPercent,
  isUnlocked,
  lockReason,
  levelProgress,
  overallProgress,
  currentLevel,
  skillScores,
  revisionQueue,
  recentActivity,
  assessmentHistory,
  dashboardSummary,
  recommendedTopic,
  isCertified,
  getTopic,
  getLevelRecord,
  topicsForLevel,
} from '../services/academyStore';
import { MASTERY_THRESHOLD } from '../data/levels';

/** How often focused time is flushed to storage, in ms. */
const TIME_FLUSH_MS = 15000;

export default function useAcademyProgress() {
  const { user } = useAuth();

  const [state, setState] = useState(() => loadState(user));
  const [chat, setChat] = useState(() => getChat(user, 'general'));

  /* Re-read when the signed-in coach changes: progress is per-coach, so
     switching accounts must not show the previous coach's ladder. */
  useEffect(() => {
    setState(loadState(user));
    setChat(getChat(user, 'general'));
  }, [user?.id, user?.userId, user?.name]);

  /* Keep multiple tabs of the academy consistent. The `storage` event fires in
     *other* tabs only, which is exactly the case we want to react to. */
  useEffect(() => {
    function onStorage(e) {
      if (!e.key || !e.key.startsWith('coachAcademy.v1')) return;
      setState(loadState(user));
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [user?.id, user?.userId, user?.name]);

  /* ── focused training time ──────────────────────────────────────────── */

  const pendingMs = useRef(0);
  const lastTick = useRef(Date.now());

  useEffect(() => {
    lastTick.current = Date.now();

    const flush = () => {
      const now = Date.now();
      const delta = now - lastTick.current;
      lastTick.current = now;
      /* A tab that was hidden reports one huge delta on return. Cap it to the
         flush interval so background time is never counted as study time. */
      pendingMs.current += Math.min(delta, TIME_FLUSH_MS);
      if (pendingMs.current >= TIME_FLUSH_MS) {
        addTrainingTime(user, pendingMs.current);
        pendingMs.current = 0;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        /* Reset the clock rather than crediting the hidden span. */
        lastTick.current = Date.now();
        pendingMs.current = 0;
      }
    };

    const id = setInterval(flush, TIME_FLUSH_MS);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
      /* Flush whatever is left so the last few seconds of a lesson are not lost
         on navigation — this is the common case, since a coach finishes a topic
         and immediately clicks the next one. */
      const tail = Math.min(Date.now() - lastTick.current, TIME_FLUSH_MS);
      if (pendingMs.current + tail > 1000) addTrainingTime(user, pendingMs.current + tail);
    };
  }, [user]);

  /* ── commands ───────────────────────────────────────────────────────── */

  /** Every mutator re-reads the store and returns the fresh state to React. */
  const run = useCallback((fn) => {
    const next = fn();
    setState(next);
    return next;
  }, []);

  const actions = useMemo(
    () => ({
      recordCriterion: (topicId, criterion, score, opts) =>
        run(() => recordCriterion(user, topicId, criterion, score, opts).state),

      recordPractice: (topicId, payload) => run(() => recordPractice(user, topicId, payload)),

      recordTopicTest: (topicId, percent) => run(() => recordTopicTest(user, topicId, percent)),

      recordAssessment: (levelN, payload) => run(() => recordAssessment(user, levelN, payload).state),

      flagForRevision: (topicId, reason) => run(() => flagForRevision(user, topicId, reason)),

      saveNote: (topicId, text) => run(() => saveNote(user, topicId, text)),

      reset: () => {
        resetAll(user);
        setState(loadState(user));
        setChat([]);
      },
    }),
    [run, user],
  );

  /* ── chat ───────────────────────────────────────────────────────────── */

  const sendChat = useCallback(
    (message, { role = 'user', topicId = 'general' } = {}) => {
      const entry = { role, text: message, at: Date.now(), topicId };
      const list = appendChat(user, topicId, entry);
      if (topicId === 'general') setChat(list);
      return list;
    },
    [user],
  );

  const resetChat = useCallback(
    (topicId = 'general') => {
      const list = clearChat(user, topicId);
      if (topicId === 'general') setChat(list);
    },
    [user],
  );

  /* ── derived views ──────────────────────────────────────────────────── */

  const view = useMemo(() => {
    const level = currentLevel(state);
    return {
      state,
      level,
      levelRecord: getLevelRecord(level),
      overall: overallProgress(state),
      levelProgress: levelProgress(level, state),
      skills: skillScores(state),
      revision: revisionQueue(state, 8),
      revisionCount: revisionQueue(state, 99).length,
      recent: recentActivity(state),
      assessments: assessmentHistory(state),
      recommended: recommendedTopic(state),
      certified: isCertified(state),
      streak: state.streak?.count || 0,
      trainingMs: state.trainingMs || 0,
    };
  }, [state]);

  /* Per-topic helpers, so pages do not re-implement mastery arithmetic. */
  const forTopic = useCallback(
    (topicId) => {
      const rec = topicRecord(state, topicId);
      return {
        record: rec,
        percent: masteryPercent(rec.scores),
        mastered: rec.state === 'mastered' || masteryPercent(rec.scores) >= MASTERY_THRESHOLD,
        unlocked: isUnlocked(getTopic(topicId)?.level ?? 1, state),
      };
    },
    [state],
  );

  const forLevel = useCallback(
    (n) => ({
      unlocked: isUnlocked(n, state),
      reason: lockReason(n, state),
      progress: levelProgress(n, state),
      topics: topicsForLevel(n),
      record: state.assessments?.[String(n)] || null,
    }),
    [state],
  );

  const dashboard = useMemo(() => dashboardSummary(user), [user, state]);

  return {
    user,
    ...view,
    ...actions,
    chat,
    sendChat,
    resetChat,
    forTopic,
    forLevel,
    dashboard,
    /* Re-read on demand, e.g. after a reset in another tab. */
    refresh: () => setState(loadState(user)),
  };
}