import { useMemo } from 'react';
import Button from './Button';

/**
 * PositionCard — ranked player/person card for leaderboards & standings.
 *
 * Builds ONLY from existing design tokens:
 *  - Shell ............ `.chess-card` + `.chess-card-hover` (index.css ~112)
 *                        radius 1.25rem, olive/gold gradient bg, border
 *                        --surface-border, shadow 0 8px 26px rgba(15,23,42,.12),
 *                        hover: translateY(-4px) + gold border/glow — matches
 *                        every other card + Stat hover convention
 *  - Rank badge ....... `.chess-chip` (pill, radius 999px, 600 weight,
 *                        bg rgba(224,242,254,.9)) + Leaderboard top-3 medal
 *                        glyphs ♕♖♗ with text-gold-400 / text-ivory-300 /
 *                        text-amber-600 (Leaderboard.jsx MEDALS)
 *  - Avatar ........... pattern from `.pgr-coach-avatar` / `.cp-avatar`:
 *                        circular, gold border rgba(59,130,246,.4/.45),
 *                        gold→olive radial gradient, 3px gold glow ring
 *  - Title ............ font-display (Quicksand) font-semibold, text-ivory-300
 *  - Subtitle ......... text-sm text-ivory-500 (muted text token)
 *  - Stat chips ....... `.chess-chip` / `.chess-chip-gold` (metric pops gold,
 *                        label copies .chess-chip padding/weight)
 *  - Action button .... `.app-btn--primary`: flat blue, 10px radius, compact
 *                        sizing via size="sm"
 *
 * Dark mode: inherited for free — .chess-card has an html[data-theme='dark']
 * override in index.css ~3046, and all text uses var(--ivory-*) tokens.
 */

const MEDALS = ['♕', '♖', '♗'];

/* help: pick a readable fallback glyph when no avatar image is passed */
function fallbackGlyph(title) {
  const ch = (title || '').trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(ch) ? ch : '♘';
}

export default function PositionCard({
  rank = 1,
  image,             // avatar src (optional)
  title = '',
  subtitle = '',
  stats = [],        // [{ label, value, gold }] — metric pills
  buttonLabel = 'View',
  onAction,
  onClick,           // optional whole-card click (extra semantics)
  active = false,    // current-user highlight ring
  className = '',
}) {
  const badge = useMemo(() => (
    <span className="chess-chip inline-flex items-center gap-1.5 !text-xs">
      {rank <= 3 && (
        <span className={`text-sm ${rank === 1 ? 'text-gold-400' : rank === 2 ? 'text-ivory-300' : 'text-amber-600'}`}>
          {MEDALS[rank - 1]}
        </span>
      )}
      #{rank}
    </span>
  ), [rank]);

  return (
    <div
      className={`chess-card chess-card-hover ${active ? 'ring-2 ring-gold-300/70' : ''} ${className}`}
      style={onClick ? { cursor: 'pointer' } : undefined}
      onClick={onClick}
    >
      {/* ── header row: badge · avatar · name ── */}
      <div className="flex items-center gap-3">
        {badge}

        {/* avatar — .pgr-coach-avatar / .cp-avatar token recipe (circle, gold border, gradient, glow ring) */}
        <span
          className="relative grid place-items-center !border-[1.5px] overflow-hidden rounded-full flex-shrink-0"
          style={{
            width: 52,
            height: 52,
            background: 'radial-gradient(circle at 30% 25%, rgba(255,255,255,0.12), transparent 60%), linear-gradient(150deg, rgba(59,130,246,0.3), rgba(37,99,235,0.35))',
            borderColor: 'rgba(59,130,246,0.45)',
            boxShadow: '0 0 0 3px rgba(59,130,246,0.12)',
            fontSize: '1.5rem',
          }}
        >
          {image ? (
            <img src={image} alt={title} className="w-full h-full object-cover" />
          ) : (
            <span style={{ color: 'rgba(62,53,35,0.85)' }}>{fallbackGlyph(title)}</span>
          )}
        </span>

        <div className="min-w-0 flex-1">
          {/* title — font-display (Quicksand) semibold, primary text token --ivory-100 */}
          <h3 className="font-display font-semibold text-base leading-tight text-ivory-300 truncate">
            {title}
          </h3>
          {/* subtitle — muted text token --ivory-500, body family */}
          <p className="text-sm text-ivory-500 truncate">{subtitle}</p>
        </div>
      </div>

      {/* ── footer row: metric pills + action button ── */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {stats.map((s, i) => (
          <span
            key={`${s.label}-${i}`}
            className={`chess-chip ${s.gold ? 'chess-chip-gold' : ''} inline-flex items-center gap-1.5`}
            title={s.label}
          >
            {s.icon && <span>{s.icon}</span>}
            <span className="font-bold tabular-nums">{s.value}</span>
            <span className="opacity-80">{s.label}</span>
          </span>
        ))}

        {/* action button - shared .app-btn primary, compact size */}
        <Button
          type="button"
          onClick={(e) => { e.stopPropagation(); onAction && onAction(); }}
          variant="primary" size="sm" className="!py-2 !px-4 text-xs ml-auto"
        >
          {buttonLabel}
        </Button>
      </div>
    </div>
  );
}