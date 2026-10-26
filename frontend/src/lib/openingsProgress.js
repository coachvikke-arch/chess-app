/* Openings progress store — "Learned / In Progress / Not Started" per opening,
   plus practice stats (accuracy, streak) and family badges.

   STORAGE IS PER-USER AND OPTIONAL. The module works fine signed out; when a
   user is signed in the key is namespaced by user id so a shared machine does
   not leak one student's progress into another's. Nothing here depends on the
   backend — this is purely local, and a failed read degrades to "no progress".

   Shape stored at the key:
   {
     v: 1,
     openings: {
       [slug]: {
         status: 'not-started' | 'in-progress' | 'learned',
         attempts, bestStreak, onTheory, totalMoves,
         lastPlayedAt, firstPlayedAt,
         lines: {
           [lineId]: { practiced: boolean, completedAt: epochMs, bestStreak: number }
         }
       }
     },
     stats: { sessions, correct, total, currentStreak, bestStreak, lastSessionDay },
     badges: { [badgeId]: epochMs },
   }
 */

const BASE_KEY = 'np:openings:progress:v1';
const SCHEMA_VERSION = 1;

export const STATUS = {
  NOT_STARTED: 'not-started',
  IN_PROGRESS: 'in-progress',
  LEARNED: 'learned',
};

/* Consecutive correct theory moves in one session that earns the badge. */
export const STREAK_TARGET = 8;
/* Accuracy (%) needed, together with the streak, to mark an opening learned. */
export const ACCURACY_TARGET = 80;

/**
 * How many moves of this line the learner actually has to play.
 * A black opening is offset by one ply, because move 1 ... is played from
 * ply index 0 rather than ply index 1.
 */
function ownMoveCount(opening) {
  if (!opening?.moves?.length) return 0;
  const offset = opening.side === 'black' ? 1 : 0;
  let n = 0;
  for (let i = offset; i < opening.moves.length; i += 2) n += 1;
  return n;
}

/**
 * Streak required to auto-complete this opening. Short lines can never reach
 * STREAK_TARGET (a 6-ply line only has 3 moves for the learner), so we require a
 * clean run of every move they actually have to play, capped at the target.
 */
export function requiredStreak(opening) {
  return Math.max(1, Math.min(STREAK_TARGET, ownMoveCount(opening)));
}

function emptyState() {
  return { v: SCHEMA_VERSION, openings: {}, stats: emptyStats(), badges: {} };
}

function emptyStats() {
  return {
    sessions: 0,
    correct: 0,
    total: 0,
    currentStreak: 0,
    bestStreak: 0,
    lastSessionDay: null, // 'YYYY-MM-DD' of the most recent session
  };
}

export function emptyOpeningEntry() {
  return {
    status: STATUS.NOT_STARTED,
    attempts: 0,
    bestStreak: 0,
    onTheory: 0,
    totalMoves: 0,
    lastPlayedAt: 0,
    firstPlayedAt: 0,
    lines: {},
  };
}

/* ─────────────────────────── keys + read/write ─────────────────────────── */

function storageKey(userId) {
  return userId ? `${BASE_KEY}:u${userId}` : `${BASE_KEY}:guest`;
}

function read(userId) {
  if (typeof localStorage === 'undefined') return emptyState();
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== SCHEMA_VERSION) return emptyState();
    return {
      v: SCHEMA_VERSION,
      openings: parsed.openings || {},
      stats: { ...emptyStats(), ...(parsed.stats || {}) },
      badges: parsed.badges || {},
    };
  } catch {
    // Corrupt payload — start clean rather than breaking the page.
    return emptyState();
  }
}

function write(userId, state) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    /* quota or private mode — progress simply won't persist */
  }
}

/* ─────────────────────────── queries ─────────────────────────── */

/** Progress entry for one opening (a fresh entry when untouched). */
export function getOpeningProgress(slug, userId) {
  return read(userId).openings[slug] || emptyOpeningEntry();
}

/** Map of slug -> entry for the whole library. */
export function getAllProgress(userId) {
  return read(userId).openings;
}

/** Aggregate practice stats. */
export function getStats(userId) {
  return read(userId).stats;
}

/** Epoch ms of when a badge was earned, or null. */
export function getBadgeEarnedAt(badgeId, userId) {
  return read(userId).badges[badgeId] || null;
}

