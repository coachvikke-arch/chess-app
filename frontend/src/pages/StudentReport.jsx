import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  LineChart, PctBar, BarChart, DonutChart, DonutLegend, resultSegments,
  FormStrip, rollingWinRateSeries, gamesPerMonth, CompareBars, RatingBars,
} from '../utils/charts';
import { Chip, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import StudentAvatar from '../components/StudentAvatar';
import HomeworkPuzzleCard from '../components/HomeworkPuzzleCard';
import StudentReportPrint, { exportStudentReportPdf } from './StudentReportPrint';
import Button from '../components/Button';
import PhoneInput from '../components/PhoneInput';
import { formatPhoneDisplay, splitPhone, toE164 } from '../utils/phone';
import { useTournamentReport } from '../features/tournaments/useTournamentReport';
import TournamentReportSection from '../features/tournaments/TournamentReportSection';
import usePageTitle from '../hooks/usePageTitle';
import { APP_NAME } from '../config/brand';

/* Admin "Student report" — opened from the roster in a new tab at
   /students/:studentId/report. Fetches everything it needs from the URL and can
   be printed to PDF. Layout mirrors the classic coaching-portal report: identity
   card up top, then a section rail (Combined / Student / Classes & Quota / User
   Information / Classrooms / Assignments / Homework assignments). */

export const TYPE_META = {
  puzzle:    { glyph: '♟', color: '#93c5fd' },
  assignment:{ glyph: '♙', color: '#e58f4a' },
  quiz:      { glyph: '❓', color: '#7bc96f' },
  lesson:    { glyph: '♜', color: '#6bc5d0' },
  class:     { glyph: '♘', color: '#b3a06d' },
  training:  { glyph: '♔', color: '#c792ea' },
  match:     { glyph: '♞', color: '#93c5fd' },
  review:    { glyph: '♝', color: '#7bc96f' },
};

export const SECTIONS = [
  ['combined', 'Combined report', '♟'],
  ['student', 'Student report', '♞'],
  ['tournaments', 'Tournaments', '♛'],
  ['classes', 'Classes & Quota', '♘'],
  ['user', 'User Information', '♜'],
  ['classrooms', 'Classrooms', '♝'],
  ['assignments', 'Assignments', '♙'],
  ['homework', 'Homework assignments', '♟'],
];

/**
 * The section rail.
 *
 * THREE independent guards, because any one of them alone was not enough:
 *
 * 1. MODULE LEVEL. Declared inside StudentReport's render body it was a new
 *    function identity - a new component TYPE to React - on every render of a
 *    page holding ~25 pieces of state. React reconciles a changed type by
 *    unmounting the old subtree and mounting a new one, so all seven buttons
 *    were rebuilt on every click and every unrelated state change, taking the
 *    scroll position with them.
 *
 * 2. memo, with ONLY stable props. `sections` is a module constant, `onSelect`
 *    is a useCallback with no dependencies and `navRef` is a ref object, so all
 *    three are referentially constant for the life of the page. The only prop
 *    that ever changes is `active` - which is the one change that is wanted.
 *    Every other state change in StudentReport (sort, homework filter, a toast,
 *    the lazy chess fetch resolving) now short-circuits at the memo boundary and
 *    the rail does not re-render at all.
 *
 * 3. Its OWN scroll container, sticky on md+. The rail used to have no overflow
 *    of its own, so "the list's scroll position" was really the window's - and
 *    switching section changed the document height, which clamped scrollY and
 *    threw the reader back to the top. With its own overflow the rail's
 *    position is entirely its own business and cannot be disturbed by whatever
 *    the content pane does.
 */
const SectionNav = memo(function SectionNav({ sections, active, onSelect, navRef }) {
  return (
    <nav
      ref={navRef}
      aria-label="Report sections"
      className="chess-card !p-2 md:sticky md:top-4 md:max-h-[calc(100vh-2rem)] md:overflow-y-auto"
    >
      {sections.map(([key, label, glyph]) => (
        <button
          key={key}
          type="button"
          onClick={() => onSelect(key)}
          aria-current={active === key ? 'page' : undefined}
          className={`flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
            active === key ? 'bg-gold-500/90 text-ink-950 font-semibold' : 'text-ivory-300 hover:bg-black/5'
          }`}
        >
          <span className="text-base">{glyph}</span>
          {label}
        </button>
      ))}
    </nav>
  );
});

const GENDERS = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];
const LANGUAGES = ['English', 'Hindi', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Marathi', 'Bengali', 'Gujarati', 'Other'];

export function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':');
  const hr = Number(h);
  const ampm = hr >= 12 ? 'PM' : 'AM';
  const hh = hr % 12 === 0 ? 12 : hr % 12;
  return `${hh}:${m || '00'} ${ampm}`;
}

