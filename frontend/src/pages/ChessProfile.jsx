import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Chess } from 'chess.js';
import GameViewerCard from '../components/GameViewerCard';
import { Page, Card, Stat, Chip, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useUrlTab } from '../hooks/useUrlTab';
import { useUrlView } from '../hooks/useUrlView';
import { LineChart, BarChart, PctBar } from '../utils/charts';
import { resultMeta, timeClassGlyph, formatDate } from '../utils/pgnTools';
import { getUserColour, getUserResult } from '../utils/gameColour';
import { formatTime12 } from '../utils/time';
import {
  listAccounts, validateAccount, connectAccount, disconnectAccount, syncAccount,
  accountRatings, fetchStatistics, fetchOpenings, fetchInsights,
  fetchGames, fetchGame, fetchAnalysis, saveAnalysis,
} from '../services/chessProfiles';
import useAccountSync from '../hooks/useAccountSync';
import Button from '../components/Button';

/* ============================================================ helpers */

function elo(e) {
  return e == null ? '—' : e;
}

function toneOf(result, myColor) {
  if (result === 'draw') return 'draw';
  return result === myColor ? 'win' : 'loss';
}

/* colour the owner played, with a fallback for rows imported before my_color was stored */
function effectiveColor(g) {
  if (g.my_color) return g.my_color;
  const me = String(g.account_username || '').toLowerCase();
  if (me) {
    if (String(g.white_name || '').toLowerCase().indexOf(me) >= 0) return 'white';
    if (String(g.black_name || '').toLowerCase().indexOf(me) >= 0) return 'black';
  }
  return 'white';
}

/* Fit a board square width inside `col` px, leaving room for the themed
   coordinate frame (remC band + 13px border/padding each side) so the framed
   board never overflows its column and gets visually cut. */
/* Sync freshness needs the TIME, not just the date. "Synced 2026-10-02" could
   mean a moment ago or 23 hours ago, and that difference is exactly what the
   user is trying to see. Relative for anything under an hour ("2 min ago"),
   then an absolute date + time. */
function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  if (diffMs >= 0 && diffMs < 60 * 1000) return 'just now';
  if (diffMs >= 0 && diffMs < 60 * 60 * 1000) return `${Math.round(diffMs / 60000)} min ago`;
  return `${formatDate(iso.slice(0, 10))} ${formatTime12(d)}`;
}

/* last_activity_at arrives as epoch milliseconds in a BIGINT column, which
   node-postgres hands over as a string. It must be turned into a real instant
   before formatting — slicing the digits off it just yields a number. */
function formatEpochMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/* The four pools the rating cards always describe. A pool with no games still
   gets a row reading "--" rather than vanishing, so "I have no rapid rating" is
   distinguishable from "rapid was not synced". Extra pools the platform happens
   to report (puzzle, fide, …) follow after these. */
const CANONICAL_POOLS = ['bullet', 'blitz', 'rapid', 'correspondence'];

function ratingRows(ratings) {
  const byCategory = new Map((ratings || []).map((r) => [r.category, r]));
  const rows = CANONICAL_POOLS.map((category) => ({
    category,
    rating: byCategory.get(category)?.rating ?? null,
    best: byCategory.get(category)?.best ?? null,
  }));
  for (const r of ratings || []) {
    if (!CANONICAL_POOLS.includes(r.category)) {
      rows.push({ category: r.category, rating: r.rating ?? null, best: r.best ?? null });
    }
  }
  return rows;
}

/* Chart labels are dates, not instants: the backend sends a plain calendar
   string and it is formatted here so a point never reads as raw ISO. */