export function getEarnedBadges(userId) {
  return read(userId).badges;
}

/** Live accuracy: correct theory moves / total theory moves (0-100). */
export function getAccuracy(userId) {
  const { correct, total } = getStats(userId);
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

/** Get progress for a specific line within an opening. */
export function getLineProgress(slug, lineId, userId) {
  const entry = getOpeningProgress(slug, userId);
  return entry.lines?.[lineId] || { practiced: false, bestStreak: 0 };
}

/** Count how many lines of an opening have been practiced. */
export function countPracticedLines(slug, userId) {
  const entry = getOpeningProgress(slug, userId);
  return Object.values(entry.lines || {}).filter(l => l.practiced).length;
}

/* ─────────────────────────── mutations ─────────────────────────── */

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

/**
 * Record the result of a practice session and return a summary the UI can
 * celebrate (status change, streak, newly earned badges).
 *
 * @param {object} opts
 * @param {string} opts.slug       opening practiced
 * @param {number} opts.correct    theory-correct moves played
 * @param {number} opts.total      theory moves attempted
 * @param {number} opts.streak     best correct-run inside the session
 * @param {boolean} [opts.completed] user played the line to the end
 * @param {string}  [opts.lineId]  the line/variation id practiced (default 'main')
 * @param {object}  [opts.opening] the opening record (for family badges)
 * @param {Array}   [opts.library] the full opening list (for family totals)
 * @param {string|number} [opts.userId]
 */
export function recordSession(opts) {
  const {
    slug,
    correct = 0,
    total = 0,
    streak = 0,
    completed = false,
    lineId = 'main',
    opening = null,
    library = [],
    userId = null,
  } = opts;

  const state = read(userId);
  const now = Date.now();

  /* ── opening entry ── */
  const prev = state.openings[slug] || emptyOpeningEntry();
  const entry = {
    ...prev,
    attempts: prev.attempts + 1,
    bestStreak: Math.max(prev.bestStreak, streak),
    onTheory: prev.onTheory + correct,
    totalMoves: prev.totalMoves + total,
    lastPlayedAt: now,
    firstPlayedAt: prev.firstPlayedAt || now,
    lines: { ...prev.lines },
  };

  const sessionAccuracy = total > 0 ? (correct / total) * 100 : 0;
  const need = requiredStreak(opening);
  const strong = completed && total > 0 && sessionAccuracy >= ACCURACY_TARGET && streak >= need;

  if (strong) {
    entry.status = STATUS.LEARNED;
  } else if (entry.status === STATUS.NOT_STARTED) {
    // Playing a single move counts as "started" — never block the learner.
    entry.status = STATUS.IN_PROGRESS;
  }

  /* Track per-line progress */
  if (completed && sessionAccuracy >= ACCURACY_TARGET) {
    entry.lines[lineId] = {
      practiced: true,
      completedAt: now,
      bestStreak: Math.max(entry.lines[lineId]?.bestStreak || 0, streak),
    };
  } else if (!entry.lines[lineId]) {
    entry.lines[lineId] = { practiced: false, bestStreak: 0 };
  }
  entry.lines[lineId].bestStreak = Math.max(entry.lines[lineId].bestStreak || 0, streak);

  state.openings[slug] = entry;

  /* ── global stats + day streak ── */
  const s = state.stats;
  s.sessions += 1;
  s.correct += correct;
  s.total += total;
  s.bestStreak = Math.max(s.bestStreak, streak);

  const day = today();
  if (s.lastSessionDay !== day) {
    const gap = daysBetween(s.lastSessionDay, day);
    // A gap of 1 day continues the streak; 2+ days (or a new user) restarts it.
    s.currentStreak = gap === 1 ? s.currentStreak + 1 : 1;
    s.lastSessionDay = day;
  }

  /* ── badges ── */
  const newBadges = evaluateBadges(state, opening, library);

  write(userId, state);

  return {
    accuracy: Math.round(sessionAccuracy),
    status: entry.status,
    justLearned: strong && prev.status !== STATUS.LEARNED,
    dayStreak: s.currentStreak,
    newBadges,
  };
}

/** Manually set an opening's status (the "mark as learned" control). */
export function setStatus(slug, status, userId = null) {
  const state = read(userId);
  const prev = state.openings[slug] || emptyOpeningEntry();
  state.openings[slug] = { ...prev, status, lastPlayedAt: Date.now() };
  write(userId, state);
  return state.openings[slug];
}

export function resetProgress(userId = null) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    /* ignore */
  }
}

