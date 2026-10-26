import { DonutChart, DonutLegend, resultSegments } from '../../utils/charts';
import { FORMAT_LABEL, STATUS_LABEL, tournamentDate } from './useTournamentReport';

/*
 * Print-only tournament section for the report PDF. Mirrors the on-screen
 * section with plain literals and the existing .rp-* print classes so the
 * html2canvas capture never sees a scroll container or an interactive control.
 */

function fmtDay(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Block({ children }) {
  return (
    <div className="rp-block" data-print-block="" data-print-section="tournaments">
      {children}
    </div>
  );
}

function Tile({ icon, label, value, sub }) {
  return (
    <div className="rp-tile">
      <div className="rp-tile-icon" aria-hidden="true">{icon}</div>
      <div className="rp-tile-label">{label}</div>
      <div className="rp-tile-value">{value}</div>
      <div className="rp-tile-sub">{sub}</div>
    </div>
  );
}

export default function TournamentPrint({ tournaments }) {
  if (!tournaments) {
    return (
      <Block>
        <div className="rp-card">
          <h3 className="rp-card-title">Tournaments</h3>
          <p className="rp-muted">Tournament data was not loaded for this export.</p>
        </div>
      </Block>
    );
  }

  const { rows = [], stats, scopeName, personal, filters } = tournaments;
  if (!rows.length) {
    return (
      <Block>
        <div className="rp-card">
          <h3 className="rp-card-title">Tournaments</h3>
          <p className="rp-muted">No tournaments recorded for this period.</p>
        </div>
      </Block>
    );
  }

  const segments = resultSegments(stats);
  const wdlTotal = stats.wins + stats.draws + stats.losses;

  return (
    <>
      <Block>
        <div className="rp-card">
          <h3 className="rp-card-title">Tournaments</h3>
          <p className="rp-muted">
            {scopeName} · {filters.range} · {filters.format} · {filters.status}
          </p>
        </div>
      </Block>

      <Block>
        <div className="rp-tiles">
          <Tile icon="♛" label="Tournaments played" value={stats.tournamentsPlayed} sub="completed & live" />
          <Tile icon="♔" label="Wins / podiums" value={`${stats.wins} / ${stats.podiums}`} sub="wins / top-3" />
          <Tile icon="♚" label="Best rank" value={stats.bestRank ? `#${stats.bestRank}` : '—'} sub="played events" />
          <Tile icon="♞" label="Total points" value={stats.totalPoints} sub={personal ? 'tournament points' : 'all players'} />
          <Tile icon="♗" label="Average score" value={Number(stats.avgScore).toFixed(1)} sub={personal ? 'per event' : 'per player-event'} />
          <Tile icon="♟" label="W / D / L" value={`${stats.wins} / ${stats.draws} / ${stats.losses}`} sub="match results" />
        </div>
      </Block>

      {wdlTotal > 0 && (
        <Block>
          <div className="rp-card">
            <h3 className="rp-card-title">Win / Draw / Loss</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
              <DonutChart
                segments={segments}
                size={150}
                thickness={22}
                centerValue={wdlTotal}
                centerLabel="games"
              />
              <div style={{ flex: 1 }}>
                <DonutLegend segments={segments} />
              </div>
            </div>
          </div>
        </Block>
      )}

      <Block>
        <div className="rp-card">
          <h3 className="rp-card-title">Tournament list</h3>
          <table className="rp-table">
            <thead>
              <tr>
                <th>Tournament</th>
                {!personal && <th>Player</th>}
                <th>Format</th>
                <th>Date</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Players</th>
                <th style={{ textAlign: 'right' }}>{personal ? 'My rank' : 'Leader rank'}</th>
                <th style={{ textAlign: 'right' }}>{personal ? 'My points' : 'Top points'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  {!personal && <td>{r.display?.name || '—'}</td>}
                  <td>{FORMAT_LABEL[r.format] || r.format || '—'}</td>
                  <td>{fmtDay(tournamentDate(r))}</td>
                  <td>{STATUS_LABEL[r.statusGroup] || r.statusGroup}</td>
                  <td style={{ textAlign: 'right' }}>{r.playerCount ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{r.displayRank != null ? `#${r.displayRank}` : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{r.displayPoints != null ? r.displayPoints : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>
    </>
  );
}
