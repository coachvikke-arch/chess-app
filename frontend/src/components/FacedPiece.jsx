import { useId } from 'react';

const TONE = {
  w: { top: '#fdf7ea', bottom: '#d3c29c', line: '#5f4e33', extra: '#efe6cd' },
  b: { top: '#4a4c54', bottom: '#1c1e24', line: '#09090c', extra: '#2c2e36' },
};

const ACCENT = {
  k: { fill: '#f2c14e', dark: '#b8862f', light: '#ffdf9a' },
  q: { fill: '#e28ba6', dark: '#b25a74', light: '#f7c0cf' },
  b: { fill: '#c94f4e', dark: '#8f2d2d', light: '#e08a88' },
  n: { fill: '#2fb6a6', dark: '#1b7f74', light: '#7fe0d3' },
  r: { fill: '#5260d8', dark: '#323c96', light: '#8f9af0' },
  p: { fill: '#ef9a4a', dark: '#ba6b22', light: '#ffc78f' },
};

const INK = 'rgba(38,50,70,0.95)';
const LID = 'rgba(88,76,50,0.45)';

/* ── small drawable pieces ──────────────────────────────────────────────── */

function Eye({ x, y, r = 5, closed = false, lid = 0, line }) {
  if (closed) {
    return (
      <path
        d={`M ${x - r - 1} ${y} Q ${x} ${y - r * 1.7} ${x + r + 1} ${y}`}
        fill="none"
        stroke={line}
        strokeWidth={2}
        strokeLinecap="round"
      />
    );
  }
  return (
    <g>
      <ellipse cx={x} cy={y} rx={r} ry={r * 1.05} fill="#ffffff" stroke={LID} strokeWidth={0.9} />
      <circle cx={x + r * 0.35} cy={y + r * 0.3} r={r * 0.55} fill={INK} />
      <circle cx={x + r * 0.15} cy={y - r * 0.3} r={r * 0.22} fill="#ffffff" />
      {lid > 0 && (
        <path
          d={`M ${x - r - 1} ${y - lid * 0.35} Q ${x} ${y - lid} ${x + r + 1} ${y - lid * 0.35}`}
          fill="none"
          stroke={line}
          strokeWidth={2}
          strokeLinecap="round"
        />
      )}
    </g>
  );
}

function Brow({ d, line }) {
  return <path d={d} fill="none" stroke={line} strokeWidth={2.3} strokeLinecap="round" />;
}

function SmileOpen({ x, y, w = 8, h = 6, line, teeth = true }) {
  return (
    <g>
      <path
        d={`M ${x - w} ${y} Q ${x} ${y + h} ${x + w} ${y} Q ${x} ${y + h - 3} ${x - w} ${y} Z`}
        fill="#5b2f26"
        stroke={line}
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
      {teeth && <path d={`M ${x - w + 2} ${y} Q ${x} ${y + h * 0.45} ${x + w - 2} ${y}`} fill="#ffffff" opacity="0.92" />}
    </g>
  );
}

function SmileClosed({ x, y, w = 8, h = 4, line }) {
  return (
    <path
      d={`M ${x - w} ${y} Q ${x} ${y + h} ${x + w} ${y}`}
      fill="none"
      stroke={line}
      strokeWidth={2}
      strokeLinecap="round"
    />
  );
}

function StraightMouth({ x, y, w = 6, line }) {
  return <path d={`M ${x - w} ${y} L ${x + w} ${y}`} fill="none" stroke={line} strokeWidth={2} strokeLinecap="round" />;
}

function Frown({ x, y, w = 6, line }) {
  return (
    <path
      d={`M ${x - w} ${y} Q ${x} ${y - 4} ${x + w} ${y}`}
      fill="none"
      stroke={line}
      strokeWidth={2}
      strokeLinecap="round"
    />
  );
}

function Gloss({ x, y, rx, ry, tone }) {
  return <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="#ffffff" opacity={tone === 'w' ? 0.5 : 0.14} />;
}

function GroundShadow() {
  return <ellipse cx="50" cy="123" rx="31" ry="5" fill="rgba(15,16,12,0.32)" />;
}

