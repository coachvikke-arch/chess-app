import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Page, Card, Chip, Spinner, Bar } from '../components/ui';
import Pagination, { PAGE_SIZE } from '../components/Pagination';
import { usePagination } from '../hooks/usePagination';
import { isAdminRole } from '../utils/roles';
import { formatDateTime12 } from '../utils/time';
import { copyText } from '../utils/clipboard';
import { buildRowPgn, pgnFilename, hasPgnMoves, pgnHasMoves } from '../utils/gamePgn';

function resultTone(r) {
  if (!r) return '';
  if (r.startsWith('Win')) return 'green';
  if (r.startsWith('Loss')) return 'red';
  if (r === 'Draw' || r.startsWith('Draw')) return 'amber';
  if (r === 'Abandoned') return 'amber';
  if (r === 'Aborted') return '';
  return '';
}

/* When Game History is rendered as a tab INSIDE Game Review, the parent already
   provides the page header, so we drop our own <Page> wrapper — nesting one
   inside another would double the padding and print the title twice. */
function Wrap({ embedded, title, piece, sub, children }) {
  if (embedded) return <>{children}</>;
  return (
    <Page title={title} piece={piece} sub={sub}>
      {children}
    </Page>
  );
}

function modeChip(g) {
  if (g.type === 'computer')   return { label: '🤖 Computer',   tone: '' };
  if (g.type === 'online')     return { label: '👤 Player',     tone: 'green' };
  if (g.type === 'tournament') return { label: '🏆 Tournament', tone: 'gold' };
  return { label: '♟ Game', tone: '' };
}

/* The charts and filters all key off the ordered prefixes the backend writes
   (Win / Loss / Draw + optional reason). One helper keeps them in agreement. */
function resultBucket(g) {
  const label = g.resultLabel || '';
  if (label === 'Win' || label.startsWith('Win ')) return 'win';
  if (label === 'Loss' || label.startsWith('Loss ')) return 'loss';
  if (label === 'Draw' || label.startsWith('Draw ')) return 'draw';
  return 'other';
}

/* A game is replayable when it has real MOVES or at least a final position.
   A headers-only PGN (abandoned/aborted games, some imports) is not a game the
   review parser can load, so it falls through to the FEN instead of erroring.
   Tournament boards always carry a FEN, so a forfeited board can still be
   opened rather than the row silently doing nothing. */
const isReplayable = (g) => !!(pgnHasMoves(g) || g.fen);

/* Tournament rating movement for THIS game. Overall rating wins over the
   time-control pool only when the settlement actually wrote one. */
function gameRating(g) {
  if (g.type !== 'tournament') return null;
  const before = g.ratingBefore ?? g.timeRatingBefore;
  const after = g.ratingAfter ?? g.timeRatingAfter;
  const change = g.ratingChange ?? g.timeRatingChange;
  if (before == null || after == null || change == null) return null;
  return { before: Number(before), after: Number(after), change: Number(change) };
}

function RatingCell({ g }) {
  if (g.type !== 'tournament') return <span className="text-ivory-600">—</span>;
  const r = gameRating(g);
  if (!r) return <span className="text-ivory-500 text-xs">Unrated</span>;
  const tone = r.change > 0 ? 'green' : r.change < 0 ? 'red' : '';
  return (
    <span className="whitespace-nowrap text-ivory-300" title={`${r.before} → ${r.after}`}>
      {r.before} <span className="text-ivory-500">→</span> {r.after}{' '}
      <Chip tone={tone}>{r.change > 0 ? `+${r.change}` : r.change}</Chip>
    </span>
  );
}

function TournamentCell({ g }) {
  if (g.type !== 'tournament') return <span className="text-ivory-600">—</span>;
  const parts = [];
  if (g.roundNo != null) parts.push(`Round ${g.roundNo}`);
  if (g.boardNo != null) parts.push(`Board ${g.boardNo}`);
  if (g.isArmageddon) parts.push('Armageddon');
  return (
    <span className="block max-w-[16rem]">
      <span className="block text-ivory-200 truncate" title={g.tournamentName || ''}>
        {g.tournamentName || 'Tournament'}
      </span>
      {parts.length > 0 && (
        <span className="block text-[0.7rem] text-ivory-500">{parts.join(' · ')}</span>
      )}
    </span>
  );
}

