import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import { PageHeader, Stat, Spinner } from '../components/ui';
import ClassDetailModal from '../components/ClassDetailModal';
import Pagination, { PAGE_SIZE } from '../components/Pagination';
import { usePagination } from '../hooks/usePagination';
import { useAuth } from '../context/AuthContext';
import { formatTime12 } from '../utils/time';
import Button from '../components/Button';
import OfflineAttendance from './OfflineAttendance';

const STATUS_META = {
  present: { cls: 'border-emerald-400/50 bg-emerald-500/15 text-emerald-700', label: '✓ Present' },
  late: { cls: 'border-amber-400/50 bg-amber-500/15 text-amber-600', label: '◷ Late' },
  absent: { cls: 'border-red-400/50 bg-red-500/15 text-red-600', label: '✕ Absent' },
};
/* Present → Late → Absent → cleared. The fourth step is what lets a coach undo
   a wrong mark; the DELETE behind an empty status is also what makes the record
   vanish from the student's page. */
const CYCLE = ['present', 'late', 'absent', ''];

const TYPE_TABS = [
  { key: 'all', label: 'All' },
  { key: 'online', label: 'Online' },
  { key: 'offline', label: 'Offline' },
];

export default function Attendance() {
  const { user } = useAuth();

  /* The student's list and the admin day register share this route only because
     both are "attendance"; the class-cell register stays inside Manage Classes. */
  if (user?.role === 'student') return <StudentAttendance />;
  return <OfflineAttendance />;
}

/* ────────────────────── student: my attendance ──────────────────────
   Online class attendance and offline marks in one date-ordered list. Paging,
   the type chips and the month all go to the server as query params, so the
   summary cards and the pager always describe the same slice of records. */