function Base({ tone }) {
  const { top, line } = tone;
  return (
    <g>
      <path
        d="M35 107 h30 a4 4 0 0 1 4 4 v1.5 a4 4 0 0 1 -4 4 h-30 a4 4 0 0 1 -4 -4 v-1.5 a4 4 0 0 1 4 -4"
        fill={top}
        stroke={line}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <ellipse cx="50" cy="115.5" rx="25.5" ry="6" fill={top} stroke={line} strokeWidth="2.2" />
      <ellipse cx="50" cy="113.7" rx="19" ry="3.8" fill="rgba(0,0,0,0.1)" />
    </g>
  );
}

function Gradient({ id, top, bottom }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor={top} />
      <stop offset="1" stopColor={bottom} />
    </linearGradient>
  );
}

function PawnPiece({ tone, accent, id }) {
  const line = tone.line;
  const body = `url(#${id}-body)`;
  return (
    <g>
      <GroundShadow />
      <path d="M40 62 L60 60 L67 100 L33 100 Z" fill={body} stroke={line} strokeWidth="2.4" strokeLinejoin="round" />
      <circle cx="50" cy="47" r="19" fill={body} stroke={line} strokeWidth="2.4" />
      <rect x="30" y="94" width="40" height="7" rx="3.5" fill={accent.fill} stroke={line} strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="50" cy="26" r="6" fill={accent.fill} stroke={line} strokeWidth="1.8" />
      <circle cx="48" cy="24.5" r="1.8" fill={accent.light} />
      <Gloss x="41" y="50" rx="6" ry="12" tone={tone.line === TONE.w.line ? 'w' : 'b'} />
      {/* eager face */}
      <Brow d="M34 38 Q40 34 46 38" line={line} />
      <Brow d="M54 38 Q60 34 66 38" line={line} />
      <Eye x="41" y="46" r="5" line={line} />
      <Eye x="59" y="46" r="5" line={line} />
      <SmileOpen x="50" y="60" w="9" h="6" line={line} />
    </g>
  );
}

function KingPiece({ tone, accent, id }) {
  const line = tone.line;
  const body = `url(#${id}-body)`;
  const gold = `url(#${id}-accent)`;
  return (
    <g>
      <GroundShadow />
      <path d="M32 62 C32 52 68 52 68 62 L62 104 C59 108 41 108 38 104 Z" fill={body} stroke={line} strokeWidth="2.4" strokeLinejoin="round" />
      {/* crown */}
      <rect x="27" y="56" width="46" height="7" rx="3.5" fill={gold} stroke={line} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M41 56 L36 42 L44 51 L50 38 L56 51 L64 42 L59 56 Z" fill={gold} stroke={line} strokeWidth="2" strokeLinejoin="round" />
      <circle cx="50" cy="35" r="4.5" fill={accent.fill} stroke={line} strokeWidth="1.8" />
      <path d="M49 33 l2 0 M50 32 l0 2" stroke={accent.light} strokeWidth="2" strokeLinecap="round" />
      <circle cx="38" cy="53" r="2.2" fill={accent.light} />
      <circle cx="50" cy="52.5" r="2.2" fill={accent.light} />
      <circle cx="62" cy="53" r="2.2" fill={accent.light} />
      <Gloss x="40" y="78" rx="7" ry="16" tone={tone === TONE.w ? 'w' : 'b'} />
      {/* calm regal face */}
      <Brow d="M35 68 Q40 65 45 68" line={line} />
      <Brow d="M55 68 Q60 65 65 68" line={line} />
      <Eye x="41" y="74" r="4.2" line={line} />
      <Eye x="59" y="74" r="4.2" line={line} />
      <SmileClosed x="50" y="84" w="7" h="3.4" line={line} />
    </g>
  );
}

