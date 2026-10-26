import React from 'react';
import { Head, Bell, OUTLINE, STROKE } from '../shared';

// KNIGHT — horse ears + forelock mane on the doll head
export default function KnightBase({ color }) {
  return (
    <g>
      <Bell color={color} />
      <Head />
      {/* horse ears */}
      <path d="M72 46 L84 19 L98 50 Z" fill={color} stroke={OUTLINE} strokeWidth={STROKE} strokeLinejoin="round" />
      <path d="M128 46 L116 19 L102 50 Z" fill={color} stroke={OUTLINE} strokeWidth={STROKE} strokeLinejoin="round" />
      <path d="M77 41 L84 28 L90 44 Z" fill="#ffb1b8" />
      <path d="M123 41 L116 28 L110 44 Z" fill="#ffb1b8" />
      {/* forelock mane */}
      <path
        d="M90 28 Q98 20 106 28 Q102 24 98 28 Q94 24 90 28"
        fill="none"
        stroke={OUTLINE}
        strokeWidth={3}
        strokeLinecap="round"
      />
    </g>
  );
}