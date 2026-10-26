/**
 * Tactics progress — per user, stored locally, React-free underneath.
 *
 * This mirrors the pattern the AI Coach Academy store already uses
 * (`features/coachAcademy/services/academyStore.js`): pure functions plus a thin
 * imperative API, so every state rule is testable in plain node and the whole
 * module can later be swapped for a server sync without touching a component.
 *
 * Two rules, in priority order:
 *
 *   1. PER-USER SCOPE. The storage key ends with the user id, so two people
 *      sharing a browser do not inherit each other's progress.
 *
 *   2. STORAGE FAILURE IS NOT FATAL. Every read is defensive and every write is
 *      best-effort. A private-browsing quota error degrades to in-memory state
 *      for the session instead of throwing into a render.
 *
 * "Viewed" and "solved" are tracked SEPARATELY on purpose: the list screen draws
 * a tick for solved, and a dimmed marker for seen-but-unsolved, and collapsing
 * them into one flag would make the progress bar claim credit for opening a card.
 */

const STORAGE_PREFIX = 'tactics.v1';
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
  return { schema: CURRENT_SCHEMA, createdAt: Date.now(), viewed: [], solved: [], solvedAt: {} };
}

export function loadState(user) {
  const key = storeKey(scopeFor(user));
  const state = safeParse(storage()?.getItem(key), null);
  if (!state || state.schema !== CURRENT_SCHEMA) return emptyState();
  /* Merge over a fresh shell so a state saved before a field existed still
     loads (and does not crash a screen that reads the new field). */
  return { ...emptyState(), ...state };
}

function save(user, state) {
  const s = storage();
  if (!s) return state;
  try { s.setItem(storeKey(scopeFor(user)), JSON.stringify(state)); } catch { /* quota/private mode */ }
  return state;
}

/* ── reads ────────────────────────────────────────────────────────────── */

export function isViewed(state, slug) { return state.viewed.includes(slug); }
export function isSolved(state, slug) { return state.solved.includes(slug); }

export function viewedCount(state) { return state.viewed.length; }
export function solvedCount(state) { return state.solved.length; }

/** 0–100, rounded. */
export function percent(state, total) {
  if (!total) return 0;
  return Math.round((solvedCount(state) / total) * 100);
}

/* ── writes ───────────────────────────────────────────────────────────── */

export function markViewed(user, state, slug) {
  if (!slug || isViewed(state, slug)) return state;
  return save(user, { ...state, viewed: [...state.viewed, slug] });
}

export function markSolved(user, state, slug) {
  if (!slug) return state;
  const solved = isSolved(state, slug) ? state.solved : [...state.solved, slug];
  return save(user, { ...state, solved, solvedAt: { ...state.solvedAt, [slug]: Date.now() } });
}

/** Mark both in one pass — the detail screen marks viewed on mount and solved on
 *  completion, and two writes in a row would race on the same storage key. */
export function markSolvedAndViewed(user, state, slug) {
  if (!slug) return state;
  return save(user, {
    ...state,
    viewed: isViewed(state, slug) ? state.viewed : [...state.viewed, slug],
    solved: isSolved(state, slug) ? state.solved : [...state.solved, slug],
    solvedAt: { ...state.solvedAt, [slug]: Date.now() },
  });
}

export function resetAll(user) {
  const fresh = emptyState();
  const s = storage();
  if (s) { try { s.removeItem(storeKey(scopeFor(user))); } catch { /* ignore */ } }
  return fresh;
}