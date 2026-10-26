import { OUTLINE } from '../shared';

export default function ScarfAccessory() {
  return (
    <g>
      {/* scarf wrapped around the neck */}
      <path
        d="M60 128 Q100 158 140 128 L140 142 Q100 172 60 142 Z"
        fill="#e74c3c"
        stroke={OUTLINE}
        strokeWidth={5}
        strokeLinejoin="round"
      />
      {/* hanging end */}
      <path
        d="M132 140 L132 158 L114 156 L116 140 Z"
        fill="#e74c3c"
        stroke={OUTLINE}
        strokeWidth={4}
        strokeLinejoin="round"
      />
      {/* stripes on hanging end */}
      <path d="M117 146 L131 147 L131 152 L118 151 Z" fill="#f1c40f" />
    </g>
  );
}