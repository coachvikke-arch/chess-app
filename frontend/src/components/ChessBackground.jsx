import { useMemo } from 'react';

const GLYPHS = ['♔', '♕', '♖', '♗', '♘', '♙', '♚', '♛', '♜', '♝', '♞', '♟'];

export default function ChessBackground() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 20 }).map((_, i) => ({
        g: GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
        left: Math.random() * 96 + 2,
        delay: Math.random() * 26,
        dur: 30 + Math.random() * 30,
        size: 26 + Math.random() * 52,
        opacity: 0.12 + Math.random() * 0.16,
        drift: Math.random() > 0.5 ? 1 : -1,
      })),
    []
  );

  return (
    <div className="chess-bg" aria-hidden="true">
      <div className="chess-bg-grid" />
      {pieces.map((p, i) => (
        <span
          key={i}
          className="chess-bg-piece"
          style={{
            left: `${p.left}%`,
            fontSize: `${p.size}px`,
            opacity: p.opacity,
            animationDuration: `${p.dur}s`,
            animationDelay: `-${p.delay}s`,
            '--drift': p.drift,
          }}
        >
          {p.g}
        </span>
      ))}
      <div className="chess-bg-vignette" />
    </div>
  );
}