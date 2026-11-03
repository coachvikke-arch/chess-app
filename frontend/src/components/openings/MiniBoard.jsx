import { Card } from '../ui';
import StaticBoard from '../StaticBoard';

/* Opening-library preview. It used to draw its own beige/brown squares with
   Unicode glyphs, which made the library the only board surface that ignored
   the user's chosen board and piece themes. It is now the shared preview, so it
   follows the Board Frame setting exactly like a puzzle card does and keeps the
   same outer box whether the frame is on or off. */
export default function MiniBoard({ fen, orientation = 'white', size = 220 }) {
  return (
    <div style={{ width: size }} aria-hidden="true">
      <StaticBoard fen={fen} width={size} orientation={orientation} />
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
