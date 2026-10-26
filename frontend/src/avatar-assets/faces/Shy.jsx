import { EYE_L, EYE_R, EYE_CY, MOUTH_CY, FEATURE, FEATURE_STROKE as W } from '../shared';

export default function ShyFace() {
  return (
    <g>
      <circle cx={EYE_L} cy={EYE_CY} r={5} fill={FEATURE} />
      <circle cx={EYE_R} cy={EYE_CY} r={5} fill={FEATURE} />
      {/* blush cheeks */}
      <ellipse cx={EYE_L - 2} cy={EYE_CY + 15} rx={9} ry={5} fill="#ff9d9d" opacity={0.85} />
      <ellipse cx={EYE_R + 2} cy={EYE_CY + 15} rx={9} ry={5} fill="#ff9d9d" opacity={0.85} />
      {/* small bashful smile */}
      <path
        d={`M92 ${MOUTH_CY + 4} Q100 ${MOUTH_CY + 8} 108 ${MOUTH_CY + 4}`}
        fill="none"
        stroke={FEATURE}
        strokeWidth={W}
        strokeLinecap="round"
      />
    </g>
  );
}