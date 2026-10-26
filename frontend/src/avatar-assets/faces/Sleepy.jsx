import { EYE_L, EYE_R, EYE_CY, MOUTH_CY, FEATURE, FEATURE_STROKE as W } from '../shared';

export default function SleepyFace() {
  return (
    <g>
      <path d={`M${EYE_L - 10} ${EYE_CY} Q${EYE_L} ${EYE_CY + 7} ${EYE_L + 10} ${EYE_CY}`} fill="none" stroke={FEATURE} strokeWidth={W} strokeLinecap="round" />
      <path d={`M${EYE_R - 10} ${EYE_CY} Q${EYE_R} ${EYE_CY + 7} ${EYE_R + 10} ${EYE_CY}`} fill="none" stroke={FEATURE} strokeWidth={W} strokeLinecap="round" />
      <ellipse cx={100} cy={MOUTH_CY} rx={5} ry={6} fill={FEATURE} />
      {/* zzz */}
      <text x={140} y={66} fontSize={15} fontWeight={700} fill={FEATURE} fontFamily="inherit">z</text>
      <text x={150} y={54} fontSize={11} fontWeight={700} fill={FEATURE} fontFamily="inherit">z</text>
    </g>
  );
}