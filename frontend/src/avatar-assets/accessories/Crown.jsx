import { OUTLINE } from '../shared';

export default function CrownAccessory() {
  return (
    <g>
      {/* royal crown on ANY piece */}
      <path
        d="M62 52 L62 30 L78 44 L100 26 L122 44 L138 30 L138 52 Z"
        fill="#f1c40f"
        stroke={OUTLINE}
        strokeWidth={5}
        strokeLinejoin="round"
      />
      <path d="M62 52 L138 52" stroke={OUTLINE} strokeWidth={5} strokeLinecap="round" />
      {/* gemstones */}
      <circle cx={78} cy={46} r={4} fill="#e74c3c" stroke={OUTLINE} strokeWidth={2.5} />
      <circle cx={100} cy={52} r={4.5} fill="#4a90d9" stroke={OUTLINE} strokeWidth={2.5} />
      <circle cx={122} cy={46} r={4} fill="#e74c3c" stroke={OUTLINE} strokeWidth={2.5} />
    </g>
  );
}