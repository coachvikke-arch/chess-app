import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import { PageHeader, Spinner } from '../components/ui';
import StudentAvatar from '../components/StudentAvatar';
import ChampionsPodium, { PlayerBadges } from '../components/ChampionsPodium';
import Pagination, { PAGE_SIZE } from '../components/Pagination';
import { usePagination } from '../hooks/usePagination';
import { useAuth } from '../context/AuthContext';
import { WHITE } from 'chess.js';
import Button from '../components/Button';

/** Which endpoint ranks the players for this viewer.
 *
 *  A coach asks for the COACH view, a student for the public one, and the two are
 *  deliberately different:
 *
 *  · `/coach` is gated on the admin role only, so a coach reaches their students'
 *    standings whether or not the `leaderboard` feature switch is on. The public
 *    route is behind `requireFeature('leaderboard')`, which is why a coach with
 *    that switch off got a 403.
 *  · The public route filters `hide_from_leaderboard = FALSE`; the coach route
 *    passes every student, so a coach sees a student who opted out of public
 *    standings. That opt-out is about the public board, not about their coach.
 *
 *  Exported so the choice can be asserted directly. */
export function leaderboardEndpointFor(role) {
  return role === 'admin' || role === 'superadmin'
    ? '/students/ratings/coach'
    : '/students/ratings/leaderboard';
}

const TABS = [
  { key: 'all', label: 'Overall Champion' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'bullet', label: 'Bullet' },
  { key: 'blitz', label: 'Blitz' },
  { key: 'rapid', label: 'Rapid' },
  { key: 'classical', label: 'Classical' },
  { key: 'puzzle', label: 'Puzzle Rush' },
];

/* Rating for the active tab. Time-control tabs read that control's own pool
   (`timeRatings`), so a blitz player is ranked against blitz players. A student
   with no games in that control has rating null and sorts last.

   There is no common/unified rating left in this app:
     · "Overall Champion" shows the RAPID pool
     · "Weekly" shows the same RAPID pool, but only for players who actually
       played a Rapid game in the last 7 days (it deliberately does NOT fall
       back to their standing rating, so an inactive player can't hold a
       top-of-table slot on a stale number) */
function ratingFor(row, key) {
  switch (key) {
    case 'all': return row.rapidRating ?? null;
    case 'weekly': return row.weeklyRating ?? null;
    case 'puzzle': return row.puzzlePoints;
    default: return row.timeRatings?.[key]?.rating ?? null;
  }
}

function Spark({ points }) {
  const arr = Array.isArray(points) && points.length >= 2 ? points : null;
  if (!arr) return <span className="text-[11px] text-slate-500">-</span>;
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const span = max - min || 1;
  const W = 64, H = 20, p = 3;
  const pts = arr.map((v, i) => `${p + (i / (arr.length - 1)) * (W - 2 * p)},${H - p - ((v - min) / span) * (H - 2 * p)}`).join(' ');
  const up = arr[arr.length - 1] >= arr[0];
  const col = up ? '#2563eb' : '#dc2626';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="lb-spark-svg">
      <polyline fill="none" stroke={col} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" points={pts} />
      <circle cx={W - p} cy={H - p - ((arr[arr.length - 1] - min) / span) * (H - 2 * p)} r={2.4} fill={col} />
    </svg>
  );
}

function changeMark(delta) {
  if (delta > 0) return <span className="lb-change lb-up">▲ +{delta}</span>;
  if (delta < 0) return <span className="lb-change lb-down">▼ {delta}</span>;
  return <span className="lb-change lb-flat">–</span>;
}

