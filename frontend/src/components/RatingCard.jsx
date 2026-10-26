import { useState } from 'react';
import api from '../services/api';
import { Card, Bar, Spinner } from './ui';
import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { gameOutcome } from '../utils/charts';

/**
 * Rating + Level/Badge progress profile.
 * Rectangular highlight card — badge & rating on the left, "progress to next
 * level" bar on the right, so it reads at a glance on the dashboard.
 *
 * Student-only: mounts on student routes only, but guards anyway so a stale
 * auth state never fires GET /students/ratings/me with a staff token (which
 * answers 404 without a `students` row and logs console noise). A 404 (no
 * student record yet) is not an error — show the empty state instead.
 */
export default function RatingCard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user && user.role !== 'student') return;
    let cancelled = false;
    api.get('/students/ratings/me', { cache: false })
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((e) => {
        if (cancelled) return;
        if (e.response?.status === 404) { setData({ rapid: null }); return; }
        setError(e.response?.data?.message || 'Failed to load rating');
      });
    return () => { cancelled = true; };
  }, [user]);

  if (error) {
    return (
      <Card title="Rating & Badge" piece="♔">
        <p className="text-sm chess-error">{error}</p>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card title="Rating & Badge" piece="♔">
        <Spinner text="Loading rating…" />
      </Card>
    );
  }

  /* Rapid is the ladder now, so this card leads with the Rapid pool. The
     common/unified rating is still returned by the API for compatibility but
     is no longer shown anywhere. */
  const rapid = data.rapid;
  const shownRating = rapid ? rapid.rating : null;
  const shownPeak = rapid ? rapid.peakRating : null;
  const shownGames = rapid ? rapid.gamesPlayed : 0;
  const shownTier = rapid?.level || data.maxLevel || data.level || { name: 'Unrated', number: 0, icon: '♟' };
  const shownProvisional = rapid ? !!rapid.provisional : !!data.isProvisional;
  const shownNext = rapid && data.nextLevel ? data.nextLevel : null;
  const shownToNext = rapid?.pointsToNext ?? 0;
  const shownProgress = rapid?.progress ?? data.progress ?? 0;

  /* THE latest Rapid rating move, straight from the server.

     This used to be `recent.reduce((s, r) => s + r.rating_change, 0)` - the net
     of several games - which is not the latest move at all: a single win after
     two losses read as a loss, and a loss after a run of wins read as a rise.
     It is now the newest row's own transition (rating_before -> rating_after),
     computed by ratingService and delivered as `latestRapid`.

     Deliberately NOT derived from peak, from the starting rating, from the
     overall rating, or from another category: peak is displayed separately as
     its own fact. The rating number keeps its own colour; only the delta chip is
     tinted, so the arrow never competes with the number itself. */
  const latest = data.latestRapid || null;
  const lastChange = latest ? Number(latest.ratingChange) || 0 : 0;
  const trend = !latest || lastChange === 0 ? 'flat' : lastChange > 0 ? 'up' : 'down';
  const trendStyle =
    trend === 'up'
      ? { color: '#22c55e' }
      : trend === 'down'
        ? { color: '#ef4444' }
        : { color: 'var(--ivory-500)' };

  /* Recent Rapid form: one square per game, oldest -> newest.

     `rapidRecent` is already Rapid-only and already ordered oldest -> newest by
     the server (it slices the same ascending list the rating was written to), so
     this does no sorting of its own and cannot reverse the array. `gameOutcome`
     is the project's existing W/D/L classifier - reused rather than adding a
     second result-icon system. */
  const rapidRecent = Array.isArray(data.rapidRecent) ? data.rapidRecent : [];
  const formLimit = data.recentRapidLimit || 5;
  const formSquares = rapidRecent
    /* `resultLabel` is the field gameOutcome reads first; the pool history rows
       carry the bare `result` ('win' | 'loss' | 'draw') instead, so it is
       forwarded under the name the shared classifier already understands rather
       than forking that helper. */
    .map((g) => ({ g, r: gameOutcome({ resultLabel: g.result, result: g.result }) }))
    .filter((x) => x.r)
    .slice(-formLimit);

  return (
    <Card title="Rapid Rating & Badge" piece="♔" className="rating-card">
      <div className="flex flex-wrap items-center gap-4">
        {/* Left — badge + rating */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="grid place-items-center w-11 h-11 shrink-0 rounded-xl bg-gold-500/12 border border-gold-500/30">
            <span className="text-2xl leading-none" style={{ color: '#2563eb' }}>{shownTier.icon}</span>
          </div>
          <div className="min-w-0">
            <p className="text-[0.6rem] uppercase tracking-wider text-ivory-500 font-semibold whitespace-nowrap">
              {shownTier.name} · Tier {shownTier.number}
              {shownProvisional && <span className="ml-1.5 chess-chip chess-chip-gold">Provisional</span>}
            </p>
            <p className="flex items-baseline gap-2 mt-1">
              {shownRating == null ? (
                <span className="text-sm text-ivory-500">No rapid games yet</span>
              ) : (
                <>
                  {/* The rating itself keeps its own colour. Only the delta chip is
                      tinted, so the number stays the loudest thing on the card. */}
                  <span className="font-display text-2xl font-bold leading-none">{shownRating}</span>
                  {latest && (
                    <span
                      className="rc-delta"
                      style={{
                        color: trendStyle.color,
                        borderColor: trend === 'up' ? 'rgba(34,197,94,0.5)'
                          : trend === 'down' ? 'rgba(239,68,68,0.5)' : 'rgba(122,137,141,0.5)',
                        background: trend === 'up' ? 'rgba(34,197,94,0.1)'
                          : trend === 'down' ? 'rgba(239,68,68,0.1)' : 'rgba(122,137,141,0.08)',
                      }}
                      /* Spells out the transition, so the tooltip can never be
                         misread as peak-vs-current. */
                      title={latest.result
                        ? `Latest rapid ${latest.result}: ${latest.ratingBefore} → ${latest.ratingAfter} (${lastChange > 0 ? '+' : ''}${lastChange})`
                        : `Latest rapid move: ${latest.ratingBefore} → ${latest.ratingAfter}`}
                    >
                      {/* Small arrow + signed points, per the card's hierarchy:
                          the number dominates, the delta annotates it. */}
                      <span aria-hidden="true">{trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}</span>
                      <span className="tabular-nums">{trend === 'flat' ? '0' : `${lastChange > 0 ? '+' : ''}${lastChange}`}</span>
                    </span>
                  )}
                  {shownPeak != null && (
                    /* Always shown, and explicitly NOT the delta: peak is its
                       own fact about the best rating ever reached. The old
                       `shownPeak > shownRating` guard hid it exactly when the
                       player was below their peak, which is the case where a
                       reader is most likely to mistake one for the other. */
                    <span className="text-xs text-ivory-500">Peak {shownPeak}</span>
                  )}
                </>
              )}
            </p>
            <p className="text-xs text-ivory-500 mt-1">
              {shownGames} rapid game{shownGames === 1 ? '' : 's'}
            </p>

            {/* Recent Rapid form. Rendered only when the server actually sent
                rows, so a student with zero rapid games sees no squares and no
                empty boxes. `formSquares` is already oldest → newest. */}
            {formSquares.length > 0 && (
              <div className="rc-form mt-2">
                <span className="rc-form-label">Recent</span>
                <span className="rc-form-row">
                  {formSquares.map(({ g, r }, i) => (
                    <span
                      key={g.id ?? `${g.played_at}-${i}`}
                      className={`rc-form-box is-${r.toLowerCase()}`}
                      role="img"
                      aria-label={`Rapid ${r === 'W' ? 'win' : r === 'D' ? 'draw' : 'loss'}${g.opponentName ? ` against ${g.opponentName}` : ''
                        }${i === formSquares.length - 1 ? ', most recent' : ''}`}
                      title={[
                        `Rapid ${r === 'W' ? 'win' : r === 'D' ? 'draw' : 'loss'}`,
                        g.opponentName,
                        g.played_at ? new Date(g.played_at).toLocaleDateString() : null,
                      ].filter(Boolean).join(' · ')}
                    >
                      {/* ✓ / ✕ / — rather than W/L/D text: this is a compact
                          visual form guide, not a table. */}
                      {r === 'W' ? '✓' : r === 'L' ? '✕' : '—'}
                    </span>
                  ))}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Divider */}
        <span className="hidden sm:block h-10 w-px bg-black/5 shrink-0" />

        {/* Right — progress toward next level */}
        <div className="min-w-0 flex-1 flex flex-col justify-center">
          {shownRating == null ? (
            <p className="text-sm text-ivory-500">
              Play a rated rapid game to appear on the leaderboard.
            </p>
          ) : shownNext ? (
            <>
              <p className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-gold-400 font-semibold">{shownToNext} pts to {shownNext.name}</span>
                <span className="text-ivory-500">{shownNext.icon}</span>
              </p>
              <Bar pct={shownProgress} />
            </>
          ) : (
            <p className="text-sm font-semibold text-gold-400">Maximum tier reached — Grandmaster! ♚</p>
          )}
        </div>
      </div>
    </Card>
  );
}