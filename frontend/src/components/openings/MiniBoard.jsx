import { Card } from '../ui';

const GLYPHS = {
  k: { w: '♔', b: '♚' },
  q: { w: '♕', b: '♛' },
  r: { w: '♖', b: '♜' },
  b: { w: '♗', b: '♝' },
  n: { w: '♘', b: '♞' },
  p: { w: '♙', b: '♟' },
};

/* Tiny FEN → grid preview, no images needed. */
export default function MiniBoard({ fen, orientation = 'white', size = 220 }) {
  const boardStr = (String(fen || '').split(' ')[0] || '').trim();
  const ranks = boardStr ? boardStr.split('/') : [];

  const sq = size / 8;
  const cells = [];
  for (let rank = 0; rank < 8; rank += 1) {
    const fenRank = ranks[rank] || '';
    let file = 0;
    for (const ch of fenRank) {
      if (ch >= '1' && ch <= '8') {
        file += Number(ch);
      } else {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        cells.push({ file, rank, glyph: GLYPHS[ch.toLowerCase()]?.[color] || '', color });
        file += 1;
      }
    }
  }

  const grid = [];
  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const piece = cells.find((c) => c.file === file && c.rank === rank);
      const col = orientation === 'white' ? file : 7 - file;
      const row = orientation === 'white' ? 7 - rank : rank;
      const isLight = (file + rank) % 2 === 0;
      grid.push(
        <span
          key={`${rank}-${file}`}
          className="absolute flex items-center justify-center select-none"
          style={{
            left: col * sq,
            top: row * sq,
            width: sq,
            height: sq,
            background: isLight ? '#efe2cb' : '#b58863',
            fontSize: sq * 0.62,
            color: piece?.color === 'w' ? '#f0f9ff' : '#282018',
            textShadow:
              piece?.color === 'w'
                ? '0 0 3px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,0.9), 1px 0 1px rgba(0,0,0,0.8), -1px 0 1px rgba(0,0,0,0.8), 0 -1px 1px rgba(0,0,0,0.8)'
                : '0 0 2px rgba(255,255,255,0.35)',
            lineHeight: 1,
          }}
        >
          {piece?.glyph || ''}
        </span>
      );
    }
  }

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-white/10 shadow-lg"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {grid}
    </div>
  );
}

export function MiniBoardCard({ fen, orientation = 'white', size = 220, children }) {
  return (
    <Card className="bg-white/[0.02]" piece="♘">
      <div className="flex flex-col items-center gap-3">
        <MiniBoard fen={fen} orientation={orientation} size={size} />
        {children}
      </div>
    </Card>
  );
}