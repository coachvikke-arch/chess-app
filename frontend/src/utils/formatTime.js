/**
 * The one timestamp format in the app: "26 Oct 2026, 11:20 PM".
 *
 * Everything that shows a date or time uses this, so no raw ISO string and no
 * 24-hour clock ever reaches the screen. Anything unusable (missing, malformed)
 * renders as "-" instead of "Invalid Date".
 */
export function formatTime(value, { dateOnly = false } = {}) {
  if (value === null || value === undefined || value === '') return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-IN', dateOnly
    ? { day: '2-digit', month: 'short', year: 'numeric' }
    : {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    /* en-IN lower-cases the meridiem ("1:59 pm"); the house style is upper. */
    .replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
}
