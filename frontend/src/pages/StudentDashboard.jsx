import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { joinExternalClass } from '../services/liveClassApi';
import { Stat, Card, Spinner } from '../components/ui';
import RatingCard from '../components/RatingCard';
import StudentAvatar from '../components/StudentAvatar';
import { RANK_META, RankIcon } from '../components/ChampionsPodium';
import { useAuth } from '../context/AuthContext';
import GmQuoteStrip from '../components/GmQuoteStrip';
import DashboardTournaments from '../features/tournaments/DashboardTournaments';
import { formatTime12 } from '../utils/time';
import Button from '../components/Button';
import usePageTitle from '../hooks/usePageTitle';

async function openExternalMeeting(m) {
  const win = window.open('', '_blank', 'noopener,noreferrer');
  let url = m.meeting_url;
  try {
    const res = await joinExternalClass(m.id);
    if (res?.meetingUrl) url = res.meetingUrl;
  } catch (e) {
    /* offline / attendance failure must not block joining the meeting */
  }
  if (win && win.location) {
    win.location.href = url;
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

const W = 320;
const H = 150;
const PAD = 22;

/** Build an SVG line/area series from [{day, value}] with gold dots + gradient area. */
function TrendChart({ data, color = '#3b82f6' }) {
  const series = data.map((d) => ({ day: d.day, value: d.count ?? d.value ?? 0 }));
  if (series.length === 0) {
    return (
      <div className="h-[150px] grid place-items-center text-sm chess-empty">
        No activity recorded yet.
      </div>
    );
  }

  const max = Math.max(1, ...series.map((d) => d.value));
  const n = series.length;
  const stepX = (W - PAD * 2) / (n - 1 || 1);
  const pts = series.map((d, i) => ({
    x: PAD + i * stepX,
    y: H - PAD - (d.value / max) * (H - PAD * 2 - 10),
  }));

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L ${pts[pts.length - 1].x} ${H - PAD} L ${pts[0].x} ${H - PAD} Z`;
  const id = color.replace('#', '');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id={`area-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.45" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((f) => {
        const y = PAD + f * (H - PAD * 2 - 10);
        return <line key={f} x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="rgba(82,82,82,0.15)" strokeWidth="1" />;
      })}
      <path d={area} fill={`url(#area-${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={series.length === 1 ? 4 : 3.2} fill="#ffffff" stroke={color} strokeWidth="2" />
      ))}
      {series.length === 1 && (
        <text x={pts[0].x} y={pts[0].y - 10} textAnchor="middle" fontSize="10" fill={color} fontWeight="700">
          {series[0].value}
        </text>
      )}
    </svg>
  );
}

function lastDays(rows, key) {
  const map = {};
  rows.forEach((r) => (map[r.day] = r[key] ?? 0));
  const out = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const day = d.toISOString().slice(0, 10);
    out.push({ day, value: map[day] ?? 0 });
  }
  return out;
}

/**
 * Build a daily rating series for the last 14 days from an ASCENDING history
 * array. Days without a game carry the last known rating forward so the line
 * stays continuous.
 *
 * Returns an EMPTY ARRAY (not null) when there is no history — the caller
 * distinguishes "still loading" (null) from "this pool has no games" ([]). An
 * earlier version returned null for both, which left a pool the student has
 * never played showing an endless loading spinner.
 */
function ratingSeriesLast14Days(history) {
  if (!history || history.length === 0) return [];
  const byDay = {};
  history.forEach((h) => {
    const d = String(h.played_at || '').slice(0, 10);
    if (d) byDay[d] = Number(h.rating_after ?? h.rating ?? 0);
  });

  const threshold = new Date();
  threshold.setDate(threshold.getDate() - 13);
  threshold.setHours(0, 0, 0, 0);
  const thresholdStr = threshold.toISOString().slice(0, 10);

  // Seed with the most recent rating recorded before the window.
  let carry = null;
  history.forEach((h) => {
    const d = String(h.played_at || '').slice(0, 10);
    if (d < thresholdStr) carry = Number(h.rating_after ?? h.rating ?? 0);
  });

  const out = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const day = d.toISOString().slice(0, 10);
    if (byDay[day] !== undefined) carry = byDay[day];
    out.push({ day, value: carry ?? 0 });
  }
  return out;
}

/**
 * "Rating · Last 14 days" chart card (uses /students/ratings/me).
 *
 * The four time-control pools are SEPARATE ELO pools, so drawing them on one
 * line produced a meaningless saw-tooth whenever a bullet game sat next to a
 * classical one — the y-axis was mixing two unrelated scales. The chips pick
 * WHICH pool the graph shows; each pool is read from `historyByClass`, which
 * the API already splits and returns ascending per pool.
 *
 * Defaults to Rapid — the overall-champion ladder.
 */
function RatingTrendCard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tc, setTc] = useState('rapid');

  useEffect(() => {
    if (user && user.role !== 'student') return;
    let cancelled = false;
    api.get('/students/ratings/me', { cache: false })
      .then((res) => {
        if (!cancelled) setData(res.data || null);
      })
      .catch((e) => {
        /* A student with no `students` row gets a 404 — that's the empty
           state ("no rated games"), not a card error, and must not log. */
        if (cancelled) return;
        if (e.response?.status === 404) { if (!cancelled) setData({ timeClasses: {}, historyByClass: {} }); return; }
        if (!cancelled) setError(e.response?.data?.message || 'Failed to load rating');
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const pools = data?.timeClasses || {};
  const byClass = data?.historyByClass;
  /* Fall back to the combined `history` when the server predates the per-pool
     split — the card still works then, just unfiltered. */
  const rows = byClass ? (byClass[tc] || []) : (data?.history || []);
  const series = data ? ratingSeriesLast14Days(rows) : null;
  const label = pools[tc]?.label || tc;
  /* `series` is null while the request is still in flight — the SAME null the
     render uses to pick the loading spinner. This used to read `series.length`
     unguarded and threw "Cannot read properties of null" on every mount. The
     spinner path must be safe to reach, so derive against the null explicitly. */
  const hasGames = !!series && series.length > 0 && series.some((d) => d.value !== 0);

  return (
    <Card title="Rating · Last 14 days" piece="♚">
      {error ? (
        <p className="text-sm chess-empty">{error}</p>
      ) : series === null ? (
        <Spinner text="Loading rating…" />
      ) : (
        <>
          {/* Time-control picker */}
          {Object.keys(pools).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3" role="tablist" aria-label="Time control">
              {Object.entries(pools).map(([key, p]) => {
                const on = key === tc;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setTc(key)}
                    className="px-2.5 py-1 rounded-lg text-xs font-bold transition"
                    style={{
                      background: on ? 'rgba(37,99,235,.12)' : '#f1f5f9',
                      border: `1px solid ${on ? 'rgba(37,99,235,.45)' : '#e2e8f0'}`,
                      color: on ? '#1d4ed8' : '#475569',
                      font: 'inherit',
                      cursor: 'pointer',
                    }}
                  >
                    {p.icon} {p.label}
                    {key === 'rapid' && <span style={{ opacity: 0.7 }}> · champ</span>}
                  </button>
                );
              })}
            </div>
          )}

          {!hasGames ? (
            <div className="h-[150px] grid place-items-center text-sm chess-empty">
              No rated {label} games in the last 14 days.
            </div>
          ) : (
            <>
              <TrendChart data={series} />
              <div className="flex items-center justify-between text-xs text-ivory-500 mt-1">
                <span>2 weeks ago</span>
                <span>
                  {label} · {series[series.length - 1].value}
                </span>
                <span>Today</span>
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
}

/** Dashboard "my position" card — the same reward-glass podium card as the
 *  leaderboard, showing the signed-in student's own rank and Rapid ELO. */
function LeaderboardPositionCard({ me, total }) {
  if (!me) return null;
  const meta = RANK_META[me.rank];
  const hasRating = me.rapidRating != null;
  return (
    <div className="lb-podium lb-podium--reward lb-podium--dash">
      <div className={`lb-pcard ${meta?.cls || ''}`} style={{ animation: 'fade-up .5s both' }}>
        <div className="lb-pcard-icon">
          <span className="lb-pcard-media">
            {me.profile_image ? (
              <img src={me.profile_image} alt="" loading="lazy" />
            ) : (
              <StudentAvatar
                config={me.avatar_config}
                seed={`student_${me.student_id || ''}`}
                size={112}
                rounded={false}
              />
            )}
          </span>
          {meta && <span className="lb-pcard-rankbadge"><RankIcon rank={me.rank} /></span>}
        </div>
        <div className="lb-pcard-copy">
          <div className="lb-pcard-top">
            <p className="lb-pcard-eyebrow">{meta ? meta.eyebrow : 'Your position'}</p>
            <span className="lb-pcard-pill">{meta ? meta.pill : `#${me.rank}`}</span>
          </div>
          <h3 className="lb-pcard-title">
            <span className="lb-pcard-name" title={me.name}>{me.name}</span>
            <span className="lb-badge" title="You">⚑</span>
          </h3>
          <p className="lb-pcard-rating">
            <b>{hasRating ? me.rapidRating : '—'}</b>
            <span>Rapid ELO</span>
          </p>
          <p className="lb-pcard-desc">
            {hasRating ? '' : 'No rapid games yet · '}Rank #{me.rank} of {total} students
          </p>
        </div>
      </div>
    </div>
  );
}

