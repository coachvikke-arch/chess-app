/**
 * AI Coach Training Academy — progress store.
 *
 * Design rules, in priority order:
 *
 *  1. MASTERY IS EARNED. A level can never be marked complete without its
 *     final exam recorded as passed at or above the level's pass mark. There is
 *     deliberately no setter that lets a higher level be mastered without that
 *     exam — `recordAssessment` is the only path that opens a level, and it
 *     refuses to open one on a failing score.
 *
 *  2. PERFECT REVISION COMPATIBILITY. Any previous level stays reachable at any
 *     time. `isUnlocked` only gates forward progress, never access.
 *
 *  3. PER-COACH SCOPE. Storage is keyed by coach id, mirroring the scoped
 *     pattern already used by BotProgressService, so two coaches on one machine
 *     do not share progress.
 *
 *  4. STORAGE FAILURE IS NOT FATAL. Every read is defensive and every write is
 *     best-effort. Private-browsing quota errors degrade to in-memory state for
 *     the session rather than throwing into a render.
 *
 * Pure functions plus a thin imperative API — no React, so it is testable and
 * reusable from a future server sync without changes.
 */

import { LEVELS, getLevel, MASTERY_WEIGHTS, MASTERY_CRITERIA, MASTERY_THRESHOLD, LEVEL_MASTERY_THRESHOLD } from '../data/levels';
import { normaliseLevel, normaliseTopic } from '../data/topicSchema';
import LEVEL_1 from '../data/curriculum/level1';
import LEVEL_2 from '../data/curriculum/level2';
import LEVEL_3 from '../data/curriculum/level3';
import LEVEL_4 from '../data/curriculum/level4';
import LEVEL_5 from '../data/curriculum/level5';
import LEVEL_6 from '../data/curriculum/level6';
import LEVEL_7 from '../data/curriculum/level7';
import LEVEL_8 from '../data/curriculum/level8';
import LEVEL_9 from '../data/curriculum/level9';
import LEVEL_10 from '../data/curriculum/level10';

const STORAGE_PREFIX = 'coachAcademy.v1';
const CURRENT_SCHEMA = 1;

/* ── storage helpers (defensive) ───────────────────────────────────────── */

