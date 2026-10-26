/* ─────────────────────────────────────────────────────────────────────────────
   Shared event-type filter for the whole Command Center calendar.

   One place decides what "an event" is, so Monthly, Weekly, Daily and the Agenda
   board can't drift apart — switching tabs (or weeks/months) keeps the selection
   because they all read the same state.

   Deliberately a plain module rather than a hook: filtering is pure, and keeping
   it free of React means the rules stay unit-testable on their own.
   ─────────────────────────────────────────────────────────────────────────── */

export const FILTER_TYPES = [
  { key: 'class', label: 'Classes', emoji: '🏫' },
  { key: 'assignment', label: 'Assignments', emoji: '📝' },
  { key: 'puzzle', label: 'Puzzles', emoji: '🧩' },
];

export const FILTER_KEYS = ['all', ...FILTER_TYPES.map((t) => t.key)];
export const DEFAULT_FILTER = 'all';

/* Plurals and shorthands accepted in ?filter= so a hand-typed or shared URL
   ("?filter=classes") lands on the right pill instead of silently resetting. */
const FILTER_ALIASES = {
  all: 'all',
  everything: 'all',
  class: 'class',
  classes: 'class',
  assignment: 'assignment',
  assignments: 'assignment',
  homework: 'assignment',
  puzzle: 'puzzle',
  puzzles: 'puzzle',
};

function classify(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return undefined;

  // Emoji prefix, e.g. "🏫 E2E" — checked before the keyword list so a title
  // that merely contains the word "class" can't win.
  if (/[\u{1F3EB}\u{1F3ED}]/u.test(v)) return 'class';
  if (/[\u{1F4DD}\u{270F}\u{1F4CC}]/u.test(v)) return 'assignment';
  if (/[\u{1F9E9}]/u.test(v)) return 'puzzle';

  if (v === 'class' || v === 'classes' || v === 'lesson' || v === 'live') return 'class';
  if (v === 'assignment' || v === 'assignments' || v === 'homework' || v === 'task') return 'assignment';
  if (v === 'puzzle' || v === 'puzzles' || v === 'puzzle-assignment') return 'puzzle';

  return null; // present but outside the three buckets
}

/**
 * Which filter bucket an event belongs to: 'class' | 'assignment' | 'puzzle'.
 *
 * `type` is authoritative when present. This matters: an event tagged
 * `type: 'tournament'` with a `kind` of 'class' is a tournament, not a class, so
 * an explicit type that matches nothing returns null instead of falling through
 * to the kind lookup. Only when no type exists do kind, then a leading emoji in
 * the title, get a say. Kinds outside the three buckets — tournaments and course
 * files — return null so they drop out of a specific filter but stay visible
 * under "All".
 */
export function getEventType(event) {
  if (!event) return null;

  if (event.type !== undefined && event.type !== null && String(event.type).trim() !== '') {
    return classify(event.type);
  }

  for (const key of ['eventType', 'event_type', 'kind']) {
    if (event[key] === undefined || event[key] === null || String(event[key]).trim() === '') continue;
    return classify(event[key]);
  }

  // Titles occasionally lead with the emoji even when the type field is empty.
  const title = String(event.title ?? '');
  if (/^\s*[\u{1F3EB}\u{1F3ED}]/u.test(title)) return 'class';
  if (/^\s*[\u{1F4DD}\u{270F}\u{1F4CC}]/u.test(title)) return 'assignment';
  if (/^\s*[\u{1F9E9}]/u.test(title)) return 'puzzle';

  return null;
}

/** Coerce anything (URL param, storage) into a valid filter key. */
export function normalizeFilter(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return FILTER_ALIASES[key] || DEFAULT_FILTER;
}

/**
 * Filter a list of events down to one type. Runs BEFORE any per-day grouping so
 * "+N more" and "E2E ×14" describe what's actually on screen rather than
 * counting items the filter hid.
 */
export function useFilteredEvents(events, filter) {
  const active = normalizeFilter(filter);
  if (active === DEFAULT_FILTER) return events;
  return events.filter((e) => getEventType(e) === active);
}

/** Per-type counts for a slice of events; `all` is the slice's own length. */
export function countByFilterType(events) {
  const counts = { all: events.length, class: 0, assignment: 0, puzzle: 0 };
  for (const e of events) {
    const type = getEventType(e);
    if (type && counts[type] !== undefined) counts[type] += 1;
  }
  return counts;
}

/** How many events of each type fall on `date`. */
export function countsForDate(events, date) {
  const counts = { all: 0, class: 0, assignment: 0, puzzle: 0 };
  for (const e of events) {
    if (e.date !== date) continue;
    counts.all += 1;
    const type = getEventType(e);
    if (type && counts[type] !== undefined) counts[type] += 1;
  }
  return counts;
}