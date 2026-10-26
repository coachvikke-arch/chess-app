import { resultText } from './tournamentUtils';
import Button from '../../components/Button';

const pts = (n) => (n == null ? '' : Number.isInteger(n) ? String(n) : n.toFixed(1));

function scoreText(p) {
  if (p.bye) return '1 – bye';
  if (!p.result) return 'vs';
  if (p.result === 'abandon') return '0 – 0';
  if (p.result === 'draw') return '½ – ½';
  return p.result === 'white' ? '1 – 0' : '0 – 1';
}

/* One board row. `onPlay`/`onWatch` open the board; `onSetResult` is admin-only. */
function BoardRow({ p, meId, admin, onPlay, onWatch, onSetResult, canOverride }) {
  const mine = [p.white && p.white.id, p.black && p.black.id].includes(Number(meId));
  const live = p.gameId && (p.gameStatus === 'pending' || p.gameStatus === 'active');
  const wWin = p.result && p.winnerId && p.winnerId === (p.white && p.white.id);
  const bWin = p.result && p.winnerId && p.winnerId === (p.black && p.black.id);
  return (
    <div className={`tn-board ${mine ? 'mine' : ''}`}>
      <span className="bn">#{p.board || ''}</span>
      <span className={`pl ${wWin ? 'win' : bWin ? 'lose' : ''}`}>
        <i className="tn-sq w" /><span className="nm">{p.white ? p.white.name : '—'}</span>
        {p.whiteBerserk && <span title="Berserk">⚡</span>}
      </span>
      <span className={`tn-score ${live ? 'is-live' : ''}`} title={resultText(p.result, p.reason)}>
        {scoreText(p)}
        {live && <span className="tn-live">Live</span>}
        {p.armageddon && <span className="tn-armageddon">Armageddon</span>}
      </span>
      <span className={`pl r ${bWin ? 'win' : wWin ? 'lose' : ''}`}>
        {p.black ? (<>{p.blackBerserk && <span title="Berserk">⚡</span>}<span className="nm">{p.black.name}</span><i className="tn-sq b" /></>) : <span className="nm tn-bye">bye</span>}
      </span>
      <span className="acts">
        {mine && live && <Button variant="primary" size="sm" onClick={() => onPlay(p.gameId)}>Play</Button>}
        {!mine && p.gameId && (live || p.moves > 0) && <Button variant="secondary" size="sm" onClick={() => onWatch(p.gameId)}>{live ? 'Watch' : 'Replay'}</Button>}
        {mine && !live && p.gameId && p.moves > 0 && <Button variant="secondary" size="sm" onClick={() => onWatch(p.gameId)}>Replay</Button>}
        {admin && canOverride && !p.bye && (
          <select
            className="tn-select" style={{ width: 'auto', padding: '4px 6px', fontSize: 12 }}
            value="" onChange={(e) => { if (e.target.value) onSetResult(p, e.target.value === 'revert' ? null : e.target.value); }}
            title="Admin result override"
          >
            <option value="">Result…</option>
            <option value="white">White wins</option>
            <option value="black">Black wins</option>
            {p.format !== 'knockout' && <option value="draw">Draw</option>}
            {p.format !== 'knockout' && <option value="abandon">Void (0–0)</option>}
            {p.result && <option value="revert">Revert / replay</option>}
          </select>
        )}
      </span>
    </div>
  );
}

function Bracket({ rounds, totalRounds, meId, onPlay, onWatch }) {
  const cols = [];
  for (let r = 1; r <= totalRounds; r += 1) {
    const found = rounds.find((x) => x.roundNo === r);
    cols.push({ roundNo: r, pairings: found ? found.pairings : [] });
  }
  const label = (r) => (r === totalRounds ? 'Final' : r === totalRounds - 1 ? 'Semi-finals' : r === totalRounds - 2 ? 'Quarter-finals' : `Round ${r}`);
  return (
    <div className="tn-bracket">
      {cols.map((c) => (
        <div className="tn-bcol" key={c.roundNo}>
          <h4>{label(c.roundNo)}</h4>
          {c.pairings.length === 0 && <div className="tn-bmatch"><div className="tn-bside"><span className="tn-bye">To be decided</span></div></div>}
          {c.pairings.map((p) => {
            const mine = [p.white && p.white.id, p.black && p.black.id].includes(Number(meId));
            const live = p.gameId && (p.gameStatus === 'pending' || p.gameStatus === 'active');
            return (
              <div key={p.id} className={`tn-bmatch ${mine ? 'mine' : ''}`}>
                <div className={`tn-bside ${p.winnerId && p.white && p.winnerId === p.white.id ? 'win' : p.winnerId ? 'lose' : ''}`}>
                  <span>{p.white ? p.white.name : '—'}</span><span>{p.bye ? 'bye' : pts(p.whitePoints)}</span>
                </div>
                <div className={`tn-bside ${p.winnerId && p.black && p.winnerId === p.black.id ? 'win' : p.winnerId ? 'lose' : ''}`}>
                  <span>{p.black ? p.black.name : 'bye'}</span><span>{pts(p.blackPoints)}</span>
                </div>
                {(live || p.moves > 0) && !p.bye && (
                  <div style={{ padding: 6, textAlign: 'center' }}>
                    {mine && live
                      ? <Button variant="primary" size="sm" onClick={() => onPlay(p.gameId)}>Play</Button>
                      : <Button variant="secondary" size="sm" onClick={() => onWatch(p.gameId)}>{live ? 'Watch' : 'Replay'}</Button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function RoundsPanel({ tournament, rounds, meId, admin, onPlay, onWatch, onSetResult }) {
  if (!rounds.length) {
    return <div className="tn-empty"><span className="big">♞</span>{tournament.status === 'upcoming' ? 'Pairings appear when the tournament starts.' : 'No boards yet.'}</div>;
  }
  if (tournament.format === 'knockout') {
    return <Bracket rounds={rounds} totalRounds={tournament.rounds || rounds.length} meId={meId} onPlay={onPlay} onWatch={onWatch} />;
  }
  const canOverride = !['completed', 'cancelled'].includes(tournament.status);
  const ordered = tournament.format === 'arena' ? [...rounds].reverse() : rounds;
  return (
    <div>
      {ordered.map((r) => (
        <div className="tn-round" key={r.roundNo}>
          <div className="tn-round-head">
            <h4>{tournament.format === 'arena' ? `Pairing wave ${r.roundNo}` : `Round ${r.roundNo}`}</h4>
            <span className="tn-chip">{r.pairings.length} board{r.pairings.length === 1 ? '' : 's'}</span>
          </div>
          {r.pairings.map((p) => (
            <BoardRow key={p.id} p={{ ...p, format: tournament.format }} meId={meId} admin={admin}
              onPlay={onPlay} onWatch={onWatch} onSetResult={onSetResult} canOverride={canOverride} />
          ))}
        </div>
      ))}
    </div>
  );
}