function storage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function safeParse(raw, fallback) {
  try {
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

export function scopeFor(user) {
  const id = user?.id ?? user?.userId ?? user?.name ?? null;
  return id == null ? 'guest' : String(id);
}

function storeKey(scope) {
  return `${STORAGE_PREFIX}.${scope}`;
}

export function emptyState() {
  return {
    schema: CURRENT_SCHEMA,
    createdAt: Date.now(),
    /* topicId -> { state, scores:{criterion:0-100}, practiceDone, testBest, notes, lastSeen, mistakes[] } */
    topics: {},
    /* level number -> { passed, score, takenAt, attempts } */
    assessments: {},
    /* rolling personal record used by the analytics page */
    history: [],
    streak: { count: 0, lastDay: null },
    /* total focused seconds, accumulated while a training page is open */
    trainingMs: 0,
    /* AI chat transcripts, per topic and general */
    chat: {},
  };
}

export function loadState(user) {
  const s = storage();
  if (!s) return emptyState();
  /* getItem itself can throw, not just setItem — Safari in private browsing
     throws on read, and some embedded/partitioned contexts throw on any access.
     A read failure must degrade to a clean in-memory session, otherwise the
     academy crashes on load for exactly the users most likely to be on a
     locked-down device. */
  let raw = null;
  try {
    raw = s.getItem(storeKey(scopeFor(user)));
  } catch {
    return emptyState();
  }
  const parsed = safeParse(raw, null);
  if (!parsed) return emptyState();
  if (parsed.schema !== CURRENT_SCHEMA) return migrate(parsed);
  return { ...emptyState(), ...parsed };
}

function migrate(old) {
  /* Only one schema so far. When a v2 arrives it starts from a clean shell and
     carries over the parts that are still meaningful, rather than crashing on
     a shape mismatch. */
  const base = emptyState();
  return { ...base, trainingMs: old.trainingMs || 0, streak: old.streak || base.streak };
}

export function saveState(user, state) {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(storeKey(scopeFor(user)), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function resetAll(user) {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(storeKey(scopeFor(user)));
  } catch {
    /* ignore */
  }
}

/* ── curriculum index ─────────────────────────────────────────────────── */

/**
 * The normalised curriculum. Built once at module load from the ten level
 * files plus the shared LEVELS metadata (final task, pass mark, competency).
 */
export const CURRICULUM = Object.freeze(
  [LEVEL_1, LEVEL_2, LEVEL_3, LEVEL_4, LEVEL_5, LEVEL_6, LEVEL_7, LEVEL_8, LEVEL_9, LEVEL_10].map((raw) => {
    const meta = getLevel(raw.n);
    return normaliseLevel({
      ...raw,
      finalTask: raw.finalTask ?? meta?.finalTask ?? '',
      description: raw.description ?? meta?.description ?? '',
      tagline: raw.tagline ?? meta?.tagline ?? '',
      competency: raw.competency ?? meta?.competency ?? [],
      finalExam: raw.finalExam ?? meta?.finalExam,
    });
  }),
);

/** Every topic, flattened, with `level` available on each. */
export const ALL_TOPICS = Object.freeze(CURRICULUM.flatMap((l) => l.topics));

const TOPIC_INDEX = new Map(ALL_TOPICS.map((t) => [t.id, t]));

export function getTopic(topicId) {
  return TOPIC_INDEX.get(topicId) || null;
}

export function getModule(moduleId) {
  for (const level of CURRICULUM) {
    for (const mod of level.modules) if (mod.id === moduleId) return mod;
  }
  return null;
}

export function getLevelRecord(n) {
  return CURRICULUM.find((l) => l.n === Number(n)) || null;
}

export function topicsForLevel(n) {
  return getLevelRecord(n)?.topics ?? [];
}

export function curriculumStats() {
  const modules = CURRICULUM.reduce((a, l) => a + l.modules.length, 0);
  return { levels: CURRICULUM.length, modules, topics: ALL_TOPICS.length };
}

/* ── mastery arithmetic ───────────────────────────────────────────────── */

/**
 * Mastery percentage comes from actual recorded scores, never from "opened the
 * lesson". A criterion only contributes if the coach has genuinely demonstrated
 * it, so an untouched topic reads 0 and cannot be inflated by reading alone.
 */
export function masteryPercent(scores = {}) {
  let total = 0;
  for (const c of MASTERY_CRITERIA) {
    const v = Number(scores[c]);
    if (Number.isFinite(v)) total += (Math.max(0, Math.min(100, v)) * MASTERY_WEIGHTS[c]) / 100;
  }
  return Math.round(total);
}

/** Progress through one level = share of its topics that are mastered. */
export function levelProgress(n, state) {
  const topics = topicsForLevel(n);
  if (!topics.length) return { percent: 0, mastered: 0, total: 0 };
  let mastered = 0;
  let practiceDone = 0;
  for (const t of topics) {
    const rec = state.topics[t.id];
    if (!rec) continue;
    if (rec.state === 'mastered' || masteryPercent(rec.scores) >= MASTERY_THRESHOLD) mastered += 1;
    if (rec.practiceDone > 0) practiceDone += 1;
  }
  return {
    percent: Math.round((mastered / topics.length) * 100),
    practicePercent: Math.round((practiceDone / topics.length) * 100),
    mastered,
    total: topics.length,
  };
}

/** Progress across the whole ladder, weighted by topic count. */
export function overallProgress(state) {
  if (!ALL_TOPICS.length) return 0;
  let sum = 0;
  for (const t of ALL_TOPICS) {
    const rec = state.topics[t.id];
    sum += rec ? masteryPercent(rec.scores) : 0;
  }
  return Math.round(sum / ALL_TOPICS.length);
}

/* ── unlock rules ─────────────────────────────────────────────────────── */

/**
 * Level 1 is always open. Level n opens only when level n-1's final exam is
 * recorded as passed. Reading a topic never unlocks anything.
 */
export function isUnlocked(n, state) {
  const level = Number(n);
  if (level <= 1) return true;
  const prev = state.assessments?.[String(level - 1)];
  return Boolean(prev?.passed);
}

export function lockReason(n, state) {
  const level = Number(n);
  if (level <= 1) return null;
  if (isUnlocked(level, state)) return null;
  const prev = getLevel(level - 1);
  const rec = state.assessments?.[String(level - 1)];
  const mark = prev?.finalExam?.passMark ?? 80;
  if (!rec) return `Complete the Level ${level - 1} final assessment (${prev?.title ?? 'previous level'}) and score ≥ ${mark}%.`;
  return `Your Level ${level - 1} final score was ${rec.score}%. ${mark}% is required to unlock this level. Revise Level ${level - 1} and retake the exam.`;
}

/** The level a coach is currently working in: highest unlocked, unpassed. */
export function currentLevel(state) {
  for (const l of CURRICULUM) {
    if (!isUnlocked(l.n, state)) return Math.max(1, l.n - 1);
    if (!state.assessments?.[String(l.n)]?.passed) return l.n;
  }
  return CURRICULUM.length;
}

export function completedLevels(state) {
  return CURRICULUM.filter((l) => state.assessments?.[String(l.n)]?.passed).map((l) => l.n);
}

/** Level 10 passed = the internal training achievement is earned. */
export function isCertified(state) {
  const last = CURRICULUM[CURRICULUM.length - 1];
  return Boolean(last && state.assessments?.[String(last.n)]?.passed);
}

/* ── topic records ────────────────────────────────────────────────────── */

function blankRecord() {
  return {
    state: 'not-started',
    scores: {},
    practiceDone: 0,
    testBest: 0,
    testAttempts: 0,
    notes: '',
    mistakes: [],
    lastSeen: null,
  };
}

export function topicRecord(state, topicId) {
  const rec = state.topics[topicId];
  if (!rec) return blankRecord();
  return { ...blankRecord(), ...rec, scores: { ...(rec.scores || {}) } };
}

function touchDay(streak) {
  const today = new Date().toISOString().slice(0, 10);
  if (!streak || streak.lastDay === today) return streak || { count: 0, lastDay: today };
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const count = streak.lastDay === yesterday ? (streak.count || 0) + 1 : 1;
  return { count, lastDay: today };
}

/**
 * Record demonstrated performance on one topic criterion.
 *
 * This is the single funnel for mastery. It takes the best score seen for each
 * criterion (so a weak retry cannot destroy a good demonstration), recomputes
 * the derived state, and returns the next state.
 */
export function recordCriterion(user, topicId, criterion, score, { source = 'practice' } = {}) {
  const state = loadState(user);
  const prev = topicRecord(state, topicId);
  const clamped = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  const best = Math.max(Number(prev.scores[criterion]) || 0, clamped);

  const scores = { ...prev.scores, [criterion]: best };
  const percent = masteryPercent(scores);

  let next = 'learning';
  if (percent >= MASTERY_THRESHOLD) next = 'mastered';
  else if (prev.testAttempts > 0 || prev.practiceDone > 0) next = 'tested';
  else if (Object.keys(scores).length > 1) next = 'practicing';

  state.topics[topicId] = {
    ...prev,
    scores,
    state: next,
    lastSeen: Date.now(),
    mistakes: [...new Set([...(prev.mistakes || []), ...(clamped < 50 ? [criterion] : [])])].slice(0, 12),
  };
  state.streak = touchDay(state.streak);
  state.history = [
    ...(state.history || []),
    { at: Date.now(), topicId, criterion, score: clamped, source },
  ].slice(-500);

  saveState(user, state);
  return { state, record: state.topics[topicId], percent };
}

/** Move a topic into revision-needed without losing its scores. */
export function flagForRevision(user, topicId, reason = '') {
  const state = loadState(user);
  const prev = topicRecord(state, topicId);
  state.topics[topicId] = {
    ...prev,
    state: prev.state === 'mastered' ? 'needs-revision' : prev.state,
    lastSeen: Date.now(),
    mistakes: [...new Set([...(prev.mistakes || []), reason || 'weak answer'])].filter(Boolean).slice(0, 12),
  };
  saveState(user, state);
  return state;
}

export function setTopicState(user, topicId, nextState) {
  const state = loadState(user);
  const prev = topicRecord(state, topicId);
  state.topics[topicId] = { ...prev, state: nextState, lastSeen: Date.now() };
  saveState(user, state);
  return state;
}

/* ── practice / tests ─────────────────────────────────────────────────── */

export function recordPractice(user, topicId, { correct }) {
  const state = loadState(user);
  const prev = topicRecord(state, topicId);
  state.topics[topicId] = {
    ...prev,
    practiceDone: (prev.practiceDone || 0) + 1,
    state: prev.state === 'not-started' ? 'learning' : prev.state,
    lastSeen: Date.now(),
  };
  if (!correct) {
    state.topics[topicId].mistakes = [...new Set([...(prev.mistakes || []), 'practice'])].slice(0, 12);
  }
  state.streak = touchDay(state.streak);
  saveState(user, state);
  return state;
}

export function recordTopicTest(user, topicId, percent) {
  const state = loadState(user);
  const prev = topicRecord(state, topicId);
  const best = Math.max(prev.testBest || 0, percent);
  state.topics[topicId] = {
    ...prev,
    testBest: best,
    testAttempts: (prev.testAttempts || 0) + 1,
    state: percent >= MASTERY_THRESHOLD ? 'tested' : prev.state === 'not-started' ? 'learning' : 'practicing',
    lastSeen: Date.now(),
  };
  state.streak = touchDay(state.streak);
  saveState(user, state);
  return state;
}

/* ── final assessments (the only unlock path) ─────────────────────────── */

/**
 * Record a level final exam.
 *
 * A level is marked passed ONLY when the score reaches the level's pass mark.
 * Failing is recorded too — attempts and best score feed the revision engine —
 * but a failing attempt must never open the next level. That is the whole point
 * of this function.
 */
export function recordAssessment(user, levelN, { score, sections = [], answers = {} } = {}) {
  const state = loadState(user);
  const level = getLevelRecord(levelN);
  if (!level) return { state, record: null, passed: false };

  const mark = level.finalExam?.passMark ?? 80;
  const rounded = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  const passed = rounded >= mark;
  const key = String(level.n);
  const prev = state.assessments[key] || { passed: false, score: 0, attempts: 0, best: 0 };

  state.assessments[key] = {
    passed: passed || Boolean(prev.passed), // a pass is never revoked by a later fail
    score: rounded,
    best: Math.max(prev.best || 0, rounded),
    attempts: (prev.attempts || 0) + 1,
    takenAt: Date.now(),
    mark,
    sections,
  };
  state.streak = touchDay(state.streak);
  state.history = [...(state.history || []), { at: Date.now(), level: level.n, score: rounded, passed, kind: 'final-exam' }].slice(-500);
  saveState(user, state);

  return {
    state,
    record: state.assessments[key],
    passed: Boolean(state.assessments[key].passed),
    mark,
    nextUnlocked: passed ? isUnlocked(level.n + 1, state) : false,
  };
}

/* ── notes ────────────────────────────────────────────────────────────── */

export function saveNote(user, topicId, text) {
  const state = loadState(user);
  const prev = topicRecord(state, topicId);
  state.topics[topicId] = { ...prev, notes: String(text ?? ''), lastSeen: Date.now() };
  saveState(user, state);
  return state;
}

export function deleteNote(user, topicId) {
  return saveNote(user, topicId, '');
}

export function allNotes(user) {
  const state = loadState(user);
  return Object.entries(state.topics)
    .filter(([, rec]) => (rec.notes || '').trim())
    .map(([topicId, rec]) => {
      const topic = getTopic(topicId);
      return { topicId, notes: rec.notes, level: topic?.level ?? null, name: topic?.name ?? topicId };
    })
    .filter((n) => n.name !== n.topicId || n.notes);
}

/* ── chat transcripts ─────────────────────────────────────────────────── */

export function getChat(user, topicId = 'general') {
  return loadState(user).chat?.[topicId] || [];
}

export function appendChat(user, topicId, message) {
  const state = loadState(user);
  const key = topicId || 'general';
  const list = state.chat?.[key] || [];
  state.chat = { ...(state.chat || {}), [key]: [...list, message].slice(-60) };
  saveState(user, state);
  return state.chat[key];
}

export function clearChat(user, topicId = 'general') {
  const state = loadState(user);
  state.chat = { ...(state.chat || {}), [topicId]: [] };
  saveState(user, state);
  return [];
}

/* ── training time / analytics ────────────────────────────────────────── */

export function addTrainingTime(user, ms) {
  if (!(ms > 0)) return loadState(user);
  const state = loadState(user);
  state.trainingMs = (state.trainingMs || 0) + Math.min(ms, 5 * 60 * 1000); // cap a single tick
  saveState(user, state);
  return state;
}

export function totalTrainingMs(state) {
  return state.trainingMs || 0;
}

/**
 * Competency breakdown for the analytics page. Each figure is derived from real
 * recorded scores on the criteria that feed it, so it cannot be inflated by
 * browsing.
 */
export function skillScores(state) {
  const byCompetency = new Map();
  for (const topic of ALL_TOPICS) {
    const rec = state.topics[topic.id];
    if (!rec) continue;
    const level = getLevelRecord(topic.level);
    for (const comp of level?.competency ?? []) {
      if (!byCompetency.has(comp)) byCompetency.set(comp, []);
      byCompetency.get(comp).push(masteryPercent(rec.scores));
    }
  }
  const out = {};
  for (const [comp, list] of byCompetency) {
    out[comp] = list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : 0;
  }
  return out;
}

/** Topics the revision engine should send the coach back to, worst first. */
export function revisionQueue(state, limit = 5) {
  return Object.entries(state.topics)
    .map(([topicId, rec]) => {
      const topic = getTopic(topicId);
      if (!topic) return null;
      const percent = masteryPercent(rec.scores);
      const flagged = rec.state === 'needs-revision';
      if (!flagged && percent >= MASTERY_THRESHOLD) return null;
      return {
        topicId,
        name: topic.name,
        level: topic.level,
        percent,
        state: rec.state,
        mistakes: rec.mistakes || [],
        priority: (flagged ? 1000 : 0) + (100 - percent),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);
}

/** Topics touched within the last N days, newest first, for "recent activity". */
export function recentActivity(state, limit = 8) {
  return Object.entries(state.topics)
    .filter(([, rec]) => rec.lastSeen)
    .sort((a, b) => (b[1].lastSeen || 0) - (a[1].lastSeen || 0))
    .slice(0, limit)
    .map(([topicId, rec]) => {
      const topic = getTopic(topicId);
      return {
        topicId,
        name: topic?.name ?? topicId,
        level: topic?.level ?? null,
        at: rec.lastSeen,
        percent: masteryPercent(rec.scores),
      };
    });
}

export function assessmentHistory(state) {
  return Object.entries(state.assessments)
    .map(([level, rec]) => ({ level: Number(level), ...rec }))
    .sort((a, b) => a.level - b.level);
}

/** Full dashboard payload, so the dashboard renders from one read. */
export function dashboardSummary(user) {
  const state = loadState(user);
  const level = currentLevel(state);
  const levelRec = getLevelRecord(level);
  const masteredCount = ALL_TOPICS.filter((t) => {
    const rec = state.topics[t.id];
    return rec && (rec.state === 'mastered' || masteryPercent(rec.scores) >= MASTERY_THRESHOLD);
  }).length;
  const revisionCount = revisionQueue(state, 99).length;
  return {
    state,
    level,
    levelRecord: levelRec,
    overall: overallProgress(state),
    levelProgress: levelProgress(level, state),
    masteredTopics: masteredCount,
    totalTopics: ALL_TOPICS.length,
    revisionTopics: revisionCount,
    skills: skillScores(state),
    streak: state.streak?.count || 0,
    trainingMs: state.trainingMs || 0,
    assessments: assessmentHistory(state),
    revisionQueue: revisionQueue(state, 3),
    certified: isCertified(state),
    nextTopic: recommendedTopic(state),
  };
}

/** The single best next thing to do, given everything recorded so far. */
export function recommendedTopic(state) {
  const queue = revisionQueue(state, 1);
  if (queue.length) {
    const t = queue[0];
    return { ...t, reason: 'Revise a weak topic first' };
  }
  const level = currentLevel(state);
  const topics = topicsForLevel(level);
  const untouched = topics.find((t) => !state.topics[t.id]);
  if (untouched) return { topicId: untouched.id, name: untouched.name, level, reason: 'Next new topic' };
  const inProgress = topics.find((t) => {
    const rec = state.topics[t.id];
    return rec && rec.state !== 'mastered' && masteryPercent(rec.scores) < MASTERY_THRESHOLD;
  });
  if (inProgress) return { topicId: inProgress.id, name: inProgress.name, level, reason: 'Continue where you left off' };
  const nextLevel = getLevelRecord(level + 1);
  if (nextLevel) {
    const t = nextLevel.topics[0];
    return { topicId: t.id, name: t.name, level: nextLevel.n, reason: `Start Level ${nextLevel.n}` };
  }
  return null;
}

export const AcademyStore = {
  CURRICULUM,
  ALL_TOPICS,
  loadState,
  saveState,
  resetAll,
  scopeFor,
  curriculumStats,
  getTopic,
  getModule,
  getLevelRecord,
  topicsForLevel,
  masteryPercent,
  levelProgress,
  overallProgress,
  isUnlocked,
  lockReason,
  currentLevel,
  completedLevels,
  isCertified,
  topicRecord,
  recordCriterion,
  recordPractice,
  recordTopicTest,
  recordAssessment,
  flagForRevision,
  setTopicState,
  saveNote,
  deleteNote,
  allNotes,
  getChat,
  appendChat,
  clearChat,
  addTrainingTime,
  totalTrainingMs,
  skillScores,
  revisionQueue,
  recentActivity,
  assessmentHistory,
  dashboardSummary,
  recommendedTopic,
  normaliseTopic,
  LEVEL_MASTERY_THRESHOLD,
};

export default AcademyStore;