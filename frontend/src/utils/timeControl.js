/* Lichess-style time controls for the Play Arena picker.
   Every choice is a discrete number here and is passed to the API as
   baseMinutes/incrementSeconds — never parsed back out of a label, which is how
   the old selector ended up reading options as one run-on string. */

export const TIME_CONTROL_PRESETS = [
  { label: '1+0',   family: 'Bullet',    hours: 0, base: 1,  inc: 0 },
  { label: '3+0',   family: 'Blitz',     hours: 0, base: 3,  inc: 0 },
  { label: '3+2',   family: 'Blitz',     hours: 0, base: 3,  inc: 2 },
  { label: '10+0',  family: 'Rapid',     hours: 0, base: 10, inc: 0 },
  { label: '10+30', family: 'Rapid',     hours: 0, base: 10, inc: 30 },
  { label: '30+0',  family: 'Classical', hours: 0, base: 30, inc: 0 },
];

export const HOUR_OPTIONS = [0, 1, 2, 3, 4, 5];
export const MINUTE_OPTIONS = [0, 1, 2, 3, 4, 5, 10, 15, 20, 30, 45, 60];
export const INCREMENT_OPTIONS = [0, 1, 2, 3, 5, 10, 15, 20, 30];

/* The picker's largest combination (5 h + 60 min) — the server accepts exactly
   this much so a value picked here is never silently trimmed. */
export const MAX_BASE_MINUTES = 360;

export function timeControlMinutes({ hours = 0, base = 0 } = {}) {
  const h = Math.max(0, Number(hours) || 0);
  const m = Math.max(0, Number(base) || 0);
  return h * 60 + m;
}

/** A game needs a starting clock; 0 h + 0 min would flag both sides instantly. */
export function isTimeControlValid(value) {
  return timeControlMinutes(value) >= 1;
}

/** `10+0`, `3+2`, or `1:30:00 + 5s` once the clock runs into hours. */
export function formatTimeControl({ hours = 0, base = 0, inc = 0 } = {}) {
  const h = Math.max(0, Number(hours) || 0);
  const m = Math.max(0, Number(base) || 0);
  const s = Math.max(0, Number(inc) || 0);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:00 + ${s}s`;
  return `${m}+${s}`;
}

/** Plain-English caption under the big label. */
export function describeTimeControl({ hours = 0, base = 0, inc = 0 } = {}) {
  const h = Math.max(0, Number(hours) || 0);
  const m = Math.max(0, Number(base) || 0);
  const s = Math.max(0, Number(inc) || 0);
  const start = [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
  return `${start || '0 min'} starting clock · ${s} s per move`;
}

/** Lichess's estimated duration (base + 40 increments) picks the family. */
export function timeControlFamily({ hours = 0, base = 0, inc = 0 } = {}) {
  const seconds = timeControlMinutes({ hours, base }) * 60 + 40 * Math.max(0, Number(inc) || 0);
  if (seconds < 180) return 'Bullet';
  if (seconds < 480) return 'Blitz';
  if (seconds < 1500) return 'Rapid';
  return 'Classical';
}