function QueenPiece({ tone, accent, id }) {
  const line = tone.line;
  const body = `url(#${id}-body)`;
  const crown = `url(#${id}-accent)`;
  return (
    <g>
      <GroundShadow />
      <path d="M34 58 C34 46 66 46 66 58 L63 104 C61 108 39 108 37 104 Z" fill={body} stroke={line} strokeWidth="2.4" strokeLinejoin="round" />
      {/* 5-point crown with pearl tips */}
      <rect x="30" y="55" width="40" height="5.5" rx="2.75" fill={crown} stroke={line} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M38 54 L35 41 L43 49 L50 39 L57 49 L65 41 L62 54 Z" fill={crown} stroke={line} strokeWidth="2" strokeLinejoin="round" />
      <circle cx="35" cy="39" r="3" fill={accent.light} stroke={line} strokeWidth="1.6" />
      <circle cx="50" cy="36.5" r="3.4" fill={accent.light} stroke={line} strokeWidth="1.6" />
      <circle cx="65" cy="39" r="3" fill={accent.light} stroke={line} strokeWidth="1.6" />
      <circle cx="50" cy="51.5" r="2.6" fill={accent.light} />
      <Gloss x="41" y="76" rx="7" ry="16" tone={tone === TONE.w ? 'w' : 'b'} />
      {/* warm face with lashes */}
      <Brow d="M35 66 Q41 63 47 66" line={line} />
      <Brow d="M53 66 Q59 63 65 66" line={line} />
      <Eye x="42" y="72" r="4.6" line={line} />
      <Eye x="58" y="72" r="4.6" line={line} />
      {[(-5), (-6), (-7)].map((d) => (
        <path key={`l${d}`} d={`M ${42 + d} ${76} l -1.6 1.4`} stroke={line} strokeWidth="1.6" strokeLinecap="round" />
      ))}
      {[5, 6, 7].map((d) => (
        <path key={`r${d}`} d={`M ${58 + d} ${76} l 1.6 1.4`} stroke={line} strokeWidth="1.6" strokeLinecap="round" />
      ))}
      <SmileOpen x="50" y="84" w="8" h="6" line={line} />
    </g>
  );
}

function BishopPiece({ tone, accent, id }) {
  const line = tone.line;
  const body = `url(#${id}-body)`;
  return (
    <g>
      <GroundShadow />
      <path d="M38 100 C38 80 38 62 41 55 L59 55 C62 62 62 80 62 100 Z" fill={body} stroke={line} strokeWidth="2.4" strokeLinejoin="round" />
      {/* mitre */}
      <path d="M35 56 L34 36 C34 22 66 22 66 36 L65 56 Z" fill={body} stroke={line} strokeWidth="2.4" strokeLinejoin="round" />
      <circle cx="50" cy="20" r="4.2" fill={accent.fill} stroke={line} strokeWidth="1.8" />
      <rect x="34" y="52" width="32" height="5" rx="2.5" fill={accent.fill} stroke={line} strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="37" y="96" width="26" height="6" rx="3" fill={accent.fill} stroke={line} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M50 32 L50 18" stroke={line} strokeWidth="1.8" strokeLinecap="round" />
      <Gloss x="42" y="70" rx="5" ry="14" tone={tone === TONE.w ? 'w' : 'b'} />
      {/* serene face */}
      <Brow d="M38 58 Q43 55 48 58" line={line} />
      <Brow d="M52 58 Q57 55 62 58" line={line} />
      <Eye x="42" y="63" r="4" lid="2.4" line={line} />
      <Eye x="58" y="63" r="4" lid="2.4" line={line} />
      <SmileClosed x="50" y="73" w="6.5" h="3" line={line} />
    </g>
  );
}

