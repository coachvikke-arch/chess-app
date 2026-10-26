import StudentAvatar from './StudentAvatar';

const PIECE_TOP = ['♔', '♕', '♖'];
const MEDAL = ['👑', '🥈', '🥉'];

export function PlayerBadges({ row }) {
  const b = [];
  if (row.streak >= 5) b.push({ i: '🔥', t: `${row.streak}-game win streak` });
  if (row.wins >= 100) b.push({ i: '🏆', t: `${row.wins} career wins` });
  if (row.level?.icon) b.push({ i: row.level.icon, t: row.level.name || 'rating level' });
  return (
    <span className="lb-badges">
      {b.map((x, i) => (
        <span key={i} className="lb-badge" title={x.t}>{x.i}</span>
      ))}
    </span>
  );
}

/**
 * Top-3 champion podium — gold / silver / bronze cards with the leaderboard
 * glow effects. Reused by the Leaderboard page and the student dashboard.
 *
 * `elo` lets a caller choose WHICH rating the card advertises. The Leaderboard
 * passes the rapid pool (the overall-champion ladder); the dashboard passes
 * nothing and keeps the common rating. `peak` must be the matching peak, or
 * the card would show a rating and a peak from two different pools.
 *
 * `stats` replaces the default Streak / W-L-D / Games strip with
 * `[{ label, value }]`. Because each card is a different player it is normally
 * given as a function of the player — `(p) => [...]` — the same shape as `elo`
 * and `above`; pass a plain array for a strip that is the same on every card.
 * The classroom leaderboard uses this to show class-scoped numbers (points,
 * puzzles solved, games) instead of career ones, while keeping the exact same
 * card markup and styling - the podium is the shared UI, not a copy of it.
 *
 * A malformed `stats` falls back to the default strip rather than throwing. This
 * component is reused in the live classroom, where a render throw unmounts the
 * whole room (board, chat and all) with no error boundary to catch it, so a bad
 * prop here costs the whole lesson rather than one card.
 *
 * `avatarSize` shrinks the picture. ChessAvatar writes `width`/`height` as an
 * INLINE style, so no stylesheet rule can override it - a caller that needs a
 * smaller card has to pass the number, not style `.lb-avatar` and hope.
 */
export default function ChampionsPodium({
  list,
  elo,
  peak,
  eloLabel = 'ELO',
  stats,
  showPeak = true,
  avatarSize,
}) {
  if (!list || list.length === 0) return null;
  const byRank = [null, list[0], list[1], list[2]]; // rank -> player list
  return (
    <div className="lb-podium">
      {[2, 1, 3].map((rank) => {
        const p = byRank[rank];
        if (!p) return null;
        const cls = rank === 1 ? 'lb-gold' : rank === 2 ? 'lb-silver' : 'lb-bronze';
        const glow = `mixed-glow mixed-glow--rank-${rank}`;
        const medal = rank === 1 ? <span className="lb-crown">👑</span> : <span className="lb-medal">{MEDAL[rank - 1]}</span>;
        const shownElo = elo ? elo(p) : (p.current_rating ?? p.elo ?? 0);
        const shownPeak = peak ? peak(p) : p.peak_rating;
        const fallback = [
          { label: 'Streak', value: p.streak },
          { label: 'W/L/D', value: `${p.wins}:${p.losses}:${p.draws}` },
          { label: 'Games', value: p.games_played },
        ];
        // Each card is a different player, so `stats` is normally a function of
        // the player (like `elo`); a plain array applies to all three.
        const supplied = typeof stats === 'function' ? stats(p) : stats;
        const mini = Array.isArray(supplied) && supplied.length > 0 ? supplied : fallback;
        return (
          <div key={p.student_id ?? p.user_id ?? `${p.name}-${rank}`} className={`lb-pcard ${cls} ${glow}`} style={{ animation: `fade-up .5s ${(rank - 1) * 0.12}s both` }}>
            <span className="lb-tier">{PIECE_TOP[rank - 1]}</span>
            {medal}
            <div className="lb-avatar">
              {p.profile_image ? (
                <img src={p.profile_image} alt="" className="lb-photo rounded-full object-cover" />
              ) : (
                <StudentAvatar config={p.avatar_config} seed={`student_${p.student_id || ''}`} size={avatarSize ?? (rank === 1 ? 84 : 70)} />
              )}
            </div>
            <div className="lb-name">
              {p.name} <PlayerBadges row={p} />
            </div>
            <div className="lb-elo">
              {eloLabel} <b>{shownElo}</b>
              {showPeak && <span style={{ opacity: .6 }}>· peak {shownPeak ?? '—'}</span>}
            </div>
            <div className="lb-mini">
              {mini.map((s, i) => (
                <span key={i}><b>{s.value}</b>{s.label}</span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}