import { OUTLINE } from '../shared';

export default function PropellerAccessory() {
  return (
    <g>
      {/* stick */}
      <rect x={95} y={26} width={10} height={18} rx={3} fill="#8a5a2b" stroke={OUTLINE} strokeWidth={3} />
      <circle cx={100} cy={22} r={7} fill="#e74c3c" stroke={OUTLINE} strokeWidth={3.5} />
      {/* spinning arms */}
      <ellipse cx={100} cy={22} rx={34} ry={7} fill="#4a90d9" stroke={OUTLINE} strokeWidth={3.5} transform="rotate(18 100 22)" />
      <path d="M150 22 l8 -6 l-8 6 l8 6 Z" fill="#ffffff" opacity={0.85} />
      <path d="M50 22 l-8 -6 l8 6 l-8 6 Z" fill="#ffffff" opacity={0.85} />
    </g>
  );
}