/** Last-7-day check-in preview derived from the streak contract:
 *  `streak` consecutive calendar days ending at `lastLogin`. */
function last7StreakDots(streak, lastLogin) {
  const end = lastLogin ? new Date(`${lastLogin}T00:00:00Z`) : null;
  const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    let checked = false;
    if (end) {
      const diff = Math.round((d - end) / 86400000);
      checked = diff <= 0 && -diff < streak;
    }
    out.push({ key: d.toISOString().slice(0, 10), checked, letter: weekdays[d.getUTCDay()] });
  }
  return out;
}

/** "Daily Activity Streak" widget — sits between the greeting and the rating row. */
function LoginStreakCard({ streak = 0, lastLogin = null }) {
  const today = new Date().toISOString().slice(0, 10);
  const checkedIn = String(lastLogin || '') === today;
  const dots = last7StreakDots(Number(streak) || 0, lastLogin);

  return (
    <Card title="Daily Activity Streak" piece="🔥" className="login-streak-card">
<div className="flex flex-wrap items-center gap-4 sm:gap-5">
        <div className="relative grid place-items-center w-14 h-14 sm:w-16 sm:h-16 shrink-0 rounded-2xl bg-gold-500/12 border border-gold-500/30">
          <span className="text-2xl sm:text-3xl leading-none" style={{ animation: 'piece-float 2.8s ease-in-out infinite' }}>🔥</span>
          {checkedIn && <span className="streak-live-dot" />}
        </div>

        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-display text-3xl sm:text-4xl font-bold text-ivory-300 leading-none">{Number(streak) || 0}</span>
            <span className="text-[0.65rem] uppercase tracking-wider text-ivory-500">days in a row</span>
          </div>
          <p className={`text-xs mt-1 ${checkedIn ? 'text-emerald-700' : 'text-ivory-500'}`}>
            {checkedIn ? '✓ Checked in today — keep it up!' : 'Come back tomorrow to keep your streak alive.'}
          </p>
        </div>

        <div className="ml-auto flex items-end gap-1.5" aria-hidden="true">
          {dots.map((dot) => (
            <div key={dot.key} className="flex flex-col items-center gap-1">
              <span className={`streak-dot ${dot.checked ? 'streak-dot-on' : ''} ${dot.key === today && checkedIn ? 'streak-dot-today' : ''}`} />
              <span className="text-[0.55rem] text-ivory-500">{dot.letter}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export default function StudentDashboard() {
  usePageTitle('Student Dashboard');
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [meetings, setMeetings] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [leaders, setLeaders] = useState(null);

  useEffect(() => {
    const load = () => {
      api.get('/dashboard/student')
        .then((res) => setData(res.data))
        .catch((e) => setError(e.response?.data?.message || 'Failed to load'));
    };
    api.get('/classes/online', { cache: false })
      .then((res) => setMeetings(Array.isArray(res.data) ? res.data.slice(0, 3) : []))
      .catch(() => {});
    api.get('/announcements')
      .then((res) => setAnnouncements(res.data.slice(0, 3)))
      .catch(() => {});
    api.get('/students/ratings/leaderboard', { cache: false })
      .then((res) => setLeaders(Array.isArray(res.data) ? res.data : []))
      .catch(() => setLeaders([]));
    load();
    const onPuzzleSolved = () => load();
    window.addEventListener('puzzle-solved', onPuzzleSolved);
    return () => window.removeEventListener('puzzle-solved', onPuzzleSolved);
  }, []);

  if (error) return <div className="max-w-4xl mx-auto p-8"><div className="chess-error">{error}</div></div>;
  if (!data) return <Spinner />;

  const { profile, puzzles } = data;
  const puzzleTrend = lastDays(data.puzzleTrend || [], 'attempts');

  const puzzleAttempted = Number(puzzles?.attempted ?? 0);
  const puzzleCorrect = Number(puzzles?.correct ?? 0);
  const puzzlesSolved = Number(puzzles?.solved ?? puzzleCorrect);
  const puzzleAcc = puzzleAttempted > 0 ? Math.round((puzzleCorrect / puzzleAttempted) * 100) : 0;
  const pendingPuzzles = Number(data?.pendingPuzzles ?? 0);
  const myPosition = leaders && leaders.length > 0
    ? leaders.find((r) => r.user_id === user?.id) || null
    : null;

  return (
    <div>
<header className="mb-6">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-wrap">
          <span className="text-4xl sm:text-5xl piece-glyph-spin text-gold-500 shrink-0">♔</span>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[1.55rem] sm:text-3xl font-bold text-ivory-100 break-words">
              Welcome back, <span className="chess-gradient-text">{profile?.name}</span>
            </h1>
            <p className="text-ivory-300 mt-1">
              Keep your streak alive — solve puzzles and climb the rating ladder.
            </p>
            {user?.coach_name && (
              <p className="mt-2 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-ivory-300">
                <span className="text-gold-500">♘</span> Your coach · <span className="text-gold-400">{user.coach_name}</span>
              </p>
            )}
          </div>

          {/* Primary call-to-action → the Play Arena. Sits beside the greeting on
              wide screens. On phones it drops onto its own row and is pushed to
              the right edge (max-sm:ml-auto) at a compact size, instead of
              stretching across the whole screen. */}
          <Button
            to="/student/analysis"
            variant="primary"
            size="lg"
            className="shrink-0 max-sm:ml-auto max-sm:mt-3"
            aria-label="Go to the Play Arena"
          >
            <span className="text-lg leading-none" aria-hidden="true">♟</span>
            Play
          </Button>
        </div>
</header>

      <GmQuoteStrip variant="dark" />

      {/* Tournaments — live from /api/tournaments */}
      <DashboardTournaments role="student" />

      {/* Upcoming live meetings (classroom) — kept directly below Tournaments */}
      {meetings.filter((m) => !['completed', 'cancelled'].includes(m.live_status)).length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-lg font-bold flex items-center gap-2">
              <span className="text-gold-500">📹</span> Live Meetings
            </h2>
            <Link to="/student/live-meetings" className="chess-link text-sm">View all →</Link>
          </div>
<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {meetings.filter((m) => !['completed', 'cancelled'].includes(m.live_status)).map((m) => {
              const isLive = m.live_status === 'started' || m.live_status === 'live';
              const isIntegrated = m.class_type === 'integrated';
              const usesClassroom = isIntegrated || m.classroom_enabled !== false;
              return (
                <div key={m.id} className="chess-card chess-card-hover">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`px-2 py-0.5 rounded-full border ${
                      m.live_status === 'starting-soon'
                        ? 'border-amber-300 bg-amber-50 text-amber-700'
                        : isLive
                          ? 'border-red-300 bg-red-50 text-red-700'
                          : 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    }`}>
                      {m.live_status === 'starting-soon'
                        ? '● Starting soon'
                        : isLive
                          ? '● LIVE'
                          : 'Upcoming'}
                    </span>
                  </div>
                  <p className="font-medium text-ivory-100 mt-2">{m.title}</p>
                  <p className="text-xs text-ivory-500 mt-1">{m.class_date} at {formatTime12(m.start_time, m.start_time)}</p>
                  {m.topic && <p className="text-xs text-ivory-500 mt-1">{m.topic}</p>}
                  {isLive && usesClassroom && (
                    <Button to={`/live-class/${m.id}`}
                      variant="primary" size="sm" className="!py-1.5 !px-3 !text-xs mt-3 inline-block">
                      🎥 Join Class
                    </Button>
                  )}
                  {isLive && !isIntegrated && !usesClassroom && m.meeting_url && (
                    <Button onClick={() => openExternalMeeting(m)}
                      variant="primary" size="sm" className="!py-1.5 !px-3 !text-xs mt-3 inline-block">
                      📹 Join Meeting
                    </Button>
                  )}
                  {!isLive && (
                    <span className="text-[0.68rem] text-ivory-500 mt-3 inline-block">
                      👉 Join here when the instructor starts it
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Daily login streak */}
      <div className="mb-5">
        <LoginStreakCard streak={data.loginStreak?.streak ?? 0} lastLogin={data.loginStreak?.lastLogin ?? null} />
      </div>

{/* Rating & position — rating expands, champion keeps its narrow size;
          only the champion card goes to the leaderboard */}
{myPosition ? (
<div className="grid md:grid-cols-[1.35fr_1fr] gap-3 sm:gap-4 mb-10 items-stretch">
          <div className="h-full flex">
            <RatingCard />
          </div>
          <Link to="/student/leaderboard" className="relative block h-full cursor-pointer">
            <LeaderboardPositionCard me={myPosition} total={leaders.length} />
          </Link>
        </div>
      ) : (
        <div className="block mb-8">
          <RatingCard />
        </div>
      )}

      {/* Announcements */}
      {announcements.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-lg font-bold flex items-center gap-2">
              <span className="text-gold-500">♔</span> Announcements
            </h2>
            <Link to="/announcements" className="chess-link text-sm">View all →</Link>
          </div>
          <div className="space-y-3">
            {announcements.map((a) => (
              <div key={a.id} className="chess-card">
                <p className="font-semibold text-ivory-300 text-sm flex items-center gap-2">
                  <span className="text-gold-500">♔</span>{a.title}
                </p>
                <p className="text-sm text-ivory-300 mt-1 leading-relaxed">{a.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending puzzles banner */}
      {pendingPuzzles > 0 && (
        <div className="mb-6 rounded-2xl border border-gold-500/40 bg-gold-500/[0.06] px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 min-w-0">
            <div className="shrink-0 w-12 h-12 rounded-full bg-gold-500/10 border border-gold-500/40 grid place-items-center">
              <span className="text-2xl text-gold-400" style={{ animation: 'piece-float 2.8s ease-in-out infinite' }}>♞</span>
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-ivory-300 text-base leading-tight">
                {pendingPuzzles} puzzle{pendingPuzzles !== 1 ? 's' : ''} waiting for you
              </p>
              <p className="text-xs text-ivory-500 mt-0.5">
                Keep your accuracy up — tackle your assigned puzzles.
              </p>
            </div>
          </div>
          <Button to="/student/homework" variant="primary" size="md" className="!py-2 !px-5 text-sm shrink-0">
            Solve now →
          </Button>
        </div>
      )}

      {/* Basic details — stat cards */}
<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
        <Stat label="Puzzles Solved" value={puzzlesSolved} icon="♞" />
        <Stat label="Puzzle Accuracy" value={`${puzzleAcc}%`} icon="♛" />
        <Stat label="Puzzle Score" value={Number(puzzles?.score ?? 0)} icon="★" />
        <Stat label="Puzzles Pending" value={pendingPuzzles} icon="♟" />
      </div>

      {/* Live graphs */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <Card title="Puzzles Attempted · Last 14 days" piece="♞">
          <TrendChart data={puzzleTrend.map((d) => ({ day: d.day, count: d.value }))} color="#3b82f6" />
          <div className="flex items-center justify-between text-xs text-ivory-500 mt-1">
            <span>2 weeks ago</span>
            <span>Today</span>
          </div>
        </Card>

        <RatingTrendCard />
      </div>
    </div>
  );
}

function fmtDay(d) {
  if (!d) return '—';
  const date = new Date(typeof d === 'string' && d.length === 10 ? `${d}T00:00:00` : d);
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
}

function fmtClock(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':');
  const hr = Number(h);
  const ampm = hr >= 12 ? 'PM' : 'AM';
  return `${hr % 12 === 0 ? 12 : hr % 12}:${m || '00'} ${ampm}`;
}