/* ─────────────────────────── badges ─────────────────────────── */

/* Every badge is derived from stored state — there are no hidden counters — so
   they can be recomputed at any time (e.g. after the library grows). Each
   `test` receives the raw state and returns true when the badge is earned. */

const FAMILY_BADGES = [
  { family: 'Italian Game', name: 'Italian Game Master', icon: '♘' },
  { family: 'Ruy Lopez', name: 'Ruy Lopez Adept', icon: '♗' },
  { family: 'Queen’s Gambit', name: "Queen's Gambit Scholar", icon: '♕' },
  { family: 'Sicilian', name: 'Sicilian Warrior', icon: '♞' },
  { family: 'Caro-Kann', name: 'Caro-Kann Specialist', icon: '♙' },
  { family: 'King’s Indian', name: "King's Indian Master", icon: '♜' },
  { family: 'London System', name: 'London Wall Builder', icon: '♔' },
  { family: 'Nimzo-Indian', name: 'Nimzo Pinner', icon: '♝' },
  { family: 'English', name: 'English Opening Expert', icon: '♗' },
  { family: 'French Defence', name: 'French Defender', icon: '♛' },
];

/** Family names live in the JSON with curly quotes; normalise for matching. */
const fold = (s) => String(s || '').toLowerCase().replace(/[’']/g, '');

function learnedCountFor(state, library, family) {
  const target = fold(family);
  return library.filter((o) => fold(o.family) === target && state.openings[o.slug]?.status === STATUS.LEARNED)
    .length;
}

function totalFor(library, family) {
  const target = fold(family);
  return library.filter((o) => fold(o.family) === target).length;
}

/**
 * Award any newly earned badges into `state.badges`.
 * Mutates state (the caller writes it). Returns the badge records just earned.
 */
function evaluateBadges(state, opening, library) {
  if (!library?.length) return [];
  const now = Date.now();
  const fresh = [];

  const award = (id, name, icon, detail) => {
    if (state.badges[id]) return;
    state.badges[id] = now;
    fresh.push({ id, name, icon, detail });
  };

  /* Family completion — "Italian Game Master" and friends. */
  for (const b of FAMILY_BADGES) {
    const need = totalFor(library, b.family);
    if (need === 0) continue;
    const have = learnedCountFor(state, library, b.family);
    if (have === need) {
      award(`family:${fold(b.family)}`, b.name, b.icon, `All ${need} ${b.family} openings learned`);
    }
  }

  /* Milestone badges from the global stats. */
  const s = state.stats;
  if (s.sessions >= 1) award('first-session', 'Opening Explorer', '🎯', 'Finished your first practice session');
  if (s.sessions >= 10) award('ten-sessions', 'Dedicated Student', '📚', 'Completed 10 practice sessions');
  if (s.bestStreak >= 10) award('streak-10', 'Theory Machine', '⚡', '10 correct moves in a row');
  if (s.total >= 100 && s.correct / s.total >= 0.9) {
    award('accuracy-90', 'Precision Player', '🎯', '90%+ accuracy over 100 theory moves');
  }
  if (s.currentStreak >= 3) award('days-3', 'Three-Day Streak', '🔥', 'Practised 3 days in a row');
  if (s.currentStreak >= 7) award('days-7', 'Week of Chess', '🏅', 'Practised 7 days in a row');

  return fresh;
}

/** Badges with their earned state resolved, ready to render. */
export function badgeShelf(library, userId) {
  const state = read(userId);
  return FAMILY_BADGES.map((b) => {
    const need = totalFor(library, b.family);
    const have = learnedCountFor(state, library, b.family);
    const id = `family:${fold(b.family)}`;
    return {
      id,
      name: b.name,
      icon: b.icon,
      family: b.family,
      learned: have,
      total: need,
      earnedAt: state.badges[id] || null,
      earned: Boolean(state.badges[id]),
    };
  }).filter((b) => b.total > 0);
}
