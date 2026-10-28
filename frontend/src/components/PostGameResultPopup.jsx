import { useEffect, useRef, useState } from 'react';
import Button from './Button';
import PlayerAvatar from './PlayerAvatar';
import { useOverlayHistory } from '../hooks/useOverlayHistory';

/* ── helpers ─────────────────────────────────────────────────────────────── */

/* "by checkmate" → "By Checkmate". Only the display is touched; the persisted
   reason the backend stored is never rewritten. */
function displayReason(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function colorName(color) {
  return color === 'black' ? 'Black' : 'White';
}

/* Mode labels historically carried glyphs ("🔄 Rematch"); the buttons are text. */
function plainLabel(label) {
  return String(label || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
}

function ratingNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/* ── result icon ─────────────────────────────────────────────────────────── */

function ResultIcon({ tone }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  };
  if (tone === 'win') {
    return (
      <svg {...common}>
        <path d="M8 4h8v4a4 4 0 0 1-8 0V4Z" />
        <path d="M8 5H5v2a3 3 0 0 0 3 3" />
        <path d="M16 5h3v2a3 3 0 0 1-3 3" />
        <path d="M12 12v5" />
        <path d="M10 21v-4h4v4" />
        <path d="M8 21h8" />
      </svg>
    );
  }
  if (tone === 'loss') {
    return (
      <svg {...common}>
        <path d="M6 21V4" />
        <path d="M6 4h11l-1.8 4L17 12H6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 4v16" />
      <path d="M4 8h16" />
      <path d="m4 8-2 5a3 3 0 0 0 6 0L6 8" />
      <path d="m20 8 2 5a3 3 0 0 1-6 0l2-5" />
      <path d="M8 20h8" />
    </svg>
  );
}

/* ── rating movement ─────────────────────────────────────────────────────── */

function RatingDelta({ value }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > 0) return <span className="pgr-delta is-up" title={`Gained ${n} rating points`}>+{n}</span>;
  if (n < 0) return <span className="pgr-delta is-down" title={`Lost ${Math.abs(n)} rating points`}>{n}</span>;
  return <span className="pgr-delta" title="Rating unchanged">0</span>;
}

/* One player. The rating line is only ever built from the participant-scoped
   rating-result request — never from the shared game payload. */
function PlayerRow({ player, rating, rated }) {
  const mine = rated && player.isMe;
  const theirs = rated && !player.isMe && rating.opponent;
  return (
    <li
      className={`pgr-player${player.isMe ? ' is-me' : ''}${player.result === 'Winner' ? ' is-winner' : ''}`}
    >
      <span className={`pgr-player-avatar is-${player.color}`}>
        <PlayerAvatar player={player.profile} seed={player.seed} size={30} />
      </span>
      <span className="pgr-player-meta">
        <span className="pgr-player-name" title={player.name}>
          <span className="pgr-player-name-text">{player.name}</span>
          {player.isMe && <span className="pgr-you">You</span>}
        </span>
        <span className="pgr-player-sub">
          <span className={`pgr-color-dot is-${player.color}`} aria-hidden="true" />
          {colorName(player.color)}
        </span>
      </span>
      <span className="pgr-player-side">
        {mine && (
          <span className="pgr-player-rating">
            <span className="pgr-rating-before">{rating.ratingBefore}</span>
            <span className="pgr-rating-arrow" aria-hidden="true">→</span>
            <strong className="pgr-rating-after">{rating.ratingAfter}</strong>
            <RatingDelta value={rating.ratingChange} />
          </span>
        )}
        {theirs && (
          <span className="pgr-player-rating">
            <span className="pgr-rating-before">{rating.opponent.ratingBefore}</span>
            <span className="pgr-rating-arrow" aria-hidden="true">→</span>
            <strong className="pgr-rating-after">{rating.opponent.ratingAfter}</strong>
            <RatingDelta value={rating.opponent.ratingChange} />
          </span>
        )}
        {player.result && (
          <span className={`pgr-result is-${player.result.toLowerCase()}`}>{player.result}</span>
        )}
      </span>
    </li>
  );
}

/* ── the card ────────────────────────────────────────────────────────────── */

/*
 * Post-game result popup — a compact HORIZONTAL card shared by the Play Arena
 * and the bot game page:
 *
 *   [ icon | result + reason ]   [ both players ]
 *   [            actions in one wrapping row     ]
 *
 * Props:
 *  - open        : boolean
 *  - title       : headline ("You Won!", "You Lost", "Game Drawn")
 *  - reason      : termination ("By Checkmate", "By Resignation", …)
 *  - tone        : 'win' | 'loss' | 'draw' → accent + icon
 *  - players     : [{ id, name, color, profile, seed, isMe, result }]
 *  - rating      : participant-scoped rating result (rated games only)
 *  - onClose     : dismiss without touching the finished board
 *  - onReview    : open the full Game Review
 *  - secondary   : [{ label, onClick, primary? }] action buttons
 */
export default function PostGameResultPopup({
  open,
  title = '',
  reason = '',
  tone = 'draw',
  players = null,
  rating = null,
  onClose,
  onReview,
  secondary = [],
}) {
  useOverlayHistory('post-game-result', open, onClose);

  /* One click, one action: a double-tap on Rematch/New game must never start a
     second game. The lock clears when the card closes or a new result opens. */
  const [pending, setPending] = useState(null);
  useEffect(() => {
    setPending(null);
  }, [open, title]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  /* No close button lives in the card any more; Escape is the keyboard way out
     (the backdrop and the browser Back button dismiss it too). */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const rated = !!(rating && rating.rated && ratingNumber(rating.ratingBefore) != null);
  const headline = title || 'Game over';
  const rowList = Array.isArray(players) ? players : [];
  const actions = Array.isArray(secondary) ? secondary.filter(Boolean) : [];

  const run = (label, fn) => () => {
    if (pending) return;
    setPending(label);
    fn?.();
  };

  return (
    <div
      className="pgr-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pgr-title"
      onClick={onClose}
    >
      <div className={`pgr-card is-${tone}${rowList.length ? '' : ' is-solo'}`} onClick={(e) => e.stopPropagation()}>
        <section className="pgr-summary">
          <span className="pgr-hero-icon" aria-hidden="true">
            <ResultIcon tone={tone} />
          </span>
          <div className="pgr-summary-text">
            <h2 className="pgr-title" id="pgr-title">{headline}</h2>
            {reason && <p className="pgr-reason">{displayReason(reason)}</p>}
          </div>
        </section>

        {rowList.length > 0 && (
          <ul className="pgr-players">
            {rowList.map((p) => (
              <PlayerRow key={p.id || p.color} player={p} rating={rating} rated={rated} />
            ))}
          </ul>
        )}

        <div className="pgr-actions">
          {actions.map((b) => (
            <Button
              key={b.label}
              type="button"
              size="sm"
              variant={b.primary ? 'primary' : 'secondary'}
              disabled={Boolean(pending)}
              loading={pending === b.label}
              onClick={run(b.label, b.onClick)}
            >
              {plainLabel(b.label)}
            </Button>
          ))}
          {onReview && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => { if (!pending) onReview(); }}
            >
              Review game
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
