import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { PageHeader, Card, Chip } from '../components/ui';
import DashboardTournaments from '../features/tournaments/DashboardTournaments';
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

  const assignmentChart = useMemo(() => {
    const total = aData.total_assigned || 0;
    return [
      { label: 'Assigned', value: total, color: '#60a5fa' },
      { label: 'Submitted', value: aData.submitted || 0, color: '#22c55e' },
      { label: 'Graded', value: aData.graded || 0, color: '#3b82f6' },
      { label: 'Overdue', value: aData.overdue || 0, color: '#ef4444' },
    ];
  }, [aData]);

  const chessChart = useMemo(() => {
    const total = cData.totalGames || 0;
    return [
      { label: 'Wins', value: cData.whiteWins || 0, color: '#22c55e' },
      { label: 'Draws', value: cData.draws || 0, color: '#64748b' },
      { label: 'Losses', value: cData.blackWins || 0, color: '#ef4444' },
    ];
  }, [cData]);

  if (loading) {
    return (
      <PageHeader title="Admin Dashboard" icon="♕" subtitle="Your command center — see the whole board at a glance.">
        <div className="flex items-center justify-center h-64"><span className="text-ivory-500">Loading…</span></div>
      </PageHeader>
    );
  }

  if (error) {
    return (
      <PageHeader title="Admin Dashboard" icon="♕" subtitle="Your command center — see the whole board at a glance.">
        <div className="chess-card p-8 text-center">
          <p className="chess-error">{error}</p>
          <Button type="button" onClick={fetchAll} variant="primary" size="md" className="mt-4">Retry</Button>
        </div>
      </PageHeader>
    );
  }

  return (
    <PageHeader title="Admin Dashboard" icon="♕" subtitle="Your command center — see the whole board at a glance.">
      <div className="space-y-6">
        {/* ── Header row: date range + refresh ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-display font-semibold text-ivory-100">Admin Dashboard</h2>
            <p className="text-ivory-500 text-sm">{APP_NAME}</p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-ivory-500 text-sm">Data range:</span>
            <div className="flex flex-wrap gap-1">
              {['7', '30', '90'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setRange(d)}
                  className={`chess-chip ${range === d ? 'chess-chip-gold' : ''}`}
                >
                  Last {d} Days
                </button>
              ))}
              <Button
                type="button"
                onClick={fetchAll}
                variant="secondary" size="sm" className="!px-3 !py-1.5 text-xs flex items-center gap-1 transition"
              >
                <span>⟳</span> Refresh
              </Button>
            </div>
          </div>
        </div>

        {/* ── Tournaments (live from /api/tournaments) ── */}
        <DashboardTournaments role="admin" />

        {/* ── Row 1: Key metrics ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ivory-500 uppercase tracking-wider">Total Students</p>
                <p className="text-2xl font-display font-bold text-ivory-100">{o.totalStudents || 0}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-gold-500/10 flex items-center justify-center text-gold-400">
                ♙
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ivory-500 uppercase tracking-wider">Active Students (30d)</p>
                <p className="text-2xl font-display font-bold text-ivory-100">{o.activeStudents || 0}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                ♖
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ivory-500 uppercase tracking-wider">Assignments</p>
                <p className="text-2xl font-display font-bold text-ivory-100">{aData.total_assigned || 0}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600">
                ✍
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ivory-500 uppercase tracking-wider">Puzzle Attempts</p>
                <p className="text-2xl font-display font-bold text-ivory-100">{pData.total_attempts || 0}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center text-amber-700">
                🧩
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ivory-500 uppercase tracking-wider">Games Played</p>
                <p className="text-2xl font-display font-bold text-ivory-100">{cData.totalGames || 0}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center text-red-700">
                ♟
              </div>
            </div>
          </Card>
        </div>

        {/* ── Row 2: Charts ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Student activity line chart */}
          <Card className="p-6">
            <h3 className="chess-card-title mb-4">
              <span className="chess-card-piece">📈</span>
              <span className="flex-1">Student Activity</span>
            </h3>
            <div className="h-[200px] w-full">
              <LineChart points={activityChart.points} labels={activityChart.labels} height={160} stroke="#19bdf2" />
            </div>
            <p className="text-xs text-ivory-500 mt-2">
              Unique students with any activity (attendance, puzzle attempt, assignment submission) per day.
            </p>
          </Card>

          {/* Assignment progress stacked bar */}
          <Card className="p-6">
            <h3 className="chess-card-title mb-4">
              <span className="chess-card-piece">✍</span>
              <span className="flex-1">Assignment Progress</span>
            </h3>
            <div className="h-[200px] w-full">
              <BarChart items={assignmentChart} height={160} />
            </div>
            <div className="mt-4 grid grid-cols-4 gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                <span className="text-ivory-300">Submitted: {aData.submitted || 0}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                <span className="text-ivory-300">Graded: {aData.graded || 0}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500"></span>
                <span className="text-ivory-300">Overdue: {aData.overdue || 0}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-ivory-700/30"></span>
                <span className="text-ivory-300">Completion: {aData.completion_rate || 0}%</span>
              </div>
            </div>
          </Card>
        </div>

        {/* ── Row 3: Puzzle & Chess analytics ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Puzzle donut */}
          <Card className="p-6">
            <h3 className="chess-card-title mb-4">
              <span className="chess-card-piece">🧩</span>
              <span className="flex-1">Puzzle Training</span>
            </h3>
            <div className="flex flex-col items-center justify-center h-[200px]">
              <DonutChart
                segments={[
                  { key: 'correct', label: 'Correct', value: pData.correct_attempts || 0, color: '#22c55e' },
                  { key: 'incorrect', label: 'Incorrect', value: Math.max(0, (pData.total_attempts || 0) - (pData.correct_attempts || 0)), color: '#ef4444' },
                ]}
                size={160}
                thickness={24}
                centerValue={pData.success_rate || 0}
                centerLabel="% correct"
              />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-ivory-500">Attempts:</span>
                <span className="text-ivory-100 font-semibold">{pData.total_attempts || 0}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-ivory-500">Puzzles:</span>
                <span className="text-ivory-100 font-semibold">{pData.unique_puzzles || 0}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-ivory-500">Students:</span>
                <span className="text-ivory-100 font-semibold">{pData.unique_students || 0}</span>
              </div>
            </div>
            {pData.top_themes && pData.top_themes.length > 0 && (
              <div className="mt-4">
                <p className="text-xs text-ivory-500 uppercase tracking-wider mb-2">Top Themes</p>
                <DonutLegend segments={pData.top_themes.map((t) => ({
                  key: t.theme,
                  label: t.theme,
                  value: t.attempts,
                  color: t.attempts > 0 ? '#19bdf2' : '#64748b',
                }))} />
              </div>
            )}
          </Card>

          {/* Chess performance donut */}
          <Card className="p-6">
            <h3 className="chess-card-title mb-4">
              <span className="chess-card-piece">♟</span>
              <span className="flex-1">Chess Performance</span>
            </h3>
            <div className="flex flex-col items-center justify-center h-[200px]">
              <DonutChart
                segments={[
                  { key: 'white', label: 'Wins', value: cData.whiteWins || 0, color: '#22c55e' },
                  { key: 'draw', label: 'Draws', value: cData.draws || 0, color: '#64748b' },
                  { key: 'black', label: 'Losses', value: cData.blackWins || 0, color: '#ef4444' },
                ]}
                size={160}
                thickness={24}
                centerValue={cData.totalGames || 0}
                centerLabel="Games"
              />
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                <span className="text-ivory-300">Wins: {cData.whiteWins || 0}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-gray-500"></span>
                <span className="text-ivory-300">Draws: {cData.draws || 0}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500"></span>
                <span className="text-ivory-300">Losses: {cData.blackWins || 0}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-ivory-500">Win %:</span>
                <span className="text-ivory-100 font-semibold">{cData.totalDecisive > 0 ? cData.whiteWinRate : 0}%</span>
              </div>
            </div>
          </Card>
        </div>

        {/* ── Row 3b: Attendance ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-6">
            <h3 className="chess-card-title mb-4">
              <span className="chess-card-piece">📊</span>
              <span className="flex-1">Attendance</span>
            </h3>
            <div className="h-[200px] w-full">
              <LineChart
                points={attData.data.map((d, i) => ({ x: i, value: d.attendance_rate || 0 }))}
                labels={attData.data.map((d) => d.date)}
                height={160}
                stroke="#22c55e"
                format={(v) => `${v}%`}
              />
            </div>
            <div className="mt-4 grid grid-cols-4 gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-ivory-500">Rate:</span>
                <span className="text-ivory-100 font-semibold">{attData.overall?.attendanceRate || 0}%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-ivory-500">Present:</span>
                <span className="text-ivory-100 font-semibold">{attData.overall?.present || 0}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-ivory-500">Absent:</span>
                <span className="text-ivory-100 font-semibold">{attData.overall?.absent || 0}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-ivory-500">Late:</span>
                <span className="text-ivory-100 font-semibold">{attData.overall?.late || 0}</span>
              </div>
            </div>
          </Card>

          {/* Actionable overview: Needs Attention */}
          <Card className="p-6">
            <h3 className="chess-card-title mb-4">
              <span className="chess-card-piece">⚠</span>
              <span className="flex-1">Needs Attention</span>
            </h3>
            <div className="space-y-3">
              {aData.overdue && aData.overdue > 0 ? (
                <div className="flex items-center justify-between p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <div>
                    <p className="text-sm font-medium text-ivory-100">Overdue Assignments</p>
                    <p className="text-xs text-ivory-500">{aData.overdue} assignment(s) past due date without submission</p>
                  </div>
                  <Link to="/admin/assignments" className="text-xs text-gold-400 font-medium hover:underline">View →</Link>
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <span className="text-sm text-emerald-700">✓ No overdue assignments</span>
                </div>
              )}
              {pData.total_attempts && pData.total_attempts > 0 && pData.success_rate < 50 ? (
                <div className="flex items-center justify-between p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <div>
                    <p className="text-sm font-medium text-ivory-100">Low Puzzle Success Rate</p>
                    <p className="text-xs text-ivory-500">{pData.success_rate}% average — students may need easier puzzles or hints</p>
                  </div>
                  <Link to="/admin/puzzle-listing" className="text-xs text-gold-400 font-medium hover:underline">Review →</Link>
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <span className="text-sm text-emerald-700">✓ Puzzle engagement healthy</span>
                </div>
              )}
              {attData.overall && attData.overall.attendanceRate < 70 ? (
                <div className="flex items-center justify-between p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <div>
                    <p className="text-sm font-medium text-ivory-100">Low Attendance</p>
                    <p className="text-xs text-ivory-500">{attData.overall.attendanceRate}% average — consider reaching out to absent students</p>
                  </div>
                  <Link to="/admin/attendance" className="text-xs text-gold-400 font-medium hover:underline">View →</Link>
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <span className="text-sm text-emerald-700">✓ Attendance healthy</span>
                </div>
              )}
              {aData.total_assigned && aData.submitted === 0 ? (
                <div className="flex items-center justify-between p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <div>
                    <p className="text-sm font-medium text-ivory-100">No Submissions Yet</p>
                    <p className="text-xs text-ivory-500">{aData.total_assigned} assignment(s) have zero submissions</p>
                  </div>
                  <Link to="/admin/assignments" className="text-xs text-gold-400 font-medium hover:underline">Review →</Link>
                </div>
              ) : null}
              {!aData.total_assigned && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-ivory-700/10 border border-ivory-700/20">
                  <span className="text-sm text-ivory-500">No assignments created yet</span>
                </div>
              )}
              {attData.overall && attData.overall.total === 0 && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-ivory-700/10 border border-ivory-700/20">
                  <span className="text-sm text-ivory-500">No attendance data recorded yet</span>
                </div>
              )}
              {cData.totalGames === 0 && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-ivory-700/10 border border-ivory-700/20">
                  <span className="text-sm text-ivory-500">No completed games recorded yet</span>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </PageHeader>
  );
}