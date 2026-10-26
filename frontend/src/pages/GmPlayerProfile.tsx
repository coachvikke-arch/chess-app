import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import GameReplay from '../components/GameReplay';
import { Page } from '../components/ui';
import { gmGames, gmPlayers } from '../lib/dailyGames';

export default function GmPlayerProfile() {
  const { id } = useParams();
  const player = gmPlayers.find(item => item.id === id);
  const games = gmGames.filter(game => player?.gameIds.includes(game.id));
  const [selected, setSelected] = useState<string | null>(null);
  if (!player) return <Page title="GM Players" piece="♔"><p>Player not found.</p></Page>;
  return (
    <Page title={player.name} piece="♔" sub={`${player.title} · ${player.gameIds.length} featured historical ${player.gameIds.length === 1 ? 'game' : 'games'}`}>
      <section className="gm-player-profile gm-glass-card"><div className="gm-profile-avatar"><img src={player.photo} alt="" onError={(event) => { event.currentTarget.parentElement.innerHTML = '<span>♔</span>'; }} /></div><div><span className="gm-eyebrow">Player profile</span><p>{player.bio}</p><Link to="/players" className="gm-pill">← All players</Link></div></section>
      <div className="gm-player-game-list">{games.map(game => <button key={game.id} className={`gm-game-list-card gm-glass-card${selected === game.id ? ' selected' : ''}`} onClick={() => setSelected(game.id)}><span className="gm-list-year">{game.year}</span><span><strong>{game.white} vs {game.black}</strong><small>{game.event} · {game.result}</small></span><span>▶</span></button>)}</div>
      {selected && <GameReplay gameId={selected} />}
    </Page>
  );
}
