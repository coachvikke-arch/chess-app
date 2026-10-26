import { OUTLINE, STROKE } from '../shared';

export default function PartyHatAccessory() {
  return (
    <g>
      {/* cone */}
      <path
        d="M100 10 L138 54 L62 54 Z"
        fill="#e74c3c"
        stroke={OUTLINE}
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      {/* stripes */}
      <path d="M68 46 L132 46 L136 54 L64 54 Z" fill="#f1c40f" stroke={OUTLINE} strokeWidth={3} strokeLinejoin="round" />
      <path d="M84 27 Q100 34 116 27" fill="none" stroke="#f1c40f" strokeWidth={8} />
      {/* pompom */}
      <circle cx={100} cy={9} r={8} fill="#f1c40f" stroke={OUTLINE} strokeWidth={STROKE} />
    </g>
  );
}