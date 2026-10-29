import api from '../../services/api';

/**
 * Board Vision persistence.
 *
 * The signed-in user's progress lives on the server (`/api/board-vision/progress`)
 * so it follows them across devices. localStorage is kept as the OFFLINE
 * BACKUP: every change is written locally first (training works with no
 * network), and the server copy is pushed shortly afterwards. On first load the
 * local document is uploaded once when the server has nothing yet.
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

/* ── server copy ────────────────────────────────────────────────────────────
   Both helpers resolve to null/false on failure instead of throwing: a dead
   network must never interrupt a training session, and the caller already has
   the localStorage copy to fall back on. */
export async function fetchRemoteProgress() {
  try {
    const res = await api.get('/board-vision/progress', { cache: false });
    const remote = res.data?.progress;
    if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return null;
    return { ...EMPTY_PROGRESS, ...remote };
  } catch {
    return null;
  }
}

export async function saveRemoteProgress(progress) {
  try {
    await api.put('/board-vision/progress', { progress });
    return true;
  } catch {
    return false;
  }
}
