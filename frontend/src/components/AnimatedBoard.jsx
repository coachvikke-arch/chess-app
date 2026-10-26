import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { CBURNETT_SVGS } from './cburnettPieces';
import useBoardWidth from '../hooks/useBoardWidth';

const PGN = `[Event "Mikhail Tal's Greatest Queen Sacrifice! Best Chess Games | Moves, Strategy, Tricks & Ideas to Win: Chapter 1"]
[Date "2020.12.13"]
[Result "*"]
[Variant "Standard"]
[ECO "B99"]
[Opening "Sicilian Defense: Najdorf Variation, Main Line"]
[StudyName "Mikhail Tal's Greatest Queen Sacrifice! Best Chess Games | Moves, Strategy, Tricks & Ideas to Win"]
[ChapterName "Chapter 1"]
[ChapterURL "https://lichess.org/study/CZ7ihReY/KPlYk0tb"]
[Annotator "https://lichess.org/@/upadhyayinnat"]
[UTCDate "2020.12.13"]
[UTCTime "10:45:17"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Bg5 e6 7. f4 Be7 8. Qf3 Qc7 9. O-O-O Nbd7 10. Be2 h6 11. Bh4 b5 12. e5 Bb7 13. exf6 Bxf3 14. Bxf3 d5 15. Nxe6 fxe6 16. Bh5+ g6 17. Bxg6+ Kf8 18. fxe7+ Kg7 19. Bg3 Nf6 20. Rhe1 b4 21. Rxe6 bxc3 22. f5 Qb7 23. b3 Qd7 24. Be5 Qxe6 25. fxe6 Kxg6 26. Rf1 Nh7 27. Bxh8 Rxh8 28. Rf8 Rxf8 29. exf8=Q Nxf8 30. e7 Kf7 31. exf8=Q+ Kxf8 32. Kd1 Ke7 33. Ke2 Kd6 34. Kd3 Kc5 35. Kxc3 *`;

const initialBoard = (() => {
  const g = new Chess();
  return g.board();
})();

const sqRC = (sq) => ({ row: 8 - Number(sq[1]), col: sq.charCodeAt(0) - 97 });

const pieceCode = (piece) => `${piece.color}${piece.type.toUpperCase()}`;

/** Renders a Cburnett SVG piece (same vector set react-chessboard uses).
    Sits inside a cell; `className` may add the glide animation. */
function CburntPiece({ code, className }) {
  return (
    <span
      className={`hero-piece ${code[0] === 'w' ? 'w' : 'b'} hero-piece-svg ${className || ''}`}
      style={{ width: '100%', height: '100%' }}
    >
      {/* nested svg mirrors react-chessboard's built-in rendering (viewBox 1 1 43 43) */}
      <svg
        className="cb-svg"
        viewBox="1 1 43 43"
        preserveAspectRatio="xMidYMid meet"
        dangerouslySetInnerHTML={{ __html: CBURNETT_SVGS[code] }}
      />
    </span>
  );
}

/** Replays Tal's queen-sacrifice game on the hero board, one move at a time.
    The moved piece glides from its origin to its target square while the rest
    of the position stays glued to its cells; loops forever. With `fixed` the
    board container stops tilting and the scan sweep is hidden (used on Login). */
export default function AnimatedBoard({ size = 340, fixed = false }) {
  const boardW = useBoardWidth(size, 24);
  const moves = useMemo(() => {
    try {
      const g = new Chess();
      g.loadPgn(PGN);
      return g.history();
    } catch {
      return [];
    }
  }, []);

  const [pos, setPos] = useState(initialBoard);
  const [mv, setMv] = useState(null); // { from, to, step } of the last move
  const [hovered, setHovered] = useState(null);
  const stepRef = useRef(0);

  useEffect(() => {
    if (moves.length === 0) return undefined;
    const id = setInterval(() => {
      const s = stepRef.current;
      if (s >= moves.length) {
        stepRef.current = 0;
        setPos(initialBoard);
        setMv(null);
        return;
      }
      const g = new Chess();
      for (let i = 0; i <= s; i += 1) g.move(moves[i]);
      const last = g.history({ verbose: true })[s];
      setPos(g.board());
      setMv({ from: last.from, to: last.to, step: s });
      stepRef.current = s + 1;
    }, 1300);
    return () => clearInterval(id);
  }, [moves.length]);

  const from = mv ? sqRC(mv.from) : null;
  const to = mv ? sqRC(mv.to) : null;

  return (
    <div className="hero-board-scene">
      <div className={`hero-board ${fixed ? 'hero-board-fixed' : ''}`} style={{ width: boardW }}>
        <div className="hero-board-grid">
          {pos.flatMap((row, r) =>
            row.map((piece, c) => {
              const idx = r * 8 + c;
              const dark = (r + c) % 2 === 1;
              const isFrom = from && from.row === r && from.col === c;
              const isTo = to && to.row === r && to.col === c;
              return (
                <div
                  key={idx}
                  className={`hero-cell ${dark ? 'dark' : 'light'} ${isFrom ? 'hero-last-from' : ''} ${
                    isTo ? 'hero-last-to' : ''
                  }`}
                  onMouseEnter={() => setHovered(idx)}
                  onMouseLeave={() => setHovered(null)}
                >
                  {isTo && piece ? (
                    <CburntPiece
                      key={`mv-${mv.step}`}
                      code={pieceCode(piece)}
                      className="hero-move-piece"
                    />
                  ) : piece ? (
                    <CburntPiece code={pieceCode(piece)} />
                  ) : null}
                  {hovered === idx && <span className="hero-glow-ring" />}
                </div>
              );
            }),
          )}
        </div>

        {!fixed && <div className="hero-scan" />}
      </div>
    </div>
  );
}