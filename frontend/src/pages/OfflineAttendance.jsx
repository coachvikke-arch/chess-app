import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { PageHeader } from '../components/ui';
import Button from '../components/Button';
import Pagination, { PAGE_SIZE } from '../components/Pagination';
import StudentAvatar from '../components/StudentAvatar';
import { usePagination } from '../hooks/usePagination';
import './offline-attendance.css';

const STATUS_OPTIONS = [
  { value: 'present', label: 'Present', short: 'P' },
  { value: 'absent', label: 'Absent', short: 'A' },
  { value: 'late', label: 'Late', short: 'L' },
];

function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function shiftDate(key, days) {
  const value = new Date(`${key}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function datesBetween(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const first = Date.parse(`${start}T00:00:00Z`);
  const last = Date.parse(`${end}T00:00:00Z`);
  const count = Math.round((last - first) / 86400000) + 1;
  if (!Number.isFinite(count) || count < 1 || count > 31) return null;
  return Array.from({ length: count }, (_, index) => shiftDate(start, index));
}

function fullDateLabel(key) {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function shortDateLabel(key) {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function StudentIdentity({ student, showCoach }) {
  let avatar = (
    <span className="oa-letter-avatar" aria-hidden="true">
      {(student.name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
  if (student.avatarConfig) {
    avatar = <StudentAvatar config={student.avatarConfig} seed={`student_${student.id}`} size={36} />;
  }
  if (student.profileImage) {
    avatar = <img className="oa-photo-avatar" src={student.profileImage} alt="" />;
  }

  return (
    <div className="oa-student">
      <span className="oa-avatar">{avatar}</span>
      <span className="oa-student-copy">
        <span className="oa-student-name">{student.name}</span>
        <span className="oa-student-meta">
          {student.groupName || 'No batch'}
          {showCoach && student.coachName ? ` · ${student.coachName}` : ''}
        </span>
      </span>
    </div>
  );
}

function LoadingRows({ count = 5 }) {
  return (
    <div className="oa-card oa-skeleton-card" role="status" aria-label="Loading attendance">
      {Array.from({ length: count }, (_, index) => <div className="oa-skeleton-row" key={index} />)}
    </div>
  );
}

export default function OfflineAttendance() {
  const { user } = useAuth();
  const isSuper = user?.role === 'superadmin';
  const today = useRef(dateKey()).current;
  const listTopRef = useRef(null);

  const [tab, setTab] = useState('mark');
  const [date, setDate] = useState(today);
  const [students, setStudents] = useState([]);
  const [savedStatuses, setSavedStatuses] = useState({});
  const [pending, setPending] = useState({});
  const [markLoading, setMarkLoading] = useState(true);
  const [markError, setMarkError] = useState('');
  const [markReload, setMarkReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const [startDate, setStartDate] = useState(shiftDate(today, -6));
  const [endDate, setEndDate] = useState(today);
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const [overviewReload, setOverviewReload] = useState(0);

  const [query, setQuery] = useState('');
  const [batch, setBatch] = useState('');
  const [coach, setCoach] = useState('');

  const pendingCount = Object.keys(pending).length;
  const overviewDates = useMemo(() => datesBetween(startDate, endDate), [startDate, endDate]);

  useEffect(() => {
    let active = true;
    setMarkLoading(true);
    setMarkError('');
    api.get('/attendance/offline', { params: { date }, cache: false })
      .then((res) => {
        if (!active) return;
        const rows = res.data?.students || [];
        setStudents(rows);
        setSavedStatuses(Object.fromEntries(rows.map((s) => [s.id, s.status || ''])));
        setPending({});
      })
      .catch((err) => {
        if (active) setMarkError(err.response?.data?.message || 'Failed to load offline attendance');
      })
      .finally(() => {
        if (active) setMarkLoading(false);
      });
    return () => { active = false; };
  }, [date, markReload]);

  useEffect(() => {
    if (tab !== 'overview') return undefined;
    if (!overviewDates) {
      setOverview(null);
      setOverviewError('');
      setOverviewLoading(false);
      return undefined;
    }

    let active = true;
    setOverviewLoading(true);
    setOverviewError('');
    api.get('/attendance/offline/overview', {
      params: { startDate, endDate },
      cache: false,
    })
      .then((res) => { if (active) setOverview(res.data); })
      .catch((err) => {
        if (active) setOverviewError(err.response?.data?.message || 'Failed to load attendance overview');
      })
      .finally(() => { if (active) setOverviewLoading(false); });
    return () => { active = false; };
  }, [tab, startDate, endDate, overviewDates, overviewReload]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!pendingCount) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pendingCount]);

  const filterRoster = students.length ? students : overview?.students || [];
  const batches = useMemo(() => {
    const values = new Map();
    for (const student of filterRoster) {
      if (student.groupId != null) values.set(String(student.groupId), student.groupName || `Batch ${student.groupId}`);
    }
    return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [filterRoster]);

  const coaches = useMemo(() => {
    const values = new Map();
    for (const student of filterRoster) {
      if (student.coachId != null) values.set(String(student.coachId), student.coachName || `Coach ${student.coachId}`);
      for (const item of student.coaches || []) values.set(String(item.id), item.name);
    }
    return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [filterRoster]);

  const sourceStudents = tab === 'mark' ? students : overview?.students || [];
  const filteredStudents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sourceStudents.filter((student) => {
      if (needle && !`${student.name || ''} ${student.email || ''}`.toLowerCase().includes(needle)) return false;
      if (batch && String(student.groupId || '') !== batch) return false;
      if (coach) {
        const primary = String(student.coachId || '') === coach;
        const additional = (student.coaches || []).some((item) => String(item.id) === coach);
        if (!primary && !additional) return false;
      }
      return true;
    });
  }, [sourceStudents, query, batch, coach]);

  const {
    currentItems: pageStudents,
    currentPage,
    totalPages,
    setPage,
  } = usePagination(filteredStudents, PAGE_SIZE, {
    syncUrl: false,
    resetKeys: [tab, query, batch, coach, date, startDate, endDate],
    scrollRef: listTopRef,
  });

  const recordsByStudent = useMemo(() => {
    const map = new Map();
    for (const record of overview?.records || []) {
      if (!map.has(record.studentId)) map.set(record.studentId, {});
      map.get(record.studentId)[record.date] = record.status;
    }
    if (overviewDates?.includes(date)) {
      for (const [studentId, status] of Object.entries(pending)) {
        const id = Number(studentId);
        if (!map.has(id)) map.set(id, {});
        map.get(id)[date] = status;
      }
    }
    return map;
  }, [overview, overviewDates, date, pending]);

  const matrixRows = useMemo(() => filteredStudents.map((student) => {
    const records = recordsByStudent.get(student.id) || {};
    const totals = { present: 0, absent: 0, late: 0 };
    for (const day of overviewDates || []) {
      const status = records[day];
      if (totals[status] != null) totals[status] += 1;
    }
    const marked = totals.present + totals.absent + totals.late;
    return { student, totals, marked, rate: marked ? Math.round((totals.present / marked) * 100) : 0 };
  }), [filteredStudents, recordsByStudent, overviewDates]);

  const overviewTotals = useMemo(() => matrixRows.reduce((sum, row) => ({
    present: sum.present + row.totals.present,
    absent: sum.absent + row.totals.absent,
    late: sum.late + row.totals.late,
    marked: sum.marked + row.marked,
  }), { present: 0, absent: 0, late: 0, marked: 0 }), [matrixRows]);

  function currentStatus(studentId) {
    return hasOwn(pending, studentId) ? pending[studentId] : savedStatuses[studentId] || '';
  }

  function updatePending(studentId, nextStatus, draft) {
    if (nextStatus === (savedStatuses[studentId] || '')) delete draft[studentId];
    else draft[studentId] = nextStatus;
  }

  function toggleStatus(studentId, status) {
    const nextStatus = currentStatus(studentId) === status ? '' : status;
    setPending((previous) => {
      const draft = { ...previous };
      updatePending(studentId, nextStatus, draft);
      return draft;
    });
  }

  function markAll(status) {
    setPending((previous) => {
      const draft = { ...previous };
      for (const student of filteredStudents) updatePending(student.id, status, draft);
      return draft;
    });
  }

  function changeDate(nextDate) {
    if (!nextDate || nextDate === date) return;
    if (pendingCount && !window.confirm('Discard unsaved changes?')) return;
    setPending({});
    setDate(nextDate);
  }

  async function saveAttendance() {
    if (!pendingCount || saving) return;
    setSaving(true);
    setMarkError('');
    const changes = { ...pending };
    try {
      const res = await api.post('/attendance/offline', {
        date,
        records: Object.entries(changes).map(([studentId, status]) => ({ studentId: Number(studentId), status })),
      });
      setSavedStatuses((previous) => {
        const next = { ...previous };
        for (const [studentId, status] of Object.entries(changes)) next[studentId] = status;
        return next;
      });
      setStudents((previous) => previous.map((student) => {
        if (!hasOwn(changes, student.id)) return student;
        return {
          ...student,
          status: changes[student.id],
          markedByName: changes[student.id] ? user?.name : null,
          markedByRole: changes[student.id] ? user?.role : null,
        };
      }));
      setPending({});
      const savedCount = res.data.saved || 0;
      const clearedCount = res.data.cleared || 0;
      setToast(`Saved ${savedCount} and cleared ${clearedCount} ${savedCount + clearedCount === 1 ? 'record' : 'records'} for ${fullDateLabel(date)}`);
    } catch (err) {
      setMarkError(err.response?.data?.message || 'Failed to save offline attendance');
    } finally {
      setSaving(false);
    }
  }

  function filterFields(extra, prefix) {
    return (
      <div className="oa-filters">
        <div className="oa-field">
          <label htmlFor={`${prefix}-search`}>Search Student</label>
          <input
            id={`${prefix}-search`}
            className="oa-input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or email"
            autoComplete="off"
          />
        </div>
        <div className="oa-field">
          <label htmlFor={`${prefix}-batch`}>Filter by Batch</label>
          <select id={`${prefix}-batch`} className="oa-input" value={batch} onChange={(event) => setBatch(event.target.value)}>
            <option value="">All Students</option>
            {batches.map(([id, name]) => <option value={id} key={id}>{name}</option>)}
          </select>
        </div>
        {isSuper && (
          <div className="oa-field">
            <label htmlFor={`${prefix}-coach`}>Filter by Coach/Admin</label>
            <select id={`${prefix}-coach`} className="oa-input" value={coach} onChange={(event) => setCoach(event.target.value)}>
              <option value="">All Coaches</option>
              {coaches.map(([id, name]) => <option value={id} key={id}>{name}</option>)}
            </select>
          </div>
        )}
        {extra}
      </div>
    );
  }

  const pageMatrixRows = matrixRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <PageHeader
      wide
      className="oa-page"
      icon="📋"
      title={tab === 'mark' ? 'Offline Attendance Management' : 'Attendance Overview'}
      subtitle={tab === 'mark'
        ? 'Mark and track attendance for offline classes'
        : 'View and analyze student attendance across date ranges (max 31 days)'}
    >
      <div className="oa-wrap">
        <div className="oa-tabs" role="tablist" aria-label="Offline attendance views">
          <button type="button" role="tab" aria-selected={tab === 'mark'} className={`oa-tab ${tab === 'mark' ? 'is-active' : ''}`} onClick={() => setTab('mark')}>
            Mark Attendance
          </button>
          <button type="button" role="tab" aria-selected={tab === 'overview'} className={`oa-tab ${tab === 'overview' ? 'is-active' : ''}`} onClick={() => setTab('overview')}>
            Overview
          </button>
        </div>

        {tab === 'mark' ? (
          <>
            <section className="oa-card">
              {filterFields(
                <div className="oa-field">
                  <label htmlFor="oa-mark-date">Date</label>
                  <input id="oa-mark-date" className="oa-input" type="date" value={date} disabled={saving} onChange={(event) => changeDate(event.target.value)} />
                </div>,
                'oa-mark'
              )}
              <div className="oa-quick-actions">
                <Button type="button" variant="secondary" size="sm" className="oa-bulk oa-bulk--present" disabled={markLoading || saving || !filteredStudents.length} onClick={() => markAll('present')}>
                  Mark All Present
                </Button>
                <Button type="button" variant="secondary" size="sm" className="oa-bulk oa-bulk--absent" disabled={markLoading || saving || !filteredStudents.length} onClick={() => markAll('absent')}>
                  Mark All Absent
                </Button>
                <Button type="button" variant="secondary" size="sm" disabled={saving || !pendingCount} onClick={() => setPending({})}>
                  Clear Changes
                </Button>
                <span className="oa-visible-count">{filteredStudents.length} students visible</span>
              </div>
            </section>

            {markError && (
              <div className="oa-card oa-error-card" role="alert">
                <p>{markError}</p>
                <Button type="button" variant="secondary" size="sm" onClick={() => setMarkReload((value) => value + 1)}>Retry</Button>
              </div>
            )}

            {markLoading ? <LoadingRows /> : (
              <>
                <section className="oa-card oa-list-card" ref={listTopRef}>
                  {pageStudents.length ? pageStudents.map((student) => {
                    const status = currentStatus(student.id);
                    return (
                      <div className="oa-mark-row" key={student.id}>
                        <StudentIdentity student={student} showCoach={isSuper} />
                        <div className="oa-status-actions" aria-label={`Attendance for ${student.name}`}>
                          {STATUS_OPTIONS.map((option) => (
                            <button
                              type="button"
                              key={option.value}
                              className={`oa-status oa-status--${option.value} ${status === option.value ? 'is-active' : ''}`}
                              aria-pressed={status === option.value}
                              disabled={saving}
                              title={status === option.value ? `Clear ${option.label}` : `Mark ${option.label}`}
                              onClick={() => toggleStatus(student.id, option.value)}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  }) : <div className="oa-empty">No students found</div>}
                  <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    totalItems={filteredStudents.length}
                    pageSize={PAGE_SIZE}
                    onPageChange={setPage}
                    itemLabel="students"
                  />
                </section>

                <section className="oa-card oa-save-bar">
                  <span className="oa-save-state">
                    <span className={`oa-save-dot ${pendingCount ? 'is-pending' : ''}`} aria-hidden="true" />
                    {pendingCount ? `${pendingCount} unsaved ${pendingCount === 1 ? 'change' : 'changes'}` : 'All Saved · No pending changes to save'}
                  </span>
                  <Button type="button" loading={saving} disabled={!pendingCount} onClick={saveAttendance}>
                    Save Attendance
                  </Button>
                </section>
              </>
            )}
          </>
        ) : (
          <>
            {!overviewLoading && !overviewError && overviewDates && (
              <div className="oa-stats">
                {[
                  ['Students', filteredStudents.length],
                  ['Days', overviewDates.length],
                  ['Rate', `${overviewTotals.marked ? Math.round((overviewTotals.present / overviewTotals.marked) * 100) : 0}%`],
                  ['Present', overviewTotals.present],
                  ['Absent', overviewTotals.absent],
                  ['Late', overviewTotals.late],
                ].map(([label, value]) => (
                  <div className="oa-stat" key={label}><span>{label}</span><strong>{value}</strong></div>
                ))}
              </div>
            )}

            <section className="oa-card">
              {filterFields(
                <>
                  <div className="oa-field">
                    <label htmlFor="oa-overview-start">Start date</label>
                    <input id="oa-overview-start" className="oa-input" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                  </div>
                  <div className="oa-field">
                    <label htmlFor="oa-overview-end">End date</label>
                    <input id="oa-overview-end" className="oa-input" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
                  </div>
                </>,
                'oa-overview'
              )}
              {!overviewDates && <p className="oa-range-error">Date range must be 1–31 days (start before end).</p>}
            </section>

            {overviewError && (
              <div className="oa-card oa-error-card" role="alert">
                <p>{overviewError}</p>
                <Button type="button" variant="secondary" size="sm" onClick={() => setOverviewReload((value) => value + 1)}>Retry</Button>
              </div>
            )}

            {overviewLoading ? <LoadingRows count={6} /> : overviewDates && !overviewError && (
              <section className="oa-card oa-overview-card" ref={listTopRef}>
                {pageMatrixRows.length ? (
                  <div className="oa-matrix-scroll" tabIndex="0" aria-label="Attendance overview table">
                    <table className="oa-matrix">
                      <thead>
                        <tr>
                          <th>Student</th>
                          {overviewDates.map((day) => <th key={day} title={fullDateLabel(day)}>{shortDateLabel(day)}</th>)}
                          <th>Summary</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageMatrixRows.map(({ student, totals, rate }) => {
                          const records = recordsByStudent.get(student.id) || {};
                          return (
                            <tr key={student.id}>
                              <td><StudentIdentity student={student} showCoach={isSuper} /></td>
                              {overviewDates.map((day) => {
                                const status = records[day] || '';
                                const symbol = status === 'present' ? '✓' : status === 'absent' ? '✕' : status === 'late' ? 'L' : '–';
                                return (
                                  <td key={day}>
                                    <span className={`oa-cell oa-cell--${status || 'none'}`} aria-label={`${student.name}, ${fullDateLabel(day)}: ${status || 'No record'}`}>
                                      {symbol}
                                    </span>
                                  </td>
                                );
                              })}
                              <td className="oa-summary-cell"><strong>{rate}%</strong><span>{totals.present}P {totals.absent}A {totals.late}L</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : <div className="oa-empty">No students found</div>}
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalItems={filteredStudents.length}
                  pageSize={PAGE_SIZE}
                  onPageChange={setPage}
                  itemLabel="students"
                />
                <div className="oa-legend" aria-label="Attendance legend">
                  <span><i className="oa-cell oa-cell--present">✓</i>Present</span>
                  <span><i className="oa-cell oa-cell--absent">✕</i>Absent</span>
                  <span><i className="oa-cell oa-cell--late">L</i>Late</span>
                  <span><i className="oa-cell oa-cell--none">–</i>No Record</span>
                </div>
              </section>
            )}
          </>
        )}
      </div>
      {toast && <div className="oa-toast" role="status">{toast}</div>}
    </PageHeader>
  );
}
