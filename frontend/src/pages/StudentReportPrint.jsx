/**
 * Print-only report layout + PDF exporter for the student report.
 *
 * WHY A SEPARATE LAYOUT
 * Capturing the visible page bakes in everything that makes a bad print:
 * scrollable containers (a blue scrollbar thumb ends up IN the PDF), fixed
 * heights that clip text and inputs, collapsed folders, one tab visible at a
 * time, hover-only controls, and a width that follows the reader's device.
 * This file renders the same report data a second time, in print shape:
 *
 *   - fixed 794px width (≈ A4 at 96dpi), so mobile / tablet / desktop exports
 *     are byte-identical in layout;
 *   - overflow visible, no fixed heights, no scrollbars, everything
 *     max-width 100% with border-box;
 *   - no buttons, inputs, dropdowns, arrows or sticky bits anywhere — filters
 *     appear as plain text ("Sorted by: Newest first");
 *   - homework folders render fully expanded as summaries (never the
 *     per-puzzle answer cards, which stay in the app);
 *   - charts are the same animation-free SVG primitives as the screen, with
 *     thinned x-axis labels and honest empty states instead of blank charts.
 *
 * WHY BLOCK-LEVEL CAPTURE
 * Screenshotting whole sections and slicing the image cuts cards and tables
 * in half. Instead every natural unit (card, stat tile row, chart, table row,
 * list row) is its own `[data-print-block]`; each block is captured alone and
 * the packer below lays blocks onto A4 pages, starting a section on a new page
 * unless the whole section fits the remaining space (so short sections share
 * pages instead of leaving blanks), and repeating the section title whenever a
 * section continues. A block taller than a page is the only thing that can
 * still split — and no single block is built that tall.
 *
 * The on-screen report is untouched: it only mounts this while exporting.
 */
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
  LineChart,
  PctBar,
  BarChart,
  DonutChart,
  DonutLegend,
  resultSegments,
  CompareBars,
  RatingBars,
  FormStrip,
  rollingWinRateSeries,
  gamesPerMonth,
} from '../utils/charts';
import {
  SECTIONS,
  TYPE_META,
  fmtDate,
  fmtTime,
  cap,
  winRate,
  cmpColumns,
  buildFolders,
  bestOf,
  pctNum,
  streakNum,
} from './StudentReport';
import { formatPhoneDisplay } from '../utils/phone';
import TournamentPrint from '../features/tournaments/TournamentPrint';
import { APP_NAME, APP_COPYRIGHT } from '../config/brand';

/** Print canvas width: full A4 at 96dpi. Fixed, so every device exports alike. */
export const PRINT_WIDTH_PX = 794;

const PAGE = { W: 210, H: 297, M: 12 };
const CONTENT_W_MM = PAGE.W - PAGE.M * 2; // 186
const TOP_MM = 22; // below the stamped header
const BOTTOM_MM = 280; // above the stamped footer
const USABLE_MM = BOTTOM_MM - TOP_MM;
const TITLE_MM = 9; // reserved height of a repeated section title
const SCALE = 2;

/* ── building blocks ─────────────────────────────────────────────────── */

function Block({ section, children }) {
  return (
    <div className="rp-block" data-print-block="" data-print-section={section}>
      {children}
    </div>
  );
}

