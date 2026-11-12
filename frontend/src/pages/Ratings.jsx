import { useEffect, useState } from 'react';
import { useUrlTab } from '../hooks/useUrlTab';
import { useProfileChanged } from '../hooks/useProfileChanged';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { Page, Card, Stat, Bar, Spinner, Chip } from '../components/ui';
import { LineChart } from '../utils/charts';
import StudentAvatar from '../components/StudentAvatar';

const RESULT_TONE = { win: 'green', loss: 'red', draw: 'gold' };

/** Canonical control labels — the same four the pools use, so the Recent
 *  Rated Results column never shows a raw "5+0" for one row and "Blitz" for
 *  another. Falls back to the stored label for rows written before
 *  time_class existed. */
const CONTROL_LABEL = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical' };

/** "3d ago" / "2h ago" for recent games; dd/mm/yyyy beyond a week. */
function ago(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (!Number.isFinite(s)) return '—';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  /* Explicit dd/mm/yyyy: toLocaleDateString() follows the device locale and
     would render 10/28/2026 on a US phone, next to 28/10/2026 elsewhere. */
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** Opponent name cell.
 *
 *  A long Tamil name used to be clipped on the LEFT because the cell was
 *  allowed to grow past the table and the wrapper scrolled to its end — the
 *  start of the name was simply off-screen. The cell is now a fixed-width,
 *  left-aligned box that truncates with an ellipsis; tapping (or long-pressing)
 *  expands it to the full name instead of cutting it. `title` covers desktop
 *  hover. */
function OpponentCell({ id, name, open, onToggle }) {
  const label = name || '—';
  return (
    <td className="py-2 pr-3 align-top">
      <button
        type="button"
        title={label}
        aria-expanded={open}
        onClick={() => onToggle(id)}
        onContextMenu={(e) => { e.preventDefault(); onToggle(id, true); }}
        className="block w-full text-left"
        style={{
          minWidth: 0,
          maxWidth: '100%',
          font: 'inherit',
          color: 'inherit',
          opacity: 0.65,
          background: 'none',
          border: 0,
          padding: 0,
          cursor: name ? 'pointer' : 'default',
          whiteSpace: open ? 'normal' : 'nowrap',
          overflow: open ? 'visible' : 'hidden',
          textOverflow: open ? 'clip' : 'ellipsis',
          overflowWrap: open ? 'anywhere' : 'normal',
        }}
      >
        {label}
      </button>
    </td>
  );
}

function Delta({ value }) {
  if (value > 0) return <span style={{ color: '#047857' }}>▲ {value}</span>;
  if (value < 0) return <span style={{ color: '#b91c1c' }}>▼ {value}</span>;
  return <span style={{ opacity: 0.45 }}>–</span>;
}

function Person({ row, nameKey = 'name' }) {
  return (
    <span className="flex items-center gap-2 min-w-0">
      {row.profile_image ? (
        <img src={row.profile_image} alt="" className="rounded-full object-cover object-center ring-1 ring-white/15" width={28} height={28} />
      ) : (
        <StudentAvatar config={row.avatar_config} seed={`student_${row.student_id || ''}`} size={28} />
      )}
      <span className="truncate">{row[nameKey]}</span>
    </span>
  );
}

/**
 * The student's four time-control pools, as a SWITCHER.
 *
 * The four tiles double as tabs: clicking one selects that pool, and the detail
 * block plus the history chart below follow the selection. Rapid is preselected
 * because it is the overall-champion ladder, and it is the only pool guaranteed
 * to have history worth plotting for most students.
 *
 * `historyByClass` comes from the API already split and ascending per pool, so
 * this is a lookup, not a re-grouping — and a pool the student has never played
 * simply has an empty array.
 */
function MyPools({ timeClasses, historyByClass, selected, onSelect }) {
  if (!timeClasses) return null;
  const keys = Object.keys(timeClasses);
  const active = selected || 'rapid';
  const pool = timeClasses[active];
  const hist = historyByClass?.[active] || [];

  return (
    <div className="mt-5">
      <h3 className="font-display font-bold text-sm mb-2" style={{ color: '#1d4ed8' }}>
        All my time controls
      </h3>

      {/* Tabs */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3" role="tablist">
        {keys.map((key) => {
          const t = timeClasses[key];
          const on = key === active;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onSelect && onSelect(key)}
              className="p-3 rounded-lg text-left transition"
              style={{
                background: on ? 'rgba(212,169,47,.14)' : 'rgba(255,255,255,.05)',
                outline: on ? '1px solid rgba(212,169,47,.6)' : '1px solid transparent',
                cursor: 'pointer',
                font: 'inherit',
                color: 'inherit',
              }}
            >
              <p className="text-xs font-bold mb-1">
                {t.icon} {t.label}{' '}
                {key === 'rapid' && <span style={{ color: '#1d4ed8' }}>· champion</span>}
              </p>
              {t.rating == null ? (
                <p className="text-xs" style={{ opacity: 0.4 }}>No games</p>
              ) : (
                <>
                  <p className="text-xl font-bold" style={{ color: '#2563eb' }}>{t.rating}</p>
                  <p className="text-xs" style={{ opacity: 0.55 }}>
                    peak {t.peakRating} · {t.gamesPlayed} games
                  </p>
                </>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected pool detail */}
      {pool && (
        <div className="mt-4 p-4 rounded-lg" style={{ background: 'rgba(255,255,255,.04)' }}>
          <p className="text-sm font-bold mb-1">
            {pool.icon} {pool.label}
            {active === 'rapid' && <span style={{ color: '#1d4ed8' }}> · champion ladder</span>}
          </p>
          {pool.rating == null ? (
            <p className="text-xs" style={{ opacity: 0.5 }}>
              You have not played a rated {pool.label} game yet, so this pool has no rating or chart.
            </p>
          ) : (
            <>
              <div className="grid sm:grid-cols-4 gap-3">
                <Stat label="Rating" value={pool.rating} icon={pool.icon} />
                <Stat label="Peak" value={pool.peakRating} icon="★" />
                <Stat label="Games" value={pool.gamesPlayed} icon="♟" />
                <Stat label="Tier" value={pool.level?.tier || '—'} icon={pool.level?.icon || '♙'} />
              </div>

              {/* Band progress for the SELECTED pool. This used to exist only
                  for Rapid (via `me.rapid.progress`), so switching to Blitz or
                  Classical showed numbers but no progress bar at all — hence
                  the same fields are now computed per pool on the server.

                  `belowFloor` covers a rating under 1000 (the Elo floor is 100,
                  so this is common): the student is chasing the FIRST band, not
                  the one after it, and the bar correctly sits at 0%. */}
              {pool.level && (pool.belowFloor ? (
                <div className="mt-3">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span style={{ color: '#1d4ed8' }}>
                      Below {pool.level.tier} · {pool.level.min}–{pool.level.max}
                    </span>
                    <span style={{ opacity: 0.6 }}>
                      {pool.pointsToNext} pts to reach {pool.level.tier}
                    </span>
                  </div>
                  <Bar pct={pool.progress} />
                </div>
              ) : pool.level.level < 7 ? (
                <div className="mt-3">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span style={{ color: '#1d4ed8' }}>
                      {pool.level.tier} · {pool.level.min}–{pool.level.max}
                    </span>
                    <span style={{ opacity: 0.6 }}>
                      {pool.pointsToNext} pts to next tier
                    </span>
                  </div>
                  <Bar pct={pool.progress} />
                </div>
              ) : (
                <p className="text-xs mt-3" style={{ opacity: 0.55 }}>
                  Top band reached — {pool.level.tier}. Nothing higher to climb to.
                </p>
              ))}

              {pool.provisional && (
                <p className="text-xs mt-3" style={{ color: '#fbbf24' }}>
                  ⚠ Provisional — this rating still swings hard until 20 {pool.label} games are played.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* History for the selected pool */}
      {hist.length > 1 && (
        <div className="mt-5">
          <h3 className="font-display font-bold text-sm mb-2" style={{ color: '#1d4ed8' }}>
            {pool?.label || 'Rating'} rating history
          </h3>
          <LineChart
            points={hist.map((h) => ({ x: h.played_at, value: h.rating_after }))}
            labels={hist.map((h, i) =>
              i === 0 || i === hist.length - 1
                ? new Date(h.played_at).toLocaleDateString()
                : ''
            ).filter(Boolean)}
            stroke="#1d4ed8"
          />
        </div>
      )}
    </div>
  );
}

export default function Ratings() {
  const [data, setData] = useState(null);
  const [me, setMe] = useState(null);
  const [err, setErr] = useState(null);
  /* Which time-control pool the switcher is showing. Defaults to Rapid, the
     overall-champion ladder, which is the pool most students care about. */
  const [pool, setPool] = useUrlTab('pool', 'rapid');
  /* Which Recent Rated Results row has its opponent name expanded. One at a
     time keeps the table height stable. */
  const [openOpponent, setOpenOpponent] = useState(null);
  const toggleOpponent = (id, forceOpen) =>
    setOpenOpponent((cur) => (forceOpen || cur !== id ? id : null));
  /* My own photo and avatar live in these rows too, so a change made on this
     device has to pull the page again instead of waiting for the next visit. */
  const [profileTick, setProfileTick] = useState(0);
  useProfileChanged(() => setProfileTick((t) => t + 1));

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get('/students/ratings/analytics', { cache: false }).then((r) => r.data),
      /* A student without a student record has no profile — that's not a page
         error, the academy sections below still work, so swallow it. */
      api.get('/students/ratings/me', { cache: false }).then((r) => r.data).catch(() => null),
    ])
      .then(([analytics, profile]) => { if (alive) { setData(analytics); setMe(profile); } })
      .catch(() => alive && setErr('Could not load rating data.'));
    return () => { alive = false; };
  }, [profileTick]);

  if (err) {
    return (
      <Page title="Ratings" piece="♕" sub="Every rating, explained.">
        <div className="chess-card"><p className="chess-empty">{err}</p></div>
      </Page>
    );
  }
  if (!data) return <Page title="Ratings" piece="♕"><Spinner text="Crunching ratings…" /></Page>;

  const o = data.overview || {};
  const movers = data.movers || [];
  const risers = movers.filter((m) => m.delta > 0).slice(0, 8);
  const fallers = movers.filter((m) => m.delta < 0).slice(0, 8);
  /* `levelMax` was removed with the "Level Bands" card — it only scaled that
     card's per-band bars. The `levels` payload still arrives from the API and is
     used by the level lookup on the "My Rapid Rating" card. */
  return (
    <Page title="Ratings" piece="♕" sub="Your Rapid rating, the academy ladder, and this week's movers.">
      <p className="text-xs mb-6" style={{ opacity: 0.6 }}>
        There is no single combined rating. Each time control keeps its own ELO pool, and the
        <strong style={{ color: '#1d4ed8' }}> overall champion is the strongest Rapid player</strong>.
      </p>
      {/* ── 1. My rating — Rapid leads, because Rapid is the champion ladder ── */}
      {me && (
        <Card title="My Rapid Rating" piece="♔" className="mb-6">
          {me.rapid ? (
            <>
              <div className="grid md:grid-cols-4 gap-4 mb-4">
                <Stat label="Rapid ELO" value={me.rapid.rating} icon="♔" />
                <Stat label="Rapid peak" value={me.rapid.peakRating} icon="★" />
                <Stat label="Rapid games" value={me.rapid.gamesPlayed} icon="♟" />
                <Stat label="Tier" value={me.rapid.level?.tier || '—'} icon={me.rapid.level?.icon || '♙'} />
              </div>

              {/* Progress to the next band. `belowFloor` handles a rating under
                  1000 (the Elo floor is 100, so this is common): the student is
                  chasing the FIRST band, not the one after it. */}
              {me.rapid.belowFloor ? (
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span style={{ color: '#1d4ed8' }}>
                      Below {me.rapid.level?.tier} · {me.rapid.level?.min}–{me.rapid.level?.max}
                    </span>
                    <span style={{ opacity: 0.6 }}>
                      {me.rapid.pointsToNext} pts to reach {me.rapid.level?.tier}
                    </span>
                  </div>
                  <Bar pct={me.rapid.progress} />
                </div>
              ) : me.rapid.level?.level < 7 ? (
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span style={{ color: '#1d4ed8' }}>
                      {me.rapid.level?.tier} · {me.rapid.level?.min}–{me.rapid.level?.max}
                    </span>
                    <span style={{ opacity: 0.6 }}>
                      {me.rapid.pointsToNext} pts to next tier
                    </span>
                  </div>
                  <Bar pct={me.rapid.progress} />
                </div>
              ) : (
                <p className="chess-empty">Top band reached — {me.rapid.level?.tier}. Nothing higher to climb to.</p>
              )}

              {me.rapid.provisional && (
                <p className="text-xs mt-3" style={{ color: '#fbbf24' }}>
                  ⚠ Provisional — your Rapid rating still swings hard until 20 Rapid games are played.
                </p>
              )}
            </>
          ) : (
            <p className="chess-empty">
              You have no Rapid games yet, so you are not ranked on the overall champion ladder.
              Play a rated Rapid game to join it.
            </p>
          )}

          {/* The switcher lists every pool and owns the rating-history chart for
              whichever one is selected, so it renders once, outside the Rapid
              branch, and the old Rapid-only chart below it is gone. */}
          <MyPools
            timeClasses={me.timeClasses}
            historyByClass={me.historyByClass}
            selected={pool}
            onSelect={setPool}
          />
        </Card>
      )}

      {/* ── 2. Academy-wide headline numbers ── */}
      <div className="grid md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <Stat label="Students" value={o.students ?? 0} icon="♟" />
        <Stat label="Rapid rated" value={o.rated ?? 0} icon="♜" />
        <Stat label="Average Rapid" value={o.avg_rating ?? 0} icon="♕" />
        <Stat label="Median Rapid" value={o.median_rating ?? 0} icon="◑" />
        <Stat label="Highest Rapid" value={o.max_rating ?? 0} icon="★" />
        <Stat label="Lowest Rapid" value={o.min_rating ?? 0} icon="▽" />
      </div>
      <div className="grid md:grid-cols-3 gap-4 mb-8">
        <Stat label="Total Rapid games" value={o.total_games ?? 0} icon="♞" />
        <Stat label="Still provisional" value={o.provisional ?? 0} icon="⏳" />
        <Stat label="Rapid rated / students" value={`${o.rated ?? 0}/${o.students ?? 0}`} icon="📊" />
      </div>

      {/* ── 3. Biggest movers in the last 7 days ── */}
      <Card title="Biggest Movers — last 7 days" piece="♔" className="mb-6">
        {movers.length === 0 ? (
          <p className="chess-empty">No rated games this week — movers appear once matches are played.</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {[
              { title: '▲ Climbing', list: risers, color: '#047857' },
              { title: '▼ Sliding', list: fallers, color: '#b91c1c' },
            ].map((col) => (
              <div key={col.title}>
                <h3 className="font-display font-bold text-sm mb-2" style={{ color: col.color }}>{col.title}</h3>
                {col.list.length === 0 ? (
                  <p className="text-xs" style={{ opacity: 0.4 }}>Nobody moved this way yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {col.list.map((m) => (
                      <div key={m.student_id} className="flex items-center gap-2 p-2 rounded" style={{ background: 'rgba(255,255,255,.04)' }}>
                        <Person row={m} />
                        <span className="flex-1" />
                        <span className="text-xs" style={{ opacity: 0.5 }}>{m.games}g</span>
                        <span className="text-xs" style={{ opacity: 0.55 }}>{m.start_rating}→{m.end_rating}</span>
                        <span className="font-bold text-sm w-14 text-right"><Delta value={m.delta} /></span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── 8. Every recent rated result, row by row ── */}
      <Card
        title="Recent Rated Results"
        piece="♞"
        className="mb-6"
        actions={<Link to="/student/leaderboard" className="text-xs hover:underline" style={{ color: '#2563eb' }}>Full leaderboard →</Link>}
      >
        {data.recent.length === 0 ? (
          <p className="chess-empty">No rated results recorded yet.</p>
        ) : (
          <div className="overflow-x-auto" style={{ maxWidth: '100%' }}>
            <table className="w-full text-sm" style={{ tableLayout: 'fixed', minWidth: 720 }}>
              <thead>
                <tr style={{ opacity: 0.5 }} className="text-left text-xs">
                  <th className="py-2 pr-3 font-medium" style={{ width: '21%' }}>Player</th>
                  <th className="py-2 pr-3 font-medium" style={{ width: '9%' }}>Result</th>
                  <th className="py-2 pr-3 font-medium" style={{ width: '20%' }}>Opponent</th>
                  <th className="py-2 pr-3 font-medium text-right" style={{ width: '8%' }}>Before</th>
                  <th className="py-2 pr-3 font-medium text-right" style={{ width: '8%' }}>After</th>
                  <th className="py-2 pr-3 font-medium text-right" style={{ width: '9%' }}>Change</th>
                  <th className="py-2 pr-3 font-medium" style={{ width: '13%' }}>Control</th>
                  <th className="py-2 font-medium" style={{ width: '12%' }}>When</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,.06)' }}>
                    <td className="py-2 pr-3"><Person row={r} nameKey="student_name" /></td>
                    <td className="py-2 pr-3">
                      <Chip tone={RESULT_TONE[r.result] || ''}>{r.result}</Chip>
                    </td>
                    <OpponentCell
                      id={r.id}
                      name={r.opponent_name}
                      open={openOpponent === r.id}
                      onToggle={toggleOpponent}
                    />
                    <td className="py-2 pr-3 text-right" style={{ opacity: 0.6 }}>{r.rating_before}</td>
                    <td className="py-2 pr-3 text-right font-medium">{r.rating_after}</td>
                    <td className="py-2 pr-3 text-right font-bold"><Delta value={r.rating_change} /></td>
                    <td className="py-2 pr-3 text-xs" style={{ opacity: 0.5, whiteSpace: 'nowrap' }}>
                      {CONTROL_LABEL[r.time_class] || r.time_control || '—'}
                    </td>
                    <td className="py-2 text-xs" style={{ opacity: 0.5, whiteSpace: 'nowrap' }}>{ago(r.played_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}

