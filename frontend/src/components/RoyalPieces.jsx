// ─────────────────────────────────────────────────────────────────────────────
// RoyalPieces — a code-drawn, Staunton-style "premium" chess set.
//
// Two ceramic materials matched to the Royal Jade · Premium board:
//   white  → warm ivory porcelain (cream → parchment tones with a soft sheen)
//   black  → deep emerald/teal glazed stoneware with a gold trim
//
// Every piece keeps its classic Staunton silhouette — pedastalled base, tapered
// collar, finial (cross/ball/mitre/battlement) — plus a gold ring, a soft ground
// shadow and a specular gloss so they read as glossy 3D figures. No image
// assets: everything is SVG drawn at render time.
// ─────────────────────────────────────────────────────────────────────────────
import { useId } from 'react';

const TONE = {
  w: { top: '#fdfaee', mid: '#f1e5c8', low: '#d9c49a', outline: '#8f7b56' },
  b: { top: '#429976', mid: '#2a6d51', low: '#164436', outline: '#0b2c20' },
};

const GOLD_HI = '#f3cf6b';
const GOLD_MID = '#60a5fa';
const GOLD_LO = '#b8860b';

/* ── shared anatomy ───────────────────────────────────────────────────── */

function GroundShadow() {
  return <ellipse cx="50" cy="120" rx="30" ry="4.6" fill="#000000" opacity="0.2" />;
}

/* Pedestal: flared skirt + tiered top ring with a gold inlay. All pieces sit
   on it, so the set stays visually consistent. */
function Base({ body, gold, tone }) {
  return (
    <g>
      <GroundShadow />
      <path
        d="M26 114 C 26 101, 30 93, 34 89 L 66 89 C 70 93, 74 101, 74 114 C 74 117.5, 64 120.5, 50 120.5 C 36 120.5, 26 117.5, 26 114 Z"
        fill={body}
        stroke={tone.outline}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <ellipse cx="50" cy="112.8" rx="24.5" ry="6" fill={body} stroke={tone.outline} strokeWidth="1" />
      <ellipse cx="50" cy="110.8" rx="22" ry="4.4" fill={body} />
      <ellipse
        cx="50"
        cy="109.4"
        rx="20.2"
        ry="3.3"
        fill="none"
        stroke={gold}
        strokeWidth="1.5"
        opacity="0.9"
      />
    </g>
  );
}

/* Soft vertical specular streak for the tall, straight-bodied pieces. */
function GlossStreak({ bodyless }) {
  return (
    <ellipse
      cx="41"
      cy="74"
      rx="3.4"
      ry="13"
      fill="#ffffff"
      opacity={bodyless ? 0.18 : 0.32}
      transform="rotate(7 41 74)"
    />
  );
}

/* Subtle ceramic sheen applied to the wider, rounded surfaces. */
function HeadGloss({ cx = 45, cy = 42, rx = 6, ry = 9, o = 0.4 }) {
  return (
    <ellipse
      cx={cx}
      cy={cy}
      rx={rx}
      ry={ry}
      fill="#ffffff"
      opacity={o}
      transform={`rotate(-12 ${cx} ${cy})`}
    />
  );
}

/* ── the six pieces ─────────────────────────────────────────────────────── */

function PawnPiece({ body, gold, tone }) {
  return (
    <g>
      <ellipse cx="50" cy="88" rx="21.5" ry="4.3" fill={body} stroke={tone.outline} strokeWidth="1" />
      <path
        d="M33 85 C 30 74, 35 67, 42 65 L 58 65 C 65 67, 70 74, 67 85 Z"
        fill={body}
        stroke={tone.outline}
        strokeWidth="1.2"
      />
      <circle cx="50" cy="47.5" r="18" fill={body} stroke={tone.outline} strokeWidth="1.4" />
      <HeadGloss cx="45" cy="41.5" rx="6" ry="9.5" />
      <ellipse cx="50" cy="63.5" rx="16.5" ry="3.1" fill="none" stroke={gold} strokeWidth="1.3" opacity="0.9" />
    </g>
  );
}

