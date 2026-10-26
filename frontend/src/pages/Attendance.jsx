import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import { PageHeader, Chip, Stat, Bar, Spinner } from '../components/ui';
import ClassDetailModal from '../components/ClassDetailModal';
import Pagination, { PAGE_SIZE } from '../components/Pagination';
import { usePagination } from '../hooks/usePagination';
import { useAuth } from '../context/AuthContext';
import { formatTime12 } from '../utils/time';
import Button from '../components/Button';

const ATT_STATUS = [
  { id: 'present', label: 'Present', cls: 'border-emerald-400/50 bg-emerald-500/15 text-emerald-700' },
  { id: 'late', label: 'Late', cls: 'border-amber-400/50 bg-amber-500/15 text-amber-600' },
  { id: 'absent', label: 'Absent', cls: 'border-red-400/50 bg-red-500/15 text-red-600' },
];
const STATUS_META = {
  present: { cls: 'border-emerald-400/50 bg-emerald-500/15 text-emerald-700', label: '✓ Present' },
  late: { cls: 'border-amber-400/50 bg-amber-500/15 text-amber-600', label: '◷ Late' },
  absent: { cls: 'border-red-400/50 bg-red-500/15 text-red-600', label: '✕ Absent' },
};
const CYCLE = ['present', 'late', 'absent'];

export default function Attendance() {
  const { user } = useAuth();
  const role = user?.role;

  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const listTopRef = useRef(null);

  /* The register has its own column pager; only the student's class cards use
     ?page=. */
  const pager = usePagination(role === 'student' ? classes : [], PAGE_SIZE, {
    syncUrl: role === 'student',
    scrollRef: listTopRef,
  });

  /* student summary */
  const summary = useMemo(() => {
    const counts = { present: 0, late: 0, absent: 0 };
    let marked = 0;
    for (const c of classes) {
      if (c.my_status && counts[c.my_status] !== undefined) {
        counts[c.my_status] += 1;
        marked += 1;
      }
    }
    const pct = marked ? Math.round((counts.present / marked) * 100) : 0;
    return { ...counts, marked, total: classes.length, pct };
  }, [classes]);

  useEffect(() => {
    setError('');
    if (role !== 'student') {
      setLoading(false);
      return;
    }
    api
      .get('/classes/online', { cache: false })
      .then((res) => setClasses(Array.isArray(res.data) ? res.data : []))
      .catch((e) => setError(e.response?.data?.message || 'Failed to load classes'))
      .finally(() => setLoading(false));
  }, [role]);

  if (loading) return <Spinner />;

  /* ── Student view: their own attendance ── */
  if (role === 'student') {
    return (
      <PageHeader title="My Attendance" icon="📋" subtitle="Your presence across online classes.">
        {error && <div className="chess-card mb-4"><p className="chess-error">{error}</p></div>}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <Stat label="Classes" value={summary.total} icon="📚" />
          <Stat label="Present" value={summary.present} icon="✓" />
          <Stat label="Late" value={summary.late} icon="◷" />
          <Stat label="Absent" value={summary.absent} icon="✕" />
        </div>

        {summary.marked > 0 && (
          <div className="chess-card mb-6">
            <div className="flex items-center justify-between gap-4 mb-2">
              <p className="text-sm text-ivory-300 font-medium">
                Attendance so far — <span className="text-gold-400">{summary.pct}% present</span>
              </p>
              <span className="text-[0.7rem] text-ivory-500">
                {summary.present}/{summary.marked} marked
              </span>
            </div>
            <Bar pct={summary.pct} />
          </div>
        )}

        <div ref={listTopRef} className="space-y-3">
          {classes.length === 0 && (
            <div className="chess-card text-center py-14">
              <span className="block text-5xl mb-3 text-gold-500/40">📋</span>
              <p className="chess-empty">No classes scheduled for you yet.</p>
            </div>
          )}
          {pager.currentItems.map((c) => {
            const meta = STATUS_META[c.my_status];
            return (
              <div key={c.id} className="chess-card flex justify-between items-center gap-4">
                <div className="min-w-0">
                  <p className="font-medium text-ivory-100 flex items-center gap-2 flex-wrap">
                    <span className="text-gold-400">♘</span>{c.title}
                    {c.topic && <span className="text-ivory-500 text-sm">— {c.topic}</span>}
                  </p>
                  <p className="text-sm text-ivory-500 mt-1 flex items-center gap-1.5 flex-wrap">
                    <span className="text-gold-400">⚑</span>{c.class_date} at {formatTime12(c.start_time, c.start_time)}
                    {c.coach_name && <><span className="text-ivory-500">· Coach:</span> {c.coach_name}</>}
                  </p>
                </div>
                {meta ? (
                  <span className={`shrink-0 text-[0.7rem] px-2.5 py-1 rounded-full border ${meta.cls}`}>
                    {meta.label}
                  </span>
                ) : (
                  <span className="shrink-0 text-[0.7rem] px-2.5 py-1 rounded-full border border-ivory-700/50 bg-black/[0.03] text-ivory-500">
                    Not marked
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <Pagination
          currentPage={pager.currentPage}
          totalPages={pager.totalPages}
          totalItems={pager.totalItems}
          onPageChange={pager.setPage}
          itemLabel="classes"
        />
      </PageHeader>
    );
  }

  /* ── Admin view: attendance register (embedded panel for the merged
        Classes & Attendance page, or wrapped in Page by this component) ── */
  return (
    <PageHeader title="Attendance Register" icon="📋" subtitle="Every student × every class. Click a cell to cycle Present → Late → Absent.">
      <AttendancePanel />
    </PageHeader>
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

  const cycleStatus = (status) => CYCLE[(CYCLE.indexOf(status) + 1) % CYCLE.length] || 'present';

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
                                title={`${s.name} — Cycle status for ${cls.title}`}
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