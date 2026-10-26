import { useOverlayHistory } from '../hooks/useOverlayHistory';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import AnimatedBoard from './board/AnimatedBoard';
import { fenToGrid, gridToFen, validPosition, START_FEN } from './BoardSetup';
import { GLYPHS, PIECE_THEMES, pieceGlyphStyle, getPieceTheme, buildCustomPieces } from '../config/pieceTheme';
import { getBoardTheme, getBoardThemeStyles } from '../config/boardThemes';
import { useAuth } from '../context/AuthContext';
import { useSound } from '../context/SoundContext';
import Button from './Button';

/* Modal board editor — "Customize Position". Opens from the shared Setup Board
   button (Game Review, both shells). Tap a piece in the palette, then tap
   squares to place / remove pieces — or drag pieces from the palette onto the
   board, drag board pieces between squares, and drag them off the board to
   remove them. Dragging uses Pointer Events (mouse + touch); a press that does
   not move is a tap and keeps the exact click-to-place behaviour. Obeys turn +
   castling rights and produces a full FEN on Apply.

   Styled entirely from the site design system (see index.css + tailwind.config.js):
     ACCENT olive  .... --olive65 (rgba(37,99,235,…)) brand + gold hover signals
     panel ........... .chess-card recipe: radius 1.25rem, gradient surface
                       (var(--ink-800) → var(--ink-900)), border var(--surface-border),
                       box-shadow 0 8px 26px rgba(15,23,42,.12) (+1px gold sheen)
     surfaces ........ var(--ink-700) / var(--surface-soft)
     text ............ font-display (Quicksand) headings, var(--ivory-*) and var(--ink-*)
     inputs .......... .chess-input (gold focus ring)
     buttons ......... .app-btn (primary blue), .app-btn--secondary
     active states ... gold: rgba(59,130,246,.16/.65) — same as .chess-card-hover
     danger .......... chess-chip-red / .app-btn--danger reds
   Panel uses CSS variables so the html[data-theme='dark'] overrides apply. */

const BRAND = 'rgba(37, 99, 235, 0.65)';           /* --olive65 */
const BRAND_SOLID = '#2563eb';
const GOLD = 'rgba(59, 130, 246, 1)';
const GOLD_SOFT = 'rgba(59, 130, 246, 0.16)';

const BLACK_PALETTE = [
  { key: 'bP', glyph: GLYPHS.bP, letter: 'p', label: 'Black pawn' },
  { key: 'bN', glyph: GLYPHS.bN, letter: 'n', label: 'Black knight' },
  { key: 'bB', glyph: GLYPHS.bB, letter: 'b', label: 'Black bishop' },
  { key: 'bR', glyph: GLYPHS.bR, letter: 'r', label: 'Black rook' },
  { key: 'bQ', glyph: GLYPHS.bQ, letter: 'q', label: 'Black queen' },
  { key: 'bK', glyph: GLYPHS.bK, letter: 'k', label: 'Black king' },
];

const WHITE_PALETTE = [
  { key: 'wP', glyph: GLYPHS.wP, letter: 'P', label: 'White pawn' },
  { key: 'wN', glyph: GLYPHS.wN, letter: 'N', label: 'White knight' },
  { key: 'wB', glyph: GLYPHS.wB, letter: 'B', label: 'White bishop' },
  { key: 'wR', glyph: GLYPHS.wR, letter: 'R', label: 'White rook' },
  { key: 'wQ', glyph: GLYPHS.wQ, letter: 'Q', label: 'White queen' },
  { key: 'wK', glyph: GLYPHS.wK, letter: 'K', label: 'White king' },
];

const ALL_CASTLING = { wK: true, wQ: true, bK: true, bQ: true };

/* parse a FEN back into { grid, turn, castling } for the editor */
function parseFen(fen) {
  const parts = (fen || '').trim().split(/\s+/);
  const ca = (parts[2] || '-').replace('-', '');
  return {
    grid: fenToGrid(parts[0] || START_FEN),
    turn: parts[1] === 'b' ? 'b' : 'w',
    castling: {
      wK: ca.includes('K'),
      wQ: ca.includes('Q'),
      bK: ca.includes('k'),
      bQ: ca.includes('q'),
    },
  };
}

