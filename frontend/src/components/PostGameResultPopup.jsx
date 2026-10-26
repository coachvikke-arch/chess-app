import { useEffect } from 'react';
import { useOverlayHistory } from '../hooks/useOverlayHistory';
import Button from './Button';

/* ── rating rows ──────────────────────────────────────────────────────────────
 * The result card is the ONE card in the app now (the Play Arena's page board
 * and its full-screen Play Mode board show the same one), so the rating change
 * that used to live on the page-only card lives here.
 *
 * Every field is coerced before it is printed: React renders `undefined`,
 * `null` and `NaN` as visible text, so an unguarded `{ratingBefore}` would
 * print the literal word "undefined". A row without a usable before/after
 * pair is simply omitted — a delta on its own means nothing. */

function ratingNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function RatingDelta({ value }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > 0) return <span className="pgr-rating-delta is-up" title={`Gained ${n} rating points`}>+{n}</span>;
  if (n < 0) return <span className="pgr-rating-delta is-down" title={`Lost ${Math.abs(n)} rating points`}>{n}</span>;
  return <span className="pgr-rating-delta" title="Rating unchanged">0</span>;
}

function RatingRow({ name, before, after, change, color = 'white' }) {
  const b = ratingNumber(before);
  const a = ratingNumber(after);
  const label = typeof name === 'string' && name.trim() ? name.trim() : 'Player';
  if (b === null || a === null) return null;
  return (
    <li className="pgr-rating-row">
      <span className="pgr-rating-who">
        <span aria-hidden="true">{color === 'black' ? '⚫' : '⚪'}</span>
        {label}
      </span>
      <span className="pgr-rating-numbers">
        {b}
        <span className="pgr-rating-arrow" aria-hidden="true">→</span>
        <strong>{a}</strong>
      </span>
      <RatingDelta value={change} />
    </li>
  );
}

/*
 * Post-game result popup shown the moment a game ends.
 *
 * Props:
 *  - open        : boolean
 *  - title       : headline (e.g. "You Won!", "You Lost", "Draw")
 *  - reason      : subtitle (e.g. "by Checkmate", "by Resignation", "by Timeout")
 *  - tone        : 'win' | 'loss' | 'draw' → accent colour for the result
 *  - coach       : string — auto-generated coach feedback sentence
 *  - stats       : array of { icon, count, label, tone } move-quality rows (from analysis)
 *  - analyzing   : boolean — when true, stats show a lightweight "analysing" state
 *  - rating      : { rated, myName, myColor, ratingBefore, ratingAfter,
 *                    ratingChange, opponent: { name, ratingBefore, ratingAfter,
 *                    ratingChange }, opponentColor, timeControl, timeClassLabel }
 *  - onClose     : () => void — X / backdrop close (returns to board without navigating)
 *  - onReview    : () => void — primary action (navigates directly to the full Game Review)
 *  - secondary   : array of { label, onClick, primary? } — e.g. Rematch / New 10 min
 *  - avatar      : string — coach glyph/avatar (defaults to a chess coach piece)
 */
const TONES = {
  win: { title: '#7bc96f', accent: 'rgba(123,201,111,0.14)', border: 'rgba(123,201,111,0.5)' },
  loss: { title: '#f87171', accent: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.45)' },
  draw: { title: '#60a5fa', accent: 'rgba(227,173,78,0.12)', border: 'rgba(227,173,78,0.45)' },
};

export default function PostGameResultPopup({
  open,
  title = '',
  reason = '',
  tone = 'draw',
  coach = '',
  stats = [],
  analyzing = false,
  rating = null,
  avatar = '♞',
  onClose,
  onReview,
  secondary = [],
}) {
  useOverlayHistory('post-game-result', open, onClose);
  // lock background scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const t = TONES[tone] || TONES.draw;

  return (
    <div className="pgr-overlay" role="dialog" aria-modal="true" aria-label="Game result" onClick={onClose}>
      <div
        className="pgr-card"
        onClick={(e) => e.stopPropagation()}
        style={{ borderColor: t.border, boxShadow: `0 0 70px ${t.accent}, 0 30px 90px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.08)` }}
      >
        <span className="pgr-accent" style={{ background: t.title }} />
        {/* header — X close only (no share) */}
        <div className="pgr-header">
          <span className="pgr-header-piece">♛</span>
          <button
            className="pgr-close"
            onClick={onClose}
            aria-label="Close result"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* result headline */}
        <p className="pgr-title" style={{ color: t.title }}>{title || 'Game over'}</p>
        {reason && <p className="pgr-reason">{reason}</p>}

        {/* coach avatar + feedback */}
        <div className="pgr-coach">
          <span className="pgr-coach-avatar" aria-hidden="true">{avatar}</span>
          <div className="pgr-coach-bubble">
            {coach || 'Thanks for the game! Here is how it went.'}
          </div>
        </div>

        {/* move-quality stats */}
        <div className="pgr-stats">
          {analyzing ? (
            <div className="pgr-stats-label">
              <span className="pgr-analyzing-dot" /> Analysing move quality…
            </div>
          ) : stats.length === 0 ? (
            <div className="pgr-stats-label">
              <span className="pgr-analyzing-dot" /> Not enough moves to grade.
            </div>
          ) : (
            <div className="pgr-stats-row">
              {stats.map((s) => (
                <span key={s.label} className="pgr-stat">
                  <span className="pgr-stat-icon" style={{ color: s.color }}>{s.icon}</span>
                  <span className="pgr-stat-count" style={{ color: s.color }}>{s.count}</span>
                  <span className="pgr-stat-label">{s.label}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* rating change - rated player-vs-player games only.
            Deliberately absent for bot games: a bot has no real rating, so there
            is no honest number to show. `rating` arrives as null/undefined there
            and this renders nothing at all.

            BOTH players are listed when the payload carries the opponent's
            row: this card replaced the page-only result card, which showed
            both sides. */}
        {rating && rating.rated && (
          <div className="pgr-rating" data-testid="pgr-rating">
            <span className="pgr-rating-label">
              {rating.timeClassLabel
                || (rating.timeControl ? `${rating.timeControl} rating` : null)
                || 'Rating'}
            </span>
            <ul className="pgr-rating-list">
              <RatingRow
                name={rating.myName || 'You'}
                before={rating.ratingBefore}
                after={rating.ratingAfter}
                change={rating.ratingChange}
                color={rating.myColor === 'black' ? 'black' : 'white'}
              />
              {rating.opponent && (
                <RatingRow
                  name={rating.opponent.name || 'Opponent'}
                  before={rating.opponent.ratingBefore}
                  after={rating.opponent.ratingAfter}
                  change={rating.opponent.ratingChange}
                  color={rating.opponentColor === 'white' ? 'white' : 'black'}
                />
              )}
            </ul>
          </div>
        )}

        {/* primary action — Game Review */}
        {onReview && (
          <Button variant="primary" size="md" fullWidth className="mt-3" onClick={onReview}>
            📊 Game Review
          </Button>
        )}

        {/* secondary actions */}
        {secondary.length > 0 && (
          <div className="pgr-secondary">
            {secondary.map((b) => (
              <Button
                key={b.label}
                variant={b.primary ? 'primary' : 'secondary'}
                size="md"
                fullWidth
                onClick={b.onClick}
              >
                {b.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}