/* Student view — their own play history + summary. */
/* `onOpenGame` is supplied when this is embedded as a tab inside Game Review:
   the parent already owns the URL, so we hand the game over and let it switch
   tabs rather than navigating (which would drop the tab state). Standalone,
   we navigate ourselves as before. */
function StudentView({ embedded = false, onOpenGame }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  /* id of the row whose PGN was just copied / downloaded, so its button can
     show "Copied ✓" (or "Saved ✓") for a beat before reverting. */
  const [copiedId, setCopiedId] = useState(null);
  const [downloadedId, setDownloadedId] = useState(null);
  const listTopRef = useRef(null);

  useEffect(() => {
    api
      .get('/game-history')
      .then((res) => setData(res.data))
      .catch((e) => setError(e.response?.data?.message || e.message || 'Failed to load game history'));
  }, []);

  const games = useMemo(() => data?.games || [], [data]);
  const filtered = useMemo(() => {
    return games.filter((g) => {
      switch (filter) {
        case 'computer':   return g.type === 'computer';
        case 'online':     return g.type === 'online';
        case 'tournament': return g.type === 'tournament';
        case 'wins':       return resultBucket(g) === 'win';
        case 'losses':     return resultBucket(g) === 'loss';
        case 'draws':      return resultBucket(g) === 'draw';
        default:           return true;
      }
    });
  }, [games, filter]);

  const pager = usePagination(filtered, PAGE_SIZE, {
    resetKeys: [filter],
    scrollRef: listTopRef,
  });

  if (error) return <div className="chess-error">{error}</div>;
  if (!data) return <Spinner text="Loading game history…" />;

  const { summary, periods } = data;
  const winRate = summary.games > 0 ? Math.round((summary.wins / summary.games) * 100) : 0;

  const computerCount   = games.filter((g) => g.type === 'computer').length;
  const onlineCount     = games.filter((g) => g.type === 'online').length;
  const tournamentCount = games.filter((g) => g.type === 'tournament').length;
  const winsCount       = games.filter((g) => resultBucket(g) === 'win').length;
  const lossesCount     = games.filter((g) => resultBucket(g) === 'loss').length;
  const drawsCount      = games.filter((g) => resultBucket(g) === 'draw').length;

  const openGame = (g) => {
    if (!isReplayable(g)) return;
    if (onOpenGame) return onOpenGame(g);
    const prefix = '/student';
    const params = new URLSearchParams();
    /* Only hand over a PGN that actually contains moves; a headers-only one
       would make the review page reject the game. The FEN is the useful
       fallback for those rows. */
    if (pgnHasMoves(g)) params.set('pgn', g.pgn);
    else if (g.fen) params.set('fen', g.fen);
    navigate(`${prefix}/review?${params.toString()}`);
  };

  const copyPgn = async (g) => {
    const ok = await copyText(buildRowPgn(g, user?.name));
    if (!ok) return;
    setCopiedId(g.id);
    window.setTimeout(() => setCopiedId((id) => (id === g.id ? null : id)), 1500);
  };

  const downloadPgn = (g) => {
    const blob = new Blob([buildRowPgn(g, user?.name)], { type: 'application/x-chess-pgn' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = pgnFilename(g, user?.name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setDownloadedId(g.id);
    window.setTimeout(() => setDownloadedId((id) => (id === g.id ? null : id)), 1500);
  };

  return (
    <Wrap embedded={embedded} title="Game History" piece="♟" sub="Your matches, moves and results at a glance.">
      <div className="grid md:grid-cols-5 gap-4 mb-8">
        <Card title="Games" piece="♞">
          <p className="text-3xl font-bold text-ivory-100">{summary.games}</p>
          <p className="text-xs text-ivory-500 mt-1">
            🤖 {computerCount} vs Comp · 👤 {onlineCount} vs Player · 🏆 {tournamentCount} Tournament
          </p>
        </Card>
        <Card title="Wins" piece="♛">
          <p className="text-3xl font-bold text-gold-400">{summary.wins}</p>
        </Card>
        <Card title="Losses" piece="♜">
          <p className="text-3xl font-bold text-ivory-300">{summary.losses}</p>
        </Card>
        <Card title="Draws" piece="♚">
          <p className="text-3xl font-bold text-amber-600">{summary.draws}</p>
        </Card>
        <Card title="Win Rate" piece="♕">
          <p className="text-3xl font-bold text-gold-400">{winRate}%</p>
          <p className="text-xs text-ivory-500 mt-1">
            {summary.abandoned} abandoned
          </p>
        </Card>
      </div>

      <Card title="Recent Games" piece="♝" className="mb-6">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-ivory-500 uppercase tracking-wider">Filter:</span>
          <button
            onClick={() => setFilter('all')}
            className={`chess-chip text-xs ${filter === 'all' ? 'chess-chip-gold' : ''}`}
          >All ({games.length})</button>
          <button
            onClick={() => setFilter('tournament')}
            className={`chess-chip text-xs ${filter === 'tournament' ? 'chess-chip-gold' : ''}`}
          >🏆 Tournament ({tournamentCount})</button>
          <button
            onClick={() => setFilter('online')}
            className={`chess-chip text-xs ${filter === 'online' ? 'chess-chip-gold' : ''}`}
          >👤 vs Player ({onlineCount})</button>
          <button
            onClick={() => setFilter('computer')}
            className={`chess-chip text-xs ${filter === 'computer' ? 'chess-chip-gold' : ''}`}
          >🤖 vs Computer ({computerCount})</button>
          <button
            onClick={() => setFilter('wins')}
            className={`chess-chip text-xs ${filter === 'wins' ? 'chess-chip-gold' : ''}`}
          >Wins ({winsCount})</button>
          <button
            onClick={() => setFilter('losses')}
            className={`chess-chip text-xs ${filter === 'losses' ? 'chess-chip-gold' : ''}`}
          >Losses ({lossesCount})</button>
          <button
            onClick={() => setFilter('draws')}
            className={`chess-chip text-xs ${filter === 'draws' ? 'chess-chip-gold' : ''}`}
          >Draws ({drawsCount})</button>
        </div>

        {filtered.length === 0 && <p className="chess-empty">No games found — try a different filter.</p>}
        {filtered.length > 0 && (
<div ref={listTopRef} className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ivory-500 text-xs uppercase tracking-wider">
                  <th className="py-2 pr-4">Result</th>
                  <th className="py-2 pr-4">Mode</th>
                  <th className="py-2 pr-4">Color</th>
                  <th className="py-2 pr-4">Opponent</th>
                  <th className="py-2 pr-4">Tournament</th>
                  <th className="py-2 pr-4">Rating</th>
                  <th className="py-2 pr-4">Moves</th>
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.currentItems.map((g) => {
                  const mode = modeChip(g);
                  const clickable = isReplayable(g);
                  return (
                    <tr
                      key={g.id}
                      onClick={clickable ? () => openGame(g) : undefined}
                      className={`border-t border-white/[0.06] ${clickable ? 'cursor-pointer hover:bg-black/[0.04] transition' : ''}`}
                      title={
                        !clickable ? ''
                          : pgnHasMoves(g) ? 'Click to review this game'
                            : 'Click to open the saved final position'
                      }
                    >
                      <td className="py-2 pr-4">
                        <Chip tone={resultTone(g.resultLabel)}>{g.resultLabel}</Chip>
                      </td>
                      <td className="py-2 pr-4">
                        <Chip tone={mode.tone}>{mode.label}</Chip>
                      </td>
                      <td className="py-2 pr-4 text-ivory-300">
                        {g.myColor === 'white' ? '⚪ White' : '⚫ Black'}
                      </td>
                      {/* The backend resolves the opponent from the participant
                          ids and sends null when the game genuinely has no
                          other participant — never the viewer's own name. Show
                          the file's usual '-' placeholder for that. */}
                      <td className="py-2 pr-4 text-ivory-300">
                        {g.opponentName || '-'}
                        {g.type === 'tournament' && g.opponentRating != null && (
                          <span className="text-ivory-500"> ({g.opponentRating})</span>
                        )}
                      </td>
                      <td className="py-2 pr-4"><TournamentCell g={g} /></td>
                      <td className="py-2 pr-4"><RatingCell g={g} /></td>
                      <td className="py-2 pr-4 text-ivory-500">
                        {g.movesCount ??
                          (g.pgn
                            ? Math.max(0, g.pgn.trim().split(/\s+/).filter((t) => t && !t.match(/^\d+[.]$/)).length / 2).toFixed(0)
                            : '—')}
                      </td>
                      <td className="py-2 pr-4 text-ivory-500">
                        {formatDateTime12(g.date, '—')}
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => openGame(g)}
                            disabled={!clickable}
                            className={`chess-chip text-xs whitespace-nowrap ${clickable ? '' : 'opacity-40 cursor-not-allowed'}`}
                            title={
                              !clickable ? 'No moves or position saved'
                                : pgnHasMoves(g) ? 'Replay this game with analysis'
                                  : 'Open the saved final position'
                            }
                          >
                            ▶ Replay
                          </button>
                          {hasPgnMoves(g) && (
                            <>
                              <button
                                type="button"
                                onClick={() => copyPgn(g)}
                                className="chess-chip text-xs whitespace-nowrap"
                                title="Copy PGN"
                                aria-label="Copy PGN"
                              >
                                {copiedId === g.id ? 'Copied ✓' : '📋'}
                              </button>
                              <button
                                type="button"
                                onClick={() => downloadPgn(g)}
                                className="chess-chip text-xs whitespace-nowrap"
                                title="Download .pgn"
                                aria-label="Download PGN"
                              >
                                {downloadedId === g.id ? '✓' : '⤓'}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-ivory-500 mt-2">Tip: click any row to review the game with analysis.</p>
          </div>
        )}

        <Pagination
          currentPage={pager.currentPage}
          totalPages={pager.totalPages}
          totalItems={pager.totalItems}
          onPageChange={pager.setPage}
          itemLabel="games"
        />
      </Card>

      {periods.length > 0 && (
        <Card title="Daily Rollup" piece="♗">
          <div className="space-y-3">
            {periods.slice(0, 14).map((p) => {
              const pct = p.games > 0 ? Math.round((p.wins / p.games) * 100) : 0;
              return (
                <div key={p.period_start}>
                  <div className="flex items-center justify-between text-xs text-ivory-500 mb-1">
                    <span>{new Date(p.period_start).toLocaleDateString()}</span>
                    <span>
                      {p.games} games · {p.wins}W · {p.losses}L · {p.draws}D
                    </span>
                  </div>
                  <Bar pct={pct} />
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </Wrap>
  );
}

/* Members view — the Game Review page's History tab.
   The backend returns only the members this viewer is allowed to see (a coach:
   their own students; a superadmin: everyone), so the count, the search and the
   stats columns are all scoped server-side. Nothing here filters for
   permission — the list that arrives IS the permitted list. */
function AdminView({ embedded = false, onOpenGame }) {
  const [rows, setRows] = useState(null);
  const [scope, setScope] = useState('assigned');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState({}); // { [userId]: { games, periods } }
  const [open, setOpen] = useState({});
  const [loading, setLoading] = useState({});
  const listTopRef = useRef(null);

  useEffect(() => {
    api
      .get('/game-history/students')
      .then((res) => {
        /* Accept both shapes: the object is what the endpoint returns now, the
           bare array is what an older backend would send. */
        const body = res.data;
        if (Array.isArray(body)) { setRows(body); setScope('all'); return; }
        setRows(body?.members || []);
        setScope(body?.scope || 'assigned');
      })
      .catch((e) => setError(e.response?.data?.message || e.message || 'Failed to load game history'));
  }, []);

  const toggleDetail = (s) => {
    const isOpen = !!open[s.user_id];
    setOpen((o) => ({ ...o, [s.user_id]: !isOpen }));
    if (!isOpen && !detail[s.user_id]) {
      setLoading((l) => ({ ...l, [s.user_id]: true }));
      api
        .get('/game-history/students', { params: { userId: s.user_id } })
        .then((res) =>
          setDetail((d) => ({ ...d, [s.user_id]: { games: res.data.games || [], periods: res.data.periods || [] } }))
        )
        .catch(() => {})
        .finally(() => setLoading((l) => ({ ...l, [s.user_id]: false })));
    }
  };

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? (rows || []).filter((r) => (r.name || '').toLowerCase().includes(q)) : (rows || [])),
    [rows, q]
  );
  const pager = usePagination(filtered, PAGE_SIZE, {
    resetKeys: [search],
    scrollRef: listTopRef,
  });

  if (error) return <div className="chess-error">{error}</div>;
  if (!rows) return <Spinner text="Loading game history…" />;

  /* Two different empty states, and telling them apart matters: "you have no
     students" is something a coach can fix by being assigned some, whereas
     "none of your students have games yet" is not a problem at all. */
  const noStudentsAtAll = rows.length === 0 && scope === 'assigned' && !q;
  const sub = scope === 'all'
    ? 'Every member of the academy — tap a name for their full game list.'
    : 'Your students only — tap a name for their full game list.';

  return (
    <Wrap embedded={embedded} title="Game History" piece="♟" sub={sub}>
      <Card className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <span className="text-xs text-ivory-500 uppercase tracking-wider">
            {rows.length} member{rows.length === 1 ? '' : 's'}
          </span>
          <input
            placeholder="Search members…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="chess-input !w-full sm:!w-64"
          />
        </div>
        <div ref={listTopRef} className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ivory-500 text-xs uppercase tracking-wider">
              <th className="py-2 pr-4">Member</th>
              <th className="py-2 pr-4">Games</th>
              <th className="py-2 pr-4">Wins</th>
              <th className="py-2 pr-4">Losses</th>
              <th className="py-2 pr-4">Draws</th>
              <th className="py-2">Avg Moves</th>
            </tr>
          </thead>
          <tbody>
            {pager.currentItems.map((s) => {
              const winRate = s.games > 0 ? Math.round((s.wins / s.games) * 100) : 0;
              return (
                <FragmentRow
                  key={s.user_id}
                  s={s}
                  winRate={winRate}
                  open={open[s.user_id]}
                  loading={loading[s.user_id]}
                  detail={detail[s.user_id]}
                  onToggle={() => toggleDetail(s)}
                  onOpenGame={onOpenGame}
                />
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center chess-empty">
                  {noStudentsAtAll
                    ? 'No students assigned to you yet.'
                    : 'No members match — try a different search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>

        <Pagination
          currentPage={pager.currentPage}
          totalPages={pager.totalPages}
          totalItems={pager.totalItems}
          onPageChange={pager.setPage}
          itemLabel="members"
        />
      </Card>
    </Wrap>
  );
}

function FragmentRow({ s, winRate, open, loading, detail, onToggle, onOpenGame }) {
  return (
    <>
      <tr className="border-t border-white/[0.06]">
        <td className="py-2 pr-4">
          <button onClick={onToggle} className="font-medium text-ivory-100 hover:text-gold-400 transition">
            {s.name} <span className="text-ivory-500 text-xs">{open ? '▴' : '▾'}</span>
          </button>
        </td>
        <td className="py-2 pr-4 text-ivory-300">
          <span className="flex items-center gap-2">
            {s.games}
            {s.games > 0 && <Chip tone={winRate >= 50 ? 'green' : 'amber'}>{winRate}% WR</Chip>}
          </span>
        </td>
        <td className="py-2 pr-4 text-gold-400">{s.games > 0 ? s.wins : '—'}</td>
        <td className="py-2 pr-4 text-ivory-300">{s.games > 0 ? s.losses : '—'}</td>
        <td className="py-2 pr-4 text-ivory-300">{s.games > 0 ? s.draws : '—'}</td>
        <td className="py-2 text-ivory-500">{s.games > 0 ? s.avg_moves : '—'}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="pb-4">
            <MemberGames
              loading={!!loading}
              detail={detail}
              onOpenGame={onOpenGame}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/* Full game list + daily rollup for one expanded member (admin view). */
function MemberGames({ loading, detail, onOpenGame }) {
  const games = detail?.games || [];
  const periods = detail?.periods || [];
  const listTopRef = useRef(null);
  /* Local page: several members can be expanded at once, so this list must not
     share one ?page= between them. */
  const pager = usePagination(games, PAGE_SIZE, { syncUrl: false, scrollRef: listTopRef });

  if (loading) return <p className="text-xs text-ivory-500 py-3 animate-pulse">Loading games…</p>;

  if (games.length === 0) {
    return (
      <div className="rounded-xl border border-ivory-700/50 bg-black/[0.03] px-3 py-4 text-center">
        <p className="text-xs text-ivory-500">No games recorded for this member yet.</p>
      </div>
    );
  }

  const movesOf = (g) =>
    g.movesCount ??
    (g.pgn
      ? Math.max(0, g.pgn.trim().split(/\s+/).filter((t) => t && !t.match(/^\d+[.]$/)).length / 2).toFixed(0)
      : '—');

  return (
    <div className="rounded-xl border border-ivory-700/50 bg-black/[0.03] px-3 pt-3 pb-2" style={{ animation: 'board-pop .25s both' }}>
      <div ref={listTopRef} className="overflow-x-auto max-h-[420px] overflow-y-auto mb-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ivory-500 text-xs uppercase tracking-wider sticky top-0 bg-[var(--ink-800)]">
              <th className="py-2 pr-4">Result</th>
              <th className="py-2 pr-4">Mode</th>
              <th className="py-2 pr-4">Color</th>
              <th className="py-2 pr-4">Opponent</th>
              <th className="py-2 pr-4">Tournament</th>
              <th className="py-2 pr-4">Rating</th>
              <th className="py-2 pr-4">Moves</th>
              <th className="py-2 pr-4">Date</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pager.currentItems.map((g) => {
              const mode = modeChip(g);
              const clickable = isReplayable(g);
              const openGame = () => onOpenGame && onOpenGame(g);
              return (
                <tr
                  key={g.id}
                  onClick={clickable && onOpenGame ? openGame : undefined}
                  className={`border-t border-white/[0.06] ${clickable && onOpenGame ? 'cursor-pointer hover:bg-black/[0.04] transition' : ''}`}
                  title={
                    !clickable || !onOpenGame ? ''
                      : pgnHasMoves(g) ? 'Click to review this game'
                        : 'Click to open the saved final position'
                  }
                >
                  <td className="py-2 pr-4"><Chip tone={resultTone(g.resultLabel)}>{g.resultLabel}</Chip></td>
                  <td className="py-2 pr-4"><Chip tone={mode.tone}>{mode.label}</Chip></td>
                  <td className="py-2 pr-4 text-ivory-300">{g.myColor === 'white' ? '⚪ White' : '⚫ Black'}</td>
                  <td className="py-2 pr-4 text-ivory-300">
                    {g.opponentName || '-'}
                    {g.type === 'tournament' && g.opponentRating != null && (
                      <span className="text-ivory-500"> ({g.opponentRating})</span>
                    )}
                  </td>
                  <td className="py-2 pr-4"><TournamentCell g={g} /></td>
                  <td className="py-2 pr-4"><RatingCell g={g} /></td>
                  <td className="py-2 pr-4 text-ivory-500">{movesOf(g)}</td>
                  <td className="py-2 pr-4 text-ivory-500">{formatDateTime12(g.date, '—')}</td>
                  <td className="py-2">
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={openGame}
                        disabled={!clickable || !onOpenGame}
                        className={`chess-chip text-xs whitespace-nowrap ${clickable && onOpenGame ? '' : 'opacity-40 cursor-not-allowed'}`}
                        title={
                          !clickable ? 'No moves or position saved'
                            : pgnHasMoves(g) ? 'Replay this game with analysis'
                              : 'Open the saved final position'
                        }
                      >
                        ▶ Replay
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={pager.currentPage}
        totalPages={pager.totalPages}
        totalItems={pager.totalItems}
        onPageChange={pager.setPage}
        itemLabel="games"
        className="!mt-0 mb-3"
      />

      {periods.length > 0 && (
        <>
          <p className="text-[0.65rem] uppercase tracking-[0.16em] text-ivory-500 font-bold mb-2">Daily Rollup</p>
          <div className="grid md:grid-cols-2 gap-2">
            {periods.map((p) => (
              <div key={p.period_start} className="flex items-center justify-between text-xs text-ivory-300">
                <span>{new Date(p.period_start).toLocaleDateString()}</span>
                <span className="text-ivory-500">
                  {p.games} games · {p.wins}W · {p.losses}L · {p.draws}D
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {onOpenGame && games.some((g) => g.pgn) && (
        <p className="text-xs text-ivory-500 mt-2">Tip: click any row to review the game with analysis.</p>
      )}
    </div>
  );
}

export default function GameHistory({ embedded = false, onOpenGame }) {
  const { user, loading } = useAuth();
  /* Auth hydrates async: on first paint `user` is null even for a signed-in
     admin. Rendering StudentView immediately would fire the student-only
     GET /game-history with an admin token — a guaranteed 403 in the console
     — before the role is known. Wait for auth instead. */
  if (loading || !user) return <Spinner text="Loading game history…" />;
  return isAdminRole(user?.role)
    ? <AdminView embedded={embedded} onOpenGame={onOpenGame} />
    : <StudentView embedded={embedded} onOpenGame={onOpenGame} />;
}