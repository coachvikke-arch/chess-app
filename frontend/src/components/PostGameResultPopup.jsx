import { useEffect } from 'react';
import { useOverlayHistory } from '../hooks/useOverlayHistory';

/* ── rating rows ──────────────────────────────────────────────────────────────
 * The result card is the ONE card in the app (the Play Arena's page board
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
  if (n > 0) return <span className="pgr-delta is-up" title={`Gained ${n} rating points`}>+{n}</span>;
  if (n < 0) return <span className="pgr-delta is-down" title={`Lost ${Math.abs(n)} rating points`}>{n}</span>;
  return <span className="pgr-delta" title="Rating unchanged">0</span>;
}

function RatingRow({ name, before, after, change, color = 'white', mine = false }) {
  const b = ratingNumber(before);
  const a = ratingNumber(after);
  const label = typeof name === 'string' && name.trim() ? name.trim() : 'Player';
  if (b === null || a === null) return null;
  return (
    <li className={`pgr-player${mine ? ' is-me' : ''}`}>
      <span className={`pgr-dot is-${color === 'black' ? 'black' : 'white'}`} aria-hidden="true" />
      <span className="pgr-player-name" title={label}>{label}</span>
      <span className="pgr-player-rating">
        {b}
        <span className="pgr-player-arrow" aria-hidden="true">→</span>
        <strong>{a}</strong>
      </span>
      <RatingDelta value={change} />
    </li>
  );
}

/* Mode labels carry glyphs ("🔄 Rematch", "♞ New game"); the card is text-only. */
function plainLabel(label) {
  return String(label || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
}

/*
 * Post-game result popup shown the moment a game ends.
 *
 * Props:
 *  - open        : boolean
 *  - title       : headline (e.g. "You Won!", "You Lost", "Draw")
 *  - reason      : subtitle (e.g. "by Checkmate", "by Resignation", "by Timeout")
 *  - tone        : 'win' | 'loss' | 'draw' → accent colour for the result
 *  - stats       : array of { icon, count, label, tone } move-quality rows (from analysis)
 *  - analyzing   : boolean — when true the footer shows the analysing status
 *  - rating      : { rated, myName, myColor, ratingBefore, ratingAfter,
 *                    ratingChange, opponent: { name, ratingBefore, ratingAfter,
 *                    ratingChange }, opponentColor, timeControl, timeClassLabel }
 *  - onClose     : () => void — X / backdrop close (returns to board without navigating)
 *  - onReview    : () => void — "View analysis" (navigates to the full Game Review)
 *  - secondary   : array of { label, onClick, primary? } — e.g. Rematch / New game
 */
const TONES = {
  win: { accent: '#4ade80', badge: 'Won' },
  loss: { accent: '#f87171', badge: 'Lost' },
  draw: { accent: '#9aa4b2', badge: 'Draw' },
};

export default function PostGameResultPopup({
  open,
  title = '',
  reason = '',
  tone = 'draw',
  stats = [],
  analyzing = false,
  rating = null,
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
  const headline = (title || 'Game over').replace(/!+$/, '');
  const rated = !!(rating && rating.rated);
  const timeLabel = rated
    ? rating.timeClassLabel || (rating.timeControl ? `${rating.timeControl} rating` : null)
    : null;
  const summary = stats.slice(0, 3).map((s) => `${s.count} ${String(s.label).toLowerCase()}`).join(' · ');

  return (
    <div className="pgr-overlay" role="dialog" aria-modal="true" aria-label="Game result" onClick={onClose}>
      <div
        className="pgr-card"
        onClick={(e) => e.stopPropagation()}
        style={{ '--pgr-accent': t.accent }}
      >
        <span className="pgr-accent" aria-hidden="true" />

        {/* top row — time-control pill, result badge, close */}
        <div className="pgr-top">
          {timeLabel ? <span className="pgr-pill">{timeLabel}</span> : <span />}
          <div className="pgr-top-right">
            <span className={`pgr-badge is-${tone}`}>{t.badge}</span>
            <button type="button" className="pgr-close" onClick={onClose} aria-label="Close result" title="Close">
              ✕
            </button>
          </div>
        </div>

        {/* result headline */}
        <p className="pgr-headline" style={{ color: t.accent }}>{headline}</p>
        {reason && <p className="pgr-reason">{reason}</p>}

        {/* players + rating change — rated player-vs-player games only.
            Deliberately absent for bot games: a bot has no real rating, so there
            is no honest number to show. `rating` arrives as null/undefined there
            and this renders nothing at all. */}
        {rated && (
          <div className="pgr-players" data-testid="pgr-rating">
            <ul className="pgr-player-list">
              <RatingRow
                name={rating.myName || 'You'}
                before={rating.ratingBefore}
                after={rating.ratingAfter}
                change={rating.ratingChange}
                color={rating.myColor === 'black' ? 'black' : 'white'}
                mine
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

        {/* secondary actions — Rematch / New game / New 10 min */}
        {secondary.length > 0 && (
          <div className="pgr-actions">
            {secondary.map((b) => (
              <button key={b.label} type="button" className="pgr-action" onClick={b.onClick}>
                {plainLabel(b.label)}
              </button>
            ))}
          </div>
        )}

        {/* analysis status */}
        <div className="pgr-foot">
          {analyzing ? (
            <span className="pgr-status is-busy">
              <span className="pgr-shimmer" aria-hidden="true" />
              Analysing move quality…
            </span>
          ) : stats.length === 0 ? (
            <span className="pgr-status">Not enough moves to grade.</span>
          ) : (
            <span className="pgr-status">{summary}</span>
          )}
          {!analyzing && onReview && (
            <button type="button" className="pgr-link" onClick={onReview}>
              View analysis <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
