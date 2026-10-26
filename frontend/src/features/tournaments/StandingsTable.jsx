/* Live leaderboard for any format. */
export default function StandingsTable({ standings, format, meId, completed }) {
  if (!standings || !standings.length) {
    return <div className="tn-empty"><span className="big">♟</span>No players yet.</div>;
  }
  const knockout = format === 'knockout';
  const swiss = format === 'swiss';
  const arena = format === 'arena';
  return (
    <div className="tn-scroll">
      <table className="tn-table">
        <thead>
          <tr>
            <th>#</th><th>Player</th><th className="num">Rating</th>
            {knockout ? <th>Status</th> : <th className="num">{arena ? 'Points' : 'Score'}</th>}
            <th className="num">W</th><th className="num">D</th><th className="num">L</th>
            {swiss && <th className="num" title="Sum of opponents' scores">Buchholz</th>}
            {arena && <th className="num" title="Games where the player went berserk">⚡</th>}
          </tr>
        </thead>
        <tbody>
          {standings.map((s) => (
            <tr key={s.playerId} className={Number(s.playerId) === Number(meId) ? 'me' : ''}>
              <td><span className={`tn-rank ${s.rank <= 3 ? `r${s.rank}` : ''}`}>{s.rank}</span></td>
              <td>
                {s.name}
                {s.onFire && <span title="On a winning streak - points are doubled"> 🔥</span>}
                {s.champion && <span title="Champion"> 🏆</span>}
              </td>
              <td className="num">{s.rating}</td>
              {knockout
                ? <td>{s.champion ? 'Champion' : s.eliminatedRound == null ? (completed ? '—' : 'Still in') : `Out in round ${s.eliminatedRound}`}</td>
                : <td className="num"><b>{Number.isInteger(s.score) ? s.score : s.score.toFixed(1)}</b></td>}
              <td className="num">{s.wins}</td><td className="num">{s.draws}</td><td className="num">{s.losses}</td>
              {swiss && <td className="num">{Number.isInteger(s.buchholz) ? s.buchholz : s.buchholz.toFixed(1)}</td>}
              {arena && <td className="num">{s.berserks || 0}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
