import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { PageHeader, Card, Chip, Spinner } from '../components/ui';
import {
  LineChart, BarChart, PctBar, DonutChart, DonutLegend, CompareBars,
} from '../utils/charts';
import Button from '../components/Button';

/* ─────────────────────────────────────────────────────────────────────────────
   Super Admin Platform Dashboard
   Platform-wide overview across all academies (admin accounts).
   All data comes from real backend endpoints — no hardcoded values.
   ════════════════════════════════════════════════════════════════════════════════ */

export default function PlatformDashboard() {
  const [range, setRange] = useState('30');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [overview, setOverview] = useState(null);
  const [growth, setGrowth] = useState({ days: 30, data: [] });
  const [academies, setAcademies] = useState([]);
  const [activity, setActivity] = useState(null);
  const [health, setHealth] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        api.get('/admins/platform/overview').then((r) => setOverview(r.data)),
        api.get(`/admins/platform/growth?days=${range}`).then((r) => setGrowth(r.data)),
        api.get('/admins/platform/academies').then((r) => setAcademies(r.data.academies || [])),
        api.get(`/admins/platform/activity?days=${range}`).then((r) => setActivity(r.data)),
        api.get('/admins/platform/health').then((r) => setHealth(r.data)),
      ]);
    } catch (err) {
      setError(err.message || 'Failed to load platform data');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const fmtDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  if (loading) {
    return (
      <PageHeader title="Platform Dashboard" icon="♛" subtitle="Super Admin console — platform-wide overview.">
        <div className="flex items-center justify-center h-64"><span className="text-ivory-500">Loading platform data…</span></div>
      </PageHeader>
    );
  }

  if (error) {
    return (
      <PageHeader title="Platform Dashboard" icon="♛" subtitle="Super Admin console — platform-wide overview.">
        <div className="chess-card p-8 text-center">
          <p className="chess-error">{error}</p>
          <Button type="button" onClick={fetchAll} variant="primary" size="md" className="mt-4">Retry</Button>
        </div>
      </PageHeader>
    );
  }

  const o = overview || {};
  const growthData = growth.data || [];
  const academyData = academies || [];
  const actData = activity || {};
  const hData = health || {};

  /* ── Chart data ── */
  const growthChart = useMemo(() => ({
    points: growthData.map((d, i) => ({ x: i, value: d.newStudents })),
    labels: growthData.map((d) => d.date),
  }), [growthData]);

  return (
    <PageHeader title="Platform Dashboard" icon="♛" subtitle="Super Admin console — platform-wide overview across all academies.">
      <div className="space-y-6">
        {/* ── Header ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-display font-semibold text-ivory-100">Platform Dashboard</h2>
            <p className="text-ivory-500 text-sm">System-wide metrics across all academies</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-ivory-500 text-sm">Range:</span>
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

        {/* ── Row 1: Platform overview cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ivory-500 uppercase tracking-wider">Total Academies</p>
                <p className="text-2xl font-display font-bold text-ivory-100">{o.totalAcademies || 0}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
                ♔
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ivory-500 uppercase tracking-wider">Active Academies</p>
                <p className="text-2xl font-display font-bold text-ivory-100">{o.activeAcademies || 0}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center text-green-400">
                ✓
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ivory-500 uppercase tracking-wider">Total Students</p>
                <p className="text-2xl font-display font-bold text-ivory-100">{o.totalStudents || 0}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-400">
                ♙
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ivory-500 uppercase tracking-wider">Active Students</p>
                <p className="text-2xl font-display font-bold text-ivory-100">{o.activeStudents || 0}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                👥
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ivory-500 uppercase tracking-wider">Puzzle Attempts</p>
                <p className="text-2xl font-display font-bold text-ivory-100">{o.totalPuzzleAttempts || 0}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400">
                🧩
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ivory-500 uppercase tracking-wider">Games Played</p>
                <p className="text-2xl font-display font-bold text-ivory-100">{o.totalGames || 0}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400">
                ♟
              </div>
            </div>
          </Card>
        </div>

        {/* ── Row 2: Growth chart + Academy table ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Growth line chart */}
          <Card className="p-6 flex-1">
            <h3 className="chess-card-title mb-4">
              <span className="chess-card-piece">📈</span>
              <span className="flex-1">Platform Growth</span>
            </h3>
            <div className="h-[240px] w-full">
              <LineChart
                points={growthChart.points}
                labels={growthChart.labels}
                height={200}
                stroke="#19bdf2"
              />
            </div>
            <p className="text-xs text-ivory-500 mt-2">
              New student and admin registrations per day over the selected range.
            </p>
          </Card>

          {/* Academy comparison table */}
          <Card className="p-6 flex-1">
            <h3 className="chess-card-title mb-4">
              <span className="chess-card-piece">🏛</span>
              <span className="flex-1">Academy Comparison</span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-ivory-500 border-b border-ivory-700/50">
                    <th className="py-2 pr-3">Academy</th>
                    <th className="py-2 pr-3 text-center">Students</th>
                    <th className="py-2 pr-3 text-center">Classes</th>
                    <th className="py-2 pr-3 text-center">Puzzles</th>
                    <th className="py-2 pr-3 text-center">Games</th>
                    <th className="py-2 pr-3 text-right">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {academyData.map((a) => (
                    <tr key={a.id} className="border-b border-ivory-700/40 hover:bg-black/5 cursor-pointer">
                      <td className="py-2.5 pr-3 font-medium text-ivory-300 truncate">{a.academy_name || 'Unknown'}</td>
                      <td className="py-2.5 pr-3 text-center">{a.student_count || 0}</td>
                      <td className="py-2.5 pr-3 text-center">{a.classes_taught || 0}</td>
                      <td className="py-2.5 pr-3 text-center">{a.puzzle_attempts || 0}</td>
                      <td className="py-2.5 pr-3 text-center">{a.games_played || 0}</td>
                      <td className="py-2.5 pr-3 text-right text-ivory-500">{a.student_share_pct || 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {academyData.length === 0 && (
                <p className="text-xs text-ivory-500 text-center mt-4">No academy data available.</p>
              )}
            </div>
          </Card>
        </div>

        {/* ── Row 3: Platform activity + System health ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Platform activity charts */}
          <Card className="p-6">
            <h3 className="chess-card-title mb-4">
              <span className="chess-card-piece">📊</span>
              <span className="flex-1">Platform Activity</span>
            </h3>
            <div className="flex flex-col gap-4">
              {/* Puzzle activity */}
              <div className="flex-1">
                <p className="text-xs text-ivory-500 uppercase tracking-wider mb-2">Puzzle Attempts</p>
                <div className="h-[120px] w-full">
                  <BarChart items={actData.puzzleActivity?.map((d) => ({
                    label: d.day,
                    value: d.attempts,
                    color: '#2563eb',
                  })) || []} height={120} />
                </div>
              </div>
              {/* Game completion */}
              <div className="flex-1">
                <p className="text-xs text-ivory-500 uppercase tracking-wider mb-2">Game Completion</p>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex-1">
                    <div className="chess-bar">
                      <div className="chess-bar-fill" style={{ width: `${cDataPct(gData.totalGames || 1, gData.finished || 0)}%` }} />
                    </div>
                  </div>
                  <span className="text-xs text-ivory-300">
                    {gData.finished || 0} / {gData.totalGames || 0}
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* System health */}
          <Card className="p-6">
            <h3 className="chess-card-title mb-4">
              <span className="chess-card-piece">🔧</span>
              <span className="flex-1">System Health</span>
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg border border-ivory-700/50 bg-ink-800">
                <div>
                  <p className="text-sm font-medium text-ivory-300">Database</p>
                  <p className="text-xs text-ivory-500">{hData.database?.userCount || 0} users in system</p>
                </div>
                <Chip tone={hData.status === 'operational' ? 'green' : 'red'}>
                  {hData.status === 'operational' ? 'Operational' : 'Degraded'}
                </Chip>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border border-ivory-700/50 bg-ink-800">
                <div>
                  <p className="text-sm font-medium text-ivory-300">Sessions</p>
                  <p className="text-xs text-ivory-500">
                    {hData.sessions?.active || 0} active · {hData.sessions?.revoked24h || 0} revoked (24h)
                  </p>
                </div>
                <span className="text-xs text-ivory-300">{hData.sessions?.new24h || 0} new (24h)</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border border-ivory-700/50 bg-ink-800">
                <div>
                  <p className="text-sm font-medium text-ivory-300">Registrations (24h)</p>
                  <p className="text-xs text-ivory-500">
                    {hData.registrations24h?.students || 0} students · {hData.registrations24h?.admins || 0} admins
                  </p>
                </div>
                <span className="text-xs text-ivory-300">{hData.registrations24h?.total || 0} total</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border border-ivory-700/50 bg-ink-800">
                <div>
                  <p className="text-sm font-medium text-ivory-300">Last Checked</p>
                  <p className="text-xs text-ivory-500">{fmtDate(hData.checked_at)}</p>
                </div>
                <span className="text-xs text-ivory-300">{hData.status === 'operational' ? 'All systems nominal' : 'Issues detected'}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </PageHeader>
  );
}

function cDataPct(total, part) {
  if (!total || total === 0) return 0;
  return Math.round((part / total) * 100);
}