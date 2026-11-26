import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import Button from '../Button';
import { BarChart } from '../../utils/charts';
import { SkeletonChart, SkeletonRegion, SkeletonStatCard, SkeletonTable } from '../skeleton';
import { useToast } from '../Toast';
import Pagination, { PAGE_SIZE } from '../Pagination';
import PerformanceReportPrint from './PerformanceReportPrint';
import { downloadPerformanceCsv } from './performanceReportCsv';

/*
 * Performance Report — rendered INSIDE the existing Student Report page as its
 * own section. It deliberately uses the same page shell, cards, chips, tables,
 * bars, buttons and skeletons as the other report tabs; there is no new layout.
 *
 * All ten content blocks read from one API response for the selected dates, so
 * changing a filter refetches the whole report rather than partially updating
 * a few cards.
 */

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const lastNDays = (n) => {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - (n - 1));
  return { from: iso(from), to: iso(to) };
};
const fmtDate = (v) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const duration = (mins) => {
  const m = Math.max(0, Number(mins) || 0);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
};
const ordinal = (n) => {
  if (!Number.isInteger(n) || n <= 0) return '';
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`;
};
const QUICK_RANGES = [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']];

function MiniStat({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-ivory-700/40 bg-black/[0.02] px-3 py-2.5 min-w-0">
      <div className="text-[0.68rem] font-semibold uppercase tracking-wide text-ivory-500 truncate">{label}</div>
      <div className="text-lg font-display font-bold text-ivory-100 mt-0.5 break-words">{value}</div>
      {sub && <div className="text-[0.7rem] text-ivory-500 mt-0.5 break-words">{sub}</div>}
    </div>
  );
}

function SummaryCard({ icon, label, value, sub }) {
  return (
    <div className="chess-card !p-4 min-w-0">
      <div className="text-xl text-gold-400">{icon}</div>
      <div className="text-2xl font-display font-bold text-ivory-100 mt-1 break-words">{value}</div>
      <div className="text-xs font-medium text-ivory-500 mt-1">{label}</div>
      {sub && <div className="text-[0.7rem] text-ivory-500 mt-0.5 break-words">{sub}</div>}
    </div>
  );
}

function InsightCard({ icon, label, value, sub }) {
  return (
    <div className="chess-card !p-4 min-w-0">
      <div className="flex items-center gap-2 text-gold-400 text-lg"><span>{icon}</span><span className="text-[0.68rem] uppercase tracking-wide font-semibold text-ivory-500">{label}</span></div>
      <div className="text-lg font-display font-bold text-ivory-100 mt-2 break-words">{value}</div>
      {sub && <div className="text-[0.7rem] text-ivory-500 mt-1 break-words">{sub}</div>}
    </div>
  );
}

function ReportBlock({ title, subtitle, stats = [], children }) {
  return (
    <section className="chess-card !p-5 mb-5">
      <div className="mb-4">
        <h3 className="font-display font-semibold text-lg text-ivory-100">{title}</h3>
        {subtitle && <p className="text-xs text-ivory-500 mt-1">{subtitle}</p>}
      </div>
      {stats.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-4">
          {stats.map((s) => <MiniStat key={s.label} {...s} />)}
        </div>
      )}
      {children}
    </section>
  );
}

function EmptyText({ children }) {
  return <p className="text-sm text-ivory-500 py-6 text-center">{children}</p>;
}

export default function PerformanceReport({ studentId, studentMode = false }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [range, setRange] = useState(() => lastNDays(30));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [students, setStudents] = useState([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportJob, setExportJob] = useState(null);
  const [includeRemarks, setIncludeRemarks] = useState(true);
  const [remarksText, setRemarksText] = useState('');
  const [savingRemarks, setSavingRemarks] = useState(false);
  const [sessionsPage, setSessionsPage] = useState(1);
  const [quizPage, setQuizPage] = useState(1);
  const [tournamentsPage, setTournamentsPage] = useState(1);
  const menuRef = useRef(null);

  /* Staff get the student picker; the API scopes the list to their allocated
     students (super admins receive everyone). Students never even ask. */
  useEffect(() => {
    if (studentMode || user?.role === 'student') return;
    let alive = true;
    api.get('/students/assigned', { cache: false })
      .then((res) => { if (alive) setStudents(res.data || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [studentMode, user?.role]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api.get('/reports/performance', {
      params: { studentId: studentMode ? 'me' : studentId, from: range.from, to: range.to },
      cache: false,
    })
      .then((res) => {
        if (!alive) return;
        setData(res.data);
        setRemarksText(res.data?.remarks?.text || '');
        setSessionsPage(1);
        setQuizPage(1);
        setTournamentsPage(1);
      })
      .catch((e) => {
        if (alive) setError(e.response?.data?.message || e.message || 'Failed to load performance report');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [studentId, studentMode, range.from, range.to]);

  useEffect(() => {
    if (!exportOpen) return undefined;
    const close = (e) => { if (!menuRef.current?.contains(e.target)) setExportOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [exportOpen]);

  const changeDate = (key, value) => {
    const other = key === 'from' ? range.to : range.from;
    if (value && other && ((key === 'from' && value > other) || (key === 'to' && value < other))) {
      showToast('From date must be on or before To date.', { tone: 'warning', title: 'Invalid range' });
      return;
    }
    setRange((r) => ({ ...r, [key]: value }));
  };
  const applyQuickRange = (days) => setRange(lastNDays(days));
  const activeQuickRange = QUICK_RANGES.find(([days]) => {
    const r = lastNDays(days);
    return r.from === range.from && r.to === range.to;
  })?.[0];

  /* Export what is actually on screen: if a coach has edited the remarks box
     but has not saved yet, that is still the text the reader sees. */
  const exportData = () => (data
    ? {
        ...data,
        periodLabel: `${fmtDate(range.from)} - ${fmtDate(range.to)}`,
        remarks: { ...(data.remarks || {}), text: remarksText },
      }
    : data);

  const startExport = (mode) => {
    setExportOpen(false);
    if (!data) return;
    const snapshot = exportData();
    if (mode === 'csv') {
      downloadPerformanceCsv(snapshot, includeRemarks);
      return;
    }
    setExportJob({ data: snapshot, includeRemarks, mode });
  };

  const saveRemarks = async () => {
    if (savingRemarks) return;
    setSavingRemarks(true);
    try {
      const res = await api.post('/reports/remarks', {
        studentId: studentMode ? 'me' : studentId,
        from: range.from,
        to: range.to,
        text: remarksText,
      });
      setData((prev) => (prev ? { ...prev, remarks: res.data } : prev));
      showToast('Coach remarks saved.', { tone: 'success', title: 'Saved' });
    } catch (e) {
      showToast(e.response?.data?.message || 'Could not save remarks.', { tone: 'error', title: 'Save failed' });
    } finally {
      setSavingRemarks(false);
    }
  };

  const handleExportDone = useCallback(() => setExportJob(null), []);
  const handleExportError = useCallback((message) => {
    showToast(message || 'Export failed', { tone: 'error', title: 'Export failed' });
  }, [showToast]);

  const periodLabel = `${fmtDate(range.from)} - ${fmtDate(range.to)}`;
  const pageOf = (rows, page) => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-bold text-ivory-100">Performance Report</h1>
          <p className="text-xs text-ivory-500 mt-1 break-words">{data?.student?.name || 'Student'} · {periodLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!studentMode && user?.role !== 'student' && (
            <label className="flex items-center gap-2 text-xs text-ivory-500">
              Student
              <select
                className="chess-input !w-44 !py-2"
                value={studentId || ''}
                onChange={(e) => e.target.value && navigate(`/students/${e.target.value}/report`)}
              >
                {(students.length ? students : (data?.student ? [{ id: data.student.id, name: data.student.name }] : [])).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          )}
          <div className="relative" ref={menuRef}>
            <Button variant="primary" size="md" onClick={() => setExportOpen((v) => !v)} aria-expanded={exportOpen} aria-haspopup="menu">
              Export ▾
            </Button>
            {exportOpen && (
              <div role="menu" className="absolute right-0 z-30 mt-2 w-48 rounded-xl border border-surface-border bg-surface-strong p-1 shadow-lg">
                {[['pdf', 'Download PDF'], ['csv', 'Download CSV'], ['print', 'Print']].map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    role="menuitem"
                    className="w-full text-left px-3 py-2 rounded-lg text-sm text-ivory-300 hover:bg-surface-hover transition-colors"
                    onClick={() => startExport(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="chess-card !p-4 mb-5" aria-label="Filter performance report by date">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-ivory-500">
            From
            <input type="date" className="chess-input !py-2" value={range.from} max={iso(new Date())} onChange={(e) => changeDate('from', e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ivory-500">
            To
            <input type="date" className="chess-input !py-2" value={range.to} min={range.from || undefined} max={iso(new Date())} onChange={(e) => changeDate('to', e.target.value)} />
          </label>
          <div className="flex flex-wrap items-center gap-2 pb-0.5">
            {QUICK_RANGES.map(([days, label]) => (
              <button
                key={days}
                type="button"
                className={`chess-chip !px-3 !py-1.5 ${activeQuickRange === days ? 'chess-chip-gold' : ''}`}
                onClick={() => applyQuickRange(days)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {loading && (
        <SkeletonRegion label="Loading performance report" className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => <SkeletonStatCard key={i} />)}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => <SkeletonStatCard key={i} />)}
          </div>
          <div className="chess-card !p-5"><SkeletonChart height={150} /></div>
          <div className="chess-card !p-5"><SkeletonTable rows={5} columns={6} /></div>
        </SkeletonRegion>
      )}

      {!loading && error && (
        <div className="chess-card !p-5 mb-5">
          <p className="text-sm text-red-600">{error}</p>
          <Button className="mt-3" variant="secondary" size="sm" onClick={() => setRange((r) => ({ ...r }))}>Try again</Button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <SummaryCard
              icon="♘"
              label="Classes attended"
              value={`${data.summary.classes.attended}/${data.summary.classes.scheduled}`}
              sub={`${data.summary.classes.attendancePct}% attendance`}
            />
            <SummaryCard icon="⏱" label="Learning time" value={duration(data.summary.learningTimeMinutes)} sub="total time in class" />
            <SummaryCard
              icon="♟"
              label="Quiz puzzles solved"
              value={`${data.summary.puzzles.solved}/${data.summary.puzzles.attempted}`}
              sub={`${data.summary.puzzles.solvedPct}% solved · ${data.summary.puzzles.points} points`}
            />
            <SummaryCard
              icon="♛"
              label="Tournaments"
              value={data.summary.tournaments.played}
              sub={data.summary.tournaments.bestFinish ? `Best finish: ${ordinal(data.summary.tournaments.bestFinish)}` : 'No ranked finish'}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <InsightCard
              icon="★"
              label="Best topic"
              value={data.insights.bestTopic?.topic || '—'}
              sub={data.insights.bestTopic ? `${data.insights.bestTopic.solved} solved · ${data.insights.bestTopic.accuracy}% accuracy` : 'No solved puzzles yet'}
            />
            <InsightCard
              icon="♻"
              label="Needs practice"
              value={data.insights.needsPractice?.topic || '—'}
              sub={data.insights.needsPractice ? `${data.insights.needsPractice.accuracy}% accuracy` : 'No attempts yet'}
            />
            <InsightCard
              icon="⚡"
              label="Points per solved puzzle"
              value={`${data.insights.pointsPerSolved.value} pts`}
              sub={`Class average ${data.insights.pointsPerSolved.classAverage} pts`}
            />
            <InsightCard
              icon="🔥"
              label="Solving streak"
              value={`${data.insights.solvingStreak.days} day${data.insights.solvingStreak.days === 1 ? '' : 's'}`}
              sub={data.insights.solvingStreak.from ? `${fmtDate(data.insights.solvingStreak.from)} - ${fmtDate(data.insights.solvingStreak.to)}` : 'No solving streak yet'}
            />
          </div>

          <section className="chess-card !p-5 mb-5">
            <h3 className="font-display font-semibold text-lg text-ivory-100 mb-3">Puzzles solved per week</h3>
            <div className="w-full overflow-x-auto">
              <div className="min-w-[520px]"><BarChart items={data.weeklySolved} height={150} /></div>
            </div>
          </section>

          <ReportBlock
            title="Rating progress"
            stats={[
              { label: 'Start', value: data.rating.start },
              { label: 'Now', value: data.rating.end },
              { label: 'Change', value: `${data.rating.change > 0 ? '+' : ''}${data.rating.change}` },
              { label: 'Leaderboard rank', value: data.rating.rank ?? '—' },
            ]}
          />

          <ReportBlock
            title="Sessions"
            subtitle="Completed classes this student was enrolled in"
            stats={[
              { label: 'Scheduled', value: data.sessions.scheduled },
              { label: 'Attended', value: data.sessions.attended },
              { label: 'Duration', value: duration(data.sessions.durationMinutes) },
            ]}
          >
            {data.sessions.rows.length ? (
              <div className="chess-table-wrap">
                <table className="chess-table min-w-[720px]">
                  <thead><tr>
                    <th>S.No.</th><th>Session</th><th>Coach</th><th>Scheduled</th><th>Attended</th><th>Duration</th>
                  </tr></thead>
                  <tbody>
                    {pageOf(data.sessions.rows, sessionsPage).map((r) => (
                      <tr key={r.sNo}>
                        <td>{r.sNo}</td>
                        <td className="font-medium">{r.session}</td>
                        <td>{r.coach}</td>
                        <td className="whitespace-nowrap">{fmtDate(r.scheduled)}</td>
                        <td><span className={`chess-chip ${r.attendance === 'Present' ? 'chess-chip-green' : 'chess-chip-red'}`}>{r.attendance}</span></td>
                        <td className="whitespace-nowrap">{duration(r.durationMinutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyText>No completed classes fall inside the selected dates.</EmptyText>}
            <Pagination
              currentPage={sessionsPage}
              totalPages={Math.ceil(data.sessions.rows.length / PAGE_SIZE)}
              onPageChange={setSessionsPage}
              totalItems={data.sessions.rows.length}
              pageSize={PAGE_SIZE}
              itemLabel="sessions"
            />
          </ReportBlock>

          <ReportBlock
            title="Quiz Assignments"
            subtitle="Puzzle-solving activities only. Play-vs-Computer and multiple-choice homework are not counted here."
            stats={[
              { label: 'Topics', value: data.quiz.topics },
              { label: 'Assigned', value: data.quiz.assigned },
              { label: 'Attempted', value: data.quiz.attempted },
              { label: 'Solved', value: data.quiz.solved },
              { label: 'Points', value: data.quiz.points },
            ]}
          >
            {data.quiz.rows.length ? (
              <div className="chess-table-wrap">
                <table className="chess-table min-w-[760px]">
                  <thead><tr>
                    <th>S.No.</th><th>Topic</th><th>Assigned</th><th>Attempted</th><th>Solved</th><th>Progress</th><th>Accuracy</th><th>Points</th>
                  </tr></thead>
                  <tbody>
                    {pageOf(data.quiz.rows, quizPage).map((r) => {
                      const accuracyTone = r.accuracy >= 90 ? 'chess-chip-green' : r.accuracy >= 60 ? 'chess-chip-amber' : 'chess-chip-red';
                      return (
                        <tr key={r.sNo}>
                          <td>{r.sNo}</td>
                          <td className="font-medium">{r.topic}</td>
                          <td>{r.assigned}</td>
                          <td>{r.attempted}</td>
                          <td>{r.solved}</td>
                          <td className="min-w-[120px]">
                            <div className="flex items-center gap-2">
                              <div className="chess-bar flex-1"><div className="chess-bar-fill" style={{ width: `${r.progress}%`, background: 'var(--gold-400)' }} /></div>
                              <span className="text-xs whitespace-nowrap">{r.progress}%</span>
                            </div>
                          </td>
                          <td><span className={`chess-chip ${accuracyTone}`}>{r.accuracy}%</span></td>
                          <td>{r.points}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <EmptyText>No puzzle assignments fall inside the selected dates.</EmptyText>}
            <Pagination
              currentPage={quizPage}
              totalPages={Math.ceil(data.quiz.rows.length / PAGE_SIZE)}
              onPageChange={setQuizPage}
              totalItems={data.quiz.rows.length}
              pageSize={PAGE_SIZE}
              itemLabel="topics"
            />
          </ReportBlock>

          <ReportBlock
            title="Tournaments"
            subtitle="Completed tournaments played in this range"
            stats={[
              { label: 'Played', value: data.tournaments.played },
              { label: 'Wins', value: data.tournaments.wins },
              { label: 'Drawn', value: data.tournaments.drawn },
              { label: 'Lost', value: data.tournaments.lost },
            ]}
          >
            {data.tournaments.rows.length ? (
              <div className="chess-table-wrap">
                <table className="chess-table min-w-[640px]">
                  <thead><tr>
                    <th>S.No.</th><th>Tournament</th><th>Played on</th><th>Wins</th><th>Drawn</th><th>Lost</th><th>Position</th>
                  </tr></thead>
                  <tbody>
                    {pageOf(data.tournaments.rows, tournamentsPage).map((r) => (
                      <tr key={r.sNo}>
                        <td>{r.sNo}</td>
                        <td className="font-medium">{r.tournament}</td>
                        <td className="whitespace-nowrap">{fmtDate(r.playedOn)}</td>
                        <td>{r.wins}</td>
                        <td>{r.drawn}</td>
                        <td>{r.lost}</td>
                        <td>{r.position ? ordinal(r.position) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyText>This student did not play a completed tournament inside the selected dates.</EmptyText>}
            <Pagination
              currentPage={tournamentsPage}
              totalPages={Math.ceil(data.tournaments.rows.length / PAGE_SIZE)}
              onPageChange={setTournamentsPage}
              totalItems={data.tournaments.rows.length}
              pageSize={PAGE_SIZE}
              itemLabel="tournaments"
            />
          </ReportBlock>

          <section className="chess-card !p-5 mb-5">
            <h3 className="font-display font-semibold text-lg text-ivory-100 mb-3">Coach remarks</h3>
            {studentMode || user?.role === 'student' ? (
              <p className="text-sm text-ivory-300 whitespace-pre-wrap">{data.remarks?.text || 'No remarks yet.'}</p>
            ) : (
              <>
                <textarea
                  className="chess-input w-full !py-2 min-h-[96px]"
                  value={remarksText}
                  onChange={(e) => setRemarksText(e.target.value)}
                  placeholder="Add remarks for this student and date range…"
                />
                <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
                  <label className="flex items-center gap-2 text-sm text-ivory-500">
                    <input
                      type="checkbox"
                      checked={includeRemarks}
                      onChange={(e) => setIncludeRemarks(e.target.checked)}
                      style={{ accentColor: 'var(--gold-400)' }}
                    />
                    Include in export
                  </label>
                  <Button variant="primary" size="md" disabled={savingRemarks} onClick={saveRemarks}>
                    {savingRemarks ? 'Saving…' : 'Save remarks'}
                  </Button>
                </div>
              </>
            )}
          </section>
        </>
      )}

      {exportJob && (
        <PerformanceReportPrint job={exportJob} onDone={handleExportDone} onError={handleExportError} />
      )}
    </div>
  );
}
