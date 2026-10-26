import { OUTLINE } from '../shared';

export default function HeadphonesAccessory() {
  return (
    <g>
      {/* band */}
      <path
        d="M50 78 A 60 34 0 0 1 150 78"
        fill="none"
        stroke="#2b2b2b"
        strokeWidth={11}
        strokeLinecap="round"
      />
      <path
        d="M50 78 A 60 34 0 0 1 150 78"
        fill="none"
        stroke="#e8e3d0"
        strokeWidth={4}
        strokeLinecap="round"
      />
      {/* ear cups */}
      <rect x={42} y={70} width={15} height={30} rx={7} fill="#e74c3c" stroke={OUTLINE} strokeWidth={4} />
      <rect x={143} y={70} width={15} height={30} rx={7} fill="#e74c3c" stroke={OUTLINE} strokeWidth={4} />
    </g>
  );
}