function buildFen(grid, turn, castling) {
  const cr = [
    castling.wK && 'K',
    castling.wQ && 'Q',
    castling.bK && 'k',
    castling.bQ && 'q',
  ].filter(Boolean).join('') || '-';
  return `${gridToFen(grid)} ${turn} ${cr} - 0 1`;
}

export default function CustomizePositionModal({ initialFen, onApply, onClose }) {
  useOverlayHistory('CustomizePositionModal', true, onClose);
  const { boardTheme: boardThemeId, pieceSet: pieceSetId } = useAuth();
  const { soundOn, playSound } = useSound();
  const boardTheme = getBoardTheme(boardThemeId);
  const themeStyles = getBoardThemeStyles(boardTheme);

  const [grid, setGrid] = useState(() => fenToGrid(initialFen === 'start' ? START_FEN : initialFen));
  const [selected, setSelected] = useState(null);       // palette letter ('' = trash, null = none)
  const [turn, setTurn] = useState('w');
  const [castling, setCastling] = useState({ ...ALL_CASTLING });
  const [fenInput, setFenInput] = useState('');
  const [fenError, setFenError] = useState('');
  const [tab, setTab] = useState('general');

  /* ── pointer drag state (Task: drag-and-drop on mouse + touch) ──
     Click-to-place stays exactly as it was; dragging is layered on top with
     Pointer Events (HTML5 DnD does not work on touch screens). A press that
     moves less than DRAG_PX is a tap and falls through to the click path. */
  const boardBoxRef = useRef(null);
  const ghostRef = useRef(null);
  const dragRef = useRef(null); // { kind:'palette'|'board', letter, from, startX, startY, active }
  const suppressClickRef = useRef(false);
  const [dropTarget, setDropTarget] = useState(null);
  const [ghostLetter, setGhostLetter] = useState(null);

  const width = Math.min(400, typeof window !== 'undefined' ? Math.min(window.innerWidth - 96, 400) : 400);

  /* Esc closes the modal */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const position = useMemo(() => {
    const map = {};
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const ch = grid[r] && grid[r][c];
        if (!ch) continue;
        const file = String.fromCharCode(97 + c);
        const rank = 8 - r;
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        map[`${file}${rank}`] = `${color}${ch.toUpperCase()}`;
      }
    }
    return map;
  }, [grid]);

  const liveFen = useMemo(() => buildFen(grid, turn, castling), [grid, turn, castling]);

  function pick(letter) {
    setSelected((prev) => (prev === letter ? null : letter));
    setFenError('');
  }

  /* Shared grid mutations — one code path for taps AND drops. */
  function placeLetter(letter, sq) {
    const r = 8 - Number(sq[1]);
    const c = sq.charCodeAt(0) - 97;
    /* Cue the placement with the same piece-knock as a real move, and a
       removal with the softer `select` blip, so building a position on this
       board feels as audible as playing one. */
    if (soundOn) playSound(letter === '' ? 'select' : 'move-self');
    setGrid((prev) => {
      const next = prev.map((row) => [...row]);
      next[r][c] = letter === '' ? null : letter;
      return next;
    });
    setFenError('');
  }

  function onSquareClick(sq) {
    if (selected == null) return;
    placeLetter(selected, sq);
  }

  /* move a piece from one square to another (target is overwritten) */
  function movePiece(source, target) {
    const sr = 8 - Number(source[1]);
    const sc = source.charCodeAt(0) - 97;
    const tr = 8 - Number(target[1]);
    const tc = target.charCodeAt(0) - 97;
    const piece = grid[sr]?.[sc];
    if (!piece) return false;
    if (soundOn) playSound('move-self');
    setGrid((prev) => {
      const next = prev.map((row) => [...row]);
      next[tr][tc] = piece;
      next[sr][sc] = null;
      return next;
    });
    setFenError('');
    return true;
  }

  function removePiece(sq) {
    const r = 8 - Number(sq[1]);
    const c = sq.charCodeAt(0) - 97;
    if (!grid[r]?.[c]) return;
    if (soundOn) playSound('select');
    setGrid((prev) => {
      const next = prev.map((row) => [...row]);
      next[r][c] = null;
      return next;
    });
    setFenError('');
  }

  /* ── pointer drag engine ──
     The board under the overlay is a pure renderer (no native DnD, no square
     clicks of its own): every press lands on the overlay grid or a palette
     button, so mouse and touch behave identically. Coordinates are derived
     from the board box, so the math holds at any board size; this modal's
     board is fixed white-orientation, which the converter states plainly. */
  const DRAG_PX = 10;

  function squareFromPoint(clientX, clientY) {
    const box = boardBoxRef.current;
    if (!box) return null;
    const rect = box.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const col = Math.floor(((clientX - rect.left) / rect.width) * 8);
    const row = Math.floor(((clientY - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    /* white orientation: a1 bottom-left */
    return `${String.fromCharCode(97 + col)}${8 - row}`;
  }

  function showGhost(letter, clientX, clientY) {
    setGhostLetter(letter);
    const el = ghostRef.current;
    if (el) {
      el.style.display = 'grid';
      el.style.transform = `translate(${clientX}px, ${clientY}px) translate(-50%, -50%)`;
    }
  }

  function moveGhost(clientX, clientY) {
    const el = ghostRef.current;
    if (el) el.style.transform = `translate(${clientX}px, ${clientY}px) translate(-50%, -50%)`;
  }

  function hideGhost() {
    setGhostLetter(null);
    const el = ghostRef.current;
    if (el) el.style.display = 'none';
  }

  function beginPotentialDrag(e, kind, extra) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragRef.current = {
      kind, ...extra, startX: e.clientX, startY: e.clientY, active: false,
    };
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* noop */ }
  }

  function onDragMove(e) {
    const d = dragRef.current;
    if (!d || d.kind === 'tap') return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.active) {
      if (Math.hypot(dx, dy) < DRAG_PX) return;
      d.active = true;
      suppressClickRef.current = true;
      showGhost(d.letter, e.clientX, e.clientY);
    }
    moveGhost(e.clientX, e.clientY);
    const sq = squareFromPoint(e.clientX, e.clientY);
    /* Palette drags highlight the landing square; board drags highlight it too,
       and releasing anywhere off-board deletes the piece being carried. */
    setDropTarget((prev) => (prev === sq ? prev : sq));
  }

  function endDrag(e, cancelled) {
    const d = dragRef.current;
    dragRef.current = null;
    hideGhost();
    setDropTarget(null);
    if (!d) return;
    if (!d.active) {
      /* A tap: run the untouched click path. Palette taps set the suppress
         flag because the browser still fires a click after pointerup. */
      if (d.kind === 'palette') {
        suppressClickRef.current = true;
        pick(d.letter);
      } else onSquareClick(d.from);
      return;
    }
    if (cancelled) return;
    const sq = squareFromPoint(e.clientX, e.clientY);
    if (d.kind === 'palette') {
      /* Palette drags only place — dropping off-board cancels silently. */
      if (sq) placeLetter(d.letter, sq);
      return;
    }
    if (!sq) {
      /* Dragged off the board: remove the piece. */
      removePiece(d.from);
      return;
    }
    if (sq !== d.from) movePiece(d.from, sq);
  }

  function glyphFor(letter) {
    const all = [...BLACK_PALETTE, ...WHITE_PALETTE];
    return all.find((p) => p.letter === letter)?.glyph || '';
  }

  function themeKeyFor(letter) {
    return `${letter === letter.toUpperCase() ? 'w' : 'b'}${letter.toUpperCase()}`;
  }

  function loadFenFromInput() {
    const text = (fenInput || '').trim();
    if (!text) { setFenError('Paste a FEN first.'); return; }
    try {
      new Chess(text);
    } catch {
      setFenError('That FEN is invalid — please check the position string.');
      return;
    }
    const parsed = parseFen(text);
    setGrid(parsed.grid);
    setTurn(parsed.turn);
    setCastling(parsed.castling);
    setSelected(null);
    setFenError('');
  }

  function resetBoard() {
    setGrid(fenToGrid(START_FEN));
    setTurn('w');
    setCastling({ ...ALL_CASTLING });
    setSelected(null);
    setFenError('');
  }

  function clearBoard() {
    setGrid(Array.from({ length: 8 }, () => Array(8).fill(null)));
    setSelected(null);
    setFenError('');
  }

  function applySetup() {
    if (!validPosition(grid)) {
      setFenError('Each side needs exactly one king (and no pawn on rank 1 or 8) to apply.');
      return;
    }
    const fen = buildFen(grid, turn, castling);
    onApply(fen);
  }

  const toggleCastling = (key) => setCastling((prev) => ({ ...prev, [key]: !prev[key] }));

  /* piece palette button — active state uses the site gold highlight (chess-card-hover).
     Tap selects (click-to-place); press-and-move drags the piece onto the board
     via the pointer layer. touch-action:none lets a touch drag leave the button
     without starting a page scroll. */
  const paletteBtn = (item) => {
    const active = selected === item.letter;
    return (
      <button
        key={item.key}
        type="button"
        onClick={() => {
          /* A real drag ends with a click on the capture target — swallow it so
             a drop does not also toggle the palette selection. */
          if (suppressClickRef.current) { suppressClickRef.current = false; return; }
          pick(item.letter);
        }}
        onPointerDown={(e) => beginPotentialDrag(e, 'palette', { letter: item.letter })}
        title={item.label}
        className="grid place-items-center rounded-lg shrink-0"
        style={{
          width: 44,
          height: 44,
          touchAction: 'none',
          border: `1px solid ${active ? `rgba(59, 130, 246, 0.65)` : 'rgba(37, 99, 235, 0.28)'}`,
          background: active ? GOLD_SOFT : 'var(--surface-soft)',
          boxShadow: active ? '0 0 0 2px rgba(59, 130, 246, 0.45)' : 'none',
          transition: 'all 0.15s',
        }}
      >
        <span
          style={{
            /* site piece recipe — pieceGlyphStyle(PIECE_THEMES.unicode): warm-white
               fill for white pieces + dark halo so hollow ♔♕… glyphs read as white,
               not black (see config/pieceTheme.jsx DEF.white/black) */
            ...pieceGlyphStyle(PIECE_THEMES.unicode, item.key, 52),
            transform: 'translateY(2px)',
          }}
        >
          {item.glyph}
        </span>
      </button>
    );
  };

  /* trash — active state uses the site danger/red chip tokens */
  const trashBtn = (label) => {
    const active = selected === '';
    return (
      <button
        type="button"
        onClick={() => {
          if (suppressClickRef.current) { suppressClickRef.current = false; return; }
          pick('');
        }}
        onPointerDown={(e) => beginPotentialDrag(e, 'palette', { letter: '' })}
        title="Remove pieces (click squares to delete)"
        className="grid place-items-center rounded-lg shrink-0"
        style={{
          width: 44,
          height: 44,
          touchAction: 'none',
          border: `1px solid ${active ? 'rgba(239, 68, 68, 0.4)' : 'rgba(37, 99, 235, 0.28)'}`,
          background: active ? 'rgba(239, 68, 68, 0.12)' : 'var(--surface-soft)',
          boxShadow: active ? '0 0 0 2px rgba(239, 68, 68, 0.28)' : 'none',
          transition: 'all 0.15s',
        }}
      >
        <span style={{ fontSize: 20, color: active ? '#dc2626' : 'var(--ivory-500)' }}>🗑</span>
      </button>
    );
  };

  const castlingRow = (side, kKey, qKey, kLabel, qLabel) => (
    <div className="flex items-center gap-3">
      <span className="text-sm font-semibold" style={{ color: 'var(--ivory-300)' }}>{side}</span>
      {[
        [kKey, kLabel],
        [qKey, qLabel],
      ].map(([key, label]) => (
        <label key={key} className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--ivory-500)' }}>
          <input
            type="checkbox"
            checked={castling[key]}
            onChange={() => toggleCastling(key)}
            style={{ accentColor: BRAND_SOLID, width: 16, height: 16 }}
          />
          {label}
        </label>
      ))}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal-backdrop)] grid place-items-center p-3 sm:p-6"
      style={{ background: 'rgba(28, 33, 23, 0.55)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onPointerMove={onDragMove}
      onPointerUp={(e) => endDrag(e, false)}
      onPointerCancel={(e) => endDrag(e, true)}
    >
      <div
        className="w-full overflow-x-hidden"
        style={{
          maxWidth: 920,
          maxHeight: '92vh',
          overflowY: 'auto',
          borderRadius: '1.25rem',               /* same as .chess-card */
          background: 'linear-gradient(160deg, var(--ink-800), var(--ink-900))', /* .chess-card gradient surface */
          border: '1px solid var(--surface-border)',
          boxShadow: '0 8px 26px rgba(23, 23, 23, 0.18), 0 1px 0 rgba(59, 130, 246, 0.1)', /* .chess-card shadow */
        }}
      >
        {/* ── header ── */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2
            className="flex items-center gap-2 font-display font-semibold text-lg"
            style={{ color: 'var(--ivory-100)' }}
          >
            {/* gold piece glyph — same as .chess-card-piece */}
            <span className="piece-glyph-spin" style={{ color: '#93c5fd', fontSize: '1.15em' }}>♞</span>
            Customize Position
          </h2>
          <Button
            type="button"
            onClick={onClose}
            title="Close"
            variant="secondary" size="md" className="!h-8 !w-8 !p-0 grid place-items-center text-lg font-semibold"
            style={{ color: 'var(--ivory-300)' }}
          >
            ✕
          </Button>
        </div>

        {/* ── tabs ── */}
        <div className="flex gap-1.5 px-5 pb-3">
          {[
            { id: 'general', label: 'General' },
            { id: 'gamified', label: 'Gamified Board' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="rounded-full px-4 py-1.5 text-sm font-semibold transition"
              style={
                tab === t.id
                  ? {
                      background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.9), rgba(30, 64, 175, 0.9))', /* active tab fill */
                      color: '#ffffff',
                      boxShadow: '0 4px 12px rgba(37, 99, 235, 0.35)',
                    }
                  : { color: 'var(--ivory-500)', background: 'transparent' }
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'general' ? (
          <div className="flex flex-col gap-5 px-5 pb-5 lg:flex-row lg:items-stretch">
            {/* ── board cluster: black palette ∥ board ∥ white palette ── */}
            <div className="flex flex-col items-center justify-center gap-3 lg:flex-row lg:items-start lg:justify-center lg:flex-1">
              {/* black palette (vertical pill on desktop, wrapping row on mobile) */}
              <div className="flex flex-row flex-wrap items-center justify-center gap-2 rounded-xl px-2 py-2 lg:flex-col" style={{ background: 'var(--ink-700)', border: '1px solid rgba(37, 99, 235, 0.2)' }}>
                {BLACK_PALETTE.map((p) => paletteBtn(p))}
                {trashBtn('black')}
              </div>

              <div className="order-2 lg:order-none">
                <div className="flex gap-2 items-start">
                  <div className="flex flex-col items-center justify-center gap-1 py-1" style={{ width: 16, paddingRight: 2 }}>
                    {['8', '7', '6', '5', '4', '3', '2', '1'].map((n) => (
                      <span key={n} className="text-xs font-semibold" style={{ color: 'var(--ivory-500)', height: width / 8, display: 'grid', placeItems: 'center' }}>
                        {n}
                      </span>
                    ))}
                  </div>
                  <div>
                    {/* Measured box + transparent pointer grid over the board. The
                        Chessboard below is a pure renderer (its own clicks and
                        native DnD are off); every press lands on the overlay, so
                        taps and drags behave identically on mouse and touch. */}
                    <div ref={boardBoxRef} style={{ position: 'relative', width, height: width, touchAction: 'none' }}>
                      <AnimatedBoard
                        position={position}
                        arePiecesDraggable={false}
                        customPieces={buildCustomPieces(getPieceTheme(pieceSetId))}
                        arePiecesAnimated
                        boardWidth={width}
                        boardOrientation="white"
                        showBoardNotation={false}
                        customDarkSquareStyle={themeStyles.darkSquareStyle || { backgroundColor: boardTheme.darkSq }}
                        customLightSquareStyle={themeStyles.lightSquareStyle || { backgroundColor: boardTheme.lightSq }}
                        customSquareStyles={dropTarget ? { [dropTarget]: { backgroundColor: 'rgba(59, 130, 246, 0.45)' } } : {}}
                        customBoardStyle={themeStyles.boardStyle || {
                          borderRadius: 10,
                          overflow: 'hidden',
                          boxShadow: `${boardTheme.highlight}33 0 0 0 1px, 0 10px 26px rgba(23, 23, 23, 0.28)`,
                        }}
                      />
                      <div
                        aria-hidden
                        onContextMenu={(e) => e.preventDefault()}
                        style={{
                          position: 'absolute', inset: 0,
                          display: 'grid',
                          gridTemplateColumns: 'repeat(8, 1fr)',
                          gridTemplateRows: 'repeat(8, 1fr)',
                          touchAction: 'none',
                        }}
                      >
                        {Array.from({ length: 64 }, (_, i) => {
                          const file = String.fromCharCode(97 + (i % 8));
                          const sq = `${file}${8 - Math.floor(i / 8)}`;
                          return (
                            <div
                              key={sq}
                              onPointerDown={(e) => {
                                /* Occupied squares can start a drag; empty squares
                                   are tap-only and fall through to click-to-place. */
                                const r = 8 - Number(sq[1]);
                                const c = sq.charCodeAt(0) - 97;
                                const piece = grid[r]?.[c];
                                if (piece) beginPotentialDrag(e, 'board', { letter: piece, from: sq });
                                else beginPotentialDrag(e, 'tap', { from: sq });
                              }}
                              style={{
                                touchAction: 'none',
                                boxShadow: dropTarget === sq
                                  ? 'inset 0 0 0 3px rgba(59, 130, 246, 0.9)'
                                  : 'none',
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>
                    {/* file letters a-h along the bottom */}
                    <div className="flex" style={{ width, paddingTop: 2 }}>
                      {['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((f) => (
                        <span key={f} className="text-xs font-semibold text-center" style={{ color: 'var(--ivory-500)', width: width / 8 }}>
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* live FEN readout */}
                <p className="mt-2 truncate rounded-lg px-3 py-1.5 text-center font-mono text-[11px]" style={{ background: 'var(--ink-700)', border: '1px solid rgba(37, 99, 235, 0.15)', color: 'var(--ivory-500)' }}>
                  {liveFen}
                </p>
              </div>

              {/* white palette (vertical pill on desktop, wrapping row on mobile) */}
              <div className="order-1 lg:order-none flex flex-row flex-wrap items-center justify-center gap-2 rounded-xl px-2 py-2 lg:flex-col" style={{ background: 'var(--ink-700)', border: '1px solid rgba(37, 99, 235, 0.2)' }}>
                {WHITE_PALETTE.map((p) => paletteBtn(p))}
                {trashBtn('white')}
              </div>
            </div>

            {/* ── right controls column ── */}
            <div className="flex flex-col gap-4 lg:w-[300px] lg:min-w-[270px]">
              {/* FEN load */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ivory-500)' }}>
                  Load from FEN
                </p>
                <div className="flex gap-2">
                  <input
                    value={fenInput}
                    onChange={(e) => { setFenInput(e.target.value); setFenError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') loadFenFromInput(); }}
                    placeholder="Enter FEN position (e.g., 8/8/8/8/8/8/8/8/8 w KQkq - 0 1)"
                    className="chess-input flex-1 min-w-0"
                  />
                  <Button type="button" onClick={loadFenFromInput} variant="primary" size="sm" className="!py-2 !px-4 text-xs">
                    Load
                  </Button>
                </div>
                {fenError && (
                  <p className="mt-1.5 text-xs" style={{ color: '#b91c1c' }}>{fenError}</p>
                )}
              </div>

              {/* turn selector */}
              <div>
                <span className="text-sm font-semibold" style={{ color: 'var(--ivory-300)' }}>White/Black to move:</span>
                <div className="mt-1.5 flex w-fit rounded-full overflow-hidden" style={{ border: '1px solid rgba(37, 99, 235, 0.5)' }}>
                  <button
                    type="button"
                    onClick={() => setTurn('w')}
                    className="px-4 py-1.5 text-sm font-semibold transition"
                    style={
                      turn === 'w'
                        ? { background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.9), rgba(30, 64, 175, 0.9))', color: '#fff' } /* active turn */
                        : { background: 'var(--ink-800)', color: 'var(--ivory-500)' }
                    }
                  >
                    White
                  </button>
                  <button
                    type="button"
                    onClick={() => setTurn('b')}
                    className="px-4 py-1.5 text-sm font-semibold transition"
                    style={
                      turn === 'b'
                        ? { background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.9), rgba(30, 64, 175, 0.9))', color: '#fff' }
                        : { background: 'var(--ink-800)', color: 'var(--ivory-500)' }
                    }
                  >
                    Black
                  </button>
                </div>
              </div>

              {/* castling rights */}
              <div className="flex flex-col gap-2">
                {castlingRow('White:', 'wK', 'wQ', 'O-O', 'O-O-O')}
                {castlingRow('Black:', 'bK', 'bQ', 'O-O', 'O-O-O')}
              </div>

              {/* actions pinned to the bottom of the column */}
              <div className="mt-auto flex flex-col gap-2 pt-2">
                <div className="flex gap-2">
                  <Button type="button" onClick={resetBoard} variant="secondary" size="sm" className="flex-1 !py-2 !px-3 text-xs">
                    ⟳ Reset
                  </Button>
                  <Button type="button" onClick={clearBoard} variant="secondary" size="sm" className="flex-1 !py-2 !px-3 text-xs">
                    ⊘ Clear
                  </Button>
                </div>
                <Button type="button" onClick={applySetup} variant="primary" size="md" className="!py-2.5 text-sm">
                  Load Fen
                </Button>
              </div>
            </div>
          </div>
        ) : (
          /* ── Gamified Board placeholder ── */
          <div className="px-8 py-16 text-center">
            <p className="text-3xl mb-3">🎯</p>
            <p className="font-display font-semibold" style={{ color: 'var(--ivory-100)' }}>Gamified Board</p>
            <p className="mt-1 text-sm" style={{ color: 'var(--ivory-500)' }}>
              XP, streak and reward board settings are coming soon.
            </p>
          </div>
        )}

      </div>

      {/* Drag ghost — the carried piece follows the cursor/finger. Positioned
          imperatively on pointermove so dragging never re-renders the modal. */}
      <div
        ref={ghostRef}
        aria-hidden
        style={{
          display: 'none',
          position: 'fixed',
          left: 0,
          top: 0,
          zIndex: 200,
          pointerEvents: 'none',
          width: 56,
          height: 56,
          placeItems: 'center',
        }}
      >
        {ghostLetter && (
          <span
            style={{
              ...pieceGlyphStyle(PIECE_THEMES.unicode, themeKeyFor(ghostLetter), 64),
              transform: 'translateY(3px)',
              filter: 'drop-shadow(0 6px 8px rgba(0,0,0,0.45))',
            }}
          >
            {glyphFor(ghostLetter)}
          </span>
        )}
      </div>
    </div>
  );
}