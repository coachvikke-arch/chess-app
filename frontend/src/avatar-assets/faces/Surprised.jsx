import { EYE_L, EYE_R, EYE_CY, MOUTH_CY, FEATURE, FEATURE_STROKE as W } from '../shared';

export default function SurprisedFace() {
  return (
    <g>
      <ellipse cx={EYE_L} cy={EYE_CY} rx={7} ry={10} fill={FEATURE} />
      <ellipse cx={EYE_R} cy={EYE_CY} rx={7} ry={10} fill={FEATURE} />
      {/* little 'o' mouth */}
      <ellipse cx={100} cy={MOUTH_CY} rx={7} ry={9} fill={FEATURE} />
    </g>
  );
}