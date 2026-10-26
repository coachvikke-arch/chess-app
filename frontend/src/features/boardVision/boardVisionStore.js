/**
 * Board Vision persistence — LOCAL ONLY (clearly labeled).
 *
 * The backend exposes no Board Vision endpoints, and the brief forbids
 * inventing endpoints or faking server writes. All progress therefore lives
 * in localStorage under a versioned key, scoped per user. If a backend API
 * is added later, only this file needs to change (same function shapes).
 */

const KEY = 'board-vision-progress-v1';

function scopeKey(userId) {
  return `${KEY}:${userId || 'guest'}`;
}

export const EMPTY_PROGRESS = {
  version: 1,
  // overall
  totalSessions: 0,
  totalCorrect: 0,
  totalIncorrect: 0,
  responseTimes: [], // capped rolling window (ms)
  bestStreak: 0,
  lastTrainedDate: null,
  dailyStreak: 0,
  personalBests: {}, // { [modeId]: { correct, accuracy } }
  levels: {}, // { [levelId]: { sessions, bestAccuracy, qualifyingSessions, completedChallenges } }
  sessions: [], // recent session summaries (capped at 60)
  mistakeCategories: {},
  missedSquares: {},
  modeStats: {}, // { [modeId]: { correct, incorrect, times: [] } }
  freePractice: false, // teacher-enabled unlock override (stored locally; teacher sets it in class page)
};

export function loadProgress(userId) {
  try {
    const raw = localStorage.getItem(scopeKey(userId));
    if (!raw) return { ...EMPTY_PROGRESS };
    const parsed = JSON.parse(raw);
    return { ...EMPTY_PROGRESS, ...parsed };
  } catch {
    return { ...EMPTY_PROGRESS };
  }
}

export function saveProgress(userId, progress) {
  try {
    const slim = {
      ...progress,
      responseTimes: (progress.responseTimes || []).slice(-200),
      sessions: (progress.sessions || []).slice(-60),
    };
    for (const m of Object.keys(slim.modeStats || {})) {
      slim.modeStats[m] = { ...slim.modeStats[m], times: (slim.modeStats[m].times || []).slice(-100) };
    }
    localStorage.setItem(scopeKey(userId), JSON.stringify(slim));
  } catch {
    /* storage full / private mode — training still works, just not persisted */
  }
}

export function overallAccuracy(progress) {
  const total = (progress.totalCorrect || 0) + (progress.totalIncorrect || 0);
  if (!total) return 0;
  return Math.round(((progress.totalCorrect || 0) / total) * 100);
}

export function avgResponse(progress) {
  const t = progress.responseTimes || [];
  if (!t.length) return 0;
  return Math.round(t.reduce((a, b) => a + b, 0) / t.length);
}