function StudentAttendance() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState('all');
  const [month, setMonth] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/attendance/me', { params: { page, limit: PAGE_SIZE, type, month } });
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load attendance');
    } finally {
      setLoading(false);
    }
  }, [page, type, month]);

  useEffect(() => { load(); }, [load]);

  const summary = data?.summary;
  const records = data?.records || [];

  return (
    <PageHeader
      title="My Attendance"
      icon="📋"
      subtitle="Every class and offline mark, newest first."
    >
      {error && (
        <div className="chess-card mb-4">
          <p className="chess-error">{error}</p>
          <Button onClick={load} variant="secondary" size="sm" className="mt-3">Retry</Button>
        </div>
      )}

      {/* ── summary for the selected range ── */}
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-ivory-300">
          {month ? monthLabel(month) : 'All time'}
        </h2>
        {summary && summary.graded > 0 && (
          <span className="text-[0.7rem] text-ivory-500">
            {summary.present}/{summary.graded} marked present
          </span>
        )}
      </div>

      {loading && !data ? (
        <div className="tr-skeleton-stats mb-6">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="tr-skeleton-stat" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
          <Stat label="Total" value={summary?.total ?? 0} icon="📋" />
          <Stat label="Present" value={summary?.present ?? 0} icon="✓" />
          <Stat label="Absent" value={summary?.absent ?? 0} icon="✕" />
          <Stat label="Late" value={summary?.late ?? 0} icon="◷" />
          <Stat label="Attendance Rate" value={`${summary?.rate ?? 0}%`} icon="♟" />
        </div>
      )}

      {/* ── type chips + month picker ── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {TYPE_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => { setType(t.key); setPage(1); }}
            aria-pressed={type === t.key}
            className={`chess-chip ${type === t.key ? 'chess-chip-gold' : ''}`}
          >
            {t.label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 shrink-0">
          <span className="text-xs text-ivory-500">Month</span>
          <input
            type="month"
            value={month}
            onChange={(e) => { setMonth(e.target.value); setPage(1); }}
            className="chess-input !py-1.5 !text-xs"
            aria-label="Filter attendance by month"
          />
          {month && (
            <button
              type="button"
              onClick={() => { setMonth(''); setPage(1); }}
              className="text-xs text-ivory-500 hover:text-gold-400 whitespace-nowrap"
            >
              All months
            </button>
          )}
        </label>
      </div>

      {loading ? (
        <div className="tr-skeleton tr-skeleton-table">
          {[0, 1, 2].map((i) => <div key={i} className="tr-skeleton-row" />)}
        </div>
      ) : error && !data ? null : records.length === 0 ? (
        <div className="chess-card text-center py-14">
          <span className="block text-5xl mb-3 text-gold-500/40">📋</span>
          <p className="chess-empty">No attendance records yet.</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {records.map((r) => <AttendanceRecord key={recordKey(r)} r={r} />)}
          </div>
          <Pagination
            currentPage={data.page}
            totalPages={data.totalPages}
            totalItems={data.total}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            itemLabel="records"
          />
        </>
      )}
    </PageHeader>
  );
}

/* A record can be an attendance row or an unmarked class; both are keyed by
   class when they have one, and by date + status when they do not. */
function recordKey(r) {
  return r.classId != null ? `c${r.classId}` : `${r.date}-${r.type}-${r.status}`;
}

/** "2026-10" → "October 2026", without letting Date parse it as UTC. */
function monthLabel(month) {
  const [y, m] = String(month).split('-').map(Number);
  const NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${NAMES[m - 1] || m} ${y}`;
}

function AttendanceRecord({ r }) {
  const meta = STATUS_META[r.status];
  const isOffline = r.type === 'offline';
  const isSuper = r.markedByRole === 'superadmin' || r.markedByRole === 'super_admin';
  /* Rows written before the marker columns existed have no name stored; the
     brief is explicit that they still load and read as "Unknown". */
  const markerName = r.markedByName || 'Unknown';

  return (
    <div className="chess-card">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ivory-100">{r.dateLabel}</span>
            {meta ? (
              <span className={`text-[0.65rem] px-2 py-0.5 rounded-full border ${meta.cls}`}>
                {meta.label}
              </span>
            ) : (
              <span className="text-[0.65rem] px-2 py-0.5 rounded-full border border-ivory-700/50 text-ivory-500">
                Not marked
              </span>
            )}
            {isOffline && (
              <span className="text-[0.65rem] px-2 py-0.5 rounded-full border border-blue-500/40 bg-blue-500/10 text-blue-600">
                Offline
              </span>
            )}
          </p>

          {r.classTitle && (
            <p className="text-sm text-ivory-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span className="text-gold-400">♘</span>
              <span className="break-words">{r.classTitle}</span>
              {r.topic && <span>— {r.topic}</span>}
              {r.startTime && (
                <span>· {formatTime12(r.startTime, r.startTime)}</span>
              )}
              {r.coachName && <span>· Coach: {r.coachName}</span>}
            </p>
          )}

          {isOffline && (
            <p className="text-xs text-ivory-500 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="break-words">Marked by: {markerName}</span>
              {isSuper && (
                <span className="text-[0.6rem] px-1.5 py-0.5 rounded-full bg-blue-600 text-white font-semibold whitespace-nowrap">
                  Super Admin
                </span>
              )}
              {r.markedAt && (
                <span className="text-[0.65rem] text-ivory-500/80">{r.markedAt}</span>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* Admin attendance register: students × classes matrix. `filterClassId`
   (optional) pre-selects a class when arriving from the Classes tab. */
export function AttendancePanel({ filterClassId = null }) {
  const [records, setRecords] = useState(null); // { classes, students, statuses }
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [cellBusy, setCellBusy] = useState(null); // "studentId:classId"
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [detailClassId, setDetailClassId] = useState(null);
  const tableTopRef = useRef(null);

  useEffect(() => {
    setRecordsLoading(true);
    setMsg('');
    api
      .get('/classes/attendance/records')
      .then((res) => {
        setRecords(res.data || { classes: [], students: [], statuses: {} });
        setFilter((prev) => (res.data && res.data.classes.some((c) => String(c.id) === String(prev)) ? prev : ''));
      })
      .catch((e) => setError(e.response?.data?.message || 'Failed to load attendance records'))
      .finally(() => setRecordsLoading(false));
  }, []);

  /* Jump to a specific class when the user clicks "Attendance" on a class card. */
  useEffect(() => {
    if (filterClassId) setFilter(String(filterClassId));
  }, [filterClassId]);

  /* `?? ''` matters: an unmarked cell is undefined, and CYCLE's last step is the
     empty string, so the cycle must be looked up by index rather than by
     truthiness — `|| 'present'` would make clearing impossible. */
  const cycleStatus = (status) => {
    const i = CYCLE.indexOf(status ?? '');
    return CYCLE[(i + 1 + CYCLE.length) % CYCLE.length];
  };

  async function mark(studentId, classId) {
    const cur = records.statuses[studentId]?.[classId];
    const next = cycleStatus(cur);
    setCellBusy(`${studentId}:${classId}`);
    setMsg('');
    try {
      await api.post(`/classes/${classId}/attendance`, { studentId, status: next });
      setRecords((prev) => ({
        ...prev,
        statuses: {
          ...prev.statuses,
          [studentId]: { ...(prev.statuses[studentId] || {}), [classId]: next },
        },
      }));
    } catch {
      setMsg('Failed to save attendance.');
    } finally {
      setCellBusy(null);
    }
  }

  const overall = useMemo(() => {
    if (!records) return { students: 0, classes: 0, eligible: 0, marked: 0, attended: 0 };
    let eligible = 0, marked = 0, attended = 0;
    for (const cls of records.classes) {
      const el = new Set(cls.eligible);
      for (const s of records.students) {
        if (!el.has(s.id)) continue;
        eligible += 1;
        const v = records.statuses[s.id]?.[cls.id];
        if (v) marked += 1;
        if (v === 'present' || v === 'late') attended += 1;
      }
    }
    return {
      students: records.students.length,
      classes: records.classes.length,
      eligible,
      marked,
      attended,
      coverage: eligible ? Math.round((marked / eligible) * 100) : 0,
      rate: marked ? Math.round((attended / marked) * 100) : 0,
    };
  }, [records]);

  function classCounts(cls) {
    const el = new Set(cls.eligible);
    let p = 0, l = 0, a = 0;
    for (const s of records.students) {
      if (!el.has(s.id)) continue;
      const v = records.statuses[s.id]?.[cls.id];
      if (v === 'present') p += 1;
      else if (v === 'late') l += 1;
      else if (v === 'absent') a += 1;
    }
    return { p, l, a, total: el.size };
  }

  function studentTotals(sid) {
    let p = 0, l = 0, a = 0, expect = 0;
    for (const cls of records.classes) {
      if (!cls.eligible.includes(sid)) continue;
      expect += 1;
      const v = records.statuses[sid]?.[cls.id];
      if (v === 'present') p += 1;
      else if (v === 'late') l += 1;
      else if (v === 'absent') a += 1;
    }
    const attended = p + l;
    const pct = expect ? Math.round((attended / expect) * 100) : 0;
    return { p, l, a, expect, pct };
  }

  const visibleClasses = records && filter
    ? records.classes.filter((c) => String(c.id) === String(filter))
    : records
      ? records.classes
      : [];

  /* The register grows one column per class, so the matrix is paged in
     10-column slices. The student rows and their totals still cover every
     class, so a page change never changes any attendance figure. This panel
     is embedded next to the Classes list, which owns ?page=, so its pager is
     local. */
  const {
    currentItems: pagedClasses,
    currentPage: safeClassPage,
    totalPages: classTotalPages,
    setPage: goToClassPage,
  } = usePagination(visibleClasses, PAGE_SIZE, {
    syncUrl: false,
    resetKeys: [filter],
    scrollRef: tableTopRef,
  });

  return (
    <>
      {error && <div className="chess-card mb-4"><p className="chess-error">{error}</p></div>}
      {msg && <div className="chess-card mb-4"><p className="chess-error">{msg}</p></div>}

      {recordsLoading || !records ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <Stat label="Students" value={overall.students} icon="👥" />
            <Stat label="Classes" value={overall.classes} icon="♘" />
            <Stat label="Marked" value={`${overall.marked}/${overall.eligible}`} icon="📋" />
            <Stat label="Attendance" value={`${overall.rate}%`} icon="✓" />
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <label className="text-sm text-ivory-300 flex items-center gap-2 flex-wrap">
              <span className="text-gold-400">Filter class</span>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="chess-input !py-1.5 max-w-md"
              >
                <option value="">All classes</option>
                {records.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} — {c.class_date} at {formatTime12(c.start_time, c.start_time)}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              onClick={() => api.get('/classes/attendance/records').then((res) => setRecords(res.data)).catch(() => setMsg('Failed to reload.'))}
              variant="secondary" size="sm" className="!py-1.5 text-xs ml-auto"
            >
              ↺ Reload
            </Button>
          </div>

          {records.students.length === 0 ? (
            <div className="chess-card text-center py-14">
              <span className="block text-5xl mb-3 text-gold-500/40">👥</span>
              <p className="chess-empty">No students yet — add students in the Students section.</p>
            </div>
          ) : visibleClasses.length === 0 ? (
            <div className="chess-card text-center py-14">
              <span className="block text-5xl mb-3 text-gold-500/40">♘</span>
              <p className="chess-empty">No classes scheduled yet.</p>
            </div>
          ) : (
            <>
            <div ref={tableTopRef} className="chess-card overflow-x-auto">
              <table className="att-tbl w-full">
                <thead>
                  <tr>
                    <th className="att-cell att-sticky">Student</th>
                    {pagedClasses.map((cls) => {
                      const cc = classCounts(cls);
                      return (
                        <th key={cls.id} className="att-cell text-center min-w-[7.5rem] cursor-pointer hover:bg-gold-500/10" onClick={() => setDetailClassId(cls.id)} title={`View ${cls.title} details`}>
                          <p className="font-medium text-ivory-100 whitespace-nowrap">{cls.title}</p>
                          <p className="text-[0.62rem] text-ivory-500 whitespace-nowrap">
                            {String(cls.class_date).slice(0, 10)} · {formatTime12(cls.start_time, cls.start_time)}
                          </p>
                          <p className="text-[0.62rem] text-ivory-500 mt-0.5 whitespace-nowrap">
                            <span className="text-emerald-600">✓{cc.p}</span> ·{' '}
                            <span className="text-amber-600">◷{cc.l}</span> ·{' '}
                            <span className="text-red-600">✕{cc.a}</span>{' '}
                            <span className="text-ivory-500">/ {cc.total}</span>
                          </p>
                        </th>
                      );
                    })}
                    <th className="att-cell att-totals">Totals</th>
                  </tr>
                </thead>
                <tbody>
                  {records.students.map((s) => {
                    const tot = studentTotals(s.id);
                    return (
                      <tr key={s.id}>
                        <td className="att-cell att-sticky">
                          <p className="text-sm font-medium text-ivory-100 whitespace-nowrap">{s.name}</p>
                          {s.group_name && <p className="text-[0.62rem] text-ivory-500">{s.group_name}</p>}
                        </td>
                        {pagedClasses.map((cls) => {
                          const eligible = cls.eligible.includes(s.id);
                          const status = eligible ? records.statuses[s.id]?.[cls.id] : null;
                          const busy = cellBusy === `${s.id}:${cls.id}`;
                          const meta = status ? STATUS_META[status] : null;
                          if (!eligible) {
                            return (
                              <td key={cls.id} className="att-cell text-center">
                                <span className="text-ivory-500/40">—</span>
                              </td>
                            );
                          }
                          return (
                            <td key={cls.id} className="att-cell text-center">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => mark(s.id, cls.id)}
                                title={`${s.name} — ${cls.title}: Present → Late → Absent → cleared`}
                                className={`att-chip ${meta ? meta.cls : 'border-ivory-700/60 bg-black/[0.03] text-ivory-500 hover:border-ivory-50/40'} ${busy ? 'opacity-50' : ''}`}
                              >
                                {busy ? '…' : meta ? meta.label : '·'}
                              </button>
                            </td>
                          );
                        })}
                        <td className="att-cell att-totals whitespace-nowrap text-right">
                          <span className="text-emerald-600">✓{tot.p}</span>
                          <span className="mx-1 text-amber-600">◷{tot.l}</span>
                          <span className="text-red-600">✕{tot.a}</span>
                          <span className="ml-2 text-ivory-500 text-xs">{tot.expect ? `${tot.pct}%` : '—'}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={safeClassPage}
              totalPages={classTotalPages}
              totalItems={visibleClasses.length}
              onPageChange={goToClassPage}
              itemLabel="classes"
            />
            </>
          )}
        </>
      )}
      {detailClassId && (
        <ClassDetailModal
          classId={detailClassId}
          /* The column header carries the class' own row id; compare as
             strings so a re-render can never miss the record it names. */
          initial={records?.classes?.find((c) => String(c.id) === String(detailClassId))}
          onClose={() => setDetailClassId(null)}
        />
      )}
    </>
  );
}