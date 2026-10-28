/* Date/duration presentation for a completed class card.
   Values arrive as they come out of Postgres — `class_date` is a DATE
   ("2026-10-20"), `start_time`/`end_time` are bare TIME strings ("15:30:00") —
   but older rows and hand-edited data can be empty or an ISO datetime, so every
   helper returns null instead of throwing on something it cannot read. */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** `2026-10-20` → { label: '20 OCT 2026', weekday: 'Tuesday' } (null if unusable). */
export function classDateParts(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);

  let date;
  if (iso) {
    /* Built from parts on purpose: `new Date('2026-10-20')` is parsed as UTC
       midnight, which shows the previous day west of Greenwich. */
    date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const impossible =
      date.getFullYear() !== Number(iso[1]) ||
      date.getMonth() !== Number(iso[2]) - 1 ||
      date.getDate() !== Number(iso[3]);
    if (impossible) return null;
  } else {
    date = new Date(text);
  }
  if (Number.isNaN(date.getTime())) return null;

  const day = String(date.getDate()).padStart(2, '0');
  return {
    label: `${day} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`,
    weekday: WEEKDAYS[date.getDay()],
  };
}

/** Minutes since midnight for "HH:MM[:SS]" or an ISO datetime; null if unreadable. */
export function minutesOfDay(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getHours() * 60 + value.getMinutes();
  }
  const text = String(value).trim();
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (clock) {
    const h = Number(clock[1]);
    const m = Number(clock[2]);
    if (h > 23 || m > 59) return null;
    return h * 60 + m;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.getHours() * 60 + date.getMinutes();
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * "1 minute", "1 hour 5 minutes", "Less than a minute".
 * An end clock earlier than the start means the class ran past midnight.
 */
export function classDurationLabel(startTime, endTime) {
  const start = minutesOfDay(startTime);
  const end = minutesOfDay(endTime);
  if (start == null || end == null) return null;

  const minutes = end >= start ? end - start : end + 24 * 60 - start;
  if (minutes === 0) return 'Less than a minute';

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? plural(hours, 'hour') : '', rest ? plural(rest, 'minute') : '']
    .filter(Boolean)
    .join(' ');
}
