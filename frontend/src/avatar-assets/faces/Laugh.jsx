import { EYE_L, EYE_R, EYE_CY, MOUTH_CY, FEATURE, FEATURE_STROKE as W } from '../shared';

export default function LaughFace() {
  return (
    <g>
      <path d={`M${EYE_L - 8} 80 Q${EYE_L} 88 ${EYE_L + 8} 80`} fill="none" stroke={FEATURE} strokeWidth={W} strokeLinecap="round" />
      <path d={`M${EYE_R - 8} 80 Q${EYE_R} 88 ${EYE_R + 8} 80`} fill="none" stroke={FEATURE} strokeWidth={W} strokeLinecap="round" />
      {/* open laughing mouth */}
      <path
        d={`M${EYE_L} ${MOUTH_CY} Q100 ${MOUTH_CY + 18} ${EYE_R} ${MOUTH_CY} Z`}
        fill={FEATURE}
        stroke={FEATURE}
        strokeWidth={W}
        strokeLinejoin="round"
      />
    </g>
  );
}