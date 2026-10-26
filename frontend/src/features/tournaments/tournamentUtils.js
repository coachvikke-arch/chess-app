import { useEffect, useState } from 'react';

export const FORMAT_META = {
  swiss: { label: 'Swiss', icon: '♞', blurb: 'Fixed rounds. Everyone plays every round against someone on a similar score. Most points wins.' },
  arena: { label: 'Arena', icon: '⚡', blurb: 'Fixed time window. Play as many games as you can - wins score 2, draws 1, win streaks double.' },
  knockout: { label: 'Knockout', icon: '🏆', blurb: 'Single elimination bracket. Lose and you are out; drawn boards go to an Armageddon decider.' },
};

export const STATUS_META = {
  upcoming: { label: 'Upcoming', tone: 'blue' },
  active: { label: 'Live', tone: 'live' },
  paused: { label: 'Paused', tone: 'amber' },
  completed: { label: 'Completed', tone: 'grey' },
  cancelled: { label: 'Cancelled', tone: 'red' },
};

export const REASON_LABEL = {
  checkmate: 'Checkmate',
  resign: 'Resignation',
  timeout: 'Time out',
  timeout_vs_insufficient: 'Time out vs bare king',
  forfeit_no_show: 'No-show forfeit',
  forfeit: 'Forfeit',
  abandon: 'Abandoned',
  stalemate: 'Stalemate',
  repetition: 'Threefold repetition',
  fifty_move: 'Fifty-move rule',
  insufficient_material: 'Insufficient material',
  agreement: 'Draw agreed',
  admin: 'Admin decision',
  armageddon: 'Armageddon',
  bye: 'Bye',
};

export const reasonLabel = (r) => REASON_LABEL[r] || '';

export function resultText(result, reason) {
  const why = reasonLabel(reason);
  const tail = why ? ` · ${why}` : '';
  if (result === 'white') return `White wins${tail}`;
  if (result === 'black') return `Black wins${tail}`;
  if (result === 'draw') return `Draw${tail}`;
  if (result === 'abandon') return `No result${tail}`;
  if (result === 'bye') return 'Bye (+1)';
  return '';
}

export const timeControlLabel = (t) => (t ? `${t.timeMinutes}+${t.incrementSeconds}` : '');

export function fmtClock(ms) {
  if (ms == null) return '--:--';
  const total = Math.max(0, ms);
  const s = Math.floor(total / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  if (total < 10000) return `${m}:${String(sec).padStart(2, '0')}.${Math.floor((total % 1000) / 100)}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function fmtDateTime(d) {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/* Re-renders every `intervalMs` so countdowns tick. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/* Countdown text for a future timestamp ("2h 05m", "4:32"). */
export function countdown(target, now) {
  if (!target) return '';
  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return 'now';
  const s = Math.ceil(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function standingsCsv(standings, format) {
  const head = ['Rank', 'Player', 'Rating', 'Score', 'Wins', 'Draws', 'Losses'];
  if (format === 'swiss') head.push('Buchholz');
  const rows = standings.map((s) => {
    const base = [s.rank, s.name, s.rating, s.score, s.wins, s.draws, s.losses];
    if (format === 'swiss') base.push(s.buchholz);
    return base;
  });
  return [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

export function downloadText(filename, text, type = 'text/csv') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