function StatTiles({ tiles }) {
  return (
    <div className="rp-tiles">
      {tiles.map((t) => (
        <div key={t.label} className="rp-tile">
          <div className="rp-tile-icon" aria-hidden="true">{t.icon}</div>
          <div className="rp-tile-label">{t.label}</div>
          <div className="rp-tile-value">{t.value}</div>
          <div className="rp-tile-sub">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

/* ── header (cover) ──────────────────────────────────────────────────── */

function PrintHeader({ profile }) {
  const rows = [
    ['Username', profile.nickname || profile.name],
    ['Contact no.', formatPhoneDisplay(profile.phone, profile.country_code)],
    ['Gender', cap(profile.gender)],
    ['Date of birth', fmtDate(profile.birthdate)],
  ];
  return (
    <Block section="cover">
      <div className="rp-card rp-head">
        {profile.avatar_config || profile.profile_image ? (
          <img
            src={profile.profile_image || ''}
            alt=""
            className="rp-avatar"
          />
        ) : (
          <span className="rp-avatar rp-avatar-initial" aria-hidden="true">
            {String(profile.name || '?').trim().charAt(0).toUpperCase()}
          </span>
        )}
        <div className="rp-head-main">
          <p className="rp-muted" style={{ fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{APP_NAME}</p>
          <h1 className="rp-name">{profile.name}</h1>
          <p className="rp-email">{profile.email}</p>
          <div className="rp-head-grid">
            {rows.map(([label, value]) => (
              <div key={label} className="rp-head-cell">
                <span className="rp-muted">{label}</span>
                <span className="rp-strong">{value || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Block>
  );
}

/* ── combined ────────────────────────────────────────────────────────── */

function PrintComparison({ chess }) {
  const cols = cmpColumns(chess);
  const academy = cols.find((c) => c.key === 'academy');
  const accounts = chess.accounts || [];
  const platforms = cols
    .filter((c) => c.key !== 'academy')
    .map((c) => ({ ...c, account: accounts.find((a) => a.platform === c.key) }))
    .filter((c) => c.data || c.account);
  const anyData = academy.data || platforms.length > 0;

  const sources = [
    { label: 'Academy', color: '#60a5fa', data: academy?.data || null },
    ...platforms.filter((p) => p.data).map((p) => ({ label: p.label, color: '#93c5fd', data: p.data })),
  ].filter((s) => s.data);

  const rateRows = sources
    .filter((s) => Number.isFinite(Number(s.data.winRate)))
    .map((s) => ({ label: s.label, value: Number(s.data.winRate), display: `${s.data.winRate}%`, color: s.color }));

  const trend = rollingWinRateSeries(chess?.internalHistory?.games || [], 5);
  const volume = gamesPerMonth(chess?.internalHistory?.games || [], 6);
  const hasVolume = volume.some((v) => v.value > 0);

  return (
    <>
      <Block section="combined">
        <div className="rp-card">
          <h3 className="rp-card-title">Comparison · Academy vs Chess.com &amp; Lichess</h3>
          {!anyData && (
            <p className="rp-muted">No games to compare yet — play academy matches and connect a Chess.com / Lichess account to fill this in.</p>
          )}
        </div>
      </Block>

      {anyData && <AcademyPrintCard data={academy.data} />}
      {anyData && platforms.map((p) => (
        <PlatformPrintCard key={p.key} label={p.label} data={p.data} account={p.account} />
      ))}
      {anyData && platforms.length === 0 && (
        <Block section="combined">
          <div className="rp-card">
            <p className="rp-muted">No Chess.com / Lichess account connected yet — connect and sync one to appear here.</p>
          </div>
        </Block>
      )}

      {anyData && (
        <Block section="combined">
          <div className="rp-card">
            <h3 className="rp-card-title">Performance charts</h3>
            <div className="rp-tiles">
              {sources.map((s) => (
                <div key={s.label} className="rp-tile">
                  <div className="rp-tile-label">{s.label}</div>
                  <div className="rp-tile-value">{s.data.winRate}%</div>
                  <div className="rp-tile-sub">win rate · {s.data.games} game{s.data.games === 1 ? '' : 's'}</div>
                </div>
              ))}
            </div>
          </div>
        </Block>
      )}
      {anyData && sources.map((s) => {
        const segs = resultSegments(s.data);
        const played = (s.data.wins || 0) + (s.data.draws || 0) + (s.data.losses || 0);
        return (
          <Block key={s.label} section="combined">
            <div className="rp-card rp-donut-row">
              <DonutChart segments={segs} centerValue={String(played)} centerLabel="games" />
              <div>
                <p className="rp-strong">{s.label}</p>
                <DonutLegend segments={segs} />
              </div>
            </div>
          </Block>
        );
      })}
      {anyData && rateRows.length > 1 && (
        <Block section="combined">
          <div className="rp-card">
            <p className="rp-chart-title">Win rate compared</p>
            <CompareBars rows={rateRows} />
          </div>
        </Block>
      )}
      {anyData && chess?.internalHistory?.games?.length > 0 && (
        <Block section="combined">
          <div className="rp-card">
            <p className="rp-chart-title">Academy form — last games</p>
            <FormStrip games={chess.internalHistory.games} limit={16} />
          </div>
        </Block>
      )}
      {anyData && trend.points.length >= 2 && (
        <Block section="combined">
          <div className="rp-card">
            <p className="rp-chart-title">Rolling win rate (last 5 games)</p>
            <LineChart points={trend.points} labels={trend.labels} height={140} stroke="#22c55e" format={(v) => `${v}%`} maxLabels={8} />
          </div>
        </Block>
      )}
      {anyData && (
        <Block section="combined">
          <div className="rp-card">
            <p className="rp-chart-title">Academy games per month</p>
            {hasVolume ? (
              <BarChart items={volume} color="#60a5fa" />
            ) : (
              <p className="rp-muted">No academy games in the last 6 months.</p>
            )}
          </div>
        </Block>
      )}
      {anyData && (platforms || []).map((p) => (
        p.account?.ratings?.length ? (
          <Block key={p.key} section="combined">
            <div className="rp-card">
              <p className="rp-chart-title">{p.label} rating by category</p>
              <RatingBars ratings={p.account.ratings} />
            </div>
          </Block>
        ) : null
      ))}

      {anyData && <PrintVerdict academy={academy} platforms={platforms} />}
    </>
  );
}

function AcademyPrintCard({ data }) {
  return (
    <Block section="combined">
      <AcademyPrintCardBody data={data} />
    </Block>
  );
}

function AcademyPrintCardBody({ data }) {
  const rows = data ? [
    ['Games', data.games],
    ['Win rate', `${data.winRate}%`],
    ['W / D / L', `${data.wins} / ${data.draws} / ${data.losses}`],
    ['White win rate', data.white],
    ['Black win rate', data.black],
    ['Longest win streak', data.streak],
    ['Last 30 days', data.last30],
  ] : [];
  return (
    <div className="rp-card">
      <h4 className="rp-card-title">Academy report</h4>
      <p className="rp-muted">Coach &amp; computer games</p>
      {!data && <p className="rp-muted">No academy games recorded yet.</p>}
      {rows.map(([label, value]) => (
        <div key={label} className="rp-kv"><span>{label}</span><span>{value}</span></div>
      ))}
    </div>
  );
}

function PlatformPrintCard({ label, data, account }) {
  return (
    <Block section="combined">
      <PlatformPrintCardBody label={label} data={data} account={account} />
    </Block>
  );
}

function PlatformPrintCardBody({ label, data, account }) {
  const ratings = (account && account.ratings) || [];
  const rows = data ? [
    ['Games', data.games],
    ['Win rate', `${data.winRate}%`],
    ['W / D / L', `${data.wins} / ${data.draws} / ${data.losses}`],
    ['White win rate', data.white],
    ['Black win rate', data.black],
    ['Best opening', data.best],
    ['Weakest opening', data.worst],
    ['Longest win streak', data.streak],
    ['Last 30 days', data.last30],
  ] : [];
  return (
    <div className="rp-card">
      <h4 className="rp-card-title">{label} report</h4>
      <p className="rp-muted">Imported from {label}{account ? ` · ${account.username || ''}` : ''}</p>
      {!data && <p className="rp-muted">Account connected but no imported games yet — sync to fill this in.</p>}
      {rows.map(([label, value]) => (
        <div key={label} className="rp-kv"><span>{label}</span><span>{value}</span></div>
      ))}
      {ratings.length > 0 && (
        <p className="rp-muted">Best rating: {Math.max(...ratings.map((r) => r.rating || 0))}</p>
      )}
    </div>
  );
}

function PrintVerdict({ academy, platforms }) {
  const cands = [];
  if (academy && academy.data) cands.push({ key: 'academy', label: 'Academy', data: academy.data });
  (platforms || []).forEach((p) => cands.push({ key: p.key, label: p.label, data: p.data }));
  if (cands.length === 0) return null;
  const metrics = [
    { metric: 'Win rate', get: (d) => d.winRate, fmt: (d) => `${d.winRate}%` },
    { metric: 'Games played', get: (d) => d.games, fmt: (d) => String(d.games) },
    { metric: 'White win rate', get: (d) => pctNum(d.white), fmt: (d) => d.white },
    { metric: 'Black win rate', get: (d) => pctNum(d.black), fmt: (d) => d.black },
    { metric: 'Longest win streak', get: (d) => streakNum(d.streak), fmt: (d) => d.streak },
  ];
  const withOpening = cands.filter((c) => c.data.best && c.data.best !== '—');
  if (withOpening.length > 1) {
    metrics.push({
      metric: 'Best opening',
      get: (d) => (d.best && d.best !== '—' ? pctNum(d.best.split('·')[1]) : null),
      fmt: (d) => d.best,
    });
  }
  const resolved = metrics.map((m) => {
    const r = bestOf(cands, m.get);
    if (r.best) return { metric: m.metric, winner: r.best.label, value: m.fmt(r.best.data) };
    if (r.tie) return { metric: m.metric, winner: 'Tied', value: r.value };
    return { metric: m.metric, winner: '—', value: '—' };
  });
  const winRateRow = resolved[0];
  const headline = winRateRow.winner === 'Tied'
    ? 'Win rates are level across the academy and online platforms.'
    : `${winRateRow.winner} posts the best win rate (${winRateRow.value}).`;
  return (
    <Block section="combined">
      <div className="rp-card">
        <h3 className="rp-card-title">Best performance comparison</h3>
        <p className="rp-strong">{headline}</p>
        <table className="rp-table">
          <thead>
            <tr><th>Metric</th><th>Best</th><th>Value</th></tr>
          </thead>
          <tbody>
            {resolved.map((r) => (
              <tr key={r.metric}>
                <td>{r.metric}</td>
                <td className="rp-strong">{r.winner}</td>
                <td>{String(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Block>
  );
}

/* ── student ─────────────────────────────────────────────────────────── */

function PrintStudent({ rating, performance, activity }) {
  const rated = performance.rated;
  const online = performance.online;
  const tdf = performance.tournaments;
  const hist = (rating?.history || []).slice();
  const chartStep = Math.max(1, Math.ceil(hist.length / 8));
  const chartData = hist.filter((h, i) => i % chartStep === 0 || i === hist.length - 1);
  const chartPoints = chartData.map((h, i) => ({ x: i, value: h.rating }));
  const chartLabels = chartData.map((h) => fmtDate(h.played_at).split(' ').slice(0, 2).join(' '));
  return (
    <>
      <Block section="student">
        <StatTiles tiles={[
          { icon: '♚', label: 'Rapid Rating', value: rating?.currentRating ?? '—', sub: `peak ${rating?.peakRating ?? '—'}` },
          { icon: '♞', label: 'Rated games', value: rated.games, sub: `${rated.wins}W · ${rated.draws}D · ${rated.losses}L` },
          { icon: '♗', label: 'Win rate', value: `${winRate(rated.wins, rated.losses, rated.draws)}%`, sub: 'rated matches' },
          { icon: '♘', label: 'Attendance', value: `${performance.attendance.pct}%`, sub: `${performance.attendance.present}/${performance.attendance.total} classes` },
          { icon: '♟', label: 'Puzzles solved', value: performance.puzzles.solved, sub: `${performance.puzzles.accuracy}% accuracy` },
          { icon: '♔', label: 'Academy XP', value: performance.academy.xp, sub: `${performance.academy.badges} badges` },
        ]} />
      </Block>
      <Block section="student">
        <div className="rp-card">
          <h3 className="rp-card-title">Rating progression</h3>
          {chartPoints.length >= 2 ? (
            <LineChart points={chartPoints} labels={chartLabels} height={170} maxLabels={8} />
          ) : (
            <p className="rp-muted">Not enough rating points yet — play more games and this chart fills in automatically.</p>
          )}
          {rating?.isProvisional && <p className="rp-muted">Provisional rating.</p>}
        </div>
      </Block>
      <Block section="student">
        <div className="rp-card">
          <h3 className="rp-card-title">Performance</h3>
          <div className="rp-3col">
            <div>
              <h4 className="rp-subcard-title">Rated record</h4>
              <PctBar label="Wins" value={winRate(rated.wins, rated.losses, rated.draws)} />
              <p className="rp-muted">Wins {rated.wins} · Draws {rated.draws} · Losses {rated.losses}</p>
            </div>
            <div>
              <h4 className="rp-subcard-title">Online matches</h4>
              <p className="rp-muted">Games {online.games} · {online.wins} / {online.draws} / {online.losses} · Abandoned {online.abandoned}</p>
            </div>
            <div>
              <h4 className="rp-subcard-title">Tournaments</h4>
              <p className="rp-muted">Participated {tdf.participated} · {tdf.wins} / {tdf.draws} / {tdf.losses}</p>
            </div>
          </div>
        </div>
      </Block>
      {activity.length === 0 ? (
        <Block section="student">
          <div className="rp-card"><p className="rp-muted">No activity recorded yet.</p></div>
        </Block>
      ) : activity.map((a, i) => {
        const meta = TYPE_META[a.type] || TYPE_META.puzzle;
        return (
          <Block key={i} section="student">
            <div className="rp-row">
              <span className="rp-row-icon" aria-hidden="true">{meta.glyph}</span>
              <span className="rp-row-main">
                <span className="rp-strong">{a.title}</span>
                <span className="rp-muted">{a.detail}</span>
              </span>
              <span className="rp-muted">{fmtDate(a.date)}</span>
            </div>
          </Block>
        );
      })}
    </>
  );
}

/* ── classes / user / classrooms / assignments / homework ────────────── */

function PrintClasses({ performance, classes }) {
  const att = performance.attendance;
  return (
    <>
      <Block section="classes">
        <StatTiles tiles={[
          { icon: '♘', label: 'Classes attended', value: att.present, sub: `${att.pct}% attendance` },
          { icon: '♜', label: 'Late arrivals', value: att.late, sub: 'marked late' },
          { icon: '♟', label: 'All sessions', value: att.total, sub: 'scheduled / logged' },
          { icon: '♔', label: 'Quota used', value: `${att.pct}%`, sub: 'based on attended classes' },
        ]} />
      </Block>
      <Block section="classes">
        <div className="rp-card">
          <h3 className="rp-card-title">Attended classes</h3>
          {classes.attended.length === 0 && <p className="rp-muted">No classes attended yet.</p>}
        </div>
      </Block>
      {classes.attended.map((c, i) => (
        <Block key={i} section="classes">
          <div className="rp-row">
            <span className="rp-row-icon" aria-hidden="true">♘</span>
            <span className="rp-row-main">
              <span className="rp-strong">{c.title}</span>
              <span className="rp-muted">{fmtDate(c.classDate)}{c.startTime ? ` · ${fmtTime(c.startTime)}` : ''}</span>
            </span>
            <span className="rp-muted">{c.attendance === 'present' ? 'Present' : 'Late'}</span>
          </div>
        </Block>
      ))}
    </>
  );
}

function PrintUser({ profile }) {
  const rows = [
    ['Full name', profile.name],
    ['Username / nickname', profile.nickname || profile.name],
    ['Email', profile.email],
    ['Phone', formatPhoneDisplay(profile.phone, profile.country_code)],
    ['Parent / guardian', profile.parent_name],
    ['Date of birth', fmtDate(profile.birthdate)],
    ['Gender', cap(profile.gender)],
    ['Preferred language', profile.preferred_language],
    ['Batch / Group', profile.group_name],
    ['Coach', (profile.coaches && profile.coaches.length) ? profile.coaches.map((c) => c.name).join(', ') : profile.coach_name],
    ['Status', profile.active === false ? 'Inactive' : 'Active'],
    ['Member since', fmtDate(profile.joined_at)],
  ];
  return (
    <>
      <Block section="user">
        <div className="rp-card">
          <h3 className="rp-card-title">User Information</h3>
        </div>
      </Block>
      {rows.map(([label, value]) => (
        <Block key={label} section="user">
          <div className="rp-kv"><span>{label}</span><span>{value || '—'}</span></div>
        </Block>
      ))}
    </>
  );
}

function PrintClassrooms({ profile }) {
  return (
    <>
      <Block section="classrooms">
        <div className="rp-card">
          <h3 className="rp-card-title">Batch / Group</h3>
          <p className="rp-muted">{profile.group_name || 'No batch assigned'}</p>
        </div>
      </Block>
      <Block section="classrooms">
        <div className="rp-card">
          <h3 className="rp-card-title">Assigned coach</h3>
          <p className="rp-muted">{(profile.coaches && profile.coaches.length) ? profile.coaches.map((c) => c.name).join(', ') : (profile.coach_name || 'No coach assigned')}</p>
        </div>
      </Block>
    </>
  );
}

function PrintAssignments({ assignmentsList }) {
  const total = assignmentsList.length;
  const completed = assignmentsList.filter((a) => a.submitted).length;
  const avg = completed
    ? Math.round(assignmentsList.filter((a) => a.submitted).reduce((s, a) => s + a.score, 0) / completed)
    : 0;
  const solved = assignmentsList.filter((a) => a.submitted && a.approved).length;
  return (
    <Block section="assignments">
      <StatTiles tiles={[
        { icon: '♙', label: 'Assignments', value: total, sub: 'puzzle homework' },
        { icon: '✓', label: 'Completed', value: completed, sub: `${total - completed} incomplete` },
        { icon: '♟', label: 'Avg points', value: `${avg} pts`, sub: 'per completed puzzle' },
        { icon: '♔', label: 'Solved', value: solved, sub: 'correct once or more' },
      ]} />
    </Block>
  );
}

function PrintHomework({ assignmentsList }) {
  const folders = buildFolders(
    [...assignmentsList].sort((a, b) => new Date(b.assignedAt || 0) - new Date(a.assignedAt || 0)),
    'newest',
  );
  return (
    <>
      <Block section="homework">
        <div className="rp-card">
          <h3 className="rp-card-title">Homework assignments</h3>
          <p className="rp-muted">Sorted by: Newest first · {assignmentsList.length} assignments · {folders.length} folders</p>
          {assignmentsList.length === 0 && (
            <p className="rp-muted">No puzzle homework yet. Puzzles the coach assigns (or the student solves in practice) appear here as completed / incomplete entries.</p>
          )}
        </div>
      </Block>
      {folders.map((f) => (
        <Block key={f.key} section="homework">
          <div className="rp-card">
            <h4 className="rp-subcard-title">{f.name}</h4>
            <p className="rp-muted">{f.total} {f.kind === 'puzzle' ? 'puzzles' : 'assignments'} · {f.completed} completed{f.overdue > 0 ? ` · ${f.overdue} overdue` : ''}</p>
          </div>
        </Block>
      ))}
      {/* Item rows stay in the app: the PDF carries folder summaries only. */}
    </>
  );
}

/* ── root ────────────────────────────────────────────────────────────── */

export default function StudentReportPrint({ report, chess, tournaments }) {
  const { profile, rating, performance, activity, assignmentsList, classes } = report;
  const rated = performance.rated;
  const online = performance.online;
  const tdf = performance.tournaments;
  return (
    <div id="sr-print-root" aria-hidden="true" style={{
      position: 'fixed', left: '-10000px', top: 0, width: PRINT_WIDTH_PX,
      background: '#ffffff', pointerEvents: 'none',
    }}>
      <PrintHeader profile={profile} />
      <PrintCombined chess={chess} />
      <PrintStudent rating={rating} performance={performance} activity={activity || []} />
      <TournamentPrint tournaments={tournaments} />
      <PrintClasses performance={performance} classes={classes} />
      <PrintUser profile={profile} />
      <PrintClassrooms profile={profile} />
      <PrintAssignments assignmentsList={assignmentsList || []} />
      <PrintHomework assignmentsList={assignmentsList || []} />
    </div>
  );
}

function PrintCombined({ chess }) {
  if (!chess) {
    return (
      <Block section="combined">
        <div className="rp-card"><p className="rp-muted">Comparison unavailable.</p></div>
      </Block>
    );
  }
  return <PrintComparison chess={chess} />;
}

/* ── exporter ────────────────────────────────────────────────────────── */

function stampPage(pdf, pageNo, total, header, dateStr) {
  pdf.setPage(pageNo);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(110);
  pdf.text(`${APP_NAME} · ${header}`, PAGE.M, 13);
  const footerY = PAGE.H - 10;
  pdf.text(`Page ${pageNo} of ${total}`, PAGE.M, footerY);
  pdf.text(APP_COPYRIGHT, PAGE.W / 2, footerY, { align: 'center' });
  const dateLabel = dateStr;
  const dateW = pdf.getTextWidth(dateLabel);
  pdf.text(dateLabel, PAGE.W - PAGE.M - dateW, footerY);
}

/**
 * Capture every print block and lay the canvases onto A4 pages.
 *
 * Packing rules (the fix for split cards and blank pages):
 *  - a new section starts a new page UNLESS the whole section fits in the
 *    remaining space — short sections share pages instead of leaving blanks;
 *  - a continued section repeats its title at the top of the new page;
 *  - blocks are never split: a block taller than a page is the only thing that
 *    can still cross a boundary, and no block is built that tall.
 * Returns the finished jsPDF (caller saves it).
 */
export async function exportStudentReportPdf({ root, name, sections, dateStr }) {
  await document.fonts.ready;
  const imgs = [...root.querySelectorAll('img')];
  await Promise.all(imgs.map((im) => (im.decode ? im.decode().catch(() => {}) : Promise.resolve())));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const labelOf = (key) => (sections.find((s) => s[0] === key) || [])[1] || 'Student Report';
  const nodes = [...root.querySelectorAll('[data-print-block]')];
  const blocks = [];
  for (const el of nodes) {
    /* One bad node (e.g. an avatar image the browser refuses to rasterise)
       must not nuke the whole report — skip it and keep going. */
    try {
      const canvas = await html2canvas(el, {
        scale: SCALE, backgroundColor: '#ffffff', logging: false, useCORS: true,
      });
      blocks.push({
        canvas,
        mmH: (canvas.height * CONTENT_W_MM) / canvas.width,
        section: el.dataset.printSection,
      });
    } catch (err) {
      console.warn('[print] skipping a block that would not rasterise', err);
    }
  }
  if (!blocks.length) throw new Error('nothing printable was rendered');

  /* Pack blocks onto pages. A section starts a new page unless it fits whole
     in the remaining space (short sections share pages instead of leaving
     blanks); a continued section repeats its title. Titles are only ever
     emitted onto a page the following block fits on, so one can never strand
     at the bottom alone. */
  const pages = []; // { items: [{kind:'title',label,fresh} | {kind:'art',canvas,mmH}], section }
  let cur = null;
  const newPage = () => { cur = { items: [], used: 0, section: null }; pages.push(cur); };
  const noteSection = (key) => { if (key && !cur.section) cur.section = key; };
  const pushTitle = (label, continued) => {
    cur.items.push({ kind: 'title', label: continued ? `${label} (continued)` : label, fresh: true });
    cur.used += TITLE_MM;
  };
  newPage();
  let currentSection = null;
  for (const b of blocks) {
    const isCover = b.section === 'cover';
    const startsNew = b.section !== currentSection;
    currentSection = b.section;
    if (startsNew && !isCover) {
      if (cur.used > 0 && cur.used + TITLE_MM + b.mmH > USABLE_MM) newPage();
      pushTitle(labelOf(b.section), false);
      noteSection(b.section);
    } else {
      noteSection(isCover ? null : b.section);
    }
    if (cur.used + b.mmH > USABLE_MM && cur.used > 0) {
      /* The block needs a fresh page. If the title just emitted above is now
         stranded alone at the bottom, pull it back first. */
      const last = cur.items[cur.items.length - 1];
      if (last && last.kind === 'title' && last.fresh) {
        cur.items.pop();
        cur.used -= TITLE_MM;
      }
      newPage();
      if (!isCover) {
        pushTitle(labelOf(b.section), true);
        noteSection(b.section);
      }
    }
    for (const item of cur.items) item.fresh = false;
    cur.items.push({ kind: 'art', canvas: b.canvas, mmH: b.mmH });
    cur.used += b.mmH;
  }

  /* Draw: one physical page per logical page. Without the addPage call below,
     every page's content, headers and footers land on jsPDF's single initial
     page stacked on top of each other — and getNumberOfPages() stays 1, so
     every footer reads "of 1". */
  const pdf = new jsPDF('p', 'mm', 'a4');
  pages.forEach((page, pageIdx) => {
    if (pageIdx > 0) pdf.addPage();
    let y = TOP_MM;
    for (const item of page.items) {
      if (item.kind === 'title') {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(12);
        pdf.setTextColor(30);
        pdf.text(String(item.label).slice(0, 90), PAGE.M, y + 4);
        y += TITLE_MM;
      } else {
        pdf.addImage(item.canvas.toDataURL('image/jpeg', 0.95), 'JPEG', PAGE.M, y, CONTENT_W_MM, item.mmH);
        y += item.mmH;
      }
    }
  });

  /* Header + footer on every page, cover included. */
  const total = pdf.getNumberOfPages();
  pages.forEach((page, i) => {
    const label = page.section && page.section !== 'cover' ? labelOf(page.section) : 'Student Report';
    stampPage(pdf, i + 1, total, `${name} — ${label}`, dateStr);
  });
  return pdf;
}
