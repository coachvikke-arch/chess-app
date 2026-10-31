import { useEffect, useState } from 'react';

/* Countdown to the class end for the Classroom V2 rooms.
 *
 * The class stores its schedule as a DATE (`class_date`) plus bare TIME strings
 * (`start_time` / `end_time`, "HH:mm:ss"). The end instant is rebuilt from those
 * two so the countdown counts real milliseconds against Date.now() - a deadline
 * computed from a tick counter would drift on a backgrounded tab. */

function classEndTimeMs(classMeta) {
  const scheduled = classMeta?.scheduledDate;
  const endTime = classMeta?.endTime;
  if (!scheduled || !endTime) return null;
  const date = new Date(`${String(scheduled).slice(0, 10)}T${String(endTime).slice(0, 8)}`);
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** ms -> "M:SS" or "H:MM:SS" (hours only above 60 minutes, like a lesson clock). */
export function formatClassCountdown(ms) {
  if (ms == null) return null;
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

/**
 * @param {object|null} classMeta   the live class row (scheduledDate + endTime)
 * @param {boolean} [enabled]        count only while the class is live
 */
export function useClassEndTimer(classMeta, enabled = true) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);

  const endMs = classEndTimeMs(classMeta);
  const remainingMs = endMs == null ? null : Math.max(0, endMs - now);
  const label = remainingMs == null ? null : formatClassCountdown(remainingMs);

  return { endMs, remainingMs, label, endTimeMs: endMs };
}

export default useClassEndTimer;