function initials(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

export function cap(v) {
  return v && String(v).charAt(0).toUpperCase() + String(v).slice(1);
}

/* Folder label from the set's puzzle titles — uses their longest common
   prefix (e.g. "MATE IN 4 (A) #4", "#5" → "MATE IN 4 (A)") so slug set codes
   like "CSTmateinj4a" become readable. Falls back to the set code. */
export function folderName(items, fallback) {
  const titles = items.map((a) => String(a.title || '').trim()).filter(Boolean);
  if (titles.length === 0) return fallback || 'Practice';
  let prefix = titles[0].split(/\s+/);
  for (const t of titles.slice(1)) {
    const w = t.split(/\s+/);
    let n = 0;
    while (n < prefix.length && n < w.length && prefix[n] === w[n]) n++;
    prefix = prefix.slice(0, n);
    if (prefix.length === 0) break;
  }
  const name = prefix.join(' ').replace(/\s*#+\s*$/, '').trim();
  return name || fallback || titles[0];
}

export function winRate(w, l, d) {
  const total = w + l + d;
  return total ? Math.round((w / total) * 100) : 0;
}

// Homework folders: group puzzle homework by set, then sort groups by their
// newest item (or title order for the "Title A–Z" sort). Shared with the print
// layout, which always uses newest-first with no search filter.
export function buildFolders(list, sort = 'newest') {
  const byKey = new Map();
  for (const a of list) {
    const key = a.kind === 'puzzle' ? ((a.setCode || '').trim() || 'practice') : '__assignments__';
    let g = byKey.get(key);
    if (!g) { g = { key, kind: a.kind, items: [] }; byKey.set(key, g); }
    g.items.push(a);
  }
  const folders = [];
  for (const g of byKey.values()) {
    const items = sort === 'title' ? g.items.slice().sort((a, b) => a.title.localeCompare(b.title)) : g.items;
    folders.push({
      key: g.key,
      kind: g.kind,
      name: g.key === '__assignments__' ? 'Assignments' : folderName(items, g.key),
      items,
      total: items.length,
      completed: items.filter((a) => a.submitted).length,
      overdue: items.filter((a) => !a.submitted && a.dueDate && new Date(a.dueDate) < new Date()).length,
      newest: Math.max(-1, ...items.map((a) => new Date(a.assignedAt || 0).getTime())),
    });
  }
  folders.sort((a, b) => {
    if (sort === 'title') return a.name.localeCompare(b.name);
    const d = (x) => x.newest || 0;
    return sort === 'oldest' ? d(a) - d(b) : d(b) - d(a);
  });
  return folders;
}

function SafeStat({ label, value, sub, icon = '♙' }) {
  return (
    <div className="chess-card !p-4">
      <div className="text-xl text-gold-400">{icon}</div>
      <div className="text-2xl font-display font-bold text-ivory-100">{value}</div>
      <div className="text-xs font-medium text-ivory-500 mt-1">{label}</div>
      {sub && <div className="text-[0.7rem] text-ivory-500 mt-0.5">{sub}</div>}
    </div>
  );
}

/* ── Comparison report helpers (academy vs Chess.com & Lichess) ── */

function internalByColor(games = []) {
  const out = {
    white: { games: 0, wins: 0 },
    black: { games: 0, wins: 0 },
  };
  for (const g of games) {
    if (g.myColor !== 'white' && g.myColor !== 'black') continue;
    out[g.myColor].games++;
    if (g.mineWon === true) out[g.myColor].wins++;
  }
  return out;
}

function longestWinStreak(games = []) {
  let best = 0;
  let cur = 0;
  const sorted = [...games].sort((a, b) => new Date(a.date) - new Date(b.date));
  for (const g of sorted) {
    if (g.mineWon === true) { cur++; best = Math.max(best, cur); }
    else if (g.mineWon === false) cur = 0;
  }
  return best;
}

function pctWins(w, g) {
  return g > 0 ? `${Math.round((w / g) * 100)}%` : '—';
}

/* Build the three side-by-side columns: Academy | Chess.com | Lichess. */
export function cmpColumns(chess) {
  const ih = chess.internalHistory;
  const internal = ih
    ? {
        games: ih.summary?.games ?? 0,
        wins: ih.summary?.wins ?? 0,
        draws: ih.summary?.draws ?? 0,
        losses: ih.summary?.losses ?? 0,
        winRate: ih.summary?.winRate ?? 0,
        byColor: internalByColor(ih.games || []),
        last30: (ih.games || []).filter(
          (g) => g.date && +new Date(g.date) >= Date.now() - 30 * 86400000
        ).length,
        streak: longestWinStreak(ih.games || []),
      }
    : null;

  const extCol = (stats, ops) => {
    if (!stats || stats.totalGames <= 0) return null;
    const w = stats.byColor?.white;
    const b = stats.byColor?.black;
    return {
      games: stats.totalGames,
      wins: stats.wins,
      draws: stats.draws,
      losses: stats.losses,
      winRate: stats.winRate,
      white: pctWins(w?.wins ?? 0, w?.games ?? 0),
      black: pctWins(b?.wins ?? 0, b?.games ?? 0),
      best: ops?.best?.[0]?.games >= 3
        ? `${ops.best[0].name} · ${ops.best[0].winRate}%`
        : '—',
      worst: ops?.worst?.[0]?.games >= 3
        ? `${ops.worst[0].name} · ${ops.worst[0].winRate}%`
        : '—',
      last30: stats.activity?.last30 ?? 0,
      streak: stats.streaks?.longestWin ? `+${stats.streaks.longestWin}` : '—',
    };
  };

  const ps = chess.platformStats || {};
  return [
    {
      key: 'academy',
      label: 'Academy (coach & computer)',
      data: internal && internal.games > 0
        ? {
            games: internal.games,
            wins: internal.wins,
            draws: internal.draws,
            losses: internal.losses,
            winRate: internal.winRate,
            white: pctWins(internal.byColor.white.wins, internal.byColor.white.games),
            black: pctWins(internal.byColor.black.wins, internal.byColor.black.games),
            best: '—',
            worst: '—',
            last30: internal.last30,
            streak: internal.streak ? `+${internal.streak}` : '—',
          }
        : null,
    },
    {
      key: 'chess.com',
      label: 'Chess.com',
      data: extCol(ps['chess.com']?.statistics, ps['chess.com']?.openings),
    },
    {
      key: 'lichess',
      label: 'Lichess',
      data: extCol(ps['lichess']?.statistics, ps['lichess']?.openings),
    },
  ];
}

/* ── Shared stat rows + side cards (left: academy, right: platforms) ── */

function StatRows({ rows }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between items-center border-b border-ivory-700/40 py-1.5 text-sm">
          <span className="text-ivory-500">{label}</span>
          <span className="text-ivory-300 font-medium">{value}</span>
        </div>
      ))}
    </div>
  );
}

function AcademyCard({ data }) {
  return (
    <div className="chess-card !p-5">
      <h3 className="font-display font-semibold text-base text-ivory-100 mb-1">Academy report</h3>
      <p className="text-xs text-ivory-500 mb-3">Coach & computer games</p>
      {!data ? (
        <p className="text-sm text-ivory-500">No academy games recorded yet.</p>
      ) : (
        <StatRows rows={[
          ['Games', data.games],
          ['Win rate', `${data.winRate}%`],
          ['W / D / L', `${data.wins} / ${data.draws} / ${data.losses}`],
          ['White win rate', data.white],
          ['Black win rate', data.black],
          ['Longest win streak', data.streak],
          ['Last 30 days', data.last30],
        ]} />
      )}
    </div>
  );
}

function PlatformCard({ label, data, account }) {
  const ratings = (account && account.ratings) || [];
  const rapid = ratings.find((r) => r.category === 'rapid');
  const rated = ratings.filter((r) => r.category !== 'puzzle');
  const bestRating = rapid
    ? rapid.rating
    : rated.length
      ? Math.max(...rated.map((r) => r.rating || 0))
      : null;
  return (
    <div className="chess-card !p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h3 className="font-display font-semibold text-base text-ivory-100">{label} report</h3>
        {account && <span className="text-xs text-gold-400">{account.username}{bestRating ? ` · ${bestRating}` : ''}</span>}
      </div>
      <p className="text-xs text-ivory-500 mb-3">Imported from {label}</p>
      {!data ? (
        <p className="text-sm text-ivory-500">Account connected but no imported games yet — sync to fill this in.</p>
      ) : (
        <StatRows rows={[
          ['Games', data.games],
          ['Win rate', `${data.winRate}%`],
          ['W / D / L', `${data.wins} / ${data.draws} / ${data.losses}`],
          ['White win rate', data.white],
          ['Black win rate', data.black],
          ['Best opening', data.best],
          ['Weakest opening', data.worst],
          ['Longest win streak', data.streak],
          ['Last 30 days', data.last30],
        ]} />
      )}
    </div>
  );
}

/* ── Modern chart panel: the same numbers, drawn ────────────────────────────
   The stat cards above state the figures as text; this turns them into
   visuals so a coach can read the shape of a student's form at a glance.
   Everything here is derived from data already on the client — no new
   endpoints, and nothing that would break the PDF export. */
