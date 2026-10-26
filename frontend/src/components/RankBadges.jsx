/* Rank badge icon set — coin-style filled circles for the Game Review verdict
   scale (keys = REVIEW_META verdict keys).

   Each badge is a filled circle with:
     - a radial gradient (light top-left → base → darker bottom-right) for the
       embossed/coin feel,
     - a darker same-hue ring that reads as a minted edge,
     - a crisp top rim-light arc,
     - a bold WHITE glyph, centred.

   Everything is inline SVG (no assets, no font dependencies), so it scales
   crisply from 16px (move list) to 48px (legend/summary) and can be embedded
   anywhere — React here, but the SVG markup is copy-pasteable into an icon
   font or public/sprite.svg.

   Usage:
     import { RankBadge, RankIcon } from '../components/RankBadges';

     <RankBadge verdict="brilliant" />                       // icon + "Brilliant"
     <RankBadge verdict="mistake" size={48} />               // = "Miss" tier
     <RankBadge verdict="blunder" showLabel={false} />       // icon only
     <RankIcon verdict="great" size={40} />                  // bare icon
*/

import { useId } from 'react';
import { REVIEW_META } from '../utils/gameReview';
import { getDisplayVerdict } from '../utils/sigmaType';

/* vector glyphs, drawn in a 24×24 grid, filled with currentColor (white).
   One icon per verdict — including `good` (·) and `mistake` (?) which used to
   render no badge on the board. */
export const RANK_GLYPHS = {
  brilliant: (
    /* "!!" */
    <g>
      <circle cx="8.4" cy="5.7" r="0.95" fill="currentColor" />
      <circle cx="15.6" cy="5.7" r="0.95" fill="currentColor" />
      <path d="M8.4 9v7.8M15.6 9v7.8"
        fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </g>
  ),
  great: (
    /* "!" */
    <g>
      <circle cx="12" cy="5.4" r="0.95" fill="currentColor" />
      <path d="M12 8.8v8.2"
        fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </g>
  ),
  best: (
    /* ★ */
    <path
      fill="currentColor"
      stroke="none"
      d="M12 3.9l2.15 4.55 4.95.72-3.58 3.49.85 4.94L12 14.9l-4.37 2.7.85-4.94L4.9 9.17l4.95-.72z"
    />
  ),
  excellent: (
    /* ✓ */
    <path
      d="M5.9 12.4l4.1 4.1 8.1-8.6"
      fill="none" stroke="currentColor" strokeWidth="2.9"
      strokeLinecap="round" strokeLinejoin="round" />
  ),
  good: (
    /* · — solid, nothing special */
    <circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none" />
  ),
  book: (
    /* open book */
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 6.4C10.4 5.2 8.5 4.6 6.3 4.6c-1.4 0-2.6.3-3.4.7v12.9c.8-.4 2-.7 3.4-.7 2.2 0 4.1.6 5.7 1.9 1.6-1.3 3.5-1.9 5.7-1.9 1.4 0 2.6.3 3.4.7V5.3c-.8-.4-2-.7-3.4-.7-2.2 0-4.1.6-5.7 1.8z" />
      <path d="M12 6.4v12.9" />
    </g>
  ),
  inaccuracy: (
    /* "?!" */
    <g fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.6 8.9a2.7 2.7 0 1 1 4.1 2.3c-1 .6-1.5 1-1.5 2.2" />
      <circle cx="10.3" cy="17.2" r="0.95" fill="currentColor" stroke="none" />
      <path d="M15.8 9.6v5.6" />
      <circle cx="15.8" cy="17.2" r="0.95" fill="currentColor" stroke="none" />
    </g>
  ),
  miss: (
    /* "✕" — missed a forced win/mate */
    <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.6 7.6l8.8 8.8M16.4 7.6l-8.8 8.8" />
    </g>
  ),
  mistake: (
    /* "?" — Miss */
    <g fill="none" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.4 8.4a3.4 3.4 0 1 1 5.2 2.9c-1.2.8-1.9 1.3-1.9 2.8" />
      <circle cx="11.7" cy="17" r="0.95" fill="currentColor" stroke="none" />
    </g>
  ),
  blunder: (
    /* "??" — Clown */
    <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.2 8.5a3 3 0 1 1 4.6 2.5c-1.1.7-1.6 1.2-1.6 2.5" />
      <circle cx="10" cy="16.7" r="0.85" fill="currentColor" stroke="none" />
      <path d="M15.2 8.5a3 3 0 1 1 4.6 2.5c-1.1.7-1.6 1.2-1.6 2.5" />
      <circle cx="18" cy="16.7" r="0.85" fill="currentColor" stroke="none" />
    </g>
  ),
};

/* bare coin icon — one verdict, no label

   Both components normalise the verdict id first. The Sigma tier is written as
   'sigma' by the classification layer and read as 'brilliant' by everything
   visual, so a 'sigma' row used to match neither REVIEW_META nor RANK_GLYPHS and
   rendered nothing. Normalising here keeps the "!!" coin, its palette and its
   premium glow — the Sigma row is drawn as the badge it always was. */
export function RankIcon({ verdict, size = 40, className = '', ariaHidden = false }) {
  const shown = getDisplayVerdict(verdict);
  const meta = REVIEW_META[shown];
  if (!meta || !RANK_GLYPHS[shown]) return null;
  const rawId = useId();
  const gid = 'rb' + rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  const glow = meta.glow;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      color="#ffffff"
      preserveAspectRatio="xMidYMid meet"
      role={ariaHidden ? undefined : 'img'}
      aria-label={ariaHidden ? undefined : meta.label}
      aria-hidden={ariaHidden || undefined}
      className={`rank-badge__icon${glow ? ' rank-badge__icon--glow' : ''} ${className}`}
      style={glow ? { ['--rb-glow']: meta.color } : undefined}
    >
      <defs>
        <radialGradient id={gid} cx="32%" cy="28%" r="88%">
          <stop offset="0%" stopColor={meta.light} />
          <stop offset="52%" stopColor={meta.color} />
          <stop offset="100%" stopColor={meta.deep} />
        </radialGradient>
      </defs>
      {/* coin face */}
      <circle cx="12" cy="12" r="11.2" fill={`url(#${gid})`} />
      {/* minted edge — darker same-hue ring */}
      <circle cx="12" cy="12" r="11.2" fill="none" stroke={meta.deep} strokeOpacity="0.95" strokeWidth="1.3" />
      {/* embossed rim-light across the top */}
      <path d="M6 5.9a8.6 8.6 0 0 1 12 0" fill="none" stroke="#ffffff" strokeOpacity="0.42" strokeWidth="1" strokeLinecap="round" />
      {/* glyph, white & centred */}
      <g>{RANK_GLYPHS[shown]}</g>
    </svg>
  );
}

/* coin icon + text label to its right (rank name, medium weight).
   Hide the label with showLabel={false} when only the icon belongs inline.
   The label comes from the metadata, and both Sigma spellings resolve to the
   same entry — so the player reads "Brilliant" and the internal id never
   reaches the screen. */
export function RankBadge({ verdict, size = 40, label, showLabel = true, className = '' }) {
  const meta = REVIEW_META[getDisplayVerdict(verdict)];
  if (!meta) return null;
  return (
    <span className={`rank-badge${showLabel ? '' : ' rank-badge--icon-only'} ${className}`}>
      <RankIcon verdict={verdict} size={size} ariaHidden={!showLabel} />
      {showLabel && <span className="rank-badge__label">{label ?? meta.label}</span>}
    </span>
  );
}