function KnightPiece({ tone, accent, id }) {
  const line = tone.line;
  const body = `url(#${id}-body)`;
  return (
    <g>
      <GroundShadow />
      {/* neck */}
      <path d="M42 104 C38 84 40 72 48 62 L52 74 C52 88 50 96 48 104 Z" fill={body} stroke={line} strokeWidth="2.4" strokeLinejoin="round" />
      {/* mane */}
      <path d="M46 46 C36 44 33 56 42 66" fill="none" stroke={accent.fill} strokeWidth="4" strokeLinecap="round" />
      <path d="M40 50 C32 56 32 66 40 74" fill="none" stroke={accent.fill} strokeWidth="3.4" strokeLinecap="round" />
      {/* head */}
      <ellipse cx="58" cy="58" rx="15" ry="13" fill={body} stroke={line} strokeWidth="2.4" />
      {/* muzzle */}
      <path d="M66 50 C66 50 78 50 81 55 C84 60 79 64 72 63 L66 63 Z" fill={body} stroke={line} strokeWidth="2.4" strokeLinejoin="round" />
      {/* ears */}
      <path d="M46 42 L43 25 L55 34 Z" fill={body} stroke={line} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M58 39 L56 23 L65 33 Z" fill={body} stroke={line} strokeWidth="2.2" strokeLinejoin="round" />
      {/* bridle accent */}
      <path d="M66 52 C71 49 76 50 79 53" fill="none" stroke={accent.fill} strokeWidth="2.6" strokeLinecap="round" />
      {/* mischievous face */}
      <Eye x="73" y="57" r="4.6" line={line} />
      <Eye x="53" y="57" r="3" line={line} />
      <Brow d="M67 50 Q72 47 78 51" line={line} />
      <circle cx="79.5" cy="58" r="1.4" fill={line} />
      <path d="M67 62 Q71 65 75 61" fill="none" stroke={line} strokeWidth="2" strokeLinecap="round" />
    </g>
  );
}

function RookPiece({ tone, accent, id }) {
  const line = tone.line;
  const body = `url(#${id}-body)`;
  return (
    <g>
      <GroundShadow />
      {/* tower */}
      <path d="M30 52 L70 52 C71 76 71 88 70 102 L30 102 C29 88 29 76 30 52 Z" fill={body} stroke={line} strokeWidth="2.4" strokeLinejoin="round" />
      {/* merlons */}
      <rect x="30" y="40" width="11" height="14" rx="2.5" fill={body} stroke={line} strokeWidth="2.2" />
      <rect x="45" y="40" width="11" height="14" rx="2.5" fill={body} stroke={line} strokeWidth="2.2" />
      <rect x="60" y="40" width="11" height="14" rx="2.5" fill={body} stroke={line} strokeWidth="2.2" />
      <rect x="28" y="52" width="44" height="5" rx="2.5" fill={accent.fill} stroke={line} strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="36" y="64" width="5" height="16" rx="2.5" fill={accent.fill} stroke={line} strokeWidth="1.2" />
      <rect x="48" y="64" width="5" height="16" rx="2.5" fill={accent.fill} stroke={line} strokeWidth="1.2" />
      <rect x="60" y="64" width="5" height="16" rx="2.5" fill={accent.fill} stroke={line} strokeWidth="1.2" />
      <Gloss x="37" y="72" rx="6" ry="14" tone={tone === TONE.w ? 'w' : 'b'} />
      {/* sturdy grumpy face */}
      <Brow d="M34 82 L44 80" line={line} />
      <Brow d="M56 80 L66 82" line={line} />
      <Eye x="40" y="87" r="4.4" line={line} />
      <Eye x="60" y="87" r="4.4" line={line} />
      <StraightMouth x="50" y="96" w="6" line={line} />
    </g>
  );
}

export const FACED_TYPES = {
  p: PawnPiece,
  n: KnightPiece,
  b: BishopPiece,
  r: RookPiece,
  q: QueenPiece,
  k: KingPiece,
};

/**
 * One glossy character piece.
 * @param type  'p' | 'n' | 'b' | 'r' | 'q' | 'k'
 * @param side  'w' | 'b'
 * @param size  rendered width/height in px (fits inside a square)
 */
export function FacedPiece({ type, side, size }) {
  const raw = useId();
  const uid = `${raw.replace(/[^a-zA-Z0-9]/g, '')}${side}${type}`;
  const tone = TONE[side] || TONE.w;
  const accent = ACCENT[type] || ACCENT.p;
  const Piece = FACED_TYPES[type] || PawnPiece;
  const bodyGradId = `${uid}-body`;
  const accentGradId = `${uid}-accent`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 128"
      preserveAspectRatio="xMidYMax meet"
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      <defs>
        <Gradient id={bodyGradId} top={tone.top} bottom={tone.bottom} />
        <Gradient id={accentGradId} top={accent.light} bottom={accent.dark} />
      </defs>
      <Base tone={tone} />
      <Piece tone={tone} accent={accent} id={uid} />
    </svg>
  );
}