import React from 'react';
import { Head, Bell, OUTLINE, STROKE } from '../shared';

// PAWN — round knob on the doll head
export default function PawnBase({ color }) {
  return (
    <g>
      <Bell color={color} />
      <Head />
      {/* knob */}
      <circle cx={100} cy={16} r={12} fill={color} stroke={OUTLINE} strokeWidth={STROKE} />
    </g>
  );
}