// Single source of truth for the puzzle trainer's device-local state.
//
// Three things live in localStorage and nowhere else:
//   - the band the student last trained in,
//   - how many puzzles each band has been solved on this device,
//   - the ids already shown, so the feed never repeats one back.
//
// The seen list is a ROLLING WINDOW (`SEEN_CAP`), sent to `GET /puzzles/next` as
// `?seen=`. It is a guard against a repeat, not a record of everything ever
// solved: the pool behind the trainer is 6.1M rows, so forgetting the oldest few
// hundred ids costs nothing and keeps the request small forever. The solved
// counts stay forever — they are five numbers.
//
// Storage and the per-user key mirror config/autoQueen.js and config/pieceDrag.js:
// the trainer is per signed-in user on this device, and a guest gets its own slot.

/**
 * The five bands, in the order the level sheet shows them. `range` is what the
 * student reads; the server owns the matching `rating` filter and indexes it by
 * the same position in this list (`backend/src/services/puzzleTrainer.js`), so
 * adding a band here means adding one there, in the same order.
 */
export const TRAINER_LEVELS = [
  { range: '400–800', name: 'Beginner' },
  { range: '800–1200', name: 'Casual' },
  { range: '1200–1600', name: 'Club' },
  { range: '1600–2000', name: 'Advanced' },
  { range: '2000+', name: 'Expert' },
];

const TRAINER_LEVEL_COUNT = TRAINER_LEVELS.length;

const PREFIX = 'knightpath-puzzle-trainer';

export const SEEN_CAP = 400;

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

function storageKey(what) {
  return `${PREFIX}:${what}:${currentUserId()}`;
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — the trainer still works, it just forgets */
  }
}

const inBand = (n) => Number.isInteger(n) && n >= 0 && n < TRAINER_LEVEL_COUNT;

/** The band to open on. Anything unrecognised lands on band 1 (Beginner). */
export function readLevel() {
  const v = read(storageKey('level'), 0);
  return inBand(v) ? v : 0;
}

export function writeLevel(level) {
  if (inBand(level)) write(storageKey('level'), level);
}

/** One count per band, oldest storage shape repaired rather than trusted. */
export function readSolvedCounts() {
  const v = read(storageKey('solved'), null);
  return Array.from({ length: TRAINER_LEVEL_COUNT }, (_, i) => {
    const n = Array.isArray(v) ? Number(v[i]) : 0;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  });
}

/** Adds one solve to a band and hands back the whole updated row. */
export function countSolve(level) {
  const next = readSolvedCounts();
  if (!inBand(level)) return next;
  next[level] += 1;
  write(storageKey('solved'), next);
  return next;
}

/** The ids this device has been shown, newest last. */
export function readSeenIds() {
  const v = read(storageKey('seen'), null);
  if (!Array.isArray(v)) return [];
  return v.filter((id) => typeof id === 'string' && id).slice(-SEEN_CAP);
}

export function rememberSeenId(id) {
  if (!id) return;
  const seen = readSeenIds();
  /* An id is remembered once; a repeat from a stale prefetch must not push the
     oldest useful ids out of the window. */
  if (seen.includes(id)) return;
  seen.push(String(id));
  write(storageKey('seen'), seen.slice(-SEEN_CAP));
}
