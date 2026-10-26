import { useEffect, useRef, useState } from 'react';

// Quote-of-the-day selection. A quote's index is determined by the LOCAL
// calendar date: dayNumber = whole days since a fixed epoch (2026-01-01),
// index = dayNumber mod quotes.length. Using Date.UTC on the LOCAL date
// components avoids timezone/DST drift (the epoch is compared in pure UTC
// day-granularity even though the date itself is read from local calendar).
//
// The epoch MUST stay fixed forever. If the list grows, append to the end
// only; indices of existing quotes never change, so historical days are
// unaffected.

export const QUOTE_EPOCH = { year: 2026, month: 1, day: 1 };

const DAY_MS = 86_400_000;

export function dayNumberFromLocalDate(date = new Date()) {
  const utcAtLocalMidnight = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0, 0, 0, 0,
  );
  return Math.round(
    (utcAtLocalMidnight - Date.UTC(QUOTE_EPOCH.year, QUOTE_EPOCH.month - 1, QUOTE_EPOCH.day, 0, 0, 0, 0)) / DAY_MS,
  );
}

export function getQuoteIndex(listLength, date = new Date()) {
  if (!Number.isInteger(listLength) || listLength <= 0) return 0;
  const n = dayNumberFromLocalDate(date) % listLength;
  return n < 0 ? n + listLength : n;
}

export function quoteForDate(quotes, date = new Date()) {
  const list = Array.isArray(quotes) && quotes.length > 0 ? quotes : [{ en: '', ta: '', author: '' }];
  return list[getQuoteIndex(list.length, date)];
}

export function msUntilNextLocalMidnight(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

// Live quote with real-time midnight rollover: a timer fires at the next
// local midnight and re-schedules itself, and a visibilitychange listener
// re-checks the date whenever the tab becomes visible again.
export function useQuoteOfTheDay(quotes) {
  const listRef = useRef(quotes);
  listRef.current = quotes;
  const [quote, setQuote] = useState(() => quoteForDate(listRef.current));

  useEffect(() => {
    let timer = null;

    const refresh = () => setQuote(quoteForDate(listRef.current));

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        refresh();
        schedule();
      }, msUntilNextLocalMidnight());
    };

    schedule();
    document.addEventListener('visibilitychange', refresh);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  return quote;
}