function RookPiece({ body, gold, tone }) {
  return (
    <g>
      <GlossStreak />
      <path
        d="M36 89 C 30 78, 31 67, 36 59 C 42 55.5, 58 55.5, 64 59 C 69 67, 70 78, 64 89 Z"
        fill={body}
        stroke={tone.outline}
        strokeWidth="1.3"
      />
      <path d="M36 68 L 64 68" stroke={gold} strokeWidth="2" strokeLinecap="round" opacity="0.85" />
      <ellipse cx="50" cy="59" rx="18" ry="3.6" fill={body} stroke={tone.outline} strokeWidth="1" />
      <path
        d="M31 59 L 31 42 L 39 42 L 39 50 L 45 50 L 45 42 L 55 42 L 55 50 L 61 50 L 61 42 L 69 42 L 69 59 Z"
        fill={body}
        stroke={tone.outline}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <ellipse cx="50" cy="42" rx="19" ry="2.4" fill="none" stroke={tone.outline} strokeWidth="1" opacity="0.5" />
      <path d="M34 57.5 L 66 57.5" stroke={gold} strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
    </g>
  );
}

function BishopPiece({ body, gold, tone }) {
  return (
    <g>
      <path
        d="M35 89 C 30 78, 31 69, 36 61 C 44 57, 56 57, 64 61 C 69 69, 70 78, 65 89 Z"
        fill={body}
        stroke={tone.outline}
        strokeWidth="1.3"
      />
      <ellipse cx="50" cy="61" rx="18" ry="3.6" fill={body} stroke={tone.outline} strokeWidth="1" />
      {/* mitre — double-pointed tall hat */}
      <path
        d="M31 59 C 27 49, 28 39, 31 29 C 39 36, 45 41, 50 42 C 55 41, 61 36, 69 29 C 72 39, 73 49, 69 59 Z"
        fill={body}
        stroke={tone.outline}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M50 42 L 50 28" stroke={tone.low} strokeWidth="1.6" opacity="0.55" />
      <ellipse cx="50" cy="57.5" rx="18" ry="3" fill="none" stroke={gold} strokeWidth="1.2" opacity="0.85" />
      {/* finial — gold ball with a tiny cross */}
      <circle cx="50" cy="23" r="4.8" fill={gold} stroke={tone.outline} strokeWidth="0.8" />
      <path d="M50 20 V 12 M 45.4 16 H 54.6" stroke={gold} strokeWidth="1.8" strokeLinecap="round" />
    </g>
  );
}

function KnightPiece({ body, gold, tone }) {
  return (
    <g>
      {/* neck + mane + horse head, facing right */}
      <path
        d="M26 89 C 18 78, 20 67, 27 58
           C 30 52, 35 48, 42 46 L 47 31
           C 54 36, 62 38, 70 44
           C 81 51, 87 62, 87 72
           C 87 78, 82 82, 76 82
           C 73 86, 69 91, 64 93
           C 50 94, 36 93, 26 89 Z"
        fill={body}
        stroke={tone.outline}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* ear detail */}
      <path d="M44 41 C 47 43, 50 44, 52 43" stroke={tone.outline} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      {/* eye */}
      <path d="M63 56 C 65 54, 69 54, 71 56" stroke={tone.outline} strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* nostril */}
      <circle cx="81" cy="70" r="1.7" fill={tone.outline} />
      {/* jaw seam */}
      <path d="M76 82 C 73 86, 69 91, 64 93" stroke={tone.low} strokeWidth="1.2" fill="none" opacity="0.55" />
      {/* mane ridges */}
      <g stroke={tone.outline} strokeWidth="1.3" fill="none" opacity="0.45" strokeLinecap="round">
        <path d="M37 60 C 33 56, 31 50, 32 44" />
        <path d="M33 66 C 27 64, 25 58, 26 52" />
      </g>
      {/* gold saddle-band */}
      <path d="M26 85 C 38 88, 56 88, 64 85" stroke={gold} strokeWidth="1.6" fill="none" opacity="0.8" />
      {/* chest sheen */}
      <HeadGloss cx="38" cy="72" rx="3" ry="10" o="0.25" />
    </g>
  );
}

