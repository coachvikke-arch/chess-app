/**
 * Small formatting helpers shared by the academy pages.
 *
 * Kept together and dependency-free so analytics, the dashboard and the
 * certificate cannot drift into three different ways of printing a duration.
 */

/** `1h 25m`, `45m`, `40s`. Never prints "0m" for a brand-new coach. */
export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** `2 Oct 2026` — stable across locales so a stored date reads the same later. */
export function formatDate(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** `today`, `3 days ago`, `2 weeks ago`. */
export function formatRelative(value) {
  if (!value) return '—';
  const then = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(then)) return '—';
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  return formatDate(then);
}

/** Clamp a percentage into 0–100 for display. */
export function pct(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

/** Ordinal suffix, used for mastery states and step counts in prose. */
export function ordinal(n) {
  const v = Number(n) || 0;
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  switch (v % 10) {
    case 1: return `${v}st`;
    case 2: return `${v}nd`;
    case 3: return `${v}rd`;
    default: return `${v}th`;
  }
}