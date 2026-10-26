import Button from '../../components/Button';
import { DonutChart, DonutLegend, resultSegments } from '../../utils/charts';
import { downloadText } from './tournamentUtils';
import {
  ChartLegend,
  TopPerformersChart,
  TournamentBarChart,
  TournamentLineChart,
} from './TournamentCharts';
import {
  FORMAT_LABEL,
  FORMAT_OPTIONS,
  RANGE_OPTIONS,
  STATUS_LABEL,
  STATUS_OPTIONS,
  STATUS_TONE,
  tournamentDate,
} from './useTournamentReport';

const POINT_COLOR = '#0b7ea8';
const PARTICIPATION_COLOR = '#19a5e3';
const TOP_COLOR = '#b45309';

function fmtDay(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtNumber(value) {
  const n = Number(value) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function StatCard({ icon, label, value, sub }) {
  return (
    <div className="chess-card !p-4 tr-stat">
      <span className="tr-stat-icon" aria-hidden="true">{icon}</span>
      <div className="tr-stat-value">{value}</div>
      <div className="tr-stat-label">{label}</div>
      {sub && <div className="tr-stat-sub">{sub}</div>}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="tr-skeleton" aria-busy="true" aria-label="Loading tournaments">
      <div className="tr-skeleton-stats">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="tr-skeleton-stat" />
        ))}
      </div>
      <div className="tr-skeleton-charts">
        <div className="tr-skeleton-chart" />
        <div className="tr-skeleton-chart" />
      </div>
      <div className="tr-skeleton-table">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="tr-skeleton-row" />
        ))}
      </div>
    </div>
  );
}

