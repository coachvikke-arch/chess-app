import StudentAvatar from './StudentAvatar';

export const RANK_META = {
  1: { cls: 'lb-gold', eyebrow: 'Champion', pill: '1st Place' },
  2: { cls: 'lb-silver', eyebrow: 'Runner-up', pill: '2nd Place' },
  3: { cls: 'lb-bronze', eyebrow: 'Second runner-up', pill: '3rd Place' },
};

/* Crown for the champion; a medal for the two runners-up. Both are drawn with
   `currentColor`, so the tile's rank colour paints them. */
export function RankIcon({ rank }) {
  if (rank === 1) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <path d="M3 7.4 7.3 11 12 4.6 16.7 11 21 7.4 19.4 18H4.6L3 7.4Z" />
        <rect x="5" y="18.9" width="14" height="2.1" rx="1.05" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M8 2h8l-2.1 5.2h-3.8L8 2Z" fill="currentColor" stroke="none" />
      <circle cx="12" cy="14.6" r="5.4" />
    </svg>
  );
}

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
 * Top-3 champion podium — the three cards wear the Academy reward-card look:
 * a cream-to-sky glass surface, a rank-coloured border/glow, a rounded profile
 * tile on the left, an uppercase eyebrow above the serif player name and a
 * rank pill in the top-right corner. The tile shows the student's uploaded
 * photo and falls back to their generated chess avatar; a small rank badge
 * keeps the crown/medal on the corner of the tile.
 *
 * `elo` lets a caller choose WHICH rating the card advertises. The Leaderboard
 * passes the rapid pool (the overall-champion ladder). `peak` must be the
 * matching peak, or the card would show a rating and a peak from two different
 * pools.
 *
 * `stats` replaces the default Streak / W-L-D / Games strip with
 * `[{ label, value }]`. Because each card is a different player it is normally
 * given as a function of the player — `(p) => [...]`, the same shape as `elo`;
 * pass a plain array for a strip that is the same on every card. A malformed
 * `stats` falls back to the default strip rather than throwing.
 */
export default function ChampionsPodium({
  list,
  elo,
  peak,
  eloLabel = 'ELO',
  eloSuffix = null,
  stats,
  showPeak = true,
  showBadges = true,
}) {
  if (!list || list.length === 0) return null;
  const byRank = [null, list[0], list[1], list[2]]; // rank -> player list
  return (
    <div className="lb-podium lb-podium--reward">
      {[2, 1, 3].map((rank) => {
        const p = byRank[rank];
        if (!p) return null;
        const meta = RANK_META[rank];
        const shownElo = elo ? elo(p) : (p.current_rating ?? p.elo ?? 0);
        const shownPeak = peak ? peak(p) : p.peak_rating;
        const ratingText = shownElo == null
          ? (eloLabel === 'POINTS' ? 'No points yet' : `No ${eloLabel} yet`)
          : eloSuffix
            ? `${shownElo} ${eloSuffix}`
            : `${shownElo} ${eloLabel === 'POINTS'
              ? 'points'
              : /ELO$/i.test(eloLabel) ? eloLabel : `${eloLabel} ELO`}`;
        const description = [
          `Rank #${rank}`,
          ratingText,
          showPeak && shownPeak != null ? `peak ${shownPeak}` : null,
        ].filter(Boolean).join(' · ');
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
          <div
            key={p.student_id ?? p.user_id ?? `${p.name}-${rank}`}
            className={`lb-pcard ${meta.cls} lb-pcard--rank-${rank}`}
            style={{ animation: `fade-up .5s ${(rank - 1) * 0.12}s both` }}
          >
            <div className="lb-pcard-icon">
              <span className="lb-pcard-media">
                {p.profile_image ? (
                  <img src={p.profile_image} alt="" loading="lazy" />
                ) : (
                  <StudentAvatar
                    config={p.avatar_config}
                    seed={`student_${p.student_id || ''}`}
                    size={80}
                    rounded={false}
                  />
                )}
              </span>
              <span className="lb-pcard-rankbadge"><RankIcon rank={rank} /></span>
            </div>
            <div className="lb-pcard-copy">
              <div className="lb-pcard-top">
                <p className="lb-pcard-eyebrow">{meta.eyebrow}</p>
                <span className="lb-pcard-pill">{meta.pill}</span>
              </div>
              <h3 className="lb-pcard-title">
                <span className="lb-pcard-name" title={p.name}>{p.name}</span>
                {showBadges && <PlayerBadges row={p} />}
              </h3>
              <p className="lb-pcard-desc">{description}</p>
              <div className="lb-pcard-stats">
                {mini.map((s, i) => (
                  <span key={i}><b>{s.value}</b>{s.label}</span>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
