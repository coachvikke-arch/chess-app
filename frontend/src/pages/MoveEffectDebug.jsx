/* ── MoveEffect debug screen ────────────────────────────────────────────────
 *
 * A dev-only page for tuning the "sigma move" overlay without having to reach a
 * brilliant move, a mate or a promotion in a real game:
 *
 *   - one button per event type, plus the brilliant-only sacrifice badge
 *   - a scrubber over the master timeline (paused seek, so every frame is
 *     inspectable) and a 0.25x slow-motion replay
 *   - orientation and reduced-motion switches
 *
 * The board is a lightweight static grid so the page stays independent of the
 * full ChessBoard; the overlay is mounted exactly as ChessBoard mounts it, in
 * the square area of a `.chess-board-frame` (inset 0), with the board's own
 * pieces hidden while the effect owns them.
 *
 * Route: /dev/move-effect — not linked from the app navigation.
 */

import { useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { CBURNETT_SVGS } from '../components/cburnettPieces';
import MoveEffect from '../effects/moveEffect/MoveEffect';
import { T } from '../effects/moveEffect';
import usePageTitle from '../hooks/usePageTitle';

const FILES = 'abcdefgh';
const SQ = 8;

/* Post-move positions: the overlay renders the position AFTER the move, so the
 * mover sits on `to` and the captured piece is recreated from `captured`. */
const SCENARIOS = {
  brilliant: {
    label: 'Brilliant',
    fen: 'r1bqk2r/pppp1ppp/2n2Q2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 5',
    from: 'f3',
    to: 'f6',
    piece: 'q',
    color: 'w',
    captured: { square: 'f6', code: 'bn' },
  },
  checkmate: {
    label: 'Checkmate',
    fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3',
    from: 'd8',
    to: 'h4',
    piece: 'q',
    color: 'b',
    kingSquare: 'e1',
  },
  promotion: {
    label: 'Promotion',
    fen: 'Q7/8/8/8/8/8/8/4K2k b - - 0 1',
    from: 'a7',
    to: 'a8',
    piece: 'p',
    color: 'w',
    promotionPiece: 'q',
  },
};

const LIGHT = '#f0d9b5';
const DARK = '#b58863';

function PieceGlyph({ code }) {
  const svg = CBURNETT_SVGS[code];
  if (!svg) return null;
  return (
    <svg
      viewBox="1 1 43 43"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default function MoveEffectDebug() {
  usePageTitle('Move Effect Debug');
  const [type, setType] = useState('brilliant');
  const [sacrifice, setSacrifice] = useState(true);
  const [orientation, setOrientation] = useState('white');
  const [reduced, setReduced] = useState(false);
  const [rate, setRate] = useState(1);
  const [mode, setMode] = useState('play'); // 'play' | 'scrub'
  const [time, setTime] = useState(0);
  const [phase, setPhase] = useState(-1);
  const [runKey, setRunKey] = useState(0);

  const boardWidth = 384;
  const scenario = SCENARIOS[type];

  const { pieces, pieceMap, effect } = useMemo(() => {
    let game;
    try {
      game = new Chess(scenario.fen);
    } catch {
      game = new Chess();
    }
    const list = [];
    const map = {};
    for (const row of game.board()) {
      for (const cell of row) {
        if (!cell) continue;
        const code = `${cell.color}${cell.type.toUpperCase()}`;
        list.push({ square: cell.square, code });
        map[cell.square] = code;
      }
    }
    return {
      pieces: list,
      pieceMap: map,
      effect: {
        id: runKey,
        type,
        from: scenario.from,
        to: scenario.to,
        piece: scenario.piece,
        color: scenario.color,
        promotionPiece: scenario.promotionPiece || null,
        sacrifice: type === 'brilliant' ? sacrifice : false,
        captured: scenario.captured || null,
        kingSquare: scenario.kingSquare || null,
        pieces: list,
        orientation,
      },
    };
  }, [scenario, type, sacrifice, orientation, runKey]);

  /* Mirrors ChessBoard: the real pieces step aside only until the ripple has
     swept the board (phase 2), then the board takes over again. */
  const hidePieces = phase >= 0 && phase < 2;

  function play() {
    setMode('play');
    setPhase(-1);
    setTime(0);
    setRunKey((k) => k + 1);
  }

  function scrubTo(ms) {
    setMode('scrub');
    setTime(ms);
  }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '24px 16px 64px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>MoveEffect debug</h1>
      <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 18 }}>
        Master timeline {T.end} ms · landing {T.landing} ms · settle {T.settle} ms
      </p>

      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div className="chess-board-frame" style={{ padding: 12, display: 'inline-block', width: 'fit-content' }}>
          <div style={{ position: 'relative', width: boardWidth, height: boardWidth }}>
            {/* static board */}
            <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)' }}>
              {Array.from({ length: 64 }, (_, i) => {
                const row = Math.floor(i / SQ);
                const col = i % SQ;
                const file = orientation === 'white' ? col : 7 - col;
                const rank = orientation === 'white' ? 7 - row : row;
                const square = FILES[file] + (rank + 1);
                const code = pieceMap[square];
                return (
                  <div
                    key={square}
                    style={{
                      position: 'relative',
                      background: (file + rank) % 2 === 0 ? DARK : LIGHT,
                    }}
                  >
                    {code && (
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          /* hide the glyph only — the square must stay painted */
                          visibility: hidePieces ? 'hidden' : 'visible',
                        }}
                      >
                        <PieceGlyph code={code} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <MoveEffect
              key={`${type}-${runKey}`}
              effect={effect}
              boardWidth={boardWidth}
              orientation={orientation}
              inset={0}
              reduced={reduced}
              rate={rate}
              seekMs={mode === 'scrub' ? time : null}
              onTime={setTime}
              onPhase={setPhase}
            />
          </div>
        </div>

        <div style={{ flex: '1 1 280px', minWidth: 260, display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(SCENARIOS).map(([id, s]) => (
              <button
                key={id}
                type="button"
                onClick={() => { setType(id); setMode('play'); setPhase(-1); setTime(0); setRunKey((k) => k + 1); }}
                style={{
                  padding: '8px 14px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: type === id ? 'rgba(44,195,165,0.25)' : 'rgba(255,255,255,0.06)',
                  color: 'inherit',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          {type === 'brilliant' && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
              <input type="checkbox" checked={sacrifice} onChange={(e) => setSacrifice(e.target.checked)} />
              Sacrifice badge (orange sword)
            </label>
          )}

          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
            <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} />
            Reduced motion
          </label>

          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
            <input
              type="checkbox"
              checked={orientation === 'black'}
              onChange={(e) => setOrientation(e.target.checked ? 'black' : 'white')}
            />
            Black orientation
          </label>

          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
            <input
              type="checkbox"
              checked={rate === 0.25}
              onChange={(e) => { setRate(e.target.checked ? 0.25 : 1); play(); }}
            />
            Slow motion (0.25×)
          </label>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <button
              type="button"
              onClick={play}
              style={{ padding: '7px 14px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.08)', color: 'inherit', cursor: 'pointer' }}
            >
              {mode === 'play' ? 'Replay' : 'Play'}
            </button>
            <button
              type="button"
              onClick={() => { setMode('scrub'); setTime((t) => t); }}
              style={{ padding: '7px 14px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.08)', color: 'inherit', cursor: 'pointer' }}
            >
              Pause
            </button>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              t = {Math.round(time)} ms · phase {phase}
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={T.end}
            step={10}
            value={Math.min(Math.round(time), T.end)}
            onChange={(e) => scrubTo(Number(e.target.value))}
            style={{ width: '100%' }}
            aria-label="Timeline position"
          />

          <p style={{ fontSize: 12, opacity: 0.65, lineHeight: 1.5 }}>
            Scrubbing pauses the clock and silences audio/haptics, so every frame can be
            inspected. Play restarts the run; changing the speed does too (the clock has
            no seek offset).
          </p>
        </div>
      </div>
    </div>
  );
}