export default function TournamentReportSection({ state, studentMode }) {
  const payload = state.payload;
  const stats = payload?.stats;
  const rows = payload?.rows || [];
  const base = studentMode ? '/student' : '/admin';
  const filtersActive =
    state.range !== 'all' ||
    state.format !== 'all' ||
    state.status !== 'all' ||
    state.studentFilter !== 'all' ||
    state.classFilter !== 'all';

  function downloadCsv() {
    if (!payload || !rows.length) return;
    const rankHead = state.personal ? 'My rank' : 'Leader rank';
    const pointHead = state.personal ? 'My points' : 'Top points';
    const head = [
      'Tournament',
      'Player',
      'Format',
      'Date',
      'Status',
      'Players',
      rankHead,
      pointHead,
      'Wins',
      'Draws',
      'Losses',
    ];
    const body = rows.map((r) => [
      r.name,
      r.display?.name || '',
      FORMAT_LABEL[r.format] || r.format || '',
      fmtDay(tournamentDate(r)),
      STATUS_LABEL[r.statusGroup] || r.statusGroup,
      r.playerCount ?? '',
      r.displayRank ?? '',
      r.displayPoints ?? '',
      r.display?.wins ?? '',
      r.display?.draws ?? '',
      r.display?.losses ?? '',
    ]);
    const csv = [head, ...body].map((row) => row.map(csvCell).join(',')).join('\r\n');
    downloadText(`tournament-report-${state.personal ? 'student' : 'all'}.csv`, csv);
  }

  const segments = stats ? resultSegments(stats) : [];
  const wdlTotal = stats ? stats.wins + stats.draws + stats.losses : 0;
  const showCharts = !!(payload && payload.hasPlayed);
  const showTop = !studentMode && !!(payload && payload.topPerformers.length);

  return (
    <div className="tr-panel">
      <div className="tr-head">
        <div>
          <h2 className="font-display font-semibold text-lg text-ivory-100">
            <span className="tr-title-glyph" aria-hidden="true">♛</span> Tournaments
          </h2>
          <p className="tr-sub">
            {state.scopeName} · {rows.length} tournament{rows.length === 1 ? '' : 's'} in view
          </p>
        </div>
        <Button
          variant="secondary"
          size="md"
          onClick={downloadCsv}
          disabled={!rows.length}
          className="tr-download"
        >
          ⬇ Download report
        </Button>
      </div>

      <div className="chess-card !p-3 tr-filters">
        <label className="tr-field">
          <span>Date range</span>
          <select className="chess-input" value={state.range} onChange={(e) => state.setRange(e.target.value)}>
            {RANGE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <label className="tr-field">
          <span>Format</span>
          <select className="chess-input" value={state.format} onChange={(e) => state.setFormat(e.target.value)}>
            {FORMAT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <label className="tr-field">
          <span>Status</span>
          <select className="chess-input" value={state.status} onChange={(e) => state.setStatus(e.target.value)}>
            {STATUS_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <label className="tr-field">
          <span>Sort</span>
          <select className="chess-input" value={state.sortDir} onChange={(e) => state.setSortDir(e.target.value)}>
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </label>
        {state.canFilterStudents && (
          <>
            <label className="tr-field">
              <span>Class</span>
              <select className="chess-input" value={state.classFilter} onChange={(e) => state.setClassFilter(e.target.value)}>
                <option value="all">All classes</option>
                {state.classOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="tr-field">
              <span>Student</span>
              <select className="chess-input" value={state.studentFilter} onChange={(e) => state.setStudentFilter(e.target.value)}>
                <option value="all">All students</option>
                {state.studentOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </>
        )}
        {filtersActive && (
          <Button variant="secondary" size="sm" onClick={state.resetFilters} className="tr-reset">
            Reset
          </Button>
        )}
      </div>

      {state.loading && <Skeleton />}

      {!state.loading && !!state.error && (
        <div className="chess-card !p-6 tr-empty">
          <div className="tr-empty-icon" aria-hidden="true">⚠️</div>
          <h3>Could not load tournaments</h3>
          <p>{state.error}</p>
          <Button variant="primary" size="md" onClick={state.reload}>Try again</Button>
        </div>
      )}

      {!state.loading && !state.error && state.records && state.records.length === 0 && (
        <div className="chess-card !p-6 tr-empty">
          <div className="tr-empty-icon" aria-hidden="true">🏆</div>
          <h3>No tournaments yet</h3>
          <p>
            {studentMode
              ? 'Join a tournament from the Tournaments page and your results will appear here.'
              : 'Tournaments will appear here once students start competing.'}
          </p>
        </div>
      )}

      {!state.loading && !state.error && state.records && state.records.length > 0 && rows.length === 0 && (
        <div className="chess-card !p-6 tr-empty">
          <div className="tr-empty-icon" aria-hidden="true">🔍</div>
          <h3>No tournaments match these filters</h3>
          <p>Try a wider date range, another format or a different status.</p>
          {filtersActive && (
            <Button variant="primary" size="md" onClick={state.resetFilters}>Reset filters</Button>
          )}
        </div>
      )}

      {!state.loading && !state.error && stats && rows.length > 0 && (
        <>
          <div className="tr-stat-grid">
            <StatCard
              icon="♛"
              label="Tournaments played"
              value={stats.tournamentsPlayed}
              sub={state.personal ? state.scopeName : 'completed & live events'}
            />
            <StatCard
              icon="♔"
              label="Wins / podiums"
              value={`${stats.wins} / ${stats.podiums}`}
              sub="match wins / top-3 finishes"
            />
            <StatCard
              icon="♚"
              label="Best rank"
              value={stats.bestRank ? `#${stats.bestRank}` : '—'}
              sub="across played events"
            />
            <StatCard
              icon="♞"
              label="Total points"
              value={fmtNumber(stats.totalPoints)}
              sub={state.personal ? 'tournament points' : 'across all players'}
            />
            <StatCard
              icon="♗"
              label="Average score"
              value={fmtNumber(stats.avgScore)}
              sub={state.personal ? 'points per tournament' : 'points per player-event'}
            />
            <StatCard
              icon="♟"
              label="W / D / L"
              value={`${stats.wins} / ${stats.draws} / ${stats.losses}`}
              sub="match results"
            />
          </div>

          {showCharts ? (
            <div className="tr-chart-grid">
              <div className="chess-card !p-4 tr-chart-card">
                <div className="tr-chart-head">
                  <div>
                    <h3>{state.personal ? 'Points progress' : 'Top score per tournament'}</h3>
                    <p>{state.personal ? `${state.scopeName} across events, oldest to newest` : 'Best score in each event'}</p>
                  </div>
                  <ChartLegend color={POINT_COLOR} label={state.personal ? 'Points' : 'Top points'} />
                </div>
                <div className="tr-chart-body">
                  <TournamentLineChart
                    items={payload.pointsSeries}
                    color={POINT_COLOR}
                    yLabel="Points"
                    xLabel="Tournament"
                    emptyText="No scored tournaments in this range."
                  />
                </div>
              </div>

              <div className="chess-card !p-4 tr-chart-card">
                <div className="tr-chart-head">
                  <div>
                    <h3>Points per tournament</h3>
                    <p>Score earned in each event</p>
                  </div>
                  <ChartLegend color={POINT_COLOR} label="Points" />
                </div>
                <div className="tr-chart-body">
                  <TournamentBarChart
                    items={payload.pointsSeries}
                    color={POINT_COLOR}
                    yLabel="Points"
                    xLabel="Tournament"
                    emptyText="No scored tournaments in this range."
                  />
                </div>
              </div>

              {wdlTotal > 0 && (
                <div className="chess-card !p-4 tr-chart-card">
                  <div className="tr-chart-head">
                    <div>
                      <h3>Win / Draw / Loss</h3>
                      <p>{wdlTotal} decided game{wdlTotal === 1 ? '' : 's'} in view</p>
                    </div>
                    <ChartLegend color="#22c55e" label="Win / Draw / Loss" />
                  </div>
                  <div className="tr-chart-body tr-donut-body">
                    <DonutChart
                      segments={segments}
                      size={176}
                      thickness={26}
                      centerValue={wdlTotal}
                      centerLabel="games"
                    />
                    <div className="tr-donut-side">
                      <DonutLegend segments={segments} />
                    </div>
                  </div>
                </div>
              )}

              {payload.participation.length > 0 && (
                <div className="chess-card !p-4 tr-chart-card">
                  <div className="tr-chart-head">
                    <div>
                      <h3>Participation by month</h3>
                      <p>Tournaments held in the selected range</p>
                    </div>
                    <ChartLegend color={PARTICIPATION_COLOR} label="Tournaments" />
                  </div>
                  <div className="tr-chart-body">
                    <TournamentBarChart
                      items={payload.participation}
                      color={PARTICIPATION_COLOR}
                      yLabel="Tournaments"
                      xLabel="Month"
                      valueSuffix=" tournaments"
                      emptyText="No events in this range."
                    />
                  </div>
                </div>
              )}

              {showTop && (
                <div className="chess-card !p-4 tr-chart-card">
                  <div className="tr-chart-head">
                    <div>
                      <h3>Top performers</h3>
                      <p>Top 5 players by tournament points</p>
                    </div>
                    <ChartLegend color={TOP_COLOR} label="Points" />
                  </div>
                  <div className="tr-chart-body tr-hbar-body">
                    <TopPerformersChart items={payload.topPerformers} color={TOP_COLOR} />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="chess-card !p-5 tr-chart-note">
              <span aria-hidden="true">📈</span>
              <div>
                <strong>Charts appear after the first tournament game.</strong>
                <p>Once results are recorded, points, results split and participation charts fill in here.</p>
              </div>
            </div>
          )}

          <div className="chess-card !p-0 tr-table-card">
            <div className="tr-table-head">
              <h3>Tournament list</h3>
              <span>{rows.length} event{rows.length === 1 ? '' : 's'}</span>
            </div>
            <div className="tr-table-wrap">
              <table className="tr-table">
                <thead>
                  <tr>
                    <th>Tournament</th>
                    {!state.personal && <th>Player</th>}
                    <th>Format</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th className="num">Players</th>
                    <th className="num">{state.personal ? 'My rank' : 'Leader rank'}</th>
                    <th className="num">{state.personal ? 'My points' : 'Top points'}</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <span className="tr-name">{r.name}</span>
                        {r.statusGroup === 'completed' && r.winnerName && (
                          <span className="tr-name-sub">🏆 {r.winnerName}</span>
                        )}
                      </td>
                      {!state.personal && <td className="tr-player">{r.display?.name || '—'}</td>}
                      <td>{FORMAT_LABEL[r.format] || r.format || '—'}</td>
                      <td className="tr-nowrap">{fmtDay(tournamentDate(r))}</td>
                      <td>
                        <span className={`tr-chip ${STATUS_TONE[r.statusGroup] || 'grey'}`}>
                          {STATUS_LABEL[r.statusGroup] || r.statusGroup}
                        </span>
                      </td>
                      <td className="num">{r.playerCount ?? '—'}</td>
                      <td className="num">{r.displayRank != null ? `#${r.displayRank}` : '—'}</td>
                      <td className="num">{r.displayPoints != null ? r.displayPoints : '—'}</td>
                      <td className="tr-action">
                        <Button
                          to={`${base}/tournaments/${r.id}`}
                          variant="secondary"
                          size="sm"
                          className="!px-3 !py-1.5 !text-xs whitespace-nowrap"
                        >
                          View results
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
