import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import GameReplay from '../components/GameReplay';
import { Page } from '../components/ui';
import { getDailyGameId, getDailyGameNumber, gmGames, type GmGame } from '../lib/dailyGames';

const STREAK_KEY = 'knight-path-daily-gm-streak';

export default function DailyGame() {
  const gameId = getDailyGameId();
  const [game, setGame] = useState<GmGame | null>(null);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    const today = new Date(); const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    try {
      const saved = JSON.parse(localStorage.getItem(STREAK_KEY) || '{}');
      const next = saved.lastDate === today.toISOString().slice(0, 10) ? saved.streak : (saved.lastDate === yesterday.toISOString().slice(0, 10) ? (saved.streak || 0) + 1 : 1);
      localStorage.setItem(STREAK_KEY, JSON.stringify({ streak: next, lastDate: today.toISOString().slice(0, 10) }));
      setStreak(next);
    } catch { setStreak(1); }
  }, []);

  return (
    <Page title={`Daily GM Game — Day #${getDailyGameNumber()}`} piece="♞" sub="A deterministic classic for every player, every day.">
      <div className="gm-page-links"><Link to="/players" className="gm-pill">Browse GM players →</Link><span className="gm-streak-pill">🔥 {streak} day streak</span></div>
      <GameReplay gameId={gameId} onGameLoad={setGame} />
      <div className="gm-daily-note gm-glass-card"><span>♟</span><p>Today’s study: {game ? `${game.white} vs ${game.black} · ${game.event}, ${game.year}` : 'Loading featured game…'}. Replay pauses at selected key decisions so you can think before the move.</p></div>
      <div className="gm-catalog-strip"><span>More from the collection</span>{gmGames.filter(item => item.id !== gameId).slice(0, 5).map(item => <Link key={item.id} to={`/games/${item.id}`} className="gm-mini-game">{item.white} <i>vs</i> {item.black}<small>{item.year} · {item.result}</small></Link>)}</div>
    </Page>
  );
}
