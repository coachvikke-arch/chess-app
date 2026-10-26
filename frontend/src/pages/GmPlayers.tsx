import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../components/ui';
import { gmPlayers } from '../lib/dailyGames';

export default function GmPlayers() {
  const [query, setQuery] = useState('');
  const players = useMemo(() => gmPlayers.filter((player) => player.name.toLowerCase().includes(query.trim().toLowerCase())), [query]);
  return (
    <Page title="GM Players" piece="♔" sub="Explore the masters behind the featured historical games.">
      <div className="gm-player-toolbar"><label>⌕<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by player name…" /></label><span>{players.length} legends</span></div>
      <div className="gm-player-grid">{players.map(player => <Link key={player.id} to={`/players/${player.id}`} className="gm-player-card gm-glass-card"><div className="gm-player-avatar"><img src={player.photo} alt="" onError={(event) => { event.currentTarget.parentElement.innerHTML = '<span>♔</span>'; }} /></div><div><span className="gm-eyebrow">{player.title}</span><h2>{player.name}</h2><p>{player.gameIds.length} featured {player.gameIds.length === 1 ? 'game' : 'games'}</p></div><span className="gm-card-arrow">→</span></Link>)}</div>
    </Page>
  );
}
