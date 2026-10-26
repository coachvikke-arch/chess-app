// Single source of truth for the instructor's "Ask quiz" defaults.
//
// The four fields of the Ask-quiz dialog (time limit, points on solve, attempts
// allowed, points deducted per fail) are remembered PER USER and device-local,
// so the next quiz opens pre-filled with the values that instructor last used.
// storageKey()/currentUserId() mirror config/legalMoves.js, config/pieceDrag.js
// and config/boardAnimation.js. Nothing is written until a quiz is actually
// started — opening or cancelling the dialog never persists anything.
//
// A field is `null` when it is blank (e.g. "no time limit"). null stays null:
// it must never be coerced to 0, or a blank would come back as a real zero.

const STORAGE_PREFIX = 'knightpath-quiz-settings';

export const DEFAULT_QUIZ_SETTINGS = {
  timeLimitSec: null,
  pointsOnSolve: null,
  attemptsAllowed: null,
  pointsPerFail: null,
};

function currentUserId() {
  try {
    const raw = localStorage.getItem('user');
    if (raw) {
      const u = JSON.parse(raw);
      if (u && (u.id || u.user_id)) return String(u.id || u.user_id);
    }
  } catch {
    /* ignore */
  }
  return 'guest';
}

function storageKey() {
  return `${STORAGE_PREFIX}:${currentUserId()}`;
}

/* Keep only finite, non-negative NUMBERS; anything else (strings, NaN, negatives,
   missing fields) becomes null. So a blank stays blank and corrupted data falls
   back to empty fields rather than throwing. */
export function sanitizeQuizSettings(raw) {
  const out = { ...DEFAULT_QUIZ_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(DEFAULT_QUIZ_SETTINGS)) {
    const v = raw[key];
    out[key] = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  }
  return out;
}

export function getQuizSettings() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return { ...DEFAULT_QUIZ_SETTINGS };
    return sanitizeQuizSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_QUIZ_SETTINGS };
  }
}

export function setQuizSettings(next) {
  const clean = sanitizeQuizSettings(next);
  try {
    localStorage.setItem(storageKey(), JSON.stringify(clean));
  } catch {
    /* ignore — a full/blocked localStorage must not break starting a quiz */
  }
  return clean;
}

/* Stored shape → the dialog's string fields. null → '' so a blank input stays
   blank instead of rendering "0". */
export function settingsToFields(settings) {
  const s = sanitizeQuizSettings(settings);
  return {
    timeLimitSeconds: s.timeLimitSec == null ? '' : String(s.timeLimitSec),
    points: s.pointsOnSolve == null ? '' : String(s.pointsOnSolve),
    maxAttempts: s.attemptsAllowed == null ? '' : String(s.attemptsAllowed),
    negativePoints: s.pointsPerFail == null ? '' : String(s.pointsPerFail),
  };
}

/* The dialog's string fields → the stored shape. '' → null (blank preserved),
   and only non-negative finite numbers are kept. */
export function fieldsToSettings(fields) {
  const num = (v) => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return {
    timeLimitSec: num(fields.timeLimitSeconds),
    pointsOnSolve: num(fields.points),
    attemptsAllowed: num(fields.maxAttempts),
    pointsPerFail: num(fields.negativePoints),
  };
}