export default function Leaderboard() {
  const { user } = useAuth();
  const isCoach = user?.role === 'admin' || user?.role === 'superadmin';
  const [rows, setRows] = useState(null);
  /* A failed request is NOT an empty leaderboard. Collapsing a 403 or a 500 into
     [] is what made a coach read "No rated games yet" when the real problem was
     that their request was refused. */
  const [error, setError] = useState('');
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [tip, setTip] = useState(null);
  const listTopRef = useRef(null);

  useEffect(() => {
    let live = true;
    api.get(leaderboardEndpointFor(user?.role), { cache: false })
      .then((res) => {
        if (!live) return;
        setRows(Array.isArray(res.data) ? res.data : []);
        setError('');
      })
      .catch((err) => {
        if (!live) return;
        setRows([]);
        setError(
          err.response?.data?.message
            || (err.response?.status === 403
              ? 'Your account is not allowed to view this leaderboard.'
              : 'Could not load the leaderboard.'),
        );
      });
    return () => { live = false; };
  }, [user?.role]);

  const showNem = (e, row) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const above = r.top > 92;
    setTip({ x, y: above ? r.top : r.top + r.height + 8, flip: !above, title: `🎯 Nemesis — ${row.nemesisName}`, body: `${row.nemesisDefeats} losses to them in online matches` });
  };

  const ranked = useMemo(() => {
    if (!rows) return [];
    /* Null rating (no games in that control) must sort LAST, not as 0 — a
       beginner would otherwise outrank a 1500 blitz player. */
    const val = (r) => {
      const v = ratingFor(r, tab);
      return v == null ? -Infinity : v;
    };
    return [...rows]
      .sort((a, b) => val(b) - val(a) || a.name.localeCompare(b.name))
      .map((r, i) => ({ ...r, dr: i + 1 }));
  }, [rows, tab]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? ranked.filter((r) => r.name.toLowerCase().includes(t)) : ranked;
  }, [ranked, q]);

  const isPuzzle = tab === 'puzzle';
  const isOverall = tab === 'all';
  const isWeekly = tab === 'weekly';
  /* The active time-control tab (null for Overall / Weekly / Puzzle Rush). */
  const tc = TABS.find((t) => t.key === tab)?.label?.toLowerCase() || null;
  /* Only a real time-control tab has a pool; the others read rapid or points. */
  const tcKey = ['bullet', 'blitz', 'rapid', 'classical'].includes(tc) ? tc : null;
  const tcLabel = TABS.find((t) => t.key === tab)?.label || '';

  /* Pages hold ten ranks each, so page 2 starts at #11. The podium is the
     visual top three; the table shows the rest of the page, and every rank is
     the player's real rank rather than their position in the slice. */
  const pager = usePagination(shown, PAGE_SIZE, {
    resetKeys: [tab, q],
    scrollRef: listTopRef,
  });
  const podiumList = shown.slice(0, 3);
  const tableRows = pager.currentPage === 1
    ? pager.currentItems.filter((r) => r.dr > 3)
    : pager.currentItems;
  /* Always read from the full ladder, not the current page or the search, so
     "Your rank" still answers the question while you are browsing elsewhere. */
  const myRow = useMemo(
    () => ranked.find((r) => Number(r.user_id) === Number(user?.id)) || null,
    [ranked, user?.id]
  );
  const myRating = myRow ? ratingFor(myRow, tab) : null;

  return (
    <PageHeader title="Leaderboard" icon="♛" subtitle="ELO ratings from rated matches — who's climbing fastest?">
      <div className="kt-arena" style={{ animation: 'fade-up .45s both' }}>
        {/* controls */}
        <div className="flex flex-wrap items-center justify-center gap-3 mb-1">
          <div className="flex flex-wrap gap-2 justify-center">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={`kt-tab ${tab === t.key ? 'active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.tabIcon || ''}{t.label}
              </button>
            ))}
          </div>
          <input
            className="kt-search"
            placeholder="🔍 Search players…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {myRow && (
          <div className="mx-auto mb-2 flex w-fit max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
            <span className="text-blue-700">Your rank</span>
            <b className="text-blue-700">#{myRow.dr}</b>
            <span className="text-slate-500">of {ranked.length}</span>
            <span className="text-slate-500">·</span>
            <span>
              {isPuzzle
                ? `${myRating ?? 0} points`
                : myRating == null
                  ? 'no games in this pool'
                  : `${myRating} ${isOverall || isWeekly ? 'Rapid' : tcLabel} ELO`}
            </span>
          </div>
        )}

        {rows === null ? (
          <div className="py-16 text-center"><Spinner text="Loading leaderboard…" /></div>
        ) : error ? (
          /* Distinct from "no rated games yet": this says the load failed and
             offers a retry, instead of blaming an absence of games for a
             refused request. */
          <div className="py-16 text-center text-sm">
            <p className="text-slate-600">{error}</p>
            <Button type="button" variant="secondary" size="md" className="!py-2 !px-4 mt-3" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">
            {isCoach
              ? 'No rated games yet — this is every student\'s board, and it fills as matches are played.'
              : 'No rated games yet — the leaderboard fills as matches are played.'}
          </div>
        ) : (
          <>
          {/* The podium always advertises the SAME rating the active tab ranks
              by, so the champion card can never disagree with the table below.
              Weekly reads the rapid pool, so its peak is the rapid peak. */}
          <ChampionsPodium
            list={podiumList}
            elo={isPuzzle ? (p) => p.puzzlePoints : isOverall || isWeekly ? (p) => ratingFor(p, tab) : tcKey ? (p) => p.timeRatings?.[tcKey]?.rating : null}
            peak={isPuzzle || isWeekly ? () => null : isOverall ? (p) => p.rapidPeakRating : tcKey ? (p) => p.timeRatings?.[tcKey]?.peakRating : null}
            eloLabel={isPuzzle ? 'POINTS' : isWeekly ? 'WEEKLY RAPID ELO' : isOverall ? 'RAPID ELO' : tcLabel.toUpperCase()}
          />


            {/* table (rank 4 onwards on page 1; whole pages after that) */}
            <div ref={listTopRef}>
            <div className="lb-grid lb-head">
              <span>Rank</span>
              <span>Player</span>
              <span>{isPuzzle ? 'Points' : 'ELO'}</span>
              <span className="lb-c-wld">W/L/D</span>
              <span className="lb-c-streak">Streak</span>
              <span className="lb-c-change">Weekly Δ</span>
              <span className="lb-c-trend">Trend</span>
            </div>
            <div className="lb-body">
              {tableRows.map((r) => (
                <div key={r.student_id} className={`lb-grid lb-row${Number(r.user_id) === Number(user?.id) ? ' lb-row--me' : ''}`} >
                  <span className={`lb-rank ${r.dr <= 4 ? 'top' : ''}`}>#{r.dr}</span>
                  <span className="lb-pname">
                    <span className="lb-pavatar">
                      {r.profile_image ? (
                        <img
                          src={r.profile_image}
                          alt=""
                          className="lb-photo rounded-full object-cover ring-1 ring-slate-200"
                        />
                      ) : (
                        <StudentAvatar config={r.avatar_config} seed={`student_${r.student_id || ''}`} size={38} />
                      )}
                    </span>
                    <span className="lb-pmeta">
                      <span className="lb-line">
                        <span className="lb-uname">{r.name}</span>
                        {Number(r.user_id) === Number(user?.id) && <span className="lb-you">You</span>}
                        <PlayerBadges row={r} />
                      </span>
                      {r.group_name && (
                        <span className="lb-group" style={{ marginTop: 0, padding: '0 7px' }}>{r.group_name}</span>
                      )}
                    </span>
                  </span>
                  <span className="lb-elo2" style={{ color: r.dr <= 3 ? '#2563eb' : undefined }}>
                    {isPuzzle
                      ? <>♙ {ratingFor(r, tab)}</>
                      : ratingFor(r, tab) == null
                        ? <span style={{ opacity: 0.4 }}>{isOverall ? 'no rapid games' : isWeekly ? 'no rapid games this week' : `no ${tcLabel} games`}</span>
                        : <>{ratingFor(r, tab)}{tcKey && r.timeRatings?.[tcKey]?.provisional && (
                            <span style={{ opacity: 0.5, fontSize: '0.8em' }}> provisional</span>
                          )}</>}
                  </span>
                  <span className="lb-wld lb-c-wld"><b>{r.wins}</b>/<b>{r.losses}</b>/<b>{r.draws}</b></span>
                  <span className="lb-streak lb-c-streak">{r.streak >= 5 ? '🔥' : null} {r.streak}</span>
                  <span className="lb-c-change" style={{ position: 'relative' }}>
                    <span
                      onMouseEnter={(e) => r.nemesisName && showNem(e, r)}
                      onMouseLeave={() => setTip(null)}
                      style={{ cursor: r.nemesisName ? 'help' : 'default' }}
                    >
                      {changeMark(r.weeklyDelta)}
                    </span>
                  </span>
                  <span className="lb-spark-wrap lb-c-trend">
                    <Spark points={isOverall || isWeekly ? r.timeRatings?.rapid?.spark : tcKey ? r.timeRatings?.[tcKey]?.spark : r.spark} />
                  </span>
                </div>
              ))}
              {tableRows.length === 0 && (
                <div className="py-10 text-center text-slate-500 text-sm">No players match your search below the top three.</div>
              )}
            </div>
            </div>

            <Pagination
              currentPage={pager.currentPage}
              totalPages={pager.totalPages}
              totalItems={pager.totalItems}
              onPageChange={pager.setPage}
              itemLabel="players"
            />
          </>
        )}
      </div>
      {tip && (
        <div
          className="lb-fixed-tip"
          style={{
            left: tip.x,
            top: tip.y,
            transform: tip.flip ? 'translate(-50%, 0)' : 'translate(-50%, calc(-100% - 10px))',
          }}
        >
          <b>{tip.title}</b>
          {tip.body}
        </div>
      )}
</PageHeader>
  );
}
