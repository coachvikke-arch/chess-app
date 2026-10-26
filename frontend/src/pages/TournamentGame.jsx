import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Chess } from 'chess.js';
import ChessBoard from '../components/ChessBoard';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { isAdminRole } from '../utils/roles';
import { on, emit } from '../services/socket';
import {
  getGame, sendMove, resignGame, offerDraw, respondDraw, berserkGame, errorMessage,
} from '../services/tournamentsApi';
import { fmtClock, resultText, timeControlLabel, useNow } from '../features/tournaments/tournamentUtils';
import '../features/tournaments/tournaments.css';
import Button from '../components/Button';
import usePageTitle from '../hooks/usePageTitle';

/* Board width that fits the viewport (phone -> desktop). */
function useBoardSize() {
  const calc = () => {
    if (typeof window === 'undefined') return 420;
    return Math.max(260, Math.min(620, Math.floor(window.innerWidth - 56), Math.floor(window.innerHeight - 250)));
  };
  const [size, setSize] = useState(calc);
  useEffect(() => {
    const h = () => setSize(calc());
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return size;
}

export default function TournamentGame() {
  usePageTitle('Tournament Game');
  const { gameId } = useParams();
  const gid = Number(gameId);
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const admin = isAdminRole(user?.role);
  const base = admin ? '/admin' : '/student';
  const me = user ? Number(user.id) : null;
  const boardSize = useBoardSize();
  useNow(100); // tick the clocks

  const gameRef = useRef(new Chess());
  const recvRef = useRef(performance.now());
  const stateRef = useRef(null);
  const [state, setState] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [, rerender] = useState(0);

  const myColor = state
    ? (state.white && state.white.id === me ? 'white' : state.black && state.black.id === me ? 'black' : null)
    : null;
  const isPlayer = !!myColor;

  /* Accept a server snapshot (ignore anything older than what we hold). */
  const apply = useCallback((s) => {
    if (!s || s.gameId !== gid) return;
    const cur = stateRef.current;
    if (cur && s.serverTime < cur.serverTime) return;
    try {
      const g = gameRef.current;
      if ((s.pgn || '') !== g.pgn()) g.loadPgn(s.pgn || '', { strict: false });
    } catch {
      try { gameRef.current.load(s.fen); } catch { /* ignore */ }
    }
    recvRef.current = performance.now();
    stateRef.current = s;
    setState(s);
    rerender((x) => x + 1);
  }, [gid]);

  /* initial snapshot over REST (also tells us whether we may watch) */
  useEffect(() => {
    let dead = false;
    getGame(gid).then((d) => {
      if (dead) return;
      setTournament(d.tournament);
      apply(d.game);
    }).catch((e) => { if (!dead) setError(errorMessage(e, 'Could not open this board')); });
    return () => { dead = true; };
  }, [gid, apply]);

  /* live updates + presence over the socket */
  useEffect(() => {
    const join = () => emit('tournament:game:join', gid, (ack) => { if (ack && ack.ok && ack.state) apply(ack.state); });
    join();
    const offState = on('tournament:game:state', apply);
    const offConnect = on('connect', join);
    return () => {
      offState(); offConnect();
      emit('tournament:game:leave', gid);
    };
  }, [gid, apply]);

  /* safety net if the socket is down: poll while the game is live */
  useEffect(() => {
    if (!state || state.status === 'finished') return undefined;
    const t = setInterval(() => { getGame(gid).then((d) => apply(d.game)).catch(() => {}); }, 4000);
    return () => clearInterval(t);
  }, [gid, state && state.status, apply]); // eslint-disable-line react-hooks/exhaustive-deps

  const remaining = (color) => {
    if (!state) return null;
    const baseMs = color === 'white' ? state.clock.whiteMs : state.clock.blackMs;
    const ticking = state.status === 'active' && state.clock.running && state.turn === (color === 'white' ? 'w' : 'b');
    return ticking ? Math.max(0, baseMs - (performance.now() - recvRef.current)) : baseMs;
  };

  const finished = state && state.status === 'finished';
  const myTurn = isPlayer && state && state.status === 'active' && !finished && state.turn === (myColor === 'white' ? 'w' : 'b');

  const act = async (fn, okMsg) => {
    if (busy) return;
    setBusy(true);
    try { apply(await fn()); if (okMsg) showToast(okMsg, { tone: 'info', title: 'Tournament' }); }
    catch (e) { showToast(errorMessage(e), { tone: 'error', title: 'Not allowed' }); }
    finally { setBusy(false); }
  };

  const onMove = useCallback((move) => {
    if (!myTurn || busy) return;
    setBusy(true);
    sendMove(gid, { from: move.from, to: move.to, promotion: move.promotion || 'q' })
      .then(apply)
      .catch((e) => {
        try { gameRef.current.undo(); } catch { /* ignore */ }
        rerender((x) => x + 1);
        showToast(errorMessage(e, 'Move rejected'), { tone: 'error', title: 'Illegal move' });
        getGame(gid).then((d) => apply({ ...d.game, serverTime: Date.now() })).catch(() => {});
      })
      .finally(() => setBusy(false));
  }, [myTurn, busy, gid, apply, showToast]);

  if (error) {
    return (
      <div className="tn-root"><div className="tn-empty"><span className="big">⛔</span>{error}
        <div style={{ marginTop: 14 }}><Button variant="primary" size="md" onClick={() => navigate(`${base}/tournaments`)}>Back to tournaments</Button></div></div></div>
    );
  }
  if (!state) return <div className="tn-root"><div className="tn-empty"><span className="big">♞</span>Opening the board…</div></div>;

  const orientation = myColor || 'white';
  const top = orientation === 'white' ? 'black' : 'white';
  const bottom = orientation;
  const seat = (color) => {
    const p = state[color];
    const ms = remaining(color);
    const turn = state.turn === (color === 'white' ? 'w' : 'b') && state.status === 'active';
    const low = ms != null && ms < 20000 && state.status === 'active' && state.clock.running;
    return (
      <div className={`tn-seat ${turn ? 'turn' : ''}`}>
        <div className="who">
          <b><span className={`tn-dot ${state.connected[color] ? 'on' : ''}`} />{p.name}{p.id === me ? ' (you)' : ''}</b>
          <small>{color === 'white' ? '♔ White' : '♚ Black'} · {p.rating}{state.berserk[color] ? ' · ⚡ berserk' : ''}</small>
        </div>
        <div className={`tn-clock ${turn && state.clock.running ? 'run' : ''} ${low ? 'low' : ''}`}>{fmtClock(ms)}</div>
      </div>
    );
  };

  const serverNow = state.serverTime + (performance.now() - recvRef.current);
  const noShowLeft = state.noShowDeadline ? Math.max(0, state.noShowDeadline - serverNow) : null;
  const firstLeft = state.firstMoveDeadline ? Math.max(0, state.firstMoveDeadline - serverNow) : null;

  const moves = state.moves || [];
  const rows = [];
  for (let i = 0; i < moves.length; i += 2) rows.push([moves[i], moves[i + 1]]);
  const canOffer = isPlayer && state.status === 'active' && !state.drawOfferBy && tournament && tournament.allowDrawOffers && moves.length >= 2;
  const offerFromOpp = isPlayer && state.drawOfferBy && state.drawOfferBy !== me;
  const offerFromMe = isPlayer && state.drawOfferBy === me;
  const canBerserk = isPlayer && state.canBerserk && state.canBerserk[myColor];

  return (
    <div className="tn-root">
      <div className="tn-head">
        <div>
          <div className="tn-title"><span className="tn-glyph">♞</span>{tournament ? tournament.name : 'Tournament game'}</div>
          <div className="tn-sub">
            {tournament && `${timeControlLabel(tournament)} · `}{state.format}
            {state.armageddon ? ' · Armageddon decider (White 5 min, Black 4 min — Black wins a draw)' : ''}
            {!isPlayer && ' · spectating'}
          </div>
        </div>
        <div className="tn-actions">
          <Button variant="secondary" size="md" onClick={() => navigate(`${base}/tournaments/${state.tournamentId}`)}>← Tournament</Button>
        </div>
      </div>

      {state.status === 'pending' && (
        <div className="tn-banner amber">
          <span>{isPlayer ? <>Waiting for <b>{myColor === 'white' ? state.black.name : state.white.name}</b> to join the board…</> : 'Waiting for the players to join…'}</span>
          {noShowLeft != null && <span>No-show forfeit in <b>{fmtClock(noShowLeft)}</b></span>}
        </div>
      )}
      {state.status === 'active' && moves.length === 0 && firstLeft != null && (
        <div className="tn-banner amber">
          <span><b>{state.white.name}</b> (White) must make the first move</span>
          <span>Forfeit in <b>{fmtClock(firstLeft)}</b></span>
        </div>
      )}
      {isPlayer && state.status === 'active' && !state.connected[myColor === 'white' ? 'black' : 'white'] && (
        <div className="tn-banner red"><span>Your opponent disconnected. They have a short window to return before forfeiting.</span></div>
      )}
      {offerFromOpp && (
        <div className="tn-banner">
          <span><b>{(myColor === 'white' ? state.black : state.white).name}</b> offers a draw</span>
          <span className="tn-actions">
            <Button variant="primary" size="sm" disabled={busy} onClick={() => act(() => respondDraw(gid, true))}>Accept</Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => act(() => respondDraw(gid, false))}>Decline</Button>
          </span>
        </div>
      )}

      <div className="tn-game">
        <div>
          {seat(top)}
          <div style={{ width: boardSize, maxWidth: '100%', margin: '0 auto' }}>
            <ChessBoard
              game={gameRef.current}
              fen={gameRef.current.fen()}
              orientation={orientation}
              interactive={!!myTurn && !busy}
              onMove={onMove}
              boardWidth={boardSize}
              engineOn={false}
              highlightLastMove
              selfColor={myColor === 'white' ? 'w' : myColor === 'black' ? 'b' : null}
              showLegalMoves
            />
          </div>
          {seat(bottom)}
        </div>

        <div className="tn-side">
          {finished && (
            <div className="tn-result">
              <b>{state.winnerId ? (state.winnerId === me ? '🏆 You won!' : isPlayer ? 'You lost' : resultText(state.result, null).split(' ·')[0]) : state.result === 'draw' ? '🤝 Draw' : 'Game over'}</b>
              {resultText(state.result, state.reason)}
            </div>
          )}
          {isPlayer && !finished && (
            <div className="tn-panel" style={{ padding: 12 }}>
              {myTurn && <div className="tn-chip live" style={{ marginBottom: 10 }}>Your move</div>}
              {canBerserk && <Button variant="primary" size="md" disabled={busy} onClick={() => act(() => berserkGame(gid), 'Berserk! Half the time, a bonus point if you win.')}>⚡ Berserk</Button>}
              {canOffer && <Button variant="secondary" size="md" disabled={busy} onClick={() => act(() => offerDraw(gid), 'Draw offered')}>Offer draw</Button>}
              {offerFromMe && <div className="tn-sub" style={{ marginBottom: 8 }}>Draw offer sent - waiting for a reply…</div>}
              <Button variant="danger" size="md" disabled={busy} onClick={() => { if (window.confirm('Resign this game?')) act(() => resignGame(gid)); }}>Resign</Button>
            </div>
          )}
          {finished && (
            <Button variant="primary" size="lg" onClick={() => navigate(`${base}/tournaments/${state.tournamentId}`)}>
              {tournament && tournament.format === 'arena' && tournament.status === 'active' ? 'Back to the arena' : 'Back to tournament'}
            </Button>
          )}
          <div className="tn-panel" style={{ marginTop: 12 }}>
            <h3>Moves</h3>
            {rows.length === 0 ? <div className="tn-sub">No moves yet.</div> : (
              <div className="tn-moves">
                {rows.map((r, i) => (
                  <div key={i} style={{ display: 'contents' }}>
                    <span className="no">{i + 1}.</span>
                    <span className={`mv ${i * 2 === moves.length - 1 ? 'last' : ''}`}>{r[0].san}</span>
                    <span className={`mv ${i * 2 + 1 === moves.length - 1 ? 'last' : ''}`}>{r[1] ? r[1].san : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
