import { EYE_L, EYE_R, EYE_CY, MOUTH_CY, FEATURE, FEATURE_STROKE as W } from '../shared';

export default function CoolFace() {
  return (
    <g>
      {/* sunglasses */}
      <rect x={EYE_L - 16} y={EYE_CY - 9} width={26} height={18} rx={6} fill={FEATURE} />
      <rect x={EYE_R - 10} y={EYE_CY - 9} width={26} height={18} rx={6} fill={FEATURE} />
      <path d={`M${EYE_L + 10} ${EYE_CY - 3} L${EYE_R - 10} ${EYE_CY - 3}`} stroke={FEATURE} strokeWidth={4} />
      {/* smirk */}
      <path
        d={`M${EYE_R - 18} ${MOUTH_CY + 4} Q112 ${MOUTH_CY + 12} 96 ${MOUTH_CY}`}
        fill="none"
        stroke={FEATURE}
        strokeWidth={W}
        strokeLinecap="round"
      />
    </g>
  );
}