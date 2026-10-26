import React from 'react';
import { Head, Bell, OUTLINE, STROKE } from '../shared';

// ROOK — crenellation tower band on the doll head
export default function RookBase({ color }) {
  return (
    <g>
      <Bell color={color} />
      <Head />
      {/* crenellations */}
      <g fill="#c9b8a2" stroke={OUTLINE} strokeWidth={STROKE} strokeLinejoin="round">
        <rect x={72} y={40} width={56} height={15} rx={3} />
        <path d="M76 40 L76 24 L88 24 L88 40 Z" />
        <path d="M94 40 L94 24 L106 24 L106 40 Z" />
        <path d="M112 40 L112 24 L124 24 L124 40 Z" />
      </g>
    </g>
  );
}