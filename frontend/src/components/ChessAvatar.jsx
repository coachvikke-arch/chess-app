import { useMemo } from 'react';
import Background from '../avatar-assets/backgrounds/Background';
import {
  PIECE_MAP,
  FACE_MAP,
  ACCESSORY_MAP,
  DEFAULT_CONFIG,
  defaultChessConfig,
} from '../avatar-assets';
import { SVG_VIEWBOX } from '../avatar-assets/shared';

/**
 * ChessAvatar — stacks the layered chess-piece SVG assets:
 *   background → base piece (colored) → face → accessory
 *
 *   config  — { basePiece, bodyColor, face, accessory, background }
 *   seed    — falls back to a deterministic default when config is missing
 *   size    — rendered dimensions
 */
export default function ChessAvatar({ config, seed, size = 64, className = '', rounded = true }) {
  const layers = useMemo(() => {
    const c = config && config.basePiece ? config : defaultChessConfig(seed);
    const piece = PIECE_MAP[c.basePiece] || PIECE_MAP.pawn;
    const face = FACE_MAP[c.face] || FACE_MAP.happy;
    const accessory = ACCESSORY_MAP[c.accessory] || ACCESSORY_MAP.none;
    return {
      bg: c.background || DEFAULT_CONFIG.background,
      bodyColor: c.bodyColor || DEFAULT_CONFIG.bodyColor,
      piece: piece.Comp,
      face: face.Comp,
      accessory: accessory.Comp,
      accessoryOn: c.accessory && c.accessory !== 'none',
    };
  }, [config, seed]);

  const cls = `${rounded ? 'rounded-full' : ''} ${className}`.trim();

  return (
    <svg
      viewBox={SVG_VIEWBOX}
      width={size}
      height={size}
      className={cls}
      style={{ width: size, height: size, display: 'block' }}
      role="img"
      aria-label="Avatar"
    >
      <Background color={layers.bg} />
      <layers.piece color={layers.bodyColor} />
      <layers.face />
      {layers.accessoryOn && <layers.accessory />}
    </svg>
  );
}