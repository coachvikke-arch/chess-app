import { EYE_L, EYE_R, EYE_CY, MOUTH_CY, FEATURE, FEATURE_STROKE as W, OUTLINE } from '../shared';

export default function DeterminedFace() {
  // thick angled brows + straight focused mouth + tiny headband line
  return (
    <g>
      <path d={`M${EYE_L - 9} ${EYE_CY - 13} L${EYE_L + 9} ${EYE_CY - 6}`} stroke={FEATURE} strokeWidth={W} strokeLinecap="round" />
      <path d={`M${EYE_R + 9} ${EYE_CY - 13} L${EYE_R - 9} ${EYE_CY - 6}`} stroke={FEATURE} strokeWidth={W} strokeLinecap="round" />
      <circle cx={EYE_L} cy={EYE_CY} r={6} fill={FEATURE} />
      <circle cx={EYE_R} cy={EYE_CY} r={6} fill={FEATURE} />
      <path d={`M${EYE_L} ${MOUTH_CY} L${EYE_R} ${MOUTH_CY}`} stroke={FEATURE} strokeWidth={W} strokeLinecap="round" />
      {/* face shading hint */}
      <path d="M132 96 q6 4 0 8" stroke={OUTLINE} strokeWidth={2.5} strokeLinecap="round" opacity={0.4} />
    </g>
  );
}