import React from 'react';
import { Head, Bell, OUTLINE, STROKE } from '../shared';

// BISHOP — mitre on the doll head
export default function BishopBase({ color }) {
  return (
    <g>
      <Bell color={color} />
      <Head />
      {/* mitre */}
      <g fill="#fff4e0" stroke={OUTLINE} strokeWidth={STROKE} strokeLinejoin="round">
        <path d="M70 44 L58 16 L86 32 L100 12 L114 32 L142 16 L130 44 Z" />
        <rect x={70} y={38} width={60} height={8} rx={2} />
      </g>
      <rect x={96.5} y={22} width={7} height={16} rx={1} fill="#c9a227" stroke={OUTLINE} strokeWidth={2.5} />
      <rect x={90} y={28} width={20} height={5} rx={1} fill="#c9a227" stroke={OUTLINE} strokeWidth={2.5} />
    </g>
  );
}