import React from 'react';
import { Head, Bell, OUTLINE, STROKE } from '../shared';

// QUEEN — pointed ball crown on the doll head
export default function QueenBase({ color }) {
  return (
    <g>
      <Bell color={color} />
      <Head />
      {/* pointed ball crown */}
      <g fill="#f6c453" stroke={OUTLINE} strokeWidth={STROKE} strokeLinejoin="round">
        <rect x={70} y={36} width={60} height={9} rx={2} />
        <path d="M74 36 L80 22 L88 38 Z" />
        <path d="M126 36 L120 22 L112 38 Z" />
        <path d="M92 36 L100 15 L108 36 Z" />
      </g>
      <circle cx={80} cy={19} r={4.5} fill="#ffd37a" stroke={OUTLINE} strokeWidth={3} />
      <circle cx={100} cy={12} r={5} fill="#ffd37a" stroke={OUTLINE} strokeWidth={3} />
      <circle cx={120} cy={19} r={4.5} fill="#ffd37a" stroke={OUTLINE} strokeWidth={3} />
    </g>
  );
}