function DashboardPanel({ academy, platforms, chess }) {
  /* Only sources that actually have games: `academy.data` is null when the
     student has no academy history, which still lets the panel render (a linked
     platform is enough for anyData), so filtering here is what keeps the
     stat/donut sections below from reading off a null. */
  const sources = [
    { label: 'Academy', color: '#60a5fa', data: academy?.data || null },
    ...(platforms || [])
      .filter((p) => p.data)
      .map((p) => ({ label: p.label, color: '#93c5fd', data: p.data })),
  ].filter((s) => s.data);
  if (!sources.length) return null;

  /* Win rate is a percentage and the only metric where "bigger is better"
     across all sources, so it gets a real comparison. Games volume is shown
     on its own scale — comparing a 3-game sample to a 900-game platform
     account on one axis would just flatter whoever has played most. */
  const rateRows = sources
    .filter((s) => Number.isFinite(Number(s.data.winRate)))
    .map((s) => ({
      label: s.label,
      value: Number(s.data.winRate),
      display: `${s.data.winRate}%`,
      color: s.color,
    }));

  const trend = rollingWinRateSeries(chess?.internalHistory?.games || [], 5);
  const volume = gamesPerMonth(chess?.internalHistory?.games || [], 6);
  const hasVolume = volume.some((v) => v.value > 0);

  return (
    <div className="chess-card !p-5">
      <h2 className="font-display font-semibold text-lg text-ivory-100 mb-1">Performance charts</h2>
      <p className="text-xs text-ivory-500 mb-4">
        Drawn from the same figures below — win/draw/loss mix, form and volume.
      </p>

      {/* Headline numbers */}
      <div className="cp-metric-grid mb-5">
        {sources.map((s) => (
          <div key={s.label} className="cp-metric">
            <p className="cp-metric-label">{s.label}</p>
            <p className="cp-metric-value">{s.data.winRate}%</p>
            <p className="cp-metric-sub">
              win rate · {s.data.games} game{s.data.games === 1 ? '' : 's'}
            </p>
          </div>
        ))}
      </div>

      {/* W / D / L split per source */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {sources.map((s) => {
          const segs = resultSegments(s.data);
          const played = (s.data.wins || 0) + (s.data.draws || 0) + (s.data.losses || 0);
          return (
            <div key={s.label} className="flex items-center gap-4">
              <DonutChart
                segments={segs}
                centerValue={String(played)}
                centerLabel="games"
              />
              <div className="flex-1">
                <p className="text-sm font-bold text-ivory-100 mb-2">{s.label}</p>
                <DonutLegend segments={segs} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Win rate head-to-head */}
      {rateRows.length > 1 && (
        <div className="cp-chart-block">
          <p className="cp-chart-title">Win rate compared</p>
          <CompareBars rows={rateRows} />
        </div>
      )}

      {/* Academy form + rolling win rate */}
      {chess?.internalHistory?.games?.length > 0 && (
        <div className="cp-chart-block">
          <p className="cp-chart-title">Academy form — last games</p>
          <FormStrip games={chess.internalHistory.games} limit={16} />
        </div>
      )}
      {trend.points.length >= 2 && (
        <div className="cp-chart-block">
          <p className="cp-chart-title">Rolling win rate (last 5 games)</p>
          <LineChart
            points={trend.points}
            labels={trend.labels}
            height={140}
            stroke="#22c55e"
            format={(v) => `${v}%`}
          />
        </div>
      )}

      {/* Games per month */}
      {hasVolume && (
        <div className="cp-chart-block">
          <p className="cp-chart-title">Academy games per month</p>
          <BarChart items={volume} color="#60a5fa" />
        </div>
      )}

      {/* Platform ratings */}
      {(platforms || []).map((p) => (
        p.account?.ratings?.length ? (
          <div key={p.key} className="cp-chart-block">
            <p className="cp-chart-title">{p.label} rating by category</p>
            <RatingBars ratings={p.account.ratings} />
          </div>
        ) : null
      ))}
    </div>
  );
}

/* ── Best-performance comparison (winner per metric) ── */

export function bestOf(cands, fn) {
  let bestVal = -Infinity;
  let best = null;
  let tie = false;
  for (const c of cands) {
    const v = Number(fn(c.data));
    if (!Number.isFinite(v)) continue;
    if (v > bestVal) { bestVal = v; best = c; tie = false; }
    else if (v === bestVal) tie = true;
  }
  return tie ? { tie: true, value: bestVal } : { best, value: bestVal };
}

export function pctNum(v) {
  const n = Number(String(v || '').replace(/%/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function streakNum(v) {
  const n = Number(String(v || '').replace(/[+—]/g, '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function renderVerdict(academy, platforms) {
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
  const headline =
    winRateRow.winner === 'Tied'
      ? 'Win rates are level across the academy and online platforms.'
      : `${winRateRow.winner} posts the best win rate (${winRateRow.value}).`;

  return (
    <div className="chess-card !p-5">
      <h2 className="font-display font-semibold text-lg text-ivory-100 mb-2">Best performance comparison</h2>
      <p className="text-sm text-ivory-300 mb-4">{headline}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ivory-500 border-b border-ivory-700/50">
              <th className="py-2 pr-4 font-medium">Metric</th>
              <th className="py-2 pr-4 font-medium">Best</th>
              <th className="py-2 font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {resolved.map((r) => (
              <tr key={r.metric} className="border-b border-ivory-700/40">
                <td className="py-2 pr-4 text-ivory-500">{r.metric}</td>
                <td className="py-2 pr-4">
                  <span
                    className="font-semibold"
                    style={{ color: r.winner === 'Academy' ? '#60a5fa' : r.winner === 'Tied' ? undefined : '#93c5fd' }}
                  >
                    {r.winner}
                  </span>
                </td>
                <td className="py-2 text-ivory-300">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* Puzzle homework folder: loads every puzzle's attempt records up front and
   shows them inline under each puzzle so no click is needed. */
function HomeworkPuzzleFolder({ studentId, items }) {
  const refKey = (items || []).map((a) => a.refId).join(',');
  const [details, setDetails] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all(
      (items || []).map((a) =>
        api
          .get(`/students/${studentId}/puzzle/${a.refId}/report`)
          .then((res) => ({ refId: a.refId, data: res.data }))
          .catch(() => ({ refId: a.refId, data: null }))
      )
    ).then((rows) => {
      if (!alive) return;
      const map = {};
      rows.forEach((r) => { if (r.refId != null) map[r.refId] = r.data; });
      setDetails(map);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [studentId, refKey]);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 mt-3">
      {(items || []).map((a) => (
        <HomeworkPuzzleCard
          key={a.refId}
          item={a}
          expanded
          detail={details[a.refId] || null}
          detailLoading={loading}
          detailError=""
          onToggle={() => {}}
        />
      ))}
    </div>
  );
}

/* Shared by the admin roster view (/students/:studentId/report, id from the URL)
   and the student's own view (/student/report, id from the session as 'me').
   In studentMode the admin-only actions (edit / delete, roster dropdown data)
   are hidden — the sections, their order, and the PDF export are identical. */
export default function StudentReport({ studentId: propId, studentMode = false }) {
  usePageTitle(studentMode ? 'My Report' : 'Student Report');
  const { studentId: paramId } = useParams();
  const studentId = propId ?? paramId;
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user } = useAuth();
  const isSuper = user?.role === 'superadmin';
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [busyPdf, setBusyPdf] = useState(false);
  const [section, setSection] = useState('combined');

  /* ── Section switching must not disturb the rail, or the page ──────────────
   *
   * The rail is protected structurally, not by patching symptoms:
   *   - it is memo'd and receives only stable props (see SectionNav), so a
   *     section change re-renders exactly one button
   *   - it is its own sticky scroll container, so its offset is independent of
   *     the document
   *   - the content pane carries min-h-screen, so the document never shrinks
   *     when a short section is shown and the browser can never clamp scrollY
   * That last one is why there is no window.scrollTo here any more: keeping the
   * document tall makes the clamp impossible, rather than undoing it after the
   * fact. The one scrollTop guard below is kept because the rail now genuinely
   * overflows, so it has a scroll position of its own worth protecting. */
  const sectionNavRef = useRef(null);
  const savedRailScroll = useRef(0);

  /* Stable identity: the rail is handed the same function on every render, so
   * nothing downstream can be re-created just because a section was picked. */
  const selectSection = useCallback((key) => {
    savedRailScroll.current = sectionNavRef.current?.scrollTop || 0;
    setSection(key);
  }, []);

  /* Sections are mounted on FIRST VISIT and then kept mounted, hidden. Returning
   * to a section therefore costs nothing: no remount, no refetch, and any state
   * the panel built up while it was on screen is still there. */
  const [visitedSections, setVisitedSections] = useState(() => new Set(['combined']));
  useEffect(() => {
    setVisitedSections((prev) => {
      if (prev.has(section)) return prev; // already mounted; identity preserved
      const next = new Set(prev);
      next.add(section);
      return next;
    });
  }, [section]);

  useLayoutEffect(() => {
    const rail = sectionNavRef.current;
    if (rail && savedRailScroll.current) rail.scrollTop = savedRailScroll.current;
  }, [section]);
  const [sort, setSort] = useState('newest');
  const [hwQuery, setHwQuery] = useState('');
  const [hwStatus, setHwStatus] = useState('all'); // all | completed | pending | overdue
  const [openFolders, setOpenFolders] = useState(null); // null → first folder expanded
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [groups, setGroups] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [detail, setDetail] = useState(null);      // expanded puzzle answers (inline)
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [expandedRefId, setExpandedRefId] = useState(null); // card whose answers are open
  const [chess, setChess] = useState(null);                          // combined chess comparison data
  const [chessLoading, setChessLoading] = useState(false);
  const [chessError, setChessError] = useState('');
  const [chessFetched, setChessFetched] = useState(false);
  const [printJob, setPrintJob] = useState(null); // { chess, tournaments } while the hidden print layout is mounted

  /* Tournament report: loads on the first visit to the tab (or when the PDF
     export needs it) so the report page stays light until it is opened. */
  const tournamentReport = useTournamentReport({
    active: section === 'tournaments',
    studentMode,
  });

  function togglePuzzleDetail(refId) {
    if (expandedRefId === refId) {
      setExpandedRefId(null);
      setDetail(null);
      setDetailError('');
      return;
    }
    setExpandedRefId(refId);
    setDetailLoading(true);
    setDetailError('');
    setDetail(null);
    api
      .get(`/students/${studentId}/puzzle/${refId}/report`)
      .then((res) => setDetail(res.data))
      .catch((e) => setDetailError(e.response?.data?.message || 'Failed to load puzzle answers'))
      .finally(() => setDetailLoading(false));
  }

  useEffect(() => {
    /* Roster dropdowns feed the admin edit form only — a student never sees it,
       and both endpoints are admin-gated, so don't even ask. */
    if (studentMode) return;
    api.get('/groups').then((res) => setGroups(res.data || [])).catch(() => {});
    api.get('/students/coaches').then((res) => setCoaches(res.data || [])).catch(() => {});
  }, [studentMode]);

  useEffect(() => {
    let alive = true;
    api
      .get(`/students/${studentId}/report`)
      .then((res) => alive && setReport(res.data))
      .catch((e) => alive && setError(e.response?.data?.message || e.message || 'Failed to load report'));
    return () => { alive = false; };
  }, [studentId]);

  // Reset the combined comparison data whenever the student changes.
  useEffect(() => {
    setChess(null);
    setChessFetched(false);
    setChessError('');
  }, [studentId]);

  // Lazy-load the comparison report the first time the Combined tab opens.
  useEffect(() => {
    if (section !== 'combined' || chessFetched || chessLoading) return;
    setChessLoading(true);
    api
      .get(`/students/${studentId}/chess-report`)
      .then((res) => setChess(res.data))
      .catch((e) => setChessError(e.response?.data?.message || e.message || 'Failed to load comparison'))
      .finally(() => { setChessFetched(true); setChessLoading(false); });
  }, [section, studentId, chessFetched, chessLoading]);

  async function reload() {
    try {
      const res = await api.get(`/students/${studentId}/report`);
      setReport(res.data);
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Failed to load report');
    }
  }

  /* Fixed PDF export, rendered from a dedicated hidden print layout
     (StudentReportPrint) rather than the visible page — so scrollbars, fixed
     heights, collapsed folders, interactive controls and device widths can
     never leak into the file. The on-screen tab is left exactly where it was:
     nothing here touches `section`. */
  async function downloadPdf() {
    if (busyPdf) return;
    setBusyPdf(true);
    try {
      /* The combined tab lazy-loads — make sure its data exists before the
         print layout mounts, otherwise its pages would only hold spinners. */
      let chessData = chess;
      if (!chessFetched) {
        try {
          const res = await api.get(`/students/${studentId}/chess-report`);
          chessData = res.data;
          setChess(chessData);
        } catch {
          /* the print layout renders its own error state */
        }
        setChessFetched(true);
      }
      /* The tournament tab also lazy-loads — resolve its rows before the print
         layout mounts so the PDF carries the tournament section too. */
      let tournamentData = tournamentReport.payload;
      try {
        tournamentData = await tournamentReport.ensureLoaded();
      } catch {
        /* the print layout renders its own empty state */
      }
      setPrintJob({ chess: chessData, tournaments: tournamentData });
      /* Let the print layout mount and paint (fonts + avatar decode are awaited
         inside the exporter itself). */
      await new Promise((r) => setTimeout(r, 120));
      const root = document.getElementById('sr-print-root');
      if (!root) throw new Error('print layout unavailable');
      const who = report?.profile?.name || 'Student';
      const pdf = await exportStudentReportPdf({
        root,
        name: who,
        sections: SECTIONS,
        dateStr: fmtDate(new Date().toISOString()),
      });
      const safe = who.replace(/[^a-z0-9]+/gi, '_');
      pdf.save(`${safe}_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      alert('PDF export failed: ' + err.message);
    } finally {
      setPrintJob(null);
      setBusyPdf(false);
    }
  }

  function startEdit() {
    const p = report?.profile || {};
    const phone = splitPhone(p.phone, p.country_code);
    setEditForm({
      name: p.name || '',
      email: p.email || '',
      countryCode: phone.countryCode,
      phoneNumber: phone.phoneNumber,
      nickname: p.nickname || '',
      birthdate: p.birthdate ? String(p.birthdate).slice(0, 10) : '',
      parentName: p.parent_name || '',
      gender: p.gender || '',
      preferredLanguage: p.preferred_language || '',
      groupId: p.group_id ? String(p.group_id) : '',
      coachIds: (p.coaches || []).map((c) => String(c.id)),
      active: p.active !== false,
    });
    setEditOpen(true);
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!editForm) return;
    setEditSaving(true);
    try {
      const payload = {
        name: editForm.name,
        email: editForm.email,
        countryCode: editForm.countryCode,
        phoneNumber: editForm.phoneNumber,
        phone: toE164(editForm.countryCode, editForm.phoneNumber),
        active: editForm.active,
        nickname: editForm.nickname || undefined,
        birthdate: editForm.birthdate || undefined,
        parentName: editForm.parentName || undefined,
        gender: editForm.gender || undefined,
        preferredLanguage: editForm.preferredLanguage || undefined,
        groupId: editForm.groupId || null,
      };
      if (isSuper) payload.coachIds = editForm.coachIds || [];
      await api.put(`/students/${studentId}`, payload);
      setEditOpen(false);
      await reload();
      showToast('Student updated — changes are live on this report.', {
        tone: 'success',
        title: 'Student updated',
      });
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to update student', {
        tone: 'error',
        title: 'Update failed',
      });
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete ${report.profile.name}? This permanently removes the account and all their records.`)) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/students/${studentId}`);
      navigate('/admin/students');
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to delete student', {
        tone: 'error',
        title: 'Delete failed',
      });
      setDeleteBusy(false);
    }
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <div className="text-6xl mb-4 text-gold-400">♞</div>
        <h1 className="font-display text-2xl font-bold mb-2">Report unavailable</h1>
        <p className="text-ivory-500 mb-6">{error}</p>
        <Button to={studentMode ? '/student/dashboard' : '/admin/students'} variant="primary" size="md">
          {studentMode ? '← Back to Dashboard' : '← Back to Students'}
        </Button>
      </div>
    );
  }

  if (!report) return <div className="max-w-6xl mx-auto px-4 pt-8"><Spinner /></div>;

  const { profile, rating, performance, activity, coachNotes, assignmentsList, classes } = report;
  const rated = performance.rated;
  const online = performance.online;
  const tdf = performance.tournaments;

  const hist = (rating?.history || []).slice();
  const chartStep = Math.max(1, Math.ceil(hist.length / 24));
  const chartData = hist.filter((h, i) => i % chartStep === 0 || i === hist.length - 1);
  const chartPoints = chartData.map((h, i) => ({ x: i, value: h.rating }));
  const chartLabels = chartData.map((h) => fmtDate(h.played_at).split(' ').slice(0, 2).join(' '));

  const ledgerCompleted = assignmentsList.filter((a) => a.submitted);
  const ledgerPending = assignmentsList.filter((a) => !a.submitted);

  const sorted = assignmentsList.slice().sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    const da = new Date(a.assignedAt || 0).getTime();
    const db = new Date(b.assignedAt || 0).getTime();
    return sort === 'oldest' ? da - db : db - da;
  });

  // Homework folders: group puzzle homework by set, then sort groups by
  // their newest item (or title order for the "Title A–Z" sort).
  const homeworkFolders = buildFolders(sorted, sort);

  // Homework search + status filter (drives the filtered folders/chips below).
  const hwQueryLower = hwQuery.trim().toLowerCase();
  const hwStatusOf = (a) =>
    a.submitted ? 'completed'
    : a.dueDate && new Date(a.dueDate) < new Date() ? 'overdue'
    : 'pending';
  const filteredSorted = sorted.filter((a) => {
    if (hwQueryLower && !String(a.title || '').toLowerCase().includes(hwQueryLower)) return false;
    if (hwStatus !== 'all' && hwStatusOf(a) !== hwStatus) return false;
    return true;
  });
  const filteredFolders = buildFolders(filteredSorted, sort);
  const filteredCompleted = filteredSorted.filter((a) => a.submitted);
  const filteredPending = filteredSorted.filter((a) => !a.submitted);
  const hwFilterActive = hwQuery.trim() !== '' || hwStatus !== 'all';

  /* Brand-new account: nothing recorded anywhere yet. One banner explains the
     empty sections below instead of leaving a wall of zeroes unexplained. */
  const isEmptyReport =
    (activity || []).length === 0 &&
    (assignmentsList || []).length === 0 &&
    (classes?.attended || []).length === 0 &&
    (rated?.games || 0) === 0 &&
    (online?.games || 0) === 0 &&
    (performance?.attendance?.total || 0) === 0;

  function renderHeader() {
    return (
      <div className="chess-card !p-5 mb-6">
        <div className="flex flex-wrap items-start gap-5">
          {profile.avatar_config ? (
            <StudentAvatar config={profile.avatar_config} seed={`user_${profile.user_id || ''}`} size={72} className="ring-2 ring-gold-500/40" />
          ) : profile.profile_image ? (
            <img src={profile.profile_image} alt="" className="w-[72px] h-[72px] rounded-2xl object-cover object-center ring-2 ring-gold-500/40" />
          ) : (
            <span className="grid place-items-center w-[72px] h-[72px] rounded-2xl bg-[var(--ink-900)] ring-2 ring-gold-500/40 text-2xl font-bold text-gold-400">
              {initials(profile.name)}
            </span>
          )}
          <div className="flex-1 min-w-[180px]">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-2xl font-bold text-ivory-100">{profile.name}</h1>
              <Chip tone={profile.active === false ? '' : 'green'}>{profile.active === false ? 'Inactive' : 'Active'}</Chip>
            </div>
            <p className="text-sm text-ivory-500 mt-1">{profile.email}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 mt-3 text-sm">
              <div><span className="text-ivory-500">Username</span><div className="font-medium text-ivory-300">{profile.nickname || profile.name}</div></div>
              <div><span className="text-ivory-500">Contact no.</span><div className="font-medium text-ivory-300">{formatPhoneDisplay(profile.phone, profile.country_code) || '—'}</div></div>
              <div><span className="text-ivory-500">Gender</span><div className="font-medium text-ivory-300">{cap(profile.gender) || '—'}</div></div>
              <div><span className="text-ivory-500">Date of birth</span><div className="font-medium text-ivory-300">{fmtDate(profile.birthdate)}</div></div>
            </div>
          </div>
          {!studentMode && (
            <div className="flex flex-col gap-2">
              <Button onClick={startEdit} variant="primary" size="md" className="!px-4 !py-2 text-sm">✎ Edit Student</Button>
              <Button onClick={handleDelete} disabled={deleteBusy} variant="danger" size="md" className="!px-4 !py-2 text-sm">
                {deleteBusy ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderUserInfo() {
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
      <div className="chess-card !p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-display font-semibold text-lg text-ivory-100">User Information</h2>
          {!studentMode && (
            <div className="flex gap-2">
              <Button onClick={startEdit} variant="primary" size="md" className="!px-4 !py-2 !text-sm">✎ Edit Student</Button>
              <Button onClick={handleDelete} disabled={deleteBusy} variant="danger" size="md" className="!px-4 !py-2 !text-sm">
                {deleteBusy ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-x-8">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 py-2 border-b border-ivory-700/40">
              <span className="text-sm text-ivory-500">{label}</span>
              <span className="text-sm font-medium text-ivory-300 text-right">{value || '—'}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderStatsOverview() {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <SafeStat icon="♚" label="Rapid Rating" value={rating?.currentRating ?? '—'} sub={`peak ${rating?.peakRating ?? '—'}`} />
        <SafeStat icon="♞" label="Rated games" value={rated.games} sub={`${rated.wins}W · ${rated.draws}D · ${rated.losses}L`} />
        <SafeStat icon="♗" label="Win rate" value={`${winRate(rated.wins, rated.losses, rated.draws)}%`} sub="rated matches" />
        <SafeStat icon="♘" label="Attendance" value={`${performance.attendance.pct}%`} sub={`${performance.attendance.present}/${performance.attendance.total} classes`} />
        <SafeStat icon="♟" label="Puzzles solved" value={performance.puzzles.solved} sub={`${performance.puzzles.accuracy}% accuracy`} />
        <SafeStat icon="♔" label="Academy XP" value={performance.academy.xp} sub={`${performance.academy.badges} badges`} />
      </div>
    );
  }

  function renderChart() {
    return (
      <div className="chess-card !p-5 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-display font-semibold text-lg text-ivory-100">Rating progression</h2>
          {rating?.isProvisional && <Chip>Provisional</Chip>}
        </div>
        <LineChart points={chartPoints} labels={chartLabels} height={170} />
      </div>
    );
  }

  function renderPerformance() {
    return (
      <div className="grid md:grid-cols-3 gap-3 mb-6">
        <div className="chess-card !p-5">
          <h3 className="font-display font-semibold text-ivory-100 mb-3">Rated record</h3>
          <PctBar label="Wins" value={winRate(rated.wins, rated.losses, rated.draws)} />
          <div className="mt-2 space-y-1 text-sm text-ivory-500">
            <div className="flex justify-between"><span>Wins</span><span className="text-gold-400 font-semibold">{rated.wins}</span></div>
            <div className="flex justify-between"><span>Draws</span><span className="font-semibold">{rated.draws}</span></div>
            <div className="flex justify-between"><span>Losses</span><span className="text-red-600 font-semibold">{rated.losses}</span></div>
          </div>
        </div>
        <div className="chess-card !p-5">
          <h3 className="font-display font-semibold text-ivory-100 mb-3">Online matches</h3>
          <PctBar label="Wins" value={winRate(online.wins, online.losses, online.draws)} />
          <div className="mt-2 space-y-1 text-sm text-ivory-500">
            <div className="flex justify-between"><span>Games</span><span className="font-semibold">{online.games}</span></div>
            <div className="flex justify-between"><span>W / D / L</span><span className="font-semibold">{online.wins} / {online.draws} / {online.losses}</span></div>
            <div className="flex justify-between"><span>Abandoned</span><span className="font-semibold">{online.abandoned}</span></div>
          </div>
        </div>
        <div className="chess-card !p-5">
          <h3 className="font-display font-semibold text-ivory-100 mb-3">Tournaments</h3>
          <PctBar label="Wins" value={winRate(tdf.wins, tdf.losses, tdf.draws)} />
          <div className="mt-2 space-y-1 text-sm text-ivory-500">
            <div className="flex justify-between"><span>Participated</span><span className="font-semibold">{tdf.participated}</span></div>
            <div className="flex justify-between"><span>W / D / L</span><span className="font-semibold">{tdf.wins} / {tdf.draws} / {tdf.losses}</span></div>
          </div>
        </div>
      </div>
    );
  }

  function renderActivity() {
    return (
      <div className="chess-card !p-5 mb-6">
        <h2 className="font-display font-semibold text-lg text-ivory-100 mb-3">Recent activity</h2>
        {activity.length === 0 && <p className="text-sm text-ivory-500">No activity recorded yet.</p>}
        <ul className="divide-y divide-white/5">
          {activity.map((a, i) => {
            const meta = TYPE_META[a.type] || TYPE_META.puzzle;
            return (
              <li key={i} className="flex items-center gap-3 py-2.5">
                <span className="grid place-items-center w-9 h-9 rounded-xl text-base shrink-0" style={{ background: `${meta.color}1f`, color: meta.color }}>{meta.glyph}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ivory-300 truncate">{a.title}</div>
                  <div className="text-xs text-ivory-500 truncate">{a.detail}</div>
                </div>
                <span className="text-xs text-ivory-500 shrink-0">{fmtDate(a.date)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  function renderClassesQuota() {
    const att = performance.attendance;
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SafeStat icon="♘" label="Classes attended" value={att.present} sub={`${att.pct}% attendance`} />
          <SafeStat icon="♜" label="Late arrivals" value={att.late} sub="marked late" />
          <SafeStat icon="♟" label="All sessions" value={att.total} sub="scheduled / logged" />
          <SafeStat icon="♔" label="Quota used" value={`${att.pct}%`} sub="based on attended classes" />
        </div>
        <div className="chess-card !p-5">
          <h2 className="font-display font-semibold text-lg text-ivory-100 mb-3">Attended classes</h2>
          {classes.attended.length === 0 && <p className="text-sm text-ivory-500">No classes attended yet.</p>}
          <ul className="divide-y divide-white/5">
            {classes.attended.map((c, i) => (
              <li key={i} className="flex items-center gap-3 py-2.5">
                <span className="grid place-items-center w-9 h-9 rounded-xl text-base bg-[var(--ink-900)] text-gold-400">♘</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ivory-300 truncate">{c.title}</div>
                  <div className="text-xs text-ivory-500">{fmtDate(c.classDate)}{c.startTime ? ` · ${fmtTime(c.startTime)}` : ''}</div>
                </div>
                <Chip tone={c.attendance === 'present' ? 'green' : ''}>{c.attendance === 'present' ? 'Present' : 'Late'}</Chip>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  function renderClassrooms() {
    return (
      <div className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="chess-card !p-5">
            <h3 className="font-display font-semibold text-ivory-100 mb-1">Batch / Group</h3>
            <p className="text-sm text-ivory-500">{profile.group_name || 'No batch assigned'}</p>
          </div>
          <div className="chess-card !p-5">
            <h3 className="font-display font-semibold text-ivory-100 mb-1">Assigned coach</h3>
            <p className="text-sm text-ivory-500">{(profile.coaches && profile.coaches.length) ? profile.coaches.map((c) => c.name).join(', ') : (profile.coach_name || 'No coach assigned')}</p>
          </div>
        </div>
      </div>
    );
  }

  function renderAssignmentsStat() {
    const total = assignmentsList.length;
    const completed = ledgerCompleted.length;
    const pending = total - completed;
    const avg = completed && ledgerCompleted.length
      ? Math.round(ledgerCompleted.reduce((s, a) => s + a.score, 0) / ledgerCompleted.length)
      : 0;
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SafeStat icon="♙" label="Assignments" value={total} sub="puzzle homework" />
          <SafeStat icon="✓" label="Completed" value={completed} sub={`${pending} incomplete`} />
          <SafeStat icon="♟" label="Avg points" value={`${avg} pts`} sub="per completed puzzle" />
          <SafeStat icon="♔" label="Solved" value={ledgerCompleted.filter((a) => a.approved).length} sub="correct once or more" />
        </div>
        <div className="chess-card !p-5">
          <h2 className="font-display font-semibold text-lg text-ivory-100 mb-2">Puzzle assignment progress</h2>
          <p className="text-sm text-ivory-500 mb-4">
            Completed puzzles show here the moment the student solves them; assigned-but-untouched puzzles stay pending. Jump to the full list under &ldquo;Homework assignments&rdquo;.
          </p>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex-1"><div className="flex justify-between text-ivory-300 mb-1"><span>Completed</span><span>{completed}/{total}</span></div><div className="chess-bar"><div className="chess-bar-fill" style={{ width: `${total ? (completed / total) * 100 : 0}%`, background: '#60a5fa' }} /></div></div>
          </div>
        </div>
        <Button onClick={() => setSection('homework')} variant="primary" size="md">View homework list →</Button>
      </div>
    );
  }

  function renderHomework() {
    const overdue = filteredPending.filter((a) => a.dueDate && new Date(a.dueDate) < new Date());

    function isFolderOpen(key, idx) {
      return openFolders === null ? idx === 0 : !!openFolders[key];
    }

    function toggleFolder(key, idx) {
      setOpenFolders((prev) => {
        const base = prev === null ? {} : { ...prev };
        base[key] = !(prev === null ? idx === 0 : !!prev[key]);
        return base;
      });
    }

    return (
      <div className="chess-card !p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display font-semibold text-lg text-ivory-100">Homework assignments</h2>
            <p className="text-xs text-ivory-500">
              {hwFilterActive
                ? `Showing ${filteredSorted.length} of ${sorted.length} assignment${sorted.length === 1 ? '' : 's'}`
                : `${sorted.length} assignments · ${homeworkFolders.length} folder${homeworkFolders.length === 1 ? '' : 's'} · click a folder to expand`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Chip tone="green">{filteredCompleted.length} completed</Chip>
            <Chip>{filteredPending.length} incomplete</Chip>
            {overdue.length > 0 && <Chip>{overdue.length} overdue</Chip>}
            <label className="flex items-center gap-2 text-sm text-ivory-500">
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value)} className="chess-input !w-40">
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="title">Title A–Z</option>
              </select>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="flex-1 min-w-[160px]">
            <input
              value={hwQuery}
              onChange={(e) => setHwQuery(e.target.value)}
              placeholder="Search homework…"
              className="chess-input !py-2 w-full"
            />
          </div>
          <select value={hwStatus} onChange={(e) => setHwStatus(e.target.value)} className="chess-input !w-40">
            <option value="all">All statuses</option>
            <option value="completed">Completed</option>
            <option value="pending">Incomplete</option>
            <option value="overdue">Overdue</option>
          </select>
          {hwFilterActive && (
            <Button onClick={() => { setHwQuery(''); setHwStatus('all'); }} variant="secondary" size="md" className="!py-2 !px-3 !text-sm">
              Clear
            </Button>
          )}
        </div>

        {sorted.length === 0 && (
          <p className="text-sm text-ivory-500 py-6 text-center">
            No puzzle homework yet. Puzzles the coach assigns (or the student solves in practice) appear here as completed / incomplete entries.
          </p>
        )}
        {sorted.length > 0 && filteredSorted.length === 0 && (
          <p className="text-sm text-ivory-500 py-6 text-center">
            No homework matches your search or filter.
          </p>
        )}

        <div className="space-y-3">
          {filteredFolders.map((f, i) => {
            const open = isFolderOpen(f.key, i);
            const isPuzzle = f.kind === 'puzzle';
            return (
              <div key={f.key} className="rounded-xl border border-ivory-700/50 bg-black/[0.02] overflow-hidden">
                <button
                  onClick={() => toggleFolder(f.key, i)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-black/[0.04] transition"
                >
                  <span className="text-lg select-none">{open ? '📂' : '📁'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-ivory-300 truncate">{f.name}</div>
                    <div className="text-xs text-ivory-500">
                      {f.total} {isPuzzle ? 'puzzle' : 'assignment'}{f.total === 1 ? '' : 's'}
                      {' · '}{f.completed} completed
                      {f.overdue > 0 && <span className="text-red-600/80"> · {f.overdue} overdue</span>}
                    </div>
                  </div>
                  <span className="text-ivory-500 text-xs whitespace-nowrap">{f.completed}/{f.total} solved</span>
                  <span className={`text-ivory-500 transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
                </button>

                {open && (
                  <div className="px-3 pb-4 pt-1 border-t border-ivory-700/40">
                    {isPuzzle ? (
                      <HomeworkPuzzleFolder studentId={studentId} items={f.items} />
                    ) : (
                      <ul className="divide-y divide-white/5 mt-2">
                        {f.items.map((a) => (
                          <li key={a.id} className="py-3">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-ivory-500">
                              <span className="font-medium text-ivory-300 text-sm min-w-0">{a.title}</span>
                              {a.submitted
                                ? <Chip tone="green">Submitted · {a.score}/100</Chip>
                                : <Chip tone="">Pending</Chip>}
                              <span className="text-gold-400">{a.submitted ? a.activities : 0}/{a.activities || 1} activities</span>
                              {a.assignedAt ? <span>Assigned {fmtDate(a.assignedAt)}</span> : ''}
                              {a.dueDate && <span>Due {fmtDate(a.dueDate)}</span>}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderComparison() {
    if (chessLoading) return <div className="chess-card !p-5 mb-6"><Spinner text="Loading comparison…" /></div>;
    if (chessError) return <div className="chess-card !p-5 mb-6"><p className="text-sm text-red-600">{chessError}</p></div>;
    if (!chess) return null;

    const cols = cmpColumns(chess);
    const academy = cols.find((c) => c.key === 'academy');
    const accounts = chess.accounts || [];
    const platforms = cols
      .filter((c) => c.key !== 'academy')
      .map((c) => ({ ...c, account: accounts.find((a) => a.platform === c.key) }))
      .filter((c) => c.data || c.account);
    const anyData = academy.data || platforms.length > 0;

    return (
      <div className="space-y-6">
        <div className="chess-card !p-5">
          <h2 className="font-display font-semibold text-lg text-ivory-100 mb-3">
            Comparison · Academy vs Chess.com &amp; Lichess
          </h2>
          {!anyData && (
            <p className="text-sm text-ivory-500 py-1">
              No games to compare yet — play academy matches and connect a Chess.com / Lichess account to fill this in.
            </p>
          )}
          {anyData && (
            <div className="grid lg:grid-cols-2 gap-4 items-start mt-4">
              <AcademyCard data={academy.data} />
              <div className="space-y-4">
                {platforms.map((p) => (
                  <PlatformCard key={p.key} label={p.label} data={p.data} account={p.account} />
                ))}
                {platforms.length === 0 && (
                  <p className="text-sm text-ivory-500 py-4">
                    No Chess.com / Lichess account connected yet — connect and sync one to appear here.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {anyData && <DashboardPanel academy={academy} platforms={platforms} chess={chess} />}

        {anyData && renderVerdict(academy, platforms.filter((p) => p.data))}
      </div>
    );
  }

  /* The BODY of one section, keyed by the section rather than reading `section`
   from the closure. That is what lets the caller render every visited section at
   once and hide the inactive ones, instead of swapping a single conditional
   subtree that would be destroyed and rebuilt on every switch. */
  function renderSectionBody(key) {
    switch (key) {
      case 'user':
        return renderUserInfo();
      case 'classes':
        return renderClassesQuota();
      case 'classrooms':
        return renderClassrooms();
      case 'tournaments':
        return <TournamentReportSection state={tournamentReport} studentMode={studentMode} />;
      case 'assignments':
        return renderAssignmentsStat();
      case 'homework':
        return renderHomework();
      case 'student':
        return (
          <>
            {renderStatsOverview()}
            {renderChart()}
            {renderPerformance()}
            {renderActivity()}
          </>
        );
      case 'combined':
        return (
          <>
            {renderComparison()}
          </>
        );
      default:
        return null;
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Toolbar — not part of the PDF capture */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <span className="text-2xl text-gold-400 piece-glyph-spin">♞</span>
          {!studentMode && (
            <Link to="/admin/students" className="text-sm text-ivory-500 hover:text-gold-400 transition-colors">← Back to Students</Link>
          )}
        </div>
        <Button onClick={downloadPdf} disabled={busyPdf} variant="primary" size="md">
          {busyPdf ? 'Rendering PDF…' : '⬇ Download as PDF'}
        </Button>
      </div>

      <div>
        {renderHeader()}

        {isEmptyReport && (
          <div className="chess-card !p-5 mb-6 text-center">
            <p className="text-3xl mb-2">🌱</p>
            <p className="font-semibold text-ivory-100">Your report is just getting started</p>
            <p className="text-sm text-ivory-500 mt-1">
              Play rated games, solve puzzles, finish assignments and attend classes — everything you do fills in here.
            </p>
          </div>
        )}

        <div className="md:grid md:grid-cols-[210px_1fr] md:gap-6 items-start">
          <div className="mb-4 md:mb-0">
            <SectionNav
              sections={SECTIONS}
              active={section}
              onSelect={selectSection}
              navRef={sectionNavRef}
            />
          </div>
          {/* Every visited section stays mounted; only the active one is shown.
              `hidden` (not a conditional) is the whole point: the DOM is kept, so
              the panel's scroll, its open/closed state and anything it fetched
              all survive a round trip to another section.
              min-h-screen keeps the document tall even for a short section, so
              the browser never clamps the page scroll when switching. */}
          <div className="min-w-0 min-h-screen">
            {[...visitedSections].map((key) => (
              <div key={key} hidden={key !== section}>
                {renderSectionBody(key)}
              </div>
            ))}
          </div>
        </div>

        <p className="text-center text-xs text-ivory-500 pt-6 pb-4">
          {APP_NAME} · Student Report · {SECTIONS.find((s) => s[0] === section)?.[1]} · generated {fmtDate(new Date().toISOString())}
        </p>
      </div>

      {/* Edit student modal — admin only, outside the PDF capture */}
      {!studentMode && editOpen && editForm && (
        <div className="fixed inset-0 z-[var(--z-modal-backdrop)] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setEditOpen(false)}>
          <div className="chess-card w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()} style={{ animation: 'board-pop .3s both' }}>
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-base font-bold text-ivory-300">Edit student</h3>
              <button onClick={() => setEditOpen(false)} className="text-ivory-500 hover:text-ivory-300 text-xl leading-none" title="Close">✕</button>
            </div>
            <p className="text-xs text-ivory-500 mb-4">Changes apply to this account immediately.</p>
            <form onSubmit={saveEdit} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className="text-xs text-ivory-500">Full name *</span><input required className="chess-input" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></label>
                <label className="block"><span className="text-xs text-ivory-500">Email *</span><input required type="email" className="chess-input" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} /></label>
                <PhoneInput
                  label="Phone"
                  countryCode={editForm.countryCode}
                  phoneNumber={editForm.phoneNumber}
                  onChange={({ countryCode, phoneNumber }) => setEditForm({ ...editForm, countryCode, phoneNumber })}
                  autoComplete="tel"
                />
                <label className="block"><span className="text-xs text-ivory-500">First name / nickname</span><input className="chess-input" value={editForm.nickname} onChange={(e) => setEditForm({ ...editForm, nickname: e.target.value })} /></label>
                <label className="block"><span className="text-xs text-ivory-500">Date of birth</span><input type="date" className="chess-input" value={editForm.birthdate} onChange={(e) => setEditForm({ ...editForm, birthdate: e.target.value })} /></label>
                <label className="block"><span className="text-xs text-ivory-500">Parent / guardian</span><input className="chess-input" value={editForm.parentName} onChange={(e) => setEditForm({ ...editForm, parentName: e.target.value })} /></label>
                <label className="block"><span className="text-xs text-ivory-500">Gender</span>
                  <select className="chess-input" value={editForm.gender} onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })}>
                    <option value="">Prefer not to say</option>
                    {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
                <label className="block"><span className="text-xs text-ivory-500">Preferred language</span>
                  <select className="chess-input" value={editForm.preferredLanguage} onChange={(e) => setEditForm({ ...editForm, preferredLanguage: e.target.value })}>
                    <option value="">None set</option>
                    {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </label>
                <label className="block"><span className="text-xs text-ivory-500">Status</span>
                  <select className="chess-input" value={editForm.active ? 'true' : 'false'} onChange={(e) => setEditForm({ ...editForm, active: e.target.value === 'true' })}>
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </label>
                <label className="block"><span className="text-xs text-ivory-500">Batch / Group</span>
                  <select className="chess-input" value={editForm.groupId} onChange={(e) => setEditForm({ ...editForm, groupId: e.target.value })}>
                    <option value="">No batch assigned</option>
                    {groups.map((g) => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
                  </select>
                </label>
                {isSuper && (
                <div className="sm:col-span-2">
                  <span className="text-xs text-ivory-500 block">Assigned coaches (pick several)</span>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1.5">
                    {coaches.map((c) => {
                      const arr = editForm.coachIds || [];
                      const on = arr.includes(String(c.id));
                      return (
                        <label key={c.id} className="flex items-center gap-1.5 text-sm text-ivory-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                coachIds: e.target.checked ? [...arr, String(c.id)] : arr.filter((x) => x !== String(c.id)),
                              })
                            }
                            className="accent-gold-500"
                          />
                          {c.name}
                        </label>
                      );
                    })}
                    {coaches.length === 0 && <span className="text-xs text-ivory-500">No coaches registered yet.</span>}
                  </div>
                </div>
              )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" onClick={() => setEditOpen(false)} variant="secondary" size="md" className="!py-2 !px-4 text-sm">Cancel</Button>
                <Button disabled={editSaving} variant="primary" size="md" className="!py-2 !px-4 text-sm">{editSaving ? 'Saving…' : 'Save changes'}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Hidden print layout for the PDF export — mounted only while exporting,
          positioned off-screen, never visible on any device. */}
      {printJob && <StudentReportPrint report={report} chess={printJob.chess} tournaments={printJob.tournaments} />}
    </div>
  );
}