function QueenPiece({ body, gold, tone }) {
  return (
    <g>
      <GlossStreak bodyless />
      <path
        d="M35 89 C 30 78, 31 68, 36 57 C 44 53, 56 53, 64 57 C 69 68, 70 78, 65 89 Z"
        fill={body}
        stroke={tone.outline}
        strokeWidth="1.3"
      />
      <ellipse cx="50" cy="57" rx="18" ry="3.6" fill={body} stroke={tone.outline} strokeWidth="1" />
      {/* crown band */}
      <path
        d="M31 57 L 31 44 C 38 49, 45 50, 50 50 C 55 50, 62 49, 69 44 L 69 57 Z"
        fill={body}
        stroke={tone.outline}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      {/* scalloped golden top — five points */}
      <path
        d="M31 44 C 33 36, 39 36, 41 44 C 43 36, 47 36, 49 44 C 51 36, 55 36, 57 44 C 59 36, 63 36, 65 44 C 66 36, 68 36, 69 44 Z"
        stroke={gold}
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <ellipse cx="50" cy="55" rx="19" ry="3" fill="none" stroke={gold} strokeWidth="1.2" opacity="0.85" />
      {/* finial ball with grooves */}
      <circle cx="50" cy="32" r="8" fill={body} stroke={tone.outline} strokeWidth="1.3" />
      <g stroke={tone.low} strokeWidth="1.1" opacity="0.4">
        <path d="M47 26 C 49 29, 49 35, 47 38" fill="none" />
        <path d="M53 26 C 51 29, 51 35, 53 38" fill="none" />
      </g>
      <HeadGloss cx="47" cy="29" rx="2.6" ry="4.6" o="0.35" />
      <circle cx="50" cy="19" r="2.6" fill={gold} />
    </g>
  );
}

function KingPiece({ body, gold, tone }) {
  return (
    <g>
      <GlossStreak />
      <path
        d="M33 89 C 28 78, 29 68, 34 55 C 43 51, 57 51, 66 55 C 71 68, 72 78, 67 89 Z"
        fill={body}
        stroke={tone.outline}
        strokeWidth="1.3"
      />
      <ellipse cx="50" cy="55" rx="18" ry="3.6" fill={body} stroke={tone.outline} strokeWidth="1" />
      {/* crown — three merlons */}
      <path
        d="M31 55 L 31 40 L 39 40 L 39 48 L 46 48 L 46 40 L 54 40 L 54 48 L 61 48 L 61 40 L 69 40 L 69 55 Z"
        fill={body}
        stroke={tone.outline}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <ellipse cx="50" cy="40" rx="19" ry="2.4" fill="none" stroke={tone.outline} strokeWidth="1" opacity="0.6" />
      <ellipse cx="50" cy="52.5" rx="19" ry="3" fill="none" stroke={gold} strokeWidth="1.2" opacity="0.85" />
      {/* gold-tipped merlons */}
      <path d="M35 40 V 35 M 50 40 V 35 M 65 40 V 35" stroke={gold} strokeWidth="2" strokeLinecap="round" />
      {/* orb + cross */}
      <circle cx="50" cy="31" r="8.5" fill={body} stroke={tone.outline} strokeWidth="1.3" />
      <HeadGloss cx="47" cy="28" rx="2.7" ry="4.6" o="0.38" />
      <path d="M50 26.5 V 14 M 45.5 20.5 H 54.5" stroke={gold} strokeWidth="2.3" strokeLinecap="round" />
    </g>
  );
}

const ROYAL_TYPES = {
  p: PawnPiece,
  r: RookPiece,
  n: KnightPiece,
  b: BishopPiece,
  q: QueenPiece,
  k: KingPiece,
};

/**
 * One premium Staunton piece.
 * @param type  'p' | 'n' | 'b' | 'r' | 'q' | 'k'
 * @param side  'w' | 'b'
 * @param size  rendered width/height in px (fits inside a square)
 */
export function RoyalPiece({ type, side, size }) {
  const raw = useId();
  const uid = `${raw.replace(/[^a-zA-Z0-9]/g, '')}${side}${type}`;
  const tone = TONE[side] || TONE.w;
  const bodyId = `${uid}-body`;
  const goldId = `${uid}-gold`;
  const Piece = ROYAL_TYPES[type] || PawnPiece;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 128"
      preserveAspectRatio="xMidYMax meet"
      style={{ display: 'block', filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.28))' }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={bodyId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone.top} />
          <stop offset="52%" stopColor={tone.mid} />
          <stop offset="100%" stopColor={tone.low} />
        </linearGradient>
        <linearGradient id={goldId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={GOLD_HI} />
          <stop offset="100%" stopColor={GOLD_LO} />
        </linearGradient>
      </defs>
      <Base body={`url(#${bodyId})`} gold={`url(#${goldId})`} tone={tone} />
      <Piece body={`url(#${bodyId})`} gold={GOLD_MID} tone={tone} />
    </svg>
  );
}