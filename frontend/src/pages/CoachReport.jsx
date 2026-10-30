import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../services/api';
import { PageHeader, Card, Chip, Spinner } from '../components/ui';
import Button from '../components/Button';

/* ── Period helpers ──────────────────────────────────────────────────────── */

const PERIODS = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'custom', label: 'Custom' },
];

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function rangeFor(period) {
  const now = new Date();
  if (period === 'daily') {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { from: iso(day), to: iso(day), label: 'Today' };
  }
  if (period === 'weekly') {
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: iso(monday), to: iso(sunday), label: 'This week' };
  }
  if (period === 'monthly') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: iso(first), to: iso(last), label: 'This month' };
  }
  return { from: '', to: '', label: 'Custom' };
}

const fmtDate = (s) => {
  if (!s) return '';
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const fmtN = (n) => Number(n || 0).toLocaleString('en-IN');

const fmtHrs = (min) => {
  min = Number(min || 0);
  if (min <= 0) return '';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `≈ ${h}h ${m}m` : `≈ ${m}m`;
};

/* Accent palettes (literal class strings so Tailwind keeps them). */
const ACCENTS = {
  gold: { border: 'border-l-gold-500/70', icon: 'text-gold-400' },
  blue: { border: 'border-l-sky-400/80', icon: 'text-sky-400' },
  green: { border: 'border-l-emerald-400/80', icon: 'text-emerald-400' },
};

const SUM_TONES = {
  blue: { bar: 'border-l-sky-400/80', bg: 'bg-sky-400/10', label: 'text-sky-300', body: 'text-sky-100/90' },
  gold: { bar: 'border-l-gold-500/80', bg: 'bg-gold-500/10', label: 'text-gold-400', body: 'text-ivory-200' },
  green: { bar: 'border-l-emerald-400/80', bg: 'bg-emerald-400/10', label: 'text-emerald-300', body: 'text-emerald-100/90' },
};

function MiniStat({ label, value, sub, icon = '♙', accent = 'gold' }) {
  const a = ACCENTS[accent] || ACCENTS.gold;
  return (
    <div className={`rounded-xl bg-[var(--ink-800)] border border-white/10 border-l-[3px] ${a.border} p-4 flex items-center gap-3`}>
      <span className={`text-xl ${a.icon}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[0.66rem] uppercase tracking-[0.16em] text-ivory-500 font-bold">{label}</p>
        <p className="font-display font-bold text-2xl text-ivory-100 leading-tight">{value}</p>
        {sub && <p className="text-xs text-ivory-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function Donut({ completed, pending }) {
  const total = completed + pending;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const R = 52;
  const C = 2 * Math.PI * R;
  const dash = total > 0 ? (completed / total) * C : 0;
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-44 w-44">
        <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
          <circle cx="64" cy="64" r={R} fill="none" stroke="rgba(56, 189, 248, 0.22)" strokeWidth="14" />
          {total > 0 && (
            <circle
              cx="64"
              cy="64"
              r={R}
              fill="none"
              stroke="#34d399"
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${C - dash}`}
            />
          )}
        </svg>
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="text-center">
            <p className="font-display text-[1.5rem] font-bold text-ivory-100 leading-none">{pct}%</p>
            <p className="text-[0.62rem] uppercase tracking-[0.18em] text-ivory-500 mt-1">completed</p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-5 text-xs text-ivory-400 mt-3">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-emerald-400" /> Completed
          <b className="text-ivory-200">{fmtN(completed)}</b>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-sky-400/40" /> Pending
          <b className="text-ivory-200">{fmtN(pending)}</b>
        </span>
      </div>
    </div>
  );
}

/* Auto-generated, color-coded summary sentences. */
function buildSummary(t, p) {
  const b = (n) => (Number(n) === 1 ? '' : 's');
  const items = [];
  const completionRate = p.assigned > 0 ? Math.round((p.completed / p.assigned) * 100) : 0;

  items.push({
    tone: 'blue',
    label: 'Teaching impact',
    text:
      t.classesConducted === 0
        ? 'No classes were conducted in this period.'
        : `Taught ${fmtN(t.classesConducted)} class${b(t.classesConducted)} totalling ${
            fmtHrs(t.minutes) || 'no recorded time'
          } across ${fmtN(t.students)} unique student${b(t.students)}.`,
  });

  items.push({
    tone: 'gold',
    label: 'Puzzle engagement',
    text:
      p.assigned === 0
        ? 'No puzzles were assigned to this coach’s students this period.'
        : `Students completed ${fmtN(p.completed)} of ${fmtN(p.assigned)} assigned puzzles — a ${completionRate}% completion rate.`,
  });

  items.push({
    tone: 'green',
    label: 'Curriculum coverage',
    text:
      t.topics.length === 0
        ? 'No session topics were recorded for this period.'
        : `Covered ${t.topics.length} distinct topic${b(t.topics.length)} this period: ${t.topics.join(', ')}.`,
  });

  return items;
}

/* ── Single coach performance report ─────────────────────────────────────── */

