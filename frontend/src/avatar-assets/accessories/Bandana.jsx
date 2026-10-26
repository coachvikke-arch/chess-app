import { OUTLINE } from '../shared';

export default function BandanaAccessory() {
  return (
    <g>
      {/* band across the forehead */}
      <path
        d="M50 52 Q100 70 150 52 L152 66 Q100 86 48 66 Z"
        fill="#2e8b57"
        stroke={OUTLINE}
        strokeWidth={4}
        strokeLinejoin="round"
      />
      {/* knot + tails at the side */}
      <circle cx={132} cy={54} r={6} fill="#2e8b57" stroke={OUTLINE} strokeWidth={3.5} />
      <path d="M134 52 L150 44 L146 58 Z" fill="#2e8b57" stroke={OUTLINE} strokeWidth={3.5} strokeLinejoin="round" />
      <path d="M136 58 L148 66 L144 76 Z" fill="#2e8b57" stroke={OUTLINE} strokeWidth={3.5} strokeLinejoin="round" />
    </g>
  );
}