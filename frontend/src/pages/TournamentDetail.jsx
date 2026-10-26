import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { isAdminRole } from '../utils/roles';
import { on, emit } from '../services/socket';
import {
  getTournament, setTournamentStatus, generateNextRound, removePlayer, setPairingResult, deleteTournament,
  joinTournament, leaveTournament, arenaPause, arenaResume, getAudit, errorMessage,
} from '../services/tournamentsApi';
import StandingsTable from '../features/tournaments/StandingsTable';
import RoundsPanel from '../features/tournaments/RoundsPanel';
import TournamentFormModal from '../features/tournaments/TournamentFormModal';
import AddPlayersModal from '../features/tournaments/AddPlayersModal';
import ManualPairingPanel from '../features/tournaments/ManualPairingPanel';
import {
  FORMAT_META, STATUS_META, countdown, downloadText, fmtDateTime, standingsCsv, timeControlLabel, useNow,
} from '../features/tournaments/tournamentUtils';
import '../features/tournaments/tournaments.css';
import Button from '../components/Button';
import usePageTitle from '../hooks/usePageTitle';

/* One tournament: standings, rounds / bracket, players. Coaches (admin) also get
   the controls; students get Join / Leave / Play. ->  /admin|student/tournaments/:id */
export default function TournamentDetail() {
  usePageTitle('Tournament Details');
  const { id } = useParams();
  const tid = Number(id);
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const admin = isAdminRole(user?.role);
  const base = admin ? '/admin' : '/student';
  const me = user ? Number(user.id) : null;
  const now = useNow(1000);

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('standings');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [audit, setAudit] = useState(null);
  const timer = useRef(null);

  const load = useCallback(() => {
    getTournament(tid).then((d) => { setData(d); setError(''); })
      .catch((e) => setError(errorMessage(e, 'Could not load this tournament')));
  }, [tid]);

  /* debounce bursts of socket updates into one refetch */
  const softReload = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(load, 350);
  }, [load]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const join = () => emit('join-tournament', tid);
    join();
    const offUpdate = on('tournament:update', (p) => { if (!p || Number(p.tournamentId) === tid) softReload(); });
    const offReady = on('tournament:game:ready', (p) => { if (p && Number(p.tournamentId) === tid) softReload(); });
    const offConn = on('connect', join);
    const poll = setInterval(load, 10000);
    return () => {
      offUpdate(); offReady(); offConn(); clearInterval(poll); clearTimeout(timer.current);
      emit('leave-tournament', tid);
    };
  }, [tid, load, softReload]);

  const run = async (fn, okMsg) => {
    if (busy) return;
    setBusy(true);
    try {
      const out = await fn();
      if (out && out.tournament) setData(out); else load();
      if (okMsg) showToast(okMsg, { tone: 'success', title: 'Tournament' });
    } catch (e) {
      showToast(errorMessage(e), { tone: 'error', title: 'Could not do that' });
    } finally { setBusy(false); }
  };
  const confirmRun = (msg, fn, ok) => { if (window.confirm(msg)) run(fn, ok); };

  if (error) {
    return <div className="tn-root"><div className="tn-empty"><span className="big">⛔</span>{error}
      <div style={{ marginTop: 14 }}><Button variant="primary" size="md" onClick={() => navigate(`${base}/tournaments`)}>Back to tournaments</Button></div></div></div>;
  }
  if (!data) return <div className="tn-root"><div className="tn-empty"><span className="big">♞</span>Loading…</div></div>;

  const { tournament: t, standings, rounds, players, myGame, myRegistration, waiting, nextRoundAt } = data;
  const myStanding = standings.find((s) => Number(s.playerId) === me);
  const fm = FORMAT_META[t.format];
  const st = STATUS_META[t.status];
  const registered = myRegistration && myRegistration.status === 'active';
  const live = t.status === 'active';
  const over = t.status === 'completed' || t.status === 'cancelled';
  const lastRound = rounds.length ? rounds[rounds.length - 1] : null;
  const roundDone = lastRound && lastRound.pairings.every((p) => p.result);
  const canNext = admin && live && t.format === 'swiss' && !t.autoAdvance && roundDone && t.currentRound < (t.rounds || 0);
  const full = t.maxPlayers && t.playerCount >= t.maxPlayers;
  const canJoin = !admin && !registered && !over && t.selfRegister && !full && (t.status === 'upcoming' || (t.format === 'arena' && (live || t.status === 'paused')));
  const champion = t.status === 'completed' && standings[0] ? standings[0] : null;
  const playGame = (gid) => navigate(`${base}/tournaments/game/${gid}`);

  return (
    <div className="tn-root">
      <div className="tn-head">
        <div>
          <div className="tn-title">
            <span className="tn-glyph">{fm.icon}</span>{t.name}
            <span className={`tn-chip ${st.tone}`}>{st.label}</span>
          </div>
          <div className="tn-sub">
            {fm.label} · {timeControlLabel(t)}
            {t.format === 'swiss' && t.rounds ? ` · ${t.rounds} rounds` : ''}
            {t.format === 'knockout' && t.rounds ? ` · ${t.rounds} rounds` : ''}
            {t.format === 'arena' && t.durationMinutes ? ` · ${t.durationMinutes} min` : ''}
            {` · ${t.playerCount}${t.maxPlayers ? `/${t.maxPlayers}` : ''} players`}
            {t.startTime && t.status === 'upcoming' ? ` · starts ${fmtDateTime(t.startTime)} (${countdown(t.startTime, now)})` : ''}
            {live && t.format !== 'arena' ? ` · round ${t.currentRound}/${t.rounds || '?'}` : ''}
            {live && t.format === 'arena' && t.endTime ? ` · ends in ${countdown(t.endTime, now)}` : ''}
          </div>
          {t.description && <div className="tn-sub" style={{ marginTop: 6 }}>{t.description}</div>}
        </div>

        <div className="tn-actions">
          <Button variant="secondary" size="md" onClick={() => navigate(`${base}/tournaments`)}>← All tournaments</Button>
          {admin && t.status === 'upcoming' && <>
            <Button variant="primary" size="md" disabled={busy} onClick={() => confirmRun('Start this tournament now?', () => setTournamentStatus(tid, 'active'), 'Tournament started')}>▶ Start</Button>
            <Button variant="secondary" size="md" onClick={() => setEditing(true)}>Edit</Button>
          </>}
          {admin && live && <Button variant="secondary" size="md" disabled={busy} onClick={() => run(() => setTournamentStatus(tid, 'paused'), 'Paused - no new pairings')}>⏸ Pause</Button>}
          {admin && t.status === 'paused' && <Button variant="primary" size="md" disabled={busy} onClick={() => run(() => setTournamentStatus(tid, 'active'), 'Resumed')}>▶ Resume</Button>}
          {canNext && <Button variant="primary" size="md" disabled={busy} onClick={() => run(() => generateNextRound(tid), 'Next round paired')}>Next round →</Button>}
          {admin && (live || t.status === 'paused') && <Button variant="danger" size="md" disabled={busy} onClick={() => confirmRun('End the tournament now? Unfinished boards are voided and final standings are locked in.', () => setTournamentStatus(tid, 'completed'), 'Tournament ended')}>End</Button>}
          {admin && !over && t.status !== 'upcoming' && <Button variant="danger" size="md" disabled={busy} onClick={() => confirmRun('Cancel this tournament? Nothing is scored.', () => setTournamentStatus(tid, 'cancelled'), 'Tournament cancelled')}>Cancel</Button>}
          {admin && !live && t.status !== 'paused' && (
            <Button variant="danger" size="md" disabled={busy} onClick={() => { if (window.confirm('Delete this tournament and all its games? This cannot be undone.')) { deleteTournament(tid).then(() => navigate(`${base}/tournaments`)).catch((e) => showToast(errorMessage(e), { tone: 'error', title: 'Delete failed' })); } }}>Delete</Button>
          )}
          {admin && !over && (t.status === 'upcoming' || t.format === 'arena') && <Button variant="secondary" size="md" onClick={() => setAdding(true)}>+ Add players</Button>}
          {canJoin && <Button variant="primary" size="md" disabled={busy} onClick={() => run(() => joinTournament(tid), 'You are in!')}>Join tournament</Button>}
          {!admin && registered && t.status === 'upcoming' && <Button variant="danger" size="md" disabled={busy} onClick={() => confirmRun('Leave this tournament?', () => leaveTournament(tid))}>Leave</Button>}
          {!admin && registered && !over && t.status !== 'upcoming' && !(t.format === 'arena') && <Button variant="danger" size="md" disabled={busy} onClick={() => confirmRun('Withdraw? Your current board is forfeited.', () => leaveTournament(tid))}>Withdraw</Button>}
        </div>
      </div>

      {champion && (
        <div className="tn-banner green"><span>🏆 <b>{champion.name}</b> won the tournament{t.format !== 'knockout' ? ` with ${champion.score} point(s)` : ''}.</span></div>
      )}

      {!admin && myGame && (
        <div className="tn-banner green">
          <span><b>Your board is ready!</b> You have the {myGame.color} pieces{myGame.status === 'pending' ? ' - join before the no-show timer runs out.' : ' - the game is in progress.'}</span>
          <Button variant="primary" size="lg" onClick={() => playGame(myGame.gameId)}>▶ Play now</Button>
        </div>
      )}
      {!admin && registered && live && t.format === 'arena' && !myGame && (
        <div className="tn-banner">
          <span>{myRegistration.paused
            ? <><b>You are paused.</b> You will not be paired until you resume.</>
            : <>You're in the arena. <b>Keep this page open</b> - you'll be paired automatically with a free player.</>}</span>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => run(() => (myRegistration.paused ? arenaResume(tid) : arenaPause(tid)))}>
            {myRegistration.paused ? 'Resume playing' : 'Pause (stop pairing)'}
          </Button>
        </div>
      )}
      {!admin && registered && t.status === 'upcoming' && (
        <div className="tn-banner"><span>You're registered. The tournament has not started yet - pairings appear here when it does.</span></div>
      )}
      {!admin && live && !registered && t.format !== 'arena' && (
        <div className="tn-banner amber"><span>This tournament has started and is closed to new players. You can still watch finished boards.</span></div>
      )}
      {live && waiting === 'transition' && (
        <div className="tn-banner"><span><b>Waiting for next pairing…</b> The next round is being prepared.</span><span>Starts in <b>{countdown(nextRoundAt, now)}</b></span></div>
      )}
      {live && waiting === 'manual' && (
        <div className="tn-banner amber"><span>{admin ? <><b>Round complete.</b> Pair the next boards in the Rounds tab.</> : <><b>Waiting for next pairing…</b> Your coach pairs this round by hand.</>}</span></div>
      )}
      {!admin && live && t.format === 'knockout' && myStanding && myStanding.eliminatedRound != null && (
        <div className="tn-banner red"><span>You were knocked out in round {myStanding.eliminatedRound}. You can still watch the remaining boards.</span></div>
      )}
      {canNext && <div className="tn-banner amber"><span>Round {t.currentRound} is complete. Start the next round when everyone is ready.</span></div>}

      <div className="tn-tabs">
        <button className={`tn-tab ${tab === 'standings' ? 'on' : ''}`} onClick={() => setTab('standings')}>Standings</button>
        <button className={`tn-tab ${tab === 'rounds' ? 'on' : ''}`} onClick={() => setTab('rounds')}>{t.format === 'knockout' ? 'Bracket' : t.format === 'arena' ? 'Boards' : 'Rounds'}</button>
        <button className={`tn-tab ${tab === 'players' ? 'on' : ''}`} onClick={() => setTab('players')}>Players ({t.playerCount})</button>
        {admin && <button className={`tn-tab ${tab === 'audit' ? 'on' : ''}`} onClick={() => { setTab('audit'); getAudit(tid).then(setAudit).catch(() => setAudit([])); }}>Audit log</button>}
      </div>

      {tab === 'standings' && (
        <div className="tn-panel">
          <div className="tn-actions" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
            <Button variant="secondary" size="sm" onClick={() => downloadText(`${t.name.replace(/\W+/g, '-')}-standings.csv`, standingsCsv(standings, t.format))}>Download CSV</Button>
            <Button variant="secondary" size="sm" onClick={() => window.print()}>Print report</Button>
          </div>
          <StandingsTable standings={standings} format={t.format} meId={me} completed={t.status === 'completed'} />
        </div>
      )}

      {tab === 'rounds' && admin && live && t.pairingMode === 'manual' && (
        <ManualPairingPanel
          tournament={t} players={players} rounds={rounds}
          onDone={(d) => { setData(d); showToast('Board created', { tone: 'success', title: 'Tournament' }); }}
          onError={(m) => showToast(m, { tone: 'error', title: 'Could not pair' })}
        />
      )}

      {tab === 'rounds' && (
        <div className="tn-panel">
          <RoundsPanel
            tournament={t} rounds={rounds} meId={me} admin={admin}
            onPlay={playGame} onWatch={playGame}
            onSetResult={(p, result) => {
              const label = result === null ? 'revert this board and replay it' : `set this board to "${result}"`;
              confirmRun(`Admin override: ${label}?`, () => setPairingResult(tid, p.id, result), 'Result updated');
            }}
          />
        </div>
      )}

      {tab === 'players' && (
        <div className="tn-panel">
          {players.length === 0 && <div className="tn-empty"><span className="big">♟</span>No players yet.</div>}
          <div className="tn-scroll">
            <table className="tn-table">
              <thead><tr><th>Player</th><th className="num">Rating</th>{t.format === 'knockout' && <th className="num">Seed</th>}<th>Status</th>{admin && <th />}</tr></thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.id} className={p.id === me ? 'me' : ''}>
                    <td>{p.name}</td><td className="num">{p.rating}</td>
                    {t.format === 'knockout' && <td className="num">{p.seed ?? '—'}</td>}
                    <td><span className={`tn-chip ${p.status === 'active' ? 'blue' : 'grey'}`}>{p.status === 'withdrawn' || p.status === 'disqualified' ? p.status : p.paused ? 'paused' : 'playing'}</span></td>
                    {admin && <td className="num">{p.status === 'active' && !over && <div className="tn-actions" style={{ justifyContent: 'flex-end' }}><Button variant="danger" size="sm" disabled={busy} onClick={() => confirmRun(`Remove ${p.name}?${t.status !== 'upcoming' ? ' Their current board is forfeited.' : ''}`, () => removePlayer(tid, p.id))}>Remove</Button>{t.status !== 'upcoming' && <Button variant="danger" size="sm" disabled={busy} onClick={() => confirmRun(`Disqualify ${p.name}? Their board is forfeited and they cannot return.`, () => removePlayer(tid, p.id, { disqualify: true }), 'Player disqualified')}>Disqualify</Button>}</div>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'audit' && admin && (
        <div className="tn-panel">
          {audit === null && <div className="tn-sub">Loading…</div>}
          {audit && audit.length === 0 && <div className="tn-empty">No administrative actions recorded yet.</div>}
          {audit && audit.length > 0 && (
            <div className="tn-scroll"><table className="tn-table">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
              <tbody>{audit.map((a) => (
                <tr key={a.id}><td>{fmtDateTime(a.createdAt)}</td><td>{a.actor || '—'}</td><td>{a.action.replace(/_/g, ' ')}</td>
                  <td style={{ color: '#475569', fontSize: 12 }}>{Object.entries(a.details || {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ')}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {editing && <TournamentFormModal tournament={t} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
      {adding && <AddPlayersModal tournamentId={tid} existingIds={players.filter((p) => p.status === 'active').map((p) => p.id)} onClose={() => setAdding(false)} onAdded={(d) => { setAdding(false); setData(d); }} />}
    </div>
  );
}
