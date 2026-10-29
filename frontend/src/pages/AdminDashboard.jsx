import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { PageHeader, Card, Chip } from '../components/ui';
import {
  LineChart, BarChart, PctBar, DonutChart, DonutLegend,
  CompareBars, rollingWinRateSeries, gamesPerMonth,
} from '../utils/charts';
import Button from '../components/Button';
import { APP_NAME } from '../config/brand';

/* ─────────────────────────────────────────────────────────────────────────────
   Admin Dashboard — Coach / Super Admin overview.
   Every metric, chart and table is computed server-side from real data.
   No hardcoded totals, no random chart values, no placeholder percentages.
   ════════════════════════════════════════════════════════════════════════════════ */

export default function AdminDashboard() {
  const [range, setRange] = useState('30'); // days
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /* ── Data stores ── */
  const [overview, setOverview] = useState(null);
  const [activity, setActivity] = useState({ days: 30, data: [] });
  const [assignments, setAssignments] = useState(null);
  const [puzzles, setPuzzles] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [chess, setChess] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        fetchOverview(),
        fetchActivity(),
        fetchAssignments(),
        fetchPuzzles(),
        fetchAttendance(),
        fetchChess(),
      ]);
    } catch (err) {
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [range]);

  const fetchOverview = async () => {
    const res = await api.get('/dashboard/coach');
    setOverview(res.data);
  };

  const fetchActivity = async () => {
    const res = await api.get(`/dashboard/coach/activity?days=${range}`);
    setActivity(res.data);
  };

  const fetchAssignments = async () => {
    const res = await api.get('/dashboard/coach/assignments');
    setAssignments(res.data);
  };

  const fetchPuzzles = async () => {
    const res = await api.get('/dashboard/coach/puzzles');
    setPuzzles(res.data);
  };

  const fetchAttendance = async () => {
    const res = await api.get(`/dashboard/coach/attendance?days=${range}`);
    setAttendance(res.data);
  };

  const fetchChess = async () => {
    const res = await api.get(`/dashboard/coach/chess-performance?days=${range}`);
    setChess(res.data);
  };

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /* ── Format helpers ───────────────────────────────────────────────────── */
  const fmtDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const pct = (n, d) => d > 0 ? Math.round((n / d) * 100) : 0;

  const o = overview || {};
  const activityData = activity.data || [];
  const aData = assignments || {};
  const pData = puzzles || {};
  const attData = attendance || {};
  const cData = chess || {};

  /* ── Chart data preparation ── */
  const activityChart = useMemo(() => ({
    points: activityData.map((d, i) => ({ x: i, value: d.active_students })),
    labels: activityData.map((d) => d.date),
  }), [activityData]);

  /* Colour only — the values are the same fields as before. The dashboard is a
     blue-and-white page, so the series read as steps of one blue rather than
     traffic-light greens and reds. */
  const assignmentChart = useMemo(() => {
    const total = aData.total_assigned || 0;
    return [
      { label: 'Assigned', value: total, color: '#2563eb' },
      { label: 'Submitted', value: aData.submitted || 0, color: '#3b82f6' },
      { label: 'Graded', value: aData.graded || 0, color: '#8fb1e8' },
      { label: 'Overdue', value: aData.overdue || 0, color: '#bfd4f2' },
    ];
  }, [aData]);

  const chessChart = useMemo(() => {
    const total = cData.totalGames || 0;
    return [
      { label: 'Wins', value: cData.whiteWins || 0, color: '#2563eb' },
      { label: 'Draws', value: cData.draws || 0, color: '#8fb1e8' },
      { label: 'Losses', value: cData.blackWins || 0, color: '#bfd4f2' },
    ];
  }, [cData]);

  /* ── Attendance column chart geometry (presentation only) ──
     Reads the rows the page already fetched and turns them into a bar height
     per day. The scale tops out at a round multiple of 4 so the four grid
     lines land on whole percentages; no value is invented or smoothed. */
  const attendanceChart = useMemo(() => {
    const rows = attData.data || [];
    const values = rows.map((d) => Number(d.attendance_rate) || 0);
    const hi = Math.max(8, Math.ceil(Math.max(...values, 0) / 4) * 4);
    const ticks = [4, 3, 2, 1, 0].map((i) => Math.round((hi * i) / 4));
    const labelStep = Math.max(1, Math.ceil(rows.length / 8));
    return {
      ticks,
      columns: rows.map((d, i) => ({
        key: d.date || `day-${i}`,
        date: d.date,
        value: values[i],
        pct: (values[i] / hi) * 100,
        showLabel: i % labelStep === 0 || i === rows.length - 1,
      })),
    };
  }, [attData]);

  if (loading) {
    return (
      <PageHeader title="Admin Dashboard" icon="♕" subtitle="Your command center — see the whole board at a glance." className="adb-page">
        <div className="adb"><div className="adb-loading">Loading…</div></div>
      </PageHeader>
    );
  }

  if (error) {
    return (
      <PageHeader title="Admin Dashboard" icon="♕" subtitle="Your command center — see the whole board at a glance." className="adb-page">
        <div className="adb">
          <div className="chess-card adb-error">
            <p className="chess-error">{error}</p>
            <Button type="button" onClick={fetchAll} variant="primary" size="md" className="adb-error-btn">Retry</Button>
          </div>
        </div>
      </PageHeader>
    );
  }

  return (
    <PageHeader title="Admin Dashboard" icon="♕" subtitle="Your command center — see the whole board at a glance." className="adb-page">
      <div className="adb">
        {/* ── Header row: title + date range + refresh ── */}
        <div className="adb-head">
          <div className="adb-head-left">
            <h2 className="adb-title">Admin Dashboard</h2>
            <p className="adb-brand">{APP_NAME}</p>
          </div>

          <div className="adb-head-right">
            <span className="adb-range-label">Data range:</span>
            <div className="adb-range">
              {['7', '30', '90'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setRange(d)}
                  className={range === d ? 'adb-range-btn adb-range-btn--on' : 'adb-range-btn'}
                >
                  Last {d} Days
                </button>
              ))}
            </div>
            <Button type="button" onClick={fetchAll} variant="secondary" size="sm" className="adb-refresh">
              <span aria-hidden="true">⟳</span> Refresh
            </Button>
          </div>
        </div>

        {/* ── Row 1: Key metrics ── */}
        <div className="adb-stat-grid">
          <Card className="adb-stat">
            <div className="adb-stat-text">
              <p className="adb-stat-label">Total Students</p>
              <p className="adb-stat-value">{o.totalStudents || 0}</p>
            </div>
            <span className="adb-stat-icon" aria-hidden="true">♙</span>
          </Card>
          <Card className="adb-stat">
            <div className="adb-stat-text">
              <p className="adb-stat-label">Active Students (30d)</p>
              <p className="adb-stat-value">{o.activeStudents || 0}</p>
            </div>
            <span className="adb-stat-icon" aria-hidden="true">♖</span>
          </Card>
          <Card className="adb-stat">
            <div className="adb-stat-text">
              <p className="adb-stat-label">Assignments</p>
              <p className="adb-stat-value">{aData.total_assigned || 0}</p>
            </div>
            <span className="adb-stat-icon" aria-hidden="true">✍</span>
          </Card>
          <Card className="adb-stat">
            <div className="adb-stat-text">
              <p className="adb-stat-label">Puzzle Attempts</p>
              <p className="adb-stat-value">{pData.total_attempts || 0}</p>
            </div>
            <span className="adb-stat-icon" aria-hidden="true">🧩</span>
          </Card>
          <Card className="adb-stat">
            <div className="adb-stat-text">
              <p className="adb-stat-label">Games Played</p>
              <p className="adb-stat-value">{cData.totalGames || 0}</p>
            </div>
            <span className="adb-stat-icon" aria-hidden="true">♟</span>
          </Card>
        </div>

        {/* ── Student activity trend, full width ── */}
        <Card className="adb-card">
          <h3 className="adb-card-title">
            <span className="adb-card-icon" aria-hidden="true">📈</span>
            <span>Student Activity</span>
          </h3>
          <LineChart
            points={activityChart.points}
            labels={activityChart.labels.map(fmtDate)}
            height={160}
            stroke="#2563eb"
            maxLabels={8}
          />
          <p className="adb-caption">
            Unique students with any activity (attendance, puzzle attempt, assignment submission) per day.
          </p>
        </Card>

        {/* ── Row 2: Assignments, puzzles and games ── */}
        <div className="adb-grid3">
          <Card className="adb-card">
            <h3 className="adb-card-title">
              <span className="adb-card-icon" aria-hidden="true">✍</span>
              <span>Assignment Progress</span>
            </h3>
            <CompareBars rows={assignmentChart} />
            <p className="adb-foot">
              <span>Completion</span>
              <strong>{aData.completion_rate || 0}%</strong>
            </p>
          </Card>

          <Card className="adb-card">
            <h3 className="adb-card-title">
              <span className="adb-card-icon" aria-hidden="true">🧩</span>
              <span>Puzzle Training</span>
            </h3>
            <DonutChart
              segments={[
                { key: 'correct', label: 'Correct', value: pData.correct_attempts || 0, color: '#2563eb' },
                { key: 'incorrect', label: 'Incorrect', value: Math.max(0, (pData.total_attempts || 0) - (pData.correct_attempts || 0)), color: '#bfd4f2' },
              ]}
              size={140}
              thickness={20}
              centerValue={`${pData.success_rate || 0}%`}
              centerLabel="correct"
            />
            <div className="adb-pair-grid">
              <p className="adb-pair"><span>Attempts</span><strong>{pData.total_attempts || 0}</strong></p>
              <p className="adb-pair"><span>Puzzles</span><strong>{pData.unique_puzzles || 0}</strong></p>
              <p className="adb-pair"><span>Students</span><strong>{pData.unique_students || 0}</strong></p>
            </div>
            {pData.top_themes && pData.top_themes.length > 0 && (
              <div className="adb-themes">
                <p className="adb-subhead">Top Themes</p>
                <DonutLegend segments={pData.top_themes.map((t) => ({
                  key: t.theme,
                  label: t.theme,
                  value: t.attempts,
                  color: t.attempts > 0 ? '#2563eb' : '#bfd4f2',
                }))} />
              </div>
            )}
          </Card>

          <Card className="adb-card">
            <h3 className="adb-card-title">
              <span className="adb-card-icon" aria-hidden="true">♟</span>
              <span>Chess Performance</span>
            </h3>
            <p className="adb-big-number">{cData.totalGames || 0}</p>
            <p className="adb-big-label">Games</p>
            <CompareBars rows={chessChart} />
            <p className="adb-foot">
              <span>Win %</span>
              <strong>{cData.totalDecisive > 0 ? cData.whiteWinRate : 0}%</strong>
            </p>
          </Card>
        </div>

        {/* ── Row 3: Attendance trend + what needs a coach's attention ── */}
        <div className="adb-grid-bottom">
          <Card className="adb-card">
            <h3 className="adb-card-title">
              <span className="adb-card-icon" aria-hidden="true">📊</span>
              <span>Attendance</span>
            </h3>
            <div className="adb-bars">
              <div className="adb-bars-y" aria-hidden="true">
                {attendanceChart.ticks.map((t, i) => (
                  <span key={t} className="adb-bars-tick" style={{ top: `${(i / (attendanceChart.ticks.length - 1)) * 100}%` }}>
                    {t}%
                  </span>
                ))}
              </div>
              <div className="adb-bars-plot" role="img" aria-label={`Attendance rate per day, ${attendanceChart.columns.length} days`}>
                {attendanceChart.columns.map((c) => (
                  <span
                    key={c.key}
                    className="adb-bar"
                    style={{ height: `${c.pct}%` }}
                    title={`${fmtDate(c.date)} · ${c.value}%`}
                  />
                ))}
              </div>
              <div className="adb-bars-x" aria-hidden="true">
                {attendanceChart.columns.map((c) => (
                  <span key={c.key} className="adb-bars-xslot">{c.showLabel ? fmtDate(c.date) : ''}</span>
                ))}
              </div>
            </div>
            <div className="adb-quad-grid">
              <p className="adb-quad"><span>Rate</span><strong>{attData.overall?.attendanceRate || 0}%</strong></p>
              <p className="adb-quad"><span>Present</span><strong>{attData.overall?.present || 0}</strong></p>
              <p className="adb-quad"><span>Absent</span><strong>{attData.overall?.absent || 0}</strong></p>
              <p className="adb-quad"><span>Late</span><strong>{attData.overall?.late || 0}</strong></p>
            </div>
          </Card>

          {/* Actionable overview: Needs Attention */}
          <Card className="adb-card">
            <h3 className="adb-card-title">
              <span className="adb-card-icon" aria-hidden="true">⚠</span>
              <span>Needs Attention</span>
            </h3>
            <div className="adb-notes">
              {aData.overdue && aData.overdue > 0 ? (
                <div className="adb-note adb-note--warn">
                  <div>
                    <p className="adb-note-title">Overdue Assignments</p>
                    <p className="adb-note-body">{aData.overdue} assignment(s) past due date without submission</p>
                  </div>
                  <Link to="/admin/assignments" className="adb-note-link">View →</Link>
                </div>
              ) : (
                <p className="adb-note adb-note--ok"><span className="adb-note-check" aria-hidden="true">✓</span> No overdue assignments</p>
              )}
              {pData.total_attempts && pData.total_attempts > 0 && pData.success_rate < 50 ? (
                <div className="adb-note adb-note--warn">
                  <div>
                    <p className="adb-note-title">Low Puzzle Success Rate</p>
                    <p className="adb-note-body">{pData.success_rate}% average — students may need easier puzzles or hints</p>
                  </div>
                  <Link to="/admin/puzzle-listing" className="adb-note-link">Review →</Link>
                </div>
              ) : (
                <p className="adb-note adb-note--ok"><span className="adb-note-check" aria-hidden="true">✓</span> Puzzle engagement healthy</p>
              )}
              {attData.overall && attData.overall.attendanceRate < 70 ? (
                <div className="adb-note adb-note--warn">
                  <div>
                    <p className="adb-note-title">Low Attendance</p>
                    <p className="adb-note-body">{attData.overall.attendanceRate}% average — consider reaching out to absent students</p>
                  </div>
                  <Link to="/admin/attendance" className="adb-note-link">View →</Link>
                </div>
              ) : (
                <p className="adb-note adb-note--ok"><span className="adb-note-check" aria-hidden="true">✓</span> Attendance healthy</p>
              )}
              {aData.total_assigned && aData.submitted === 0 ? (
                <div className="adb-note adb-note--warn">
                  <div>
                    <p className="adb-note-title">No Submissions Yet</p>
                    <p className="adb-note-body">{aData.total_assigned} assignment(s) have zero submissions</p>
                  </div>
                  <Link to="/admin/assignments" className="adb-note-link">Review →</Link>
                </div>
              ) : null}
              {!aData.total_assigned && (
                <p className="adb-note">No assignments created yet</p>
              )}
              {attData.overall && attData.overall.total === 0 && (
                <p className="adb-note">No attendance data recorded yet</p>
              )}
              {cData.totalGames === 0 && (
                <p className="adb-note">No completed games recorded yet</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </PageHeader>
  );
}