import React from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// SHARED SVG GEOMETRY + STYLE CONSTANTS — doll-style chess avatars
//
// All layers share viewBox 0 0 200 200.
//   Head circle .... cx 100, cy 82, r 56 (cream doll face)
//   Bell body ...... x 66–134, y 128–187 (identical on all six pieces)
//   Face anchor .... eyes EYE_L/EYE_R · EYE_CY, mouth MOUTH_CY
//
// STYLE RULES (keep these fixed so future additions match):
//  1. Flat cartoon fills, single outline weight (STROKE, #3d2c1e).
//  2. Big round eyes + small mouth on the shared anchor — the main feature.
//  3. Piece type = crown/crest sitting on the doll head: King cross crown,
//     Queen pointed ball crown, Bishop mitre, Rook crenellations, Pawn knob;
//     Knight carries horse ears + forelock mane.
// ─────────────────────────────────────────────────────────────────────────────

export const SVG_VIEWBOX = '0 0 200 200';

// Line weight + palette kept constant across ALL layers.
export const OUTLINE = '#3d2c1e';
export const STROKE = 5;
export const FEATURE_STROKE = 4.5;

export const SKIN = '#ffd5a8'; // doll head cream
export const FEATURE = OUTLINE; // eyes + mouth ink

// Face anatomy anchors shared by every piece — keep expressions aligned here.
export const EYE_L = 78;
export const EYE_R = 122;
export const EYE_CY = 82;
export const MOUTH_CY = 100;

/** Bell-shaped body under the head — identical base for all six pieces. */
export function Bell({ color }) {
  return (
    <path
      d="M66 150 C66 128 134 128 134 150 L134 176 C134 187 66 187 66 176 Z"
      fill={color}
      stroke={OUTLINE}
      strokeWidth={STROKE}
      strokeLinejoin="round"
    />
  );
}

/** Cream doll head used by every piece. */
export function Head() {
  return (
    <circle cx={100} cy={82} r={56} fill={SKIN} stroke={OUTLINE} strokeWidth={STROKE} />
  );
}