function formatPointDate(value) {
  if (!value) return '—';
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ====================================================== main page */

const PLATFORMS = {
  'chess.com': { label: 'Chess.com', icon: '♔', url: 'https://www.chess.com/member' },
  lichess: { label: 'Lichess', icon: '♛', url: 'https://lichess.org/@' },
};

export default function ChessProfile() {
  const { showToast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState(null); // null = loading
  const [appReport, setAppReport] = useState({ rating: null, games: null, loading: true, error: '' });
  /* A game is opened with ?game=<id>, and that URL belongs to the GAMES tab.
     The tab default therefore follows the URL: with a fixed "overview" default a
     reload of an open game dropped the user back on the Overview tab, and the
     game - the thing they asked for - was nowhere on screen. */
  const hasGameParam = new URLSearchParams(location.search).get('game');
  const [tab] = useUrlTab('tab', hasGameParam ? 'games' : 'overview');
  /* Bumped whenever a sync stores something, so the Games tab re-reads without
     the user having to switch tabs or reload. */
  const [gamesVersion, setGamesVersion] = useState(0);
  /* Ratings refresh on the same check. The cards and history chart live in
     RatingComparison, which caches each account's payload; this version is what
     tells that cache "the server just re-read /stats — fetch again". */
  const [ratingsVersion, setRatingsVersion] = useState(0);

  const load = async (opts = {}) => {
    try {
      const d = await listAccounts();
      setAccounts(d.accounts);
    } catch (err) {
      /* Only replace the account list when we actually have one to show. A
         failed refresh must not wipe what is already on screen — that was the
         old behaviour and it made a transient 500 look like "no accounts". */
      if (!opts.quiet) {
        showToast(err.response?.data?.message || 'Failed to load profiles.', { tone: 'error', title: 'Chess profile' });
        setAccounts((prev) => (prev == null ? [] : prev));
      } else {
        setAccounts((prev) => (prev == null ? [] : prev));
      }
    }
  };

  /* Wait for auth before asking for the account list. Firing this on first paint
     meant the very first request went out with no token (or before the token was
     hydrated), got a 401, and — because nothing retried it — the page sat on an
     empty account list for the rest of the session. That also meant the sync
     poll below never became ready, since it needs a non-empty account list. */
  useEffect(() => {
    if (authLoading || !user) return;
    load({ quiet: true });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [authLoading, user?.id]);

  /* Automatic synchronisation: an immediate check once auth has resolved, then
     a poll while the page is open, paused when the tab is hidden.

     This replaces a single fire-and-forget `syncAccount(a.id, true)` on mount,
     which had two problems: it ran regardless of whether auth had resolved (so
     it could fire with no token or the wrong one), and it ran exactly once — a
     game finished ten minutes later was invisible until a manual reload. */
  const { checking, lastSyncedAt, lastError } = useAccountSync({
    accounts,
    loadAccounts: load,
    authLoading,
    user,
    onNewGames: (n) => {
      setGamesVersion((v) => v + 1);
      setRatingsVersion((v) => v + 1);
      showToast(
        `${n} new game${n === 1 ? '' : 's'} synced from ${PLATFORMS['chess.com'].label}.`,
        { tone: 'success', title: 'Games updated' },
      );
    },
    onSynced: ({ failures }) => {
      /* A clean check refreshed /stats on the server; re-read the cards and the
         chart without a page reload. A failed check must keep the old values on
         screen, so it deliberately does not bump the version. */
      if (!failures.length) setRatingsVersion((v) => v + 1);
    },
  });

  useEffect(() => {
    let active = true;
    /* "Mate Zone" is a LEARNER report and this page is also mounted for staff
       (/admin/chess-profile). It needs two things a staff account does not have:
       a row in `students` (GET /students/ratings/me answers 404 without one) and
       the student-only GET /game-history (403 for any non-student role). Asking
       anyway logged a guaranteed 403 + 404 in the console for every admin.

       So the question is only asked of students. `authLoading` is awaited rather
       than treating a still-hydrating null user as "not a student", otherwise
       the fetch would be skipped on first paint and never retried. */
    if (authLoading) return () => { active = false; };
    if (user?.role !== 'student') {
      setAppReport({ rating: null, games: null, loading: false, error: '' });
      return () => { active = false; };
    }
    Promise.all([
      api.get('/students/ratings/me', { cache: false }),
      api.get('/game-history', { cache: false }),
    ]).then(([ratingRes, gamesRes]) => {
      if (!active) return;
      setAppReport({
        rating: ratingRes.data || null,
        games: gamesRes.data || null,
        loading: false,
        error: '',
      });
    }).catch((err) => {
      if (!active) return;
      setAppReport({
        rating: null,
        games: null,
        loading: false,
        error: err.response?.data?.message || 'Mate Zone report is unavailable.',
      });
    });
    return () => { active = false; };
  }, [user, authLoading]);

  const refresh = (msg) => {
    if (msg) showToast(msg, { tone: 'success', title: 'Chess profile' });
    load();
  };

  const removeAccount = async (id, platform) => {
    if (!window.confirm(`Disconnect your ${PLATFORMS[platform]?.label || platform} profile? Imported games stay stored but are no longer synced.`)) return;
    try {
      await disconnectAccount(id);
      refresh(`${PLATFORMS[platform]?.label || 'Profile'} disconnected.`);
    } catch (err) {
      showToast(err.response?.data?.message || 'Could not disconnect.', { tone: 'error', title: 'Chess profile' });
    }
  };

  const sync = async (id, platform) => {
    try {
      showToast(`Syncing ${PLATFORMS[platform]?.label || 'profile'} — pulling latest games…`, { tone: 'info', title: 'Chess profile' });
      const r = await syncAccount(id);
      const note = r.note ? ` ${r.note}` : '';
      showToast(`Synced — ${r.newGames} new game${r.newGames === 1 ? '' : 's'} imported (${r.total} total).${note}`, { tone: 'success', title: 'Sync complete' });
      if (r.newGames > 0) setGamesVersion((v) => v + 1);
      /* Manual Sync refreshes ratings too (the backend re-reads /stats fresh). */
      setRatingsVersion((v) => v + 1);
      load();
    } catch (err) {
      showToast(err.response?.data?.message || 'Sync failed.', { tone: 'error', title: 'Chess profile' });
    }
  };

  const callbacks = {
    all: refresh,
    sync,
    remove: removeAccount,
  };

  /* Switching tabs is ONE navigation. Leaving the games tab also drops the
     open game from the URL, so a stale ?game= can never re-open a game the
     user has moved away from. */
  const selectTab = (key) => {
    const sp = new URLSearchParams(window.location.search);
    const openGame = sp.get('game');
    const sameTab = sp.get('tab') === key;
    const closingGame = sameTab && key === 'games' && !!openGame;

    /* Clicking the tab that is already open is a no-op - it must not push a
       second, identical history entry (Back would then appear to do nothing).
       The one exception is the games tab with a game open: that closes the
       game. */
    if (sameTab && !closingGame) return;

    /* Leaving the games tab - or closing the open game - drops the game from
       the URL. */
    if (key !== 'games' || closingGame) sp.delete('game');
    sp.set('tab', key);

    /* Closing a game REPLACES the entry: Back must not re-open the game that
       was just closed. */
    navigate({ search: `?${sp.toString()}` }, { replace: closingGame });
  };

  return (
    <div className="cp-ink-all">
    <Page title="Chess Profile" piece="♛" sub="Mate Zone + Chess.com + Lichess — ratings, games, statistics, openings and insights." wide>
      <div className="cp-tabs">
        {[
          ['overview', '♛ Overview'],
          ['games', '♟ Games'],
          ['stats', '📊 Statistics'],
          ['openings', '♘ Openings'],
          ['insights', '💡 Insights'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`cp-tab${tab === key ? ' active' : ''}`}
            onClick={() => selectTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <OverviewTab
          accounts={accounts}
          callbacks={callbacks}
          appReport={appReport}
          user={user}
          checking={checking}
          lastSyncedAt={lastSyncedAt}
          lastError={lastError}
          ratingsVersion={ratingsVersion}
        />
      )}
      {tab === 'games' && <GamesTab gamesVersion={gamesVersion} />}
      {tab === 'stats' && <StatsTab />}
      {tab === 'openings' && <OpeningsTab />}
      {tab === 'insights' && <InsightsTab />}
    </Page>
    </div>
  );
}

/* ====================================================== overview */

function OverviewTab({ accounts, callbacks, appReport, user, checking = false, lastSyncedAt = null, lastError = '', ratingsVersion = 0 }) {
  const { all } = callbacks;
  if (accounts === null) return <Spinner text="Loading your chess profiles…" />;
  return (
    <>
      <ConnectPanel onConnected={all} hasAccounts={accounts.length > 0} />
      {/* Staff accounts have no `students` row, so there is no Mate Zone
          profile to describe. Rendering it would show an empty card reading
          "App ID: —", so it is hidden rather than shown blank. */}
      {user?.role === 'student' && <AppProfileCard appReport={appReport} user={user} />}
      {accounts.length === 0 ? (
        <Card title="No profiles connected" piece="🔗" className="mt-4">
          <p className="text-black text-sm">
            Connect a Chess.com or Lichess account above to see your unified rating history, games,
            statistics, openings and personalized insights — all in one page.
          </p>
        </Card>
      ) : (
        <RatingComparison
          accounts={accounts}
          callbacks={callbacks}
          appReport={appReport}
          checking={checking}
          lastSyncedAt={lastSyncedAt}
          lastError={lastError}
          ratingsVersion={ratingsVersion}
        />
      )}
    </>
  );
}

function AppProfileCard({ appReport, user }) {
  if (appReport.loading) {
    return <Card title="Mate Zone (App)" piece="♞" className="cp-account-card mt-4"><Spinner text="Loading your Mate Zone report…" /></Card>;
  }
  if (appReport.error) {
    return <Card title="Mate Zone (App)" piece="♞" className="cp-account-card mt-4"><p className="text-sm text-black">{appReport.error}</p></Card>;
  }

  const rating = appReport.rating || {};
  const summary = appReport.games?.summary || {};
  const reportGames = appReport.games?.games || [];
  const games = Number(summary.games ?? reportGames.length);
  const wins = Number(summary.wins ?? 0);
  const draws = Number(summary.draws ?? 0);
  const losses = Number(summary.losses ?? 0);
  const winRate = Number(summary.winRate ?? (games ? Math.round((wins / games) * 100) : 0));

  return (
    <Card title="Mate Zone (App)" piece="♞" className="cp-account-card cp-acct-app mt-4">
      <div className="cp-account">
        <span className="cp-avatar cp-avatar-lg">♞</span>
        <div className="flex-1 min-w-0">
          <p className="cp-account-name">{user?.name || 'My Mate Zone profile'}</p>
          <p className="cp-account-meta">
            <span>App ID: {rating.studentId || user?.id || '—'}</span>
            <span>{rating.isProvisional ? 'Provisional' : 'Rated player'}</span>
          </p>
        </div>
      </div>
      <div className="cp-rating-list mt-3">
        <div className="cp-rating-row">
          <span className="cp-rating-cat">Rapid rating</span>
          <span className="cp-rating-val">{rating.rapid?.rating ?? '—'}<small>{rating.rapid?.peakRating ? ` peak ${rating.rapid.peakRating}` : ''}</small></span>
        </div>
        <div className="cp-rating-row">
          <span className="cp-rating-cat">App report</span>
          <span className="cp-rating-val">{games} games<small>{wins}W · {draws}D · {losses}L</small></span>
        </div>
        <div className="cp-rating-row">
          <span className="cp-rating-cat">Win rate</span>
          <span className="cp-rating-val">{winRate}%</span>
        </div>
        <div className="cp-rating-row">
          <span className="cp-rating-cat">Badge</span>
          <span className="cp-rating-val">{rating.maxLevel?.icon || '♟'} {rating.maxLevel?.name || '—'}</span>
        </div>
      </div>
      {reportGames.length > 0 && (
        <div className="mt-3">
          <p className="cp-section-label">Recent app games</p>
          <div className="cp-rating-list">
            {reportGames.slice(0, 3).map((game) => (
              <div key={game.id} className="cp-rating-row">
                <span className="cp-rating-cat">{game.resultLabel} · {game.type === 'online' ? 'Player' : 'Computer'}</span>
                <span className="text-xs text-black/60">{new Date(game.date).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function ConnectPanel({ onConnected, hasAccounts }) {
  const { showToast } = useToast();
  const [platform, setPlatform] = useState('chess.com');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [validated, setValidated] = useState(null);

  const usernameChanged = (v) => { setUsername(v); setValidated(null); };

  const validate = async () => {
    if (!username.trim()) { showToast('Enter a username first.', { tone: 'warning', title: 'Connect' }); return; }
    setBusy(true);
    try {
      const r = await validateAccount(platform, username.trim());
      setValidated(r);
    } catch (err) {
      setValidated(null);
      showToast(err.response?.data?.message || 'Could not validate that profile.', { tone: 'error', title: 'Validate' });
    } finally { setBusy(false); }
  };

  const connect = async () => {
    if (!validated) { validate(); return; }
    setBusy(true);
    try {
      const r = await connectAccount(platform, username.trim());
      const note = r.note ? ` ${r.note}` : '';
      showToast(`Imported ${r.newGames} game${r.newGames === 1 ? '' : 's'} from ${validated.username}.${note}`, { tone: 'success', title: 'Connected' });
      setUsername(''); setValidated(null);
      if (onConnected) onConnected();
    } catch (err) {
      showToast(err.response?.data?.message || 'Connection failed.', { tone: 'error', title: 'Connect' });
    } finally { setBusy(false); }
  };

  return (
    <Card title={hasAccounts ? 'Connect another profile' : 'Connect a profile'} piece="🔗">
      <div className="cp-connect">
        <div className="cp-connect-platforms">
          {Object.entries(PLATFORMS).map(([key, p]) => (
            <button
              key={key}
              className={`cp-connect-btn${platform === key ? ' active' : ''}`}
              onClick={() => { setPlatform(key); setValidated(null); }}
              title={`${p.label} public API — no password needed`}
            >
              <span className="cp-connect-icon">{p.icon}</span>
              {p.label}
            </button>
          ))}
        </div>
        <div className="cp-connect-row">
          <input
            className="chess-input flex-1"
            placeholder={platform === 'lichess' ? 'e.g. magnuscarlsen  (URLs okay too)' : 'e.g. hikaru  (URLs okay too)'}
            value={username}
            onChange={(e) => usernameChanged(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') connect(); }}
          />
          <Button variant="secondary" size="md" className="!px-4 !py-2 text-sm" onClick={validate} disabled={busy || !username.trim()}>
            {busy ? 'Checking…' : 'Validate'}
          </Button>
          <Button variant="primary" size="md" className="!px-4 !py-2 text-sm" onClick={connect} disabled={busy || !username.trim()}>
            {busy ? 'Working…' : 'Connect'}
          </Button>
        </div>
        {validated && (
          <div className="cp-validated">
            <span className="cp-avatar">{validated.avatar ? <img src={validated.avatar} alt="" /> : (PLATFORMS[platform]?.icon || '♟')}</span>
            <div className="flex-1">
              <p className="cp-valid-name">
                {validated.username} {validated.title && <Chip tone="gold">{validated.title}</Chip>}
                {validated.isVerified && <Chip tone="green">verified</Chip>}
              </p>
              <p className="text-xs text-black/55">
                {(validated.ratings || []).slice(0, 4).map((r) => `${r.category} ${r.rating} (best ${r.best ?? '—'})`).join(' · ') || 'No public ratings'}
              </p>
            </div>
          </div>
        )}
        <p className="cp-connect-note">
          Uses only the official public APIs — no passwords are ever stored. Chess.com imports the latest games,
          Lichess imports recent games plus full rating history.
        </p>
      </div>
    </Card>
  );
}

function RatingComparison({ accounts, callbacks, appReport, checking = false, lastSyncedAt = null, lastError = '', ratingsVersion = 0 }) {
  const [openSync, setOpenSync] = useState({});
  const [ratingsData, setRatingsData] = useState({});
  const [ratingsLoading, setRatingsLoading] = useState({});

  /* `force` re-reads an account whose payload is already cached. The automatic
     check bumps ratingsVersion, and without it a synced current rating would
     stay hidden behind the copy fetched when the page opened. */
  const loadRatings = async (acct, force = false) => {
    if (ratingsLoading[acct.id]) return;
    if (!force && ratingsData[acct.id]) return;
    setRatingsLoading((p) => ({ ...p, [acct.id]: true }));
    try {
      const r = await accountRatings(acct.id);
      setRatingsData((p) => ({ ...p, [acct.id]: r }));
    } catch { /* leave the previous values on screen */ } finally {
      setRatingsLoading((p) => ({ ...p, [acct.id]: false }));
    }
  };

  useEffect(() => {
    /* On a version bump every account is re-read. On a plain list change (new
       connection / disconnect) only the unknown ones are fetched. */
    accounts.forEach((a) => loadRatings(a, ratingsVersion > 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.map((a) => a.id).join(','), ratingsVersion]);

  /* The Mate Zone column, keyed by the SAME category names the linked
     platforms use (bullet / blitz / rapid / classical) so the columns line up
     row by row. A pool the student has never played in is null, and renders as
     "—" — never a misleading 0, which would look like a real rating. */
  const appByCategory = useMemo(() => {
    const tc = appReport?.rating?.timeClasses || {};
    return Object.fromEntries(
      Object.entries(tc).map(([key, p]) => [key, p && p.rating != null ? Number(p.rating) : null])
    );
  }, [appReport]);
  const appCategoryValues = Object.values(appByCategory).filter((v) => v != null && v > 0);
  const hasAnyAppRating = appCategoryValues.length > 0;

  const categories = useMemo(() => {
    const set = new Set();
    accounts.forEach((a) => (a.ratings || []).forEach((r) => set.add(r.category)));
    /* App pools count as categories too, so a category the student has on
       Mate Zone but not on any linked site still gets a row. */
    Object.entries(appByCategory).forEach(([k, v]) => { if (v != null) set.add(k); });
    return [...set];
  }, [accounts, appByCategory]);

  const bestCategoryId = (cat) => {
    let best = -Infinity, bestId = null;
    accounts.forEach((a) => {
      const r = (a.ratings || []).find((x) => x.category === cat);
      if (r && r.rating > best) { best = r.rating; bestId = a.id; }
    });
    /* The app competes for the ▲ marker like any other column — otherwise a
       strong Mate Zone rating would never be flagged as best in its row. */
    const appVal = appByCategory[cat];
    if (appVal != null && appVal > best) { best = appVal; bestId = 'app'; }
    return bestId;
  };

  /* "Overall (best current)" is labelled that way, and the account columns are
     already computed as each account's best current pool — so the app must be
     too. This used to report the Rapid number alone, which understated a
     student whose strongest pool is Blitz and disagreed with the column label. */
  const appRating = appCategoryValues.length
    ? Math.max(...appCategoryValues)
    : Number(appReport?.rating?.currentRating);
  const hasAppRating = Number.isFinite(appRating) && appRating > 0;
  const accountOverallRatings = accounts.map((a) => ({
    id: a.id,
    rating: Math.max(0, ...(a.ratings || []).map((r) => Number(r.rating) || 0)),
    platform: a.platform === 'lichess' ? 'lichess' : 'chess-com',
  }));
  const overallValues = [
    ...accountOverallRatings.map((value) => ({ ...value, source: 'account' })),
    ...(hasAppRating ? [{ id: 'app', rating: appRating, platform: 'app', source: 'app' }] : []),
  ];
  const bestOverall = overallValues.length
    ? Math.max(...overallValues.map((value) => value.rating))
    : null;

  return (
    <div className="cp-grid2 mt-4">
      {accounts.map((acct) => {
        const p = PLATFORMS[acct.platform] || { label: acct.platform, icon: '♟' };
        const historic = ratingsData[acct.id];
        const busy = openSync[acct.id];
        return (
          <Card key={acct.id} title={p.label} piece={p.icon} className={`cp-account-card cp-acct-${acct.platform === 'lichess' ? 'lichess' : 'chess-com'}`}>
            <div className="cp-account">
              <span className="cp-avatar cp-avatar-lg">{acct.avatar ? <img src={acct.avatar} alt="" /> : p.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="cp-account-name">{acct.username} {acct.title && <Chip tone="gold">{acct.title}</Chip>}</p>
                <p className="cp-account-meta">
                  {acct.country_code && <span>{acct.country_code}</span>}
                  {acct.is_verified && <span>✓ verified</span>}
                  {acct.games != null && <span>{acct.games} games</span>}
                  {acct.wins != null && <span>{acct.wins} wins</span>}
                </p>
                <p className="cp-account-meta">
                  {/* last_activity_at is a BIGINT epoch-ms value, not a date
                      string. Slicing it produced "1790070290" on the card. */}
                  {acct.last_activity_at && <span>active {formatEpochMs(acct.last_activity_at)}</span>}
                  {/* A date alone hid the staleness: a sync that ran at 09:00
                      looked identical to one that ran yesterday. */}
                  <span title={acct.last_synced_at || undefined}>
                    synced {acct.last_synced_at ? formatDateTime(acct.last_synced_at) : '—'}
                  </span>
                  {(acct.ratings_updated_at || acct.platform === 'chess.com') && (
                    <span title="When current and best ratings were last refreshed">
                      {acct.ratings_updated_at ? `ratings updated ${formatDateTime(acct.ratings_updated_at)}` : 'ratings not synced yet'}
                    </span>
                  )}
                  {/* "Up to date through" is the honest statement of freshness:
                      the newest game we actually hold, not when we last asked. */}
                  {acct.newest_game_ms && (
                    <span title="Newest game stored for this account">
                      up to {formatDateTime(new Date(Number(acct.newest_game_ms)).toISOString())}
                    </span>
                  )}
                </p>
                {acct.last_error && (
                  <p className="cp-account-meta text-red-700">{acct.last_error}</p>
                )}
              </div>
            </div>

            <p className="cp-account-meta mt-2">
              {checking ? 'Checking for new games…'
                : lastError ? `Last check failed: ${lastError}`
                : lastSyncedAt ? `Checked ${formatDateTime(lastSyncedAt)} · this page re-checks every 2 minutes`
                : 'Re-checking for new games automatically'}
            </p>

            <div className="flex flex-wrap gap-2 mt-3">
              <Button variant="secondary" size="sm" className="!px-3 !py-1.5 !text-xs" disabled={busy} onClick={async () => {
                setOpenSync((s) => ({ ...s, [acct.id]: true }));
                await callbacks.sync(acct.id, acct.platform);
                setOpenSync((s) => ({ ...s, [acct.id]: false }));
              }}>
                {busy ? 'Syncing…' : '↺ Sync'}
              </Button>
              <Button variant="danger" size="sm" className="!px-3 !py-1.5 !text-xs" onClick={() => callbacks.remove(acct.id, acct.platform)}>
                Disconnect
              </Button>
              <Button variant="secondary" size="sm" className="!px-3 !py-1.5 !text-xs" href={acct.profile_url || '#'} target="_blank" rel="noopener noreferrer">
                View on site ↗
              </Button>
            </div>

            {acct.last_error && (
              <p className="cp-error-line mt-2">⚠ {acct.last_error}</p>
            )}

            <div className="cp-rating-list mt-3">
              {ratingRows(acct.ratings).map((r) => (
                <div key={r.category} className="cp-rating-row">
                  <span className="cp-rating-cat">{r.category}</span>
                  <span className="cp-rating-val">
                    {r.rating != null ? r.rating : '--'}
                    {r.best != null ? <small>{` best ${r.best}`}</small> : null}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-3">
              <p className="cp-section-label">
                Rating history
                {/* A check re-reads the chart every two minutes. Keep the chart
                    mounted while that happens (a small "updating" note instead
                    of swapping it for a loader) so the selected class tab does
                    not jump back to the default on every poll. */}
                {ratingsLoading[acct.id] && historic && (
                  <span className="text-xs font-normal text-black animate-pulse"> · updating…</span>
                )}
              </p>
              {ratingsLoading[acct.id] && !historic ? (
                <p className="text-xs text-black animate-pulse">Loading history…</p>
              ) : historic && historic.history && historic.history.length ? (
                <RatingHistoryHistory history={historic.history} stroke={acct.platform === 'lichess' ? '#f59e0b' : '#2563eb'} />
              ) : (
                <p className="text-xs text-black">No rating history imported yet.</p>
              )}
            </div>
          </Card>
        );
      })}

      {/* Shown when there is anything to compare. Previously this needed at
          least one LINKED account, which hid the Mate Zone column entirely for
          a student who has app ratings but has not connected Chess.com or
          Lichess yet — the comparison is still meaningful with one column. */}
      {(accounts.length > 0 || hasAnyAppRating) && (
        <Card title="Rating comparison" piece="⚖" className="cp-account-card cp-compare-card">
          <div className="cp-compare">
            <div className="overflow-x-auto">
            <table className="cp-compare-table">
              <thead>
                <tr>
                  <th>Category</th>
                  {accounts.map((a) => (
                    <th key={a.id} className={`cp-col-${a.platform === 'lichess' ? 'lichess' : 'chess-com'}`}>
                      {PLATFORMS[a.platform]?.icon || '♟'} {PLATFORMS[a.platform]?.label || a.platform}
                    </th>
                  ))}
                  <th className="cp-col-app">♞ Mate Zone</th>
                </tr>
              </thead>
              <tbody>
                {categories.length === 0 && !hasAppRating && (
                  <tr><td colSpan={accounts.length + 2} className="text-center text-black text-sm py-6">No rating categories found.</td></tr>
                )}
                {hasAppRating && (
                  <tr className="cp-overall-row">
                    <td className="cp-cat-name">Overall (best current)</td>
                    {accountOverallRatings.map((value) => (
                      <td
                        key={value.id}
                        className={`cp-cat-val cp-col-${value.platform}${value.rating === bestOverall ? ' cp-cat-best' : ''}`}
                      >
                        {value.rating || '—'}{value.rating === bestOverall && value.rating > 0 ? ' ▲' : ''}
                      </td>
                    ))}
                    <td className={`cp-cat-val cp-col-app${appRating === bestOverall ? ' cp-cat-best' : ''}`}>
                      {appRating}{appRating === bestOverall ? ' ▲' : ''}
                    </td>
                  </tr>
                )}
                {categories.map((cat) => {
                  const bestId = bestCategoryId(cat);
                  const appVal = appByCategory[cat];
                  const appIsBest = bestId === 'app' && appVal != null;
                  return (
                    <tr key={cat}>
                      <td className="cp-cat-name">{cat}</td>
                      {accounts.map((a) => {
                        const r = (a.ratings || []).find((x) => x.category === cat);
                        const isBest = bestId === a.id && !!r;
                        return (
                          <td key={a.id} className={`cp-cat-val cp-col-${a.platform === 'lichess' ? 'lichess' : 'chess-com'}${isBest ? ' cp-cat-best' : ''}`}>
                            {r ? r.rating : '—'}{isBest ? ' ▲' : ''}
                          </td>
                        );
                      })}
                      <td className={`cp-cat-val cp-col-app${appIsBest ? ' cp-cat-best' : ''}`}>
                        {appVal != null ? appVal : '—'}{appIsBest ? ' ▲' : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ====================================================== games */

function RatingHistoryHistory({ history, stroke = '#2563eb' }) {
  /* Tabs cover every canonical pool, not just the categories that happen to
     have points yet — a class with no synced games still needs a tab to show
     its "nothing here" message instead of silently disappearing. Any extra
     category the platform returns (e.g. Lichess classical) is appended after
     the canonical four so nothing is unreachable. */
  const rows = Array.isArray(history) ? history : [];
  const byCat = new Map(rows.map((h) => [h.category, h]));
  const extraCats = rows.map((h) => h.category).filter((c) => !CANONICAL_POOLS.includes(c));
  const categories = [...CANONICAL_POOLS, ...extraCats];
  const firstWithPoints = categories.find((c) => (byCat.get(c)?.points || []).length > 0) || categories[0];
  const [cat, setCat] = useState(firstWithPoints);
  const activeCat = categories.includes(cat) ? cat : firstWithPoints;
  const source = byCat.get(activeCat)?.points || [];
  const points = source.map((pt, i) => ({ x: i, value: pt.rating, label: formatPointDate(pt.date) }));
  const labels = [points[0]?.label, ...(points.length > 2 ? [points[Math.floor(points.length / 2)]?.label] : []), points[points.length - 1]?.label].filter(Boolean);
  const titles = points.map((p) => `${p.label} · ${p.value}`);
  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-2">
        {categories.map((c) => (
          <button key={c} className={`cp-cat-tab${activeCat === c ? ' active' : ''}`} onClick={() => setCat(c)}>
            {c} · {(byCat.get(c)?.points || []).length}
          </button>
        ))}
      </div>
      {source.length === 0 ? (
        <p className="text-xs text-black">
          No {activeCat} games synced yet — this chart fills in after the next sync.
        </p>
      ) : (
        <LineChart points={points} labels={labels} titles={titles} height={120} stroke={stroke} />
      )}
    </div>
  );
}

/* ====================================================== games */

const GAME_SORTS = [
  ['desc', 'Newest first'],
  ['asc', 'Oldest first'],
];

function GamesTab({ gamesVersion = 0 }) {
  const { showToast } = useToast();
  const [filters, setFilters] = useState({ platform: '', result: 'all', timeClass: 'all', q: '', page: 1, pageSize: 25, sort: 'desc' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  /* The open game lives in the URL (?game=<id>), so it IS the history entry:
     the browser Back button returns to the list and a reload keeps the same
     game open. The id is the imported game's own row id - the unique identity
     inside the 'chess_profile' source. */
  const [selectedId, setSelectedId] = useUrlView('game');
  /* Colour-from-the-owner's-seat layer. This is purely client-side and sits ON
     TOP of the existing server filters (platform / result / timeClass / sort /
     search, which still go through fetchGames untouched): the server narrows,
     these chips narrow further. `colour` never conflicts with the existing
     "Won (as white)" / "Won (as black)" result options — those describe who
     won the board, this describes which seat the owner sat in, so e.g.
     colour=black + result="Won (as white)" is exactly "Lost as Black". */
  const [colour, setColour] = useState('all'); // 'all' | 'white' | 'black'
  const [groupByColour, setGroupByColour] = useState(false); // default off

  const apply = async (patch) => {
    const next = { ...filters, ...patch, page: patch !== undefined ? (patch.q !== undefined ? 1 : patch.page || filters.page) : filters.page };
    if (patch && (patch.q !== undefined || patch.from !== undefined || patch.to !== undefined)) next.q = patch.q;
    setFilters(next);
    setLoading(true);
    try {
      const params = { ...next };
      params.platform = params.platform || undefined;
      const r = await fetchGames(params);
      setData(r);
    } catch (err) {
      showToast(err.response?.data?.message || 'Could not load games.', { tone: 'error', title: 'Game history' });
      /* Keep whatever is already on screen. Blanking the list on a failed
         refresh makes a transient network blip look like every game vanished. */
      setData((prev) => prev);
    } finally { setLoading(false); }
  };

  useEffect(() => { apply(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /* A background sync stored new games → re-read the list in place. The user
     sees them without a reload and without losing their filters or page. */
  useEffect(() => {
    if (gamesVersion > 0) apply();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [gamesVersion]);

  /* Open ONE game: the row's own id, as a string (URL values are strings). */
  const openViewer = (id) => {
    if (id == null) return;
    setSelectedId(String(id));
  };

  /* Close the game. The ?game= entry is REPLACED, not pushed: Back then
     returns to the page the user came from instead of re-opening the game
     that was just closed. */
  const closeViewer = () => {
    setSelectedId(null, { replace: true });
  };

  /* A ?game= value that is not a game id can never open anything - drop it so
     the URL never keeps a dead pointer to a game. */
  const selectedGameId = selectedId && /^\d+$/.test(String(selectedId)) ? Number(selectedId) : null;
  useEffect(() => {
    if (selectedId && !selectedGameId) setSelectedId(null, { replace: true });
  }, [selectedId, selectedGameId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Owner colour/result per row. The username falls back to each row's own
     `account_username` (one page can mix several linked accounts), and stays
     'unknown' — never guessed — when the owner matches neither player. */
  const annotated = useMemo(
    () => (data?.games || []).map((g) => ({
      game: g,
      colour: getUserColour(g),
      userResult: getUserResult(g),
    })),
    [data],
  );
  const visible = colour === 'all' ? annotated : annotated.filter((a) => a.colour === colour);
  const whiteGames = visible.filter((a) => a.colour === 'white');
  const blackGames = visible.filter((a) => a.colour === 'black');
  const unknownGames = visible.filter((a) => a.colour !== 'white' && a.colour !== 'black');

  return (
    <div className="mt-4">
      <Card title="Game history" piece="♟">
        <div className="cp-filter-row">
          <select className="chess-input" value={filters.platform} onChange={(e) => apply({ platform: e.target.value, page: 1 })}>
            <option value="">All platforms</option>
            <option value="chess.com">Chess.com</option>
            <option value="lichess">Lichess</option>
          </select>
          <select className="chess-input" value={filters.result} onChange={(e) => apply({ result: e.target.value, page: 1 })}>
            <option value="all">All results</option>
            <option value="white">Won (as white)</option>
            <option value="black">Won (as black)</option>
            <option value="draw">Draw</option>
          </select>
          <select className="chess-input" value={filters.timeClass} onChange={(e) => apply({ timeClass: e.target.value, page: 1 })}>
            <option value="all">All time controls</option>
            <option value="bullet">Bullet</option>
            <option value="blitz">Blitz</option>
            <option value="rapid">Rapid</option>
            <option value="classical">Classical</option>
            <option value="chess960">Chess960</option>
            <option value="correspondence">Correspondence</option>
          </select>
          <select className="chess-input" value={filters.sort} onChange={(e) => apply({ sort: e.target.value })}>
            {GAME_SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          <input
            className="chess-input flex-1"
            placeholder="Search opening / opponent…"
            value={filters.q}
            onChange={(e) => apply({ q: e.target.value, page: 1 })}
          />
        </div>

        {/* Colour seat filter + group toggle. Chips combine with every select
            above (e.g. Black + "Won (as white)" reads as Lost as Black). */}
        <div className="cp-chips-row">
          <span className="cp-chips-label">Colour:</span>
          {[
            ['all', 'All'],
            ['white', '⚪ White'],
            ['black', '⚫ Black'],
          ].map(([v, label]) => (
            <button
              key={v}
              className={`cp-chip${colour === v ? ' active' : ''}`}
              onClick={() => setColour(v)}
            >
              {label}
            </button>
          ))}
          <label className="cp-group-toggle">
            <input
              type="checkbox"
              checked={groupByColour}
              onChange={(e) => setGroupByColour(e.target.checked)}
            />
            Group by colour
          </label>
        </div>

        {loading && !data ? <Spinner text="Loading games…" /> : null}

        {data && data.games.length === 0 && (
          <p className="text-black text-sm py-6 text-center">
            {data.total === 0
              ? 'No imported games yet — connect a Chess.com or Lichess profile and sync it, or check back after a sync.'
              : 'No imported games match those filters. Clear the search, or sync a profile for the latest games.'}
          </p>
        )}

        {data && data.games.length > 0 && visible.length === 0 && (
          <p className="text-black text-sm py-6 text-center">
            No games as {colour === 'white' ? 'White' : 'Black'} with these filters. Try All colours or clear the search.
          </p>
        )}

        {data && visible.length > 0 && (
          <>
            {groupByColour ? (
              <div className="cp-games-list">
                {whiteGames.length > 0 && (
                  <>
                    <p className="cp-colour-group-label">⚪ White games ({whiteGames.length})</p>
                    {whiteGames.map((a) => (
                      <GameRow key={a.game.id} game={a.game} colour={a.colour} userResult={a.userResult} active={String(selectedId) === String(a.game.id)} onOpen={() => openViewer(a.game.id)} />
                    ))}
                  </>
                )}
                {blackGames.length > 0 && (
                  <>
                    <p className="cp-colour-group-label">⚫ Black games ({blackGames.length})</p>
                    {blackGames.map((a) => (
                      <GameRow key={a.game.id} game={a.game} colour={a.colour} userResult={a.userResult} active={String(selectedId) === String(a.game.id)} onOpen={() => openViewer(a.game.id)} />
                    ))}
                  </>
                )}
                {unknownGames.length > 0 && (
                  <>
                    <p className="cp-colour-group-label">❔ Seat unknown ({unknownGames.length})</p>
                    {unknownGames.map((a) => (
                      <GameRow key={a.game.id} game={a.game} colour={a.colour} userResult={a.userResult} active={String(selectedId) === String(a.game.id)} onOpen={() => openViewer(a.game.id)} />
                    ))}
                  </>
                )}
              </div>
            ) : (
              <div className="cp-games-list">
                {visible.map((a) => (
                  <GameRow key={a.game.id} game={a.game} colour={a.colour} userResult={a.userResult} active={String(selectedId) === String(a.game.id)} onOpen={() => openViewer(a.game.id)} />
                ))}
              </div>
            )}
            <div className="cp-pager">
              <Button variant="secondary" size="sm" className="!px-3 !py-1.5 !text-xs" disabled={data.page <= 1} onClick={() => apply({ page: data.page - 1 })}>← Prev</Button>
              <span className="text-black text-xs">Page {data.page} · {data.total} game{data.total === 1 ? '' : 's'}</span>
              <Button
                variant="secondary" size="sm" className="!px-3 !py-1.5 !text-xs"
                disabled={data.page * data.pageSize >= data.total}
                onClick={() => apply({ page: data.page + 1 })}
              >Next →</Button>
            </div>
          </>
        )}
      </Card>

      {selectedGameId && (
        <GameViewer key={selectedGameId} gameId={selectedGameId} onClose={closeViewer} />
      )}
    </div>
  );
}

function GameRow({ game: g, active, onOpen, colour, userResult }) {
  const myColor = effectiveColor(g);
  const meta = resultMeta(g.result, myColor);
  const t = toneOf(g.result, myColor);
  /* Owner-seat badges: never guessed — 'unknown' renders a neutral chip. The
     `colour` / `userResult` props arrive precomputed from the GamesTab list;
     the fallback keeps GameRow safe if ever rendered standalone. */
  const uc = colour || getUserColour(g);
  const ur = userResult || getUserResult(g);
  const badgeText = ur === 'win' ? 'Win' : ur === 'loss' ? 'Loss' : ur === 'draw' ? 'Draw' : '—';
  const platCls = g.platform === 'lichess' ? 'lichess' : 'chess-com';
  return (
    <button className={`cp-game-row ${platCls} ${active ? 'active' : ''}`} onClick={onOpen}>
      <span className="cp-game-side">
        <span className={`cp-colour-chip cp-colour-${uc}`} title={uc === 'unknown' ? 'Seat unknown' : `You played ${uc}`}>
          {uc === 'white' ? '⚪' : uc === 'black' ? '⚫' : '❔'}
        </span>
        <span className={`cp-user-badge cp-user-${ur}`}>{badgeText}</span>
        <span className={`cp-game-result cp-result-${t}`}>{meta.text}</span>
      </span>
      <span className="cp-game-main">
        <span className="cp-game-head">
          <span className="cp-game-names">
            <span className={uc === 'white' ? 'cp-name-me' : undefined}>{g.white_name}</span>
            {' vs '}
            <span className={uc === 'black' ? 'cp-name-me' : undefined}>{g.black_name}</span>
          </span>
          <span className="cp-game-rating">⚪ {elo(g.white_rating)} · ⚫ {elo(g.black_rating)}</span>
        </span>
        <span className="cp-game-sub">
          {timeClassGlyph(g.time_class)} {g.time_class} · {formatDate(g.game_date)} · {(g.opening || 'No opening recorded').slice(0, 60)}
        </span>
      </span>
      <span className="cp-game-platform">
        {PLATFORMS[g.platform]?.icon || '♟'}
        <span className="text-black">{(g.moves_count || 0)} moves</span>
      </span>
    </button>
  );
}

/* ====================================================== viewer */

/* The full-game analysis card. It lives in its own component so the Brilliant
   (Sigma) Moves list opens the SAME card — one board, one move list, one
   classification source — rather than building a parallel second one. This page
   passes the game's identity plus the stored-analysis accessors; the card itself
   knows nothing about where a game came from. */
function GameViewer({ gameId, onClose }) {
  /* The card opens IMMEDIATELY and resolves the game itself, so a slow or
     failed load is reported INSIDE the card instead of leaving a dead click
     with nothing on screen. The resolver is memoised: the card re-runs its
     load whenever the resolver's identity changes, and an inline arrow would
     change on every render. */
  const resolveGame = useCallback((ref) => fetchGame(ref.gameId), []);
  return (
    <GameViewerCard
      gameRef={{ gameSource: 'chess_profile', gameId }}
      resolveGame={resolveGame}
      onClose={onClose}
      gameId={gameId}
      loadAnalysis={fetchAnalysis}
      saveAnalysis={saveAnalysis}
      /* The ?game= parameter IS this card's history entry. A second one (the
         overlay's own push) would make the browser Back button skip over the
         list the user opened the game from. */
      manageHistory={false}
    />
  );
}
/* ====================================================== stats */

function StatsTab() {
  const { showToast } = useToast();
  const [platform, setPlatform] = useState('');
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async (p) => {
    setPlatform(p);
    setLoading(true);
    try {
      setStats(await fetchStatistics(p || undefined));
    } catch (err) {
      showToast(err.response?.data?.message || 'Could not load statistics.', { tone: 'error', title: 'Statistics' });
      setStats(null);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <div className="mt-4 space-y-4">
      <Card title="Statistics" piece="📊">
        <div className="flex flex-wrap gap-2 items-center mb-4">
          {[['', 'Combined'], ['chess.com', 'Chess.com'], ['lichess', 'Lichess']].map(([v, label]) => (
            <button key={v} className={`cp-cat-tab${platform === v ? ' active' : ''}`} onClick={() => load(v)}>{label}</button>
          ))}
        </div>
        {loading ? <Spinner text="Crunching your numbers…" /> : null}
        {stats && (
          <div className="space-y-5">
            <div className="cp-stat-grid">
              <Stat label="Total games" value={stats.totalGames} icon="♟" />
              <Stat label="Win rate" value={`${stats.winRate}%`} icon="🏆" />
              <Stat label="Result" value={`${stats.wins}W · ${stats.losses}L · ${stats.draws}D`} icon="⚔" />
              <Stat label="Avg moves" value={stats.avgMoves} icon="♞" />
              <Stat label="Avg opponent" value={elo(stats.avgOpponentRating)} icon="🎯" />
              <Stat label="Current streak" value={stats.streaks?.current} icon="🔥" />
            </div>

            <div className="cp-grid2">
              <div>
                <p className="cp-section-label">By time control</p>
                {stats.byTimeClass && stats.byTimeClass.length ? stats.byTimeClass.map((tc) => (
                  <PctBar key={tc.timeClass} label={`${tc.timeClass} · ${tc.games} games`} value={tc.winRate} color="#2563eb" />
                )) : <p className="text-black/55 text-sm">No time-class data.</p>}
              </div>
              <div>
                <p className="cp-section-label">By colour</p>
                <PctBar label={`White · ${stats.byColor?.white?.games} games`} value={stats.byColor?.white?.winRate || 0} color="#2563eb" />
                <PctBar label={`Black · ${stats.byColor?.black?.games} games`} value={stats.byColor?.black?.winRate || 0} color="#4f7dff" />
              </div>
            </div>

            <div>
              <p className="cp-section-label">Games per month (last 12)</p>
              <BarChart items={(stats.gamesPerMonth || []).map((m) => ({ label: m.label.slice(2, 7), value: m.count }))} height={150} />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ====================================================== openings */

function OpeningsTab() {
  const { showToast } = useToast();
  const [platform, setPlatform] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async (p) => {
    setPlatform(p);
    setLoading(true);
    try {
      setData(await fetchOpenings(p || undefined));
    } catch (err) {
      showToast(err.response?.data?.message || 'Could not load openings.', { tone: 'error', title: 'Openings' });
      setData(null);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const all = data?.mostPlayed || [];

  return (
    <div className="mt-4 space-y-4">
      <Card title="Openings" piece="♘">
        <div className="flex flex-wrap gap-2 items-center mb-4">
          {[['', 'Combined'], ['chess.com', 'Chess.com'], ['lichess', 'Lichess']].map(([v, label]) => (
            <button key={v} className={`cp-cat-tab${platform === v ? ' active' : ''}`} onClick={() => load(v)}>{label}</button>
          ))}
        </div>
        {loading ? <Spinner text="Reading your openings…" /> : null}
        {data && (
          <div className="space-y-5">
            {all.length === 0 && <p className="text-black/55 text-sm">No opening data yet — import some games first.</p>}
            {all.length > 0 && (
              <>
                <div>
                  <p className="cp-section-label">Most played</p>
                  {all.map((o) => (
                    <div className="cp-open-row" key={o.eco + o.name}>
                      <span className="cp-open-name">{o.name}</span>
                      <span className="cp-open-nums">{o.games}g · {o.winRate}% win</span>
                    </div>
                  ))}
                </div>
                <div className="cp-grid2">
                  <div>
                    <p className="cp-section-label">Best openings (≥3 games)</p>
                    {(data.best || []).map((o) => (
                      <div className="cp-open-row" key={`b${o.eco + o.name}`}>
                        <span className="cp-open-name">{o.name}</span>
                        <span className="cp-open-nums cp-num-good">{o.winRate}% ({o.games}g)</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="cp-section-label">Toughest openings (≥3 games)</p>
                    {(data.worst || []).map((o) => (
                      <div className="cp-open-row" key={`w${o.eco + o.name}`}>
                        <span className="cp-open-name">{o.name}</span>
                        <span className="cp-open-nums cp-num-loss">{o.winRate}% ({o.games}g)</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ====================================================== insights */

const INSIGHT_TONES = {
  good: { icon: '✅', cls: 'good' },
  warn: { icon: '⚠️', cls: 'warn' },
  info: { icon: '💡', cls: 'info' },
};

function InsightsTab() {
  const { showToast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchInsights().then((r) => { if (alive) setData(r); }).catch((err) => {
      showToast(err.response?.data?.message || 'Could not load insights.', { tone: 'error', title: 'Insights' });
      if (alive) setData({ insights: [], hasData: false });
    }).finally(() => { if (alive) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-4">
      <Card title="Insights" piece="💡">
        {loading ? <Spinner text="Thinking about your chess…" /> : null}
        {data && !data.hasData && (
          <p className="text-black/55 text-sm py-4">
            No imported games yet — connect a profile and sync a few games to unlock personalized insights.
          </p>
        )}
        {data && data.hasData && data.insights.length === 0 && (
          <p className="text-black/55 text-sm py-4">Not enough variation in your data yet — play a few more games and insights will sharpen.</p>
        )}
        {data && data.insights.length > 0 && (
          <div className="cp-insights">
            {data.insights.map((ins, i) => {
              const meta = INSIGHT_TONES[ins.tone] || INSIGHT_TONES.info;
              return (
                <div key={i} className={`cp-insight cp-insight-${meta.cls}`}>
                  <span>{meta.icon}</span>
                  <p>{ins.text}</p>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