export default function CoachReport() {
  const { id } = useParams();
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState('weekly');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [applied, setApplied] = useState({ from: '', to: '' });

  useEffect(() => {
    let alive = true;
    setError('');
    const from = period === 'custom' ? applied.from : rangeFor(period).from;
    const to = period === 'custom' ? applied.to : rangeFor(period).to;
    const qs = from && to ? `?startDate=${from}&endDate=${to}` : '';
    api
      .get(`/admins/${id}/performance${qs}`, { cache: false })
      .then((res) => { if (alive) setReport(res.data); })
      .catch((err) => {
        if (!alive) return;
        setReport(null);
        setError(err.response?.data?.message || 'Failed to load the report');
      });
    return () => { alive = false; };
  }, [id, period, applied.from, applied.to]);

  function activateCustom() {
    setPeriod('custom');
    if (!customFrom && !customTo) {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
      setCustomFrom(iso(from));
      setCustomTo(iso(now));
    }
  }

  const range = rangeFor(period);
  const sub =
    period === 'custom'
      ? applied.from && applied.to
        ? `${fmtDate(applied.from)} – ${fmtDate(applied.to)}`
        : 'All time'
      : `${range.label} · ${fmtDate(range.from)} – ${fmtDate(range.to)}`;

  if (error) {
    return (
      <PageHeader title="Coach Report" icon="♘" subtitle={sub}>
        <div className="flex justify-between items-center gap-3 mb-4">
          <nav className="cr-breadcrumb">
            <Link to="/super">Super Admin</Link>
            <span>›</span>
            <span>Coach Reports</span>
          </nav>
        </div>
        <div className="chess-error">{error}</div>
      </PageHeader>
    );
  }

  if (!report) {
    return (
      <PageHeader title="Coach Report" icon="♘" subtitle={sub}>
        <div className="flex justify-between items-center gap-3 mb-4">
          <nav className="cr-breadcrumb">
            <Link to="/super">Super Admin</Link>
            <span>›</span>
            <span>Coach Reports</span>
          </nav>
        </div>
        <Spinner text="Building the performance report…" />
      </PageHeader>
    );
  }

  const t = report.teaching || { classesConducted: 0, minutes: 0, students: 0, topics: [] };
  const p = report.puzzles || { assigned: 0, completed: 0, pending: 0 };
  const completionRate = p.assigned > 0 ? Math.round((p.completed / p.assigned) * 100) : 0;

  return (
    <PageHeader title={report.coach?.name || 'Coach Report'} icon="♘" subtitle={sub}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <nav className="cr-breadcrumb !mb-0">
          <Link to="/super">Super Admin</Link>
          <span>›</span>
          <span>Coach Reports</span>
        </nav>
        <div className="cr-pills">
          {PERIODS.map((per) => (
            <button
              key={per.key}
              type="button"
              className={`perm-tab ${period === per.key ? 'perm-tab--on' : ''}`}
              onClick={() => (per.key === 'custom' ? activateCustom() : setPeriod(per.key))}
            >
              {per.label}
            </button>
          ))}
        </div>
      </div>

      {period === 'custom' && (
        <div className="cr-range">
          <input
            type="date"
            className="chess-input !py-1.5 !px-2.5 !text-xs"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            aria-label="From date"
          />
          <span className="text-ivory-500 text-xs">→</span>
          <input
            type="date"
            className="chess-input !py-1.5 !px-2.5 !text-xs"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            aria-label="To date"
          />
          <Button
            type="button"
            variant="primary" size="sm" className="!py-1.5 !px-3 !text-xs"
            disabled={!customFrom || !customTo}
            onClick={() => setApplied({ from: customFrom, to: customTo })}
          >
            Apply
          </Button>
        </div>
      )}

      <div className="cr-grid">
        {/* ── Teaching column ── */}
        <div className="space-y-4 min-w-0">
          <Card title="Teaching Statistics" piece="♘">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <MiniStat label="Classes conducted" value={fmtN(t.classesConducted)} icon="♘" accent="gold" />
              <MiniStat
                label="Teaching time"
                value={`${fmtN(t.minutes)} min`}
                sub={fmtHrs(t.minutes) || undefined}
                icon="♜"
                accent="gold"
              />
              <MiniStat label="Students taught" value={fmtN(t.students)} sub="unique" icon="♙" accent="gold" />
            </div>
          </Card>

          <Card title="Topics Covered" piece="♟">
            {t.topics.length === 0 ? (
              <p className="text-sm text-ivory-500">No topics have been covered in this period yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {t.topics.map((tp) => (
                  <Chip key={tp} tone="gold">{tp}</Chip>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ── Puzzle column ── */}
        <div className="space-y-4 min-w-0">
          <Card title="Puzzle Management" piece="♟">
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label="Puzzles assigned" value={fmtN(p.assigned)} icon="♟" accent="blue" />
              <MiniStat
                label="Puzzles completed"
                value={fmtN(p.completed)}
                sub={p.assigned > 0 ? `${completionRate}% done` : undefined}
                icon="✓"
                accent="blue"
              />
            </div>
          </Card>

          <Card title="Puzzle Completion Overview" piece="◍">
            {p.assigned === 0 ? (
              <p className="text-sm text-ivory-500">No puzzles were assigned in this period.</p>
            ) : (
              <Donut completed={p.completed} pending={p.pending} />
            )}
          </Card>

          <Card title="Performance Summary" piece="★">
            <div className="space-y-3">
              {buildSummary(t, p).map((item) => {
                const tone = SUM_TONES[item.tone] || SUM_TONES.blue;
                return (
                  <div key={item.label} className={`rounded-lg border-l-4 ${tone.bar} ${tone.bg} px-3 py-2.5`}>
                    <p className={`text-[0.65rem] uppercase tracking-[0.16em] font-bold ${tone.label}`}>{item.label}</p>
                    <p className={`text-sm leading-relaxed mt-0.5 ${tone.body}`}>{item.text}</p>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
</PageHeader>
    );
  }