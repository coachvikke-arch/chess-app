import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../Toast';
import { Card, Chip } from '../ui';
import { BarChart, PctBar } from '../../utils/charts';
import { SkeletonChart, SkeletonRegion, SkeletonStatCard, SkeletonTable, useMinimumLoading } from '../skeleton';
import { getPlayerReport } from '../../services/playerReport';
import SkillRadar from './SkillRadar';
import TrendChart from './TrendChart';
import './playerReport.css';

const SOURCES = ['chesscom', 'lichess', 'matezone'];
const SOURCE_LABEL = { chesscom: 'Chess.com', lichess: 'Lichess', matezone: 'Mate Zone' };
const SKILL_LABEL = {
  opening: 'Opening',
  tactics: 'Tactics',
  positional: 'Positional',
  endgame: 'Endgame',
  timeManagement: 'Time management',
  consistency: 'Consistency',
};

function pct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n)}%` : '—';
}

function num(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits).replace(/\.0$/, '') : '—';
}

function EvidenceList({ items, empty }) {
  if (!Array.isArray(items) || !items.length) return <p className="pr-muted">{empty}</p>;
  return (
    <ul className="pr-evidence-list">
      {items.slice(0, 3).map((item, i) => (
        <li key={`${item.label}-${i}`}>
          <span className="pr-evidence-label">{item.label}</span>
          <span className="pr-evidence-value">{item.evidence}</span>
        </li>
      ))}
    </ul>
  );
}

export default function PlayerReportTab({ scope = null, studentId: propStudentId = null, student = null, gamesVersion = 0 }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const studentId = scope?.studentId || propStudentId || user?.id;
  const [source, setSource] = useState('all');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(studentId));
  const showSkeleton = useMinimumLoading(loading, 400);

  useEffect(() => {
    if (!studentId) return undefined;
    let alive = true;
    setLoading(true);
    setError('');
    getPlayerReport(studentId, source)
      .then((res) => { if (alive) setData(res); })
      .catch((e) => {
        if (!alive) return;
        const message = e?.response?.data?.message || 'Could not load the Player Report.';
        setError(message);
        showToast(message, { tone: 'error', title: 'Player Report' });
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [studentId, source, gamesVersion, showToast]);

  if (!studentId) {
    return <Card title="Player Report" piece="📄"><p className="pr-muted">Sign in to view this report.</p></Card>;
  }

  if (showSkeleton) {
    return (
      <div className="pr-root" aria-busy="true">
        <Card title="Player Report" piece="📄">
          <SkeletonRegion label="Loading player report" className="pr-skeleton-stack">
            <div className="pr-stat-grid">{[0, 1, 2, 3, 4].map((i) => <SkeletonStatCard key={i} />)}</div>
            <div className="pr-two-col"><SkeletonChart height={260} /><SkeletonTable rows={4} columns={3} /></div>
            <SkeletonChart height={180} />
          </SkeletonRegion>
        </Card>
      </div>
    );
  }

  if (error && !data) return <Card title="Player Report" piece="📄"><p className="pr-inline-error">{error}</p></Card>;

  if (!data) return null;

  const overview = data.overview || {};
  const skills = data.skills || {};
  const splits = overview.gamesAnalysed || {};
  const header = data.header || {};
  const fide = data.fideReadiness || {};
  const plan = data.improvementPlan || {};
  const computer = data.computerBreakdown || {};
  const openings = data.openingsReport || {};

  return (
    <div className="pr-root">
      <Card
        title="Player Report"
        piece="📄"
        actions={
          <div className="pr-source-filter" role="group" aria-label="Source filter">
            {['all', ...SOURCES].map((key) => (
              <button
                key={key}
                type="button"
                className={`pr-source-chip${source === key ? ' active' : ''}`}
                onClick={() => setSource(key)}
              >
                {key === 'all' ? 'All' : SOURCE_LABEL[key]}
              </button>
            ))}
          </div>
        }
      >
        <div className="pr-player-head">
          <div className="pr-avatar" aria-hidden="true">{(header.name || student?.name || user?.name || 'P').charAt(0).toUpperCase()}</div>
          <div className="pr-player-meta">
            <h3>{header.name || student?.name || user?.name || 'Player'}</h3>
            <div className="pr-rating-row">
              {(header.ratings || []).length === 0 && <span className="pr-muted">No linked ratings yet.</span>}
              {(header.ratings || []).map((r) => (
                <span key={`${r.source}-${r.label}`} className="pr-rating-chip">
                  <strong>{r.value ?? '—'}</strong> {r.label}
                </span>
              ))}
            </div>
          </div>
          <div className="pr-player-type">
            <span className="pr-muted">Player type</span>
            <Chip>{data.playerType || 'Analysing…'}</Chip>
          </div>
        </div>

        <p className="pr-subtitle">{data.gamesAnalysed ?? 0} analysed games from the last 90 days across Chess.com, Lichess and Mate Zone. All figures are estimates based on stored engine analysis.</p>

        {data.needsMoreGames && (
          <div className="pr-warning" role="status">
            Need more games for accurate report — {data.gamesAnalysed ?? 0} analysed (at least {data.minGames ?? 20} recommended). Showing what is available.
          </div>
        )}
        {data.queuedInAppGames > 0 && (
          <div className="pr-note" role="status">
            {data.queuedInAppGames} unfinished in-app game{data.queuedInAppGames === 1 ? '' : 's'} queued for analysis and will appear once complete.
          </div>
        )}
        {error && <p className="pr-inline-error">{error}</p>}

        <div className="pr-stat-grid">
          <div className="pr-stat"><span>Average accuracy</span><strong>{pct(overview.avgAccuracy)}</strong></div>
          <div className="pr-stat"><span>Win rate</span><strong>{pct(overview.winRate)}</strong></div>
          <div className="pr-stat"><span>Blunders / game</span><strong>{num(overview.blundersPerGame, 2)}</strong></div>
          <div className="pr-stat"><span>Time trouble</span><strong>{pct(overview.timeTroublePct)}</strong></div>
          <div className="pr-stat">
            <span>Games analysed</span>
            <strong>{splits.total ?? data.gamesAnalysed ?? 0}</strong>
            <div className="pr-stat-split">
              {SOURCES.map((key) => <span key={key}>{SOURCE_LABEL[key]}: {splits[key] ?? 0}</span>)}
            </div>
          </div>
        </div>
      </Card>

      <div className="pr-two-col">
        <Card title="Skill radar" piece="🕸">
          <SkillRadar skills={skills} />
          <div className="pr-skill-values">
            {Object.entries(SKILL_LABEL).map(([key, label]) => (
              <span key={key}>{label}: <strong>{Math.round(Number(skills[key]) || 0)}</strong></span>
            ))}
          </div>
        </Card>
        <Card title="Strengths & weaknesses" piece="⚖️">
          <h3 className="pr-subhead">Strengths</h3>
          <EvidenceList items={data.strengths} empty="Not enough data yet." />
          <h3 className="pr-subhead">Weaknesses</h3>
          <EvidenceList items={data.weaknesses} empty="Not enough data yet." />
        </Card>
      </div>

      <div className="pr-two-col">
        <Card title="Phase accuracy" piece="🎯">
          <PctBar label="Opening" value={Number(data.phaseAccuracy?.opening) || 0} />
          <PctBar label="Middlegame" value={Number(data.phaseAccuracy?.middlegame) || 0} />
          <PctBar label="Endgame" value={Number(data.phaseAccuracy?.endgame) || 0} />
        </Card>
        <Card title="Blunder themes" piece="⚠️">
          <BarChart
            items={(data.blunderThemes || []).map((t) => ({ label: t.theme, value: Number(t.count) || 0 }))}
            height={150}
          />
        </Card>
      </div>

      <Card title="Openings report" piece="♘">
        <div className="pr-two-col">
          <div>
            <h3 className="pr-subhead">Best by score</h3>
            <EvidenceList
              items={(openings.best || []).map((o) => ({ label: o.name, evidence: `${pct(o.score)} · ${o.games} game${o.games === 1 ? '' : 's'}` }))}
              empty="No openings recorded in this window."
            />
          </div>
          <div>
            <h3 className="pr-subhead">Worst by score</h3>
            <EvidenceList
              items={(openings.worst || []).map((o) => ({ label: o.name, evidence: `${pct(o.score)} · ${o.games} game${o.games === 1 ? '' : 's'}` }))}
              empty="No openings recorded in this window."
            />
          </div>
        </div>
      </Card>

      <div className="pr-two-col">
        <Card title="Source comparison" piece="🔍">
          <div className="pr-table-scroll">
            <table className="pr-table">
              <thead><tr><th>Source</th><th>Accuracy</th><th>Win rate</th><th>Blunders/game</th><th>Games</th></tr></thead>
              <tbody>
                {(data.sourceComparison || []).map((row) => (
                  <tr key={row.source}>
                    <td>{SOURCE_LABEL[row.source] || row.source}</td>
                    <td>{pct(row.accuracy)}</td>
                    <td>{pct(row.winRate)}</td>
                    <td>{num(row.blundersPerGame, 2)}</td>
                    <td>{row.games ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="vs Computer" piece="🤖">
          <div className="pr-stat-grid pr-stat-grid-compact">
            <div className="pr-stat"><span>Games</span><strong>{computer.games ?? 0}</strong></div>
            <div className="pr-stat"><span>Accuracy</span><strong>{pct(computer.accuracy)}</strong></div>
            <div className="pr-stat"><span>Win rate</span><strong>{pct(computer.winRate)}</strong></div>
            <div className="pr-stat"><span>Weight in scores</span><strong>{pct((computer.weight ?? 0.5) * 100)}</strong></div>
          </div>
          <p className="pr-muted">Computer games are reported separately and carry half weight. They are excluded from opening win rate against humans.</p>
        </Card>
      </div>

      <Card title="Weekly trend" piece="📈">
        <TrendChart weeks={data.trend || []} />
      </Card>

      <Card title="Improvement plan" piece="🗺">
        <h3 className="pr-subhead">Priorities</h3>
        <div className="pr-priorities">
          {(plan.priorities || []).length === 0 && <p className="pr-muted">No priorities yet.</p>}
          {(plan.priorities || []).map((p) => (
            <div key={p.skill} className="pr-priority">
              <strong>{SKILL_LABEL[p.skill] || p.skill}</strong>
              <span className="pr-priority-score">{Math.round(Number(p.score) || 0)}/100</span>
              <p>{p.action}</p>
            </div>
          ))}
        </div>
        <h3 className="pr-subhead">4-week plan</h3>
        <div className="pr-weeks">
          {(plan.weeks || []).map((w) => (
            <div key={w.week} className="pr-week">
              <strong>Week {w.week}</strong>
              <span>{w.focus}</span>
              <p>{w.tasks}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card title="FIDE readiness" piece="🏅">
        <div className="pr-fide-grid">
          <div className="pr-fide-score"><strong>{Math.round(Number(fide.readiness) || 0)}</strong><span>/ 100 readiness</span></div>
          <div>
            <p><strong>Estimated FIDE range:</strong> {fide.range ? `${fide.range[0]}–${fide.range[1]}` : '—'}</p>
            <p><strong>Expected score in 9 rounds:</strong> {fide.expectedScore ?? '—'}</p>
            <p className="pr-muted">{fide.note || 'Estimates, not guarantees.'}</p>
          </div>
        </div>
        <div className="pr-chance-grid">
          {[
            ['Positive score', fide.chances?.positiveScore],
            ['Top 10', fide.chances?.topTen],
            ['Win tournament', fide.chances?.winTournament],
            ['Rating gain', fide.chances?.ratingGain],
          ].map(([label, value]) => (
            <div key={label} className="pr-chance"><span>{label}</span><strong>{value == null ? '—' : `${value}%`}</strong></div>
          ))}
        </div>
      </Card>
    </div>
  );
}
