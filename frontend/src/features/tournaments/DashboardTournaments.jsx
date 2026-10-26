import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listTournaments, joinTournament, errorMessage } from '../../services/tournamentsApi';
import { FORMAT_META, countdown, fmtDateTime, timeControlLabel, useNow } from './tournamentUtils';
import Button from '../../components/Button';

/* Status shown on a dashboard card. "Registration open" is an upcoming
   tournament that students may join themselves. */
function statusOf(t) {
  if (t.status === 'completed') return { label: 'Completed', cls: 'border-slate-200 bg-slate-50 text-slate-500' };
  if (t.status === 'cancelled') return { label: 'Cancelled', cls: 'border-slate-200 bg-slate-50 text-slate-500' };
  if (t.status === 'paused') return { label: 'Paused', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-700' };
  if (t.status === 'active') return { label: 'Live', cls: 'border-red-500/40 bg-red-500/10 text-red-700' };
  if (t.selfRegister) return { label: 'Registration open', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700' };
  return { label: 'Upcoming', cls: 'border-sky-500/40 bg-sky-500/10 text-sky-700' };
}

/* A tournament may still accept this viewer when it is upcoming (or a running
   arena) and self-registration is enabled. Mirrors the server's join rules. */
function canJoin(t, registered) {
  return !registered && t.selfRegister
    && !['completed', 'cancelled'].includes(t.status)
    && (t.status === 'upcoming' || t.format === 'arena');
}

function scheduleLine(t, now) {
  if (t.status === 'completed') {
    return t.winnerName ? `🏆 ${t.winnerName}` : (t.completedAt ? `Finished ${fmtDateTime(t.completedAt)}` : 'Finished');
  }
  if (t.status === 'cancelled') return 'This event was cancelled';
  if (t.status === 'active' || t.status === 'paused') {
    const round = t.format !== 'arena' && t.currentRound ? ` · Round ${t.currentRound}/${t.rounds || '?'}` : '';
    return `${t.status === 'paused' ? 'Paused' : 'Live now'}${round}`;
  }
  if (t.startTime) {
    const left = countdown(t.startTime, now);
    return left === 'now' ? `Starting soon · ${fmtDateTime(t.startTime)}` : `Starts in ${left} · ${fmtDateTime(t.startTime)}`;
  }
  return 'No start time set';
}

/**
 * Tournament cards for the admin and student dashboards. Reads live data from
 * the same /api/tournaments endpoint the tournament pages use, so a tournament
 * created on the tournaments page appears here after a refresh (or within 30s).
 */
export default function DashboardTournaments({ role = 'student' }) {
  const base = role === 'admin' ? '/admin' : '/student';
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState(null);
  const now = useNow(1000);

  const load = useCallback(() => {
    listTournaments()
      .then((list) => { setItems(list); setErr(''); })
      .catch((e) => setErr(errorMessage(e, 'Could not load tournaments.')));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [load]);

  async function join(id) {
    setBusyId(id);
    setErr('');
    try {
      await joinTournament(id);
      load();
    } catch (e) {
      setErr(errorMessage(e, 'Could not join this tournament.'));
    } finally {
      setBusyId(null);
    }
  }

  /* Dashboards keep the list short; the full tournaments page shows all. */
  const shown = items ? items.slice(0, 3) : null;
  const hasMore = items ? items.length > 3 : false;

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 className="font-display text-lg font-bold flex items-center gap-2 text-ivory-100">
          <span className="text-gold-500">♛</span> Tournaments
        </h2>
        {hasMore && (
          <Link to={`${base}/tournaments`} className="chess-link text-sm">View all →</Link>
        )}
      </div>

      {err && <p className="text-sm text-red-400 mb-2">{err}</p>}

      {items === null && !err && (
        <div className="chess-card text-sm text-ivory-500">Loading tournaments…</div>
      )}

      {items && items.length === 0 && (
        <div className="chess-card text-sm text-ivory-500">
          {role === 'admin'
            ? 'No tournaments yet. Create one from the Tournaments page.'
            : 'No tournaments yet. Check back soon!'}
        </div>
      )}

      {shown && shown.length > 0 && (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
          {shown.map((t) => {
            const fm = FORMAT_META[t.format] || FORMAT_META.swiss;
            const st = statusOf(t);
            const registered = t.myStatus === 'active';
            const joinable = canJoin(t, registered);
            return (
              <div key={t.id} className="chess-card chess-card-hover flex flex-col min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-ivory-100 min-w-0 break-words">{fm.icon} {t.name}</p>
                  <span className={`shrink-0 text-[0.66rem] font-bold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                </div>

                <div className="flex flex-wrap gap-1.5 mt-2 text-[0.68rem] text-ivory-300">
                  <span className="rounded border border-ivory-700/50 px-2 py-0.5">{fm.label}</span>
                  <span className="rounded border border-ivory-700/50 px-2 py-0.5">{timeControlLabel(t)}</span>
                  <span className="rounded border border-ivory-700/50 px-2 py-0.5">
                    {t.playerCount}{t.maxPlayers ? `/${t.maxPlayers}` : ''} players
                  </span>
                  {registered && <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-700">You're in</span>}
                </div>

                <p className="text-xs text-ivory-500 mt-2">{scheduleLine(t, now)}</p>

                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-ivory-700/30">
                  {role === 'admin' ? (
                    <Button to={`${base}/tournaments/${t.id}`} variant="primary" size="sm" className="!py-1.5 !px-3 !text-xs">
                      Open / manage →
                    </Button>
                  ) : joinable ? (
                    <>
                      <Button
                        type="button"
                        onClick={() => join(t.id)}
                        disabled={busyId === t.id}
                        variant="primary" size="sm" className="!py-1.5 !px-3 !text-xs"
                      >
                        {busyId === t.id ? 'Joining…' : 'Join tournament'}
                      </Button>
                      <Button to={`${base}/tournaments/${t.id}`} variant="secondary" size="sm" className="!py-1.5 !px-3 !text-xs">
                        Details
                      </Button>
                    </>
                  ) : (
                    <Button to={`${base}/tournaments/${t.id}`} variant="primary" size="sm" className="!py-1.5 !px-3 !text-xs">
                      {registered && (t.status === 'active' || t.status === 'paused')
                        ? 'Play now →'
                        : registered && t.status === 'upcoming'
                          ? 'Open lobby →'
                          : t.status === 'completed'
                            ? 'View results →'
                            : 'View tournament →'}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
