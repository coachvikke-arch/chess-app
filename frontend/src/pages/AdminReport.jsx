import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';
import { PageHeader, Chip, Spinner } from '../components/ui';
import ClassDetailModal from '../components/ClassDetailModal';
import Button from '../components/Button';

/* Super admin report for a single admin/coach — opened from the Admins page at
   /admin/admins/:id/report. Shows everything that coach has done: assigned
   students, batches, scheduled + past classes (with attendance), online games
   they played, assignments/puzzles they created, and a month calendar. */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':');
  const hr = Number(h);
  const ampm = hr >= 12 ? 'PM' : 'AM';
  const hh = hr % 12 === 0 ? 12 : hr % 12;
  return `${hh}:${m || '00'} ${ampm}`;
}

function initials(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

function dateKey(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function stat(n) {
  return Number(n) || 0;
}

const STATUS_TONE = {
  scheduled: 'gold',
  live: 'green',
  completed: 'green',
  cancelled: '',
  ended: '',
};

export default function AdminReport() {
  const { id } = useParams();
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [detailClassId, setDetailClassId] = useState(null);
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  useEffect(() => {
    api
      .get(`/admins/${id}/report`, { cache: false })
      .then((res) => setReport(res.data))
      .catch((err) => setError(err.response?.data?.message || 'Failed to load report'))
      .finally(() => {});
  }, [id]);

  const calendarCells = useMemo(() => {
    if (!report?.calendar) return [];
    const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
    const startWeekday = (first.getUTCDay() + 6) % 7; // Mon-first
    const dim = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= dim; d++) cells.push({ date: dateKey(cursor.y, cursor.m, d), day: d });
    return cells;
  }, [report, cursor]);

  if (error) {
    return (
      <PageHeader title="Admin report" icon="♖" subtitle="Activity for one coach.">
        <p className="chess-empty">{error}</p>
      </PageHeader>
    );
  }

  if (!report) {
    return (
      <PageHeader title="Admin report" icon="♖" subtitle="Activity for one coach.">
        <div className="py-20 text-center"><Spinner /></div>
      </PageHeader>
    );
  }

  const p = report.profile || {};
  const cn = report.classes || [];
  const past = report.past || [];
  const batches = report.batches || [];
  const games = report.games || {};

  const gotoPrev = () => {
    const ds = new Date(Date.UTC(cursor.y, cursor.m - 1, 1));
    setCursor({ y: ds.getUTCFullYear(), m: ds.getUTCMonth() });
  };
  const gotoNext = () => {
    const ds = new Date(Date.UTC(cursor.y, cursor.m + 1, 1));
    setCursor({ y: ds.getUTCFullYear(), m: ds.getUTCMonth() });
  };
  const gotoToday = () => {
    const d = new Date();
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  };

  const totalAttendance = cn.reduce((s, c) => s + stat(c.attendance?.total), 0);
  const presentAttendance = cn.reduce((s, c) => s + stat(c.attendance?.present), 0);

  const stats = [
    { label: 'Students', value: `${stat(report.students?.total)}`, sub: `${stat(report.students?.active)} active`, icon: '♙' },
    { label: 'Batches', value: `${batches.length}`, sub: 'coached groups', icon: '♘' },
    { label: 'Classes', value: `${cn.length}`, sub: 'on record', icon: '🏫' },
    { label: 'Attendance', value: totalAttendance ? `${Math.round((presentAttendance / totalAttendance) * 100)}%` : '—', sub: `${presentAttendance}/${totalAttendance} present`, icon: '✓' },
    { label: 'Online games', value: `${stat(games.total)}`, sub: `${stat(games.wins)}W · ${stat(games.draws)}D · ${stat(games.losses)}L`, icon: '♞' },
    { label: 'Reviews', value: `${stat(report.analyses)}`, sub: 'game analyses', icon: '♝' },
    { label: 'Assignments', value: `${stat(report.assignmentsCreated)}`, sub: 'created', icon: '📝' },
    { label: 'Puzzles', value: `${stat(report.puzzlesAssigned)}`, sub: 'assigned', icon: '🧩' },
  ];

  return (
    <PageHeader title={`${p.name || 'Admin'} report`} icon="♖" subtitle="Every activity this coach has on record, at a glance.">
      <Button to="/admin/admins" variant="secondary" size="sm" className="!py-1.5 !px-3 !text-xs inline-flex items-center gap-1.5 mb-4">
        ← Back to admins
      </Button>

      {/* Identity */}
      <div className="chess-card p-5 mb-6">
        <div className="flex flex-wrap items-center gap-5">
          {p.profile_image ? (
            <img src={p.profile_image} alt="" className="w-20 h-20 rounded-2xl object-cover ring-2 ring-gold-500/40 shrink-0" />
          ) : (
            <span className="grid place-items-center w-20 h-20 rounded-2xl bg-[var(--ink-900)] ring-2 ring-gold-500/40 text-3xl font-bold text-gold-400 shrink-0">
              {initials(p.name)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl font-bold text-ivory-100">{p.name}</h2>
            <p className="text-sm text-ivory-500 mt-0.5">{p.email}</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <Chip>Coach</Chip>
              <Chip tone="green">{stat(report.students?.active)} active students</Chip>
              <Chip>Joined {fmtDate(p.created_at)}</Chip>
            </div>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {stats.map((s) => (
          <div key={s.label} className="chess-card p-4">
            <span className="text-lg">{s.icon}</span>
            <p className="font-display text-xl font-bold text-ivory-100 mt-1">{s.value}</p>
            <p className="text-sm text-ivory-500">{s.label}</p>
            <p className="text-xs text-ivory-500/70 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* Batches */}
        <section className="chess-card p-5">
          <h3 className="font-display font-semibold text-ivory-100 mb-3">Batches coached ({batches.length})</h3>
          {batches.length === 0 ? (
            <p className="text-sm text-ivory-500">No batches assigned yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {batches.map((b) => (
                <li key={b.id} className="rounded-lg bg-[var(--ink-900)] ring-1 ring-white/10 p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ivory-300 truncate">{b.name}</p>
                    <p className="text-xs text-ivory-500 mt-0.5">Since {fmtDate(b.created_at)}</p>
                  </div>
                  <Chip>{stat(b.student_count)} students</Chip>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Calendar */}
        <section className="chess-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <h3 className="font-display font-semibold text-ivory-100">Class calendar</h3>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <Button onClick={gotoPrev} variant="secondary" size="sm" className="!px-2.5 !py-1 !text-xs">←</Button>
              <span className="text-sm font-semibold text-ivory-300 min-w-[7rem] sm:min-w-[9rem] text-center">
                {MONTHS[cursor.m]} {cursor.y}
              </span>
              <Button onClick={gotoNext} variant="secondary" size="sm" className="!px-2.5 !py-1 !text-xs">→</Button>
              <Button onClick={gotoToday} variant="secondary" size="sm" className="!px-2.5 !py-1 !text-xs">Today</Button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1.5 mb-1.5">
            {WEEKDAYS.map((d) => (
              <div key={d} className="text-center text-xs text-ivory-500 font-semibold py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-1 min-[560px]:grid-cols-7 gap-1.5">
            {calendarCells.map((cell, i) => {
              if (!cell) return <div key={`pad-${i}`} />;
              const dayClasses = (report.calendar || {})[cell.date] || [];
              return (
                <div
                  key={cell.date}
                  className={`rounded-lg border min-h-[3rem] min-[560px]:min-h-[3.4rem] p-1.5 flex flex-col ${
                    dayClasses.length > 0
                      ? 'border-gold-500/50 bg-gold-700/15'
                      : 'border-ivory-700/50 bg-black/[0.03]'
                  }`}
                >
                  <span className={`text-xs font-bold ${dayClasses.length > 0 ? 'text-gold-400' : 'text-ivory-500'}`}>
                    {cell.day}
                  </span>
                  {dayClasses.length > 0 && (
                    <span className="mt-auto text-[0.6rem] text-gold-400 leading-tight truncate">
                      {dayClasses.length} class{dayClasses.length > 1 ? 'es' : ''}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Past classes */}
        <section className="chess-card p-5 lg:col-span-2">
          <h3 className="font-display font-semibold text-ivory-100 mb-3">Class history ({past.length})</h3>
          {past.length === 0 ? (
            <p className="text-sm text-ivory-500">No past classes on record.</p>
          ) : (
            <div className="chess-table-wrap">
              <table className="chess-table">
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>Date</th>
                    <th>Batch</th>
                    <th>Attendance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {past.map((c) => (
                    <tr key={c.id} className="cursor-pointer hover:bg-white/[0.03]" onClick={() => setDetailClassId(c.id)}>
                      <td className="font-medium text-ivory-300">{c.topic || c.title}</td>
                      <td className="text-ivory-500">{fmtDate(c.classDate)} · {fmtTime(c.startTime)}</td>
                      <td className="text-ivory-500">{c.groupName || '—'}</td>
                      <td className="text-ivory-500">
                        {stat(c.attendance?.total) > 0
                          ? `${stat(c.attendance?.present)}/${stat(c.attendance?.total)}`
                          : '—'}
                      </td>
                      <td><Chip tone={STATUS_TONE[c.status] || ''}>{c.status}</Chip></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      {detailClassId && (
        <ClassDetailModal classId={detailClassId} onClose={() => setDetailClassId(null)} />
      )}
    </PageHeader>
  );
}