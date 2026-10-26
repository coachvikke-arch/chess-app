/* One 12-hour clock for the whole app: "02:31 PM".
 *
 * Times arrive in two shapes — a bare "HH:MM[:SS]" string straight from a TIME
 * column, or a Date / ISO datetime — and browsers disagree on whether
 * toLocaleTimeString defaults to 12h or 24h, so every time-of-day on screen
 * goes through here instead of toLocaleTimeString. Countdowns and durations
 * (game clocks, "4:52 left") are NOT times of day and must never use this.
 *
 * Anything unparseable comes back as `fallback` (default ''), so a strange
 * value degrades to blank rather than a wrong time. Pass the original string
 * as fallback where showing something is better than showing nothing.
 */
export function formatTime12(value, fallback = '') {
  if (value == null || value === '') return fallback;
  let h;
  let m;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return fallback;
    h = value.getHours();
    m = value.getMinutes();
  } else {
    const s = String(value).trim();
    const clock = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (clock) {
      h = Number(clock[1]);
      m = Number(clock[2]);
      if (h < 0 || h > 23 || m < 0 || m > 59) return fallback;
    } else {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return fallback;
      h = d.getHours();
      m = d.getMinutes();
    }
  }
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

/* Indian-style datetime: "07 Oct 2026, 02:31 PM". Same date words the report
 * pages already use (en-IN "dd Mon yyyy"), with the 12-hour clock above. */
export function formatDateTime12(value, fallback = '') {
  if (value == null || value === '') return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${date}, ${formatTime12(d, '')}`;
}
