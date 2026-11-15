import { useEffect, useMemo, useState } from 'react';
import Button from '../Button';

const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const presetRange = (key) => {
  const today = startOfDay();
  if (key === 'today') return { from: iso(today), to: iso(today) };
  if (key === '7d' || key === '30d') {
    const from = new Date(today); from.setDate(from.getDate() - (key === '7d' ? 6 : 29));
    return { from: iso(from), to: iso(today) };
  }
  if (key === 'month') return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
  if (key === 'year') return { from: iso(new Date(today.getFullYear(), 0, 1)), to: iso(today) };
  return { from: '', to: '' };
};
const pretty = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

export default function ReportDateFilter({ value = { from: '', to: '' }, onChange, allowFuture = false, className = '' }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  useEffect(() => setDraft(value), [value.from, value.to]);
  const applied = useMemo(() => value.from || value.to
    ? `Showing: ${value.from ? pretty(value.from) : 'Any date'} – ${value.to ? pretty(value.to) : 'Any date'}`
    : 'Showing: All time', [value.from, value.to]);
  const max = allowFuture ? undefined : iso(startOfDay());

  function apply(next = draft) {
    if (next.from && next.to && next.from > next.to) { setError('From Date must be on or before To Date.'); return; }
    if (!allowFuture && ((next.from && next.from > max) || (next.to && next.to > max))) { setError('Dates cannot be later than today.'); return; }
    setError('');
    setDraft(next);
    onChange?.(next);
  }

  function preset(key) {
    const next = presetRange(key);
    apply(next);
  }

  function reset() { const next = { from: '', to: '' }; setDraft(next); setError(''); onChange?.(next); }

  return (
    <section className={`chess-card report-date-filter ${className}`} aria-label="Filter report by date">
      <div className="report-date-controls">
        <label><span>From Date</span><input type="date" value={draft.from || ''} max={max} onChange={(e) => setDraft((v) => ({ ...v, from: e.target.value }))} /></label>
        <label><span>To Date</span><input type="date" value={draft.to || ''} min={draft.from || undefined} max={max} onChange={(e) => setDraft((v) => ({ ...v, to: e.target.value }))} /></label>
        <div className="report-date-actions"><Button type="button" variant="primary" size="sm" onClick={() => apply()}>Apply</Button><Button type="button" variant="secondary" size="sm" onClick={reset}>Reset / Clear</Button></div>
      </div>
      <div className="report-date-presets" aria-label="Quick date ranges">
        {[['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['year', 'This year'], ['all', 'All time']].map(([key, label]) => <button key={key} type="button" className="chess-chip" onClick={() => preset(key)}>{label}</button>)}
      </div>
      {error && <p className="report-date-error" role="alert">{error}</p>}
      <p className="report-date-active" aria-live="polite">{applied}</p>
    </section>
  );
}
