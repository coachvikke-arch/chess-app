import { EYE_L, EYE_R, EYE_CY, MOUTH_CY, FEATURE, FEATURE_STROKE as W } from '../shared';

export default function HappyFace() {
  return (
    <g>
      <circle cx={EYE_L} cy={EYE_CY} r={7.5} fill={FEATURE} />
      <circle cx={EYE_R} cy={EYE_CY} r={7.5} fill={FEATURE} />
      <path
        d={`M${EYE_L} ${MOUTH_CY} Q100 ${MOUTH_CY + 14} ${EYE_R} ${MOUTH_CY}`}
        fill="none"
        stroke={FEATURE}
        strokeWidth={W}
        strokeLinecap="round"
      />
    </g>
  );
}