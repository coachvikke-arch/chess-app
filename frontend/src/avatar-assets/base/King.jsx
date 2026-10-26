import React from 'react';
import { Head, Bell, OUTLINE, STROKE } from '../shared';

// KING — cross crown on the doll head
export default function KingBase({ color }) {
  return (
    <g>
      <Bell color={color} />
      <Head />
      {/* cross crown */}
      <g fill="#f6c453" stroke={OUTLINE} strokeWidth={STROKE} strokeLinejoin="round">
        <rect x={60} y={34} width={80} height={9} rx={2} />
        <path d="M64 34 L70 20 L80 34 Z" />
        <path d="M136 34 L130 20 L120 34 Z" />
        <path d="M92 34 L100 13 L108 34 Z" />
      </g>
      <g fill="#f6c453" stroke={OUTLINE} strokeWidth={STROKE} strokeLinejoin="round">
        <rect x={97} y={3} width={6} height={11} rx={1} />
        <rect x={92} y={7} width={16} height={4} rx={1} />
      </g>
    </g>
  );
}