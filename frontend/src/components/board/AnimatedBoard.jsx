import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { CBURNETT_SVGS } from '../cburnettPieces';
import { resolveBoardAnimation, useBoardAnimationId } from '../../config/boardAnimation';
import { lum } from '../../config/ornateTheme';

const FILES = 'abcdefgh';
let pieceIdCounter = 0;
const nextPieceId = () => (pieceIdCounter += 1);

const START_FEN = new Chess().fen();

function squareToDisplay(square, orientation) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  if (orientation === 'black') return { col: 7 - file, row: rank };
  return { col: file, row: 7 - rank };
}

function displayToSquare(col, row, orientation) {
  if (orientation === 'black') return FILES[7 - col] + (row + 1);
  return FILES[col] + (8 - row);
}

function parsePosition(position) {
  if (!position) {
    return { map: parsePosition(START_FEN).map, fen: START_FEN };
  }
  if (typeof position !== 'string') {
    const map = {};
    for (const [square, code] of Object.entries(position)) {
      if (typeof code === 'string' && code.length === 2) map[square] = code;
    }
    return { map, fen: null };
  }
  const placement = position.trim().split(/\s+/)[0] || '';
  const map = {};
  let rank = 8;
  let file = 0;
  for (const ch of placement) {
    if (ch === '/') {
      rank -= 1;
      file = 0;
    } else if (ch >= '1' && ch <= '8') {
      file += Number(ch);
    } else {
      const lower = ch.toLowerCase();
      if (file >= 0 && file < 8 && rank >= 1 && rank <= 8) {
        map[FILES[file] + rank] = (ch === lower ? 'b' : 'w') + lower.toUpperCase();
      }
      file += 1;
    }
  }
  const fields = position.trim().split(/\s+/);
  return { map, fen: fields.length >= 2 ? position.trim() : null };
}

function mapKey(map) {
  return Object.keys(map).sort().map((sq) => `${sq}:${map[sq]}`).join('|');
}

function sameMap(a, b) {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

function positionKey(fen) {
  return String(fen).split(' ').slice(0, 4).join(' ');
}

/* Ask the previous position for its legal moves and look for the one that lands
   exactly on the new position. Anything else (a jump, a paste, a multi-ply
   replay) returns null and the board snaps instead of animating. */
function exactlyOnePly(prevFen, nextFen) {
  if (!prevFen || !nextFen || prevFen === nextFen) return null;
  let prevGame;
  try {
    prevGame = new Chess(prevFen);
  } catch {
    return null;
  }
  const legal = prevGame.moves({ verbose: true });
  for (const m of legal) {
    try {
      prevGame.move(m.san);
      if (positionKey(prevGame.fen()) === positionKey(nextFen)) return m;
      prevGame.undo();
    } catch {
      /* restore and continue */
    }
  }
  return null;
}

function buildPieces(map) {
  return Object.entries(map).map(([square, code]) => ({ id: nextPieceId(), code, square }));
}

/* Move the tracked pieces to match a single inferred ply, keeping each piece's
   identity so the renderer animates it. Returns null when the result would not
   reproduce `nextMap` (drift, undo of a pawn move, ...) so the caller snaps. */
function applySingleMove(current, move, nextMap) {
  const out = current.map((p) => ({ ...p }));
  const mover = out.find((p) => p.square === move.from && !p.die);
  if (!mover) return null;

  let captureSquare = move.to;
  const enPassant = Boolean(move.flags && move.flags.includes('e'));
  if (enPassant) captureSquare = move.to[0] + move.from[1];
  const isCapture = Boolean(move.captured) || enPassant;
  if (isCapture) {
    const victim = out.find((p) => p !== mover && p.square === captureSquare && !p.die);
    if (!victim) return null;
    victim.die = true;
  }

  mover.square = move.to;
  if (move.promotion) mover.promoteTo = mover.code[0] + String(move.promotion).toUpperCase();

  if (move.flags && (move.flags.includes('k') || move.flags.includes('q'))) {
    const rank = move.from[1];
    const rookFrom = (move.flags.includes('k') ? 'h' : 'a') + rank;
    const rookTo = (move.flags.includes('k') ? 'f' : 'd') + rank;
    const rook = out.find((p) => p.square === rookFrom && !p.die);
    if (rook) rook.square = rookTo;
  }

  const live = {};
  for (const p of out) if (!p.die) live[p.square] = p.promoteTo || p.code;
  if (!sameMap(live, nextMap)) return null;
  return out;
}

export default function AnimatedBoard({
  position,
  onPieceDrop,
  onSquareClick,
  onPieceClick,
  getLegalTargets,
  legalTargets,
  boardWidth = 420,
  boardOrientation = 'white',
  arePiecesDraggable = true,
  lockTouch = false,
  cursorForSquare = null,
  animationDuration = 0.25,
  customPieces,
  customDarkSquareStyle,
  customLightSquareStyle,
  customBoardStyle,
  customSquareStyles,
  showNotation,
  showBoardNotation,
  showLegalMoves,
  customArrows,
  areArrowsAllowed,
  onArrowsChange,
  arePiecesAnimated,
  customNotationStyle,
  insideNotation,
  hidePieces = false,
}) {
  /* Accepts `true` (hide everything), a Set of squares, or an array of
   * squares. The MoveEffect controller hands over a Set so only the pieces the
   * overlay currently draws are hidden. */
  const isHiddenSquare = (square) => {
    if (!hidePieces) return false;
    if (hidePieces === true) return true;
    if (typeof hidePieces.has === 'function') return hidePieces.has(square);
    if (Array.isArray(hidePieces)) return hidePieces.includes(square);
    return false;
  };
  const animationId = useBoardAnimationId();
  const preset = resolveBoardAnimation(animationId);
  const animate = preset.animate && animationDuration !== 0;
  const durationMs = animate ? preset.duration : 0;
  const easing = animate ? preset.easing : 'linear';

  const parsedInitial = useMemo(() => parsePosition(position), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [pieces, setPieces] = useState(() => buildPieces(parsedInitial.map));
  const [ready, setReady] = useState(false);
  const [hiddenId, setHiddenId] = useState(null);
  const [drag, setDrag] = useState(null);
  const [settle, setSettle] = useState(null);
  const [dragOverSq, setDragOverSq] = useState(null);
  const [dragTargets, setDragTargets] = useState(null);

  const rootRef = useRef(null);
  const prevRef = useRef({ key: mapKey(parsedInitial.map), fen: parsedInitial.fen });
  const dragRef = useRef(null);
  const timersRef = useRef([]);

  const signature = useMemo(
    () => (typeof position === 'string' ? position : JSON.stringify(position || null)),
    [position],
  );

  useEffect(() => {
    const r1 = requestAnimationFrame(() => {
      const r2 = requestAnimationFrame(() => setReady(true));
      timersRef.current.push({ raf: r2 });
    });
    timersRef.current.push({ raf: r1 });
    return () => {
      for (const t of timersRef.current) if (t.raf) cancelAnimationFrame(t.raf);
      timersRef.current = [];
    };
  }, []);

  useEffect(() => () => {
    for (const t of timersRef.current) {
      if (t.timeout) clearTimeout(t.timeout);
      if (t.raf) cancelAnimationFrame(t.raf);
    }
  }, []);

  useEffect(() => {
    const parsed = parsePosition(position);
    const key = mapKey(parsed.map);
    const prev = prevRef.current;
    if (prev.key === key) {
      prev.fen = parsed.fen;
      return;
    }

    const forward = prev.fen && parsed.fen ? exactlyOnePly(prev.fen, parsed.fen) : null;
    const backward = !forward && prev.fen && parsed.fen ? exactlyOnePly(parsed.fen, prev.fen) : null;
    prevRef.current = { key, fen: parsed.fen };

    setPieces((current) => {
      if (forward) {
        const applied = applySingleMove(current, forward, parsed.map);
        if (applied) return applied;
      }
      if (backward) {
        const reversed = { ...backward, from: backward.to, to: backward.from, flags: '' };
        const applied = applySingleMove(current, reversed, parsed.map);
        if (applied) return applied;
      }
      return buildPieces(parsed.map);
    });
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pieces.some((p) => p.die)) return undefined;
    if (durationMs <= 0) {
      setPieces((current) => current.filter((p) => !p.die));
      return undefined;
    }
    const timeout = setTimeout(() => {
      setPieces((current) => current.filter((p) => !p.die));
    }, durationMs + 90);
    timersRef.current.push({ timeout });
    return () => clearTimeout(timeout);
  }, [pieces, durationMs]);

  useEffect(() => {
    const promoting = pieces.filter((p) => p.promoteTo);
    if (!promoting.length) return undefined;
    const timeout = setTimeout(() => {
      setPieces((current) => current.map((p) => (
        p.promoteTo ? { ...p, code: p.promoteTo, promoteTo: undefined } : p
      )));
    }, durationMs * 2 + 120);
    timersRef.current.push({ timeout });
    return () => clearTimeout(timeout);
  }, [pieces, durationMs]);

  const squareFromPoint = useCallback((clientX, clientY) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return null;
    const cell = rect.width / 8;
    const col = Math.floor((clientX - rect.left) / cell);
    const row = Math.floor((clientY - rect.top) / cell);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return displayToSquare(col, row, boardOrientation);
  }, [boardOrientation]);

  const pieceAt = useCallback((sq) => pieces.find((p) => p.square === sq && !p.die), [pieces]);

  const endDrag = useCallback((e, cancelled) => {
    const d = dragRef.current;
    dragRef.current = null;
    try { rootRef.current?.releasePointerCapture?.(d?.pointerId); } catch { /* ignore */ }
    setDragTargets(null);
    setDragOverSq(null);

    if (!d) return;

    if (!d.dragging) {
      if (d.piece && onPieceClick) onPieceClick(d.piece.code, d.sq);
      if (onSquareClick) onSquareClick(d.sq);
      return;
    }

    const target = cancelled || !e ? null : squareFromPoint(e.clientX, e.clientY);
    /* onPieceDrop applies a legal move SYNCHRONOUSLY and reports what happened:
         true    → move applied (settle the piece on the target)
         'promo' → promotion picker is opening; the move is NOT applied yet
         false   → illegal / locked drop (snap back to origin) */
    const result = target && target !== d.from ? onPieceDrop?.(d.from, target) : false;
    const accepted = result === true;
    const pending = result === 'promo';

    const rect = rootRef.current.getBoundingClientRect();
    const cell = rect.width / 8;
    const dropX = e ? e.clientX - rect.left : 0;
    const dropY = e ? e.clientY - rect.top : 0;

    setDrag(null);

    /* Promotion: the caller owns the picker and the position has not changed, so
       do not run the settle clone — just reveal the piece back on its origin and
       let the normal promotion animation play once the choice is made. */
    if (pending) {
      setHiddenId(null);
      setSettle(null);
      return;
    }

    /* Glide the floating piece to the destination square's CENTRE (the clone is
       centred on `translate(-50%,-50%)`, hence the + cell/2), or back to the
       origin centre when the drop was rejected. */
    const destSq = accepted ? target : d.from;
    const dest = squareToDisplay(destSq, boardOrientation);

    setSettle({
      id: d.id,
      code: d.code,
      phase: 'start',
      startX: dropX,
      startY: dropY,
      endX: dest.col * cell + cell / 2,
      endY: dest.row * cell + cell / 2,
    });

    const raf = requestAnimationFrame(() => {
      setSettle((s) => (s ? { ...s, phase: 'go' } : s));
    });
    timersRef.current.push({ raf });

    const timeout = setTimeout(() => {
      setSettle(null);
      setHiddenId(null);
    }, durationMs <= 0 ? 0 : durationMs + 40);
    timersRef.current.push({ timeout });
  }, [onPieceClick, onSquareClick, onPieceDrop, squareFromPoint, boardOrientation, durationMs]);

  const handlePointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    const sq = squareFromPoint(e.clientX, e.clientY);
    if (!sq) return;
    const piece = pieceAt(sq);
    dragRef.current = {
      sq,
      piece,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
      dragging: false,
      id: piece?.id ?? null,
      from: sq,
      code: piece?.code,
    };
    if (arePiecesDraggable && piece) {
      try { rootRef.current.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    }
  }, [squareFromPoint, pieceAt, arePiecesDraggable]);

  const handlePointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.dragging) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;
      if (!arePiecesDraggable || !d.piece) return;
      d.dragging = true;
      setHiddenId(d.id);
      if (getLegalTargets) setDragTargets(getLegalTargets(d.from) || []);
    }
    const rect = rootRef.current.getBoundingClientRect();
    setDrag({ id: d.id, code: d.code, x: e.clientX - rect.left, y: e.clientY - rect.top });
    setDragOverSq(squareFromPoint(e.clientX, e.clientY));
    e.preventDefault();
  }, [arePiecesDraggable, getLegalTargets, squareFromPoint]);

  const handlePointerUp = useCallback((e) => endDrag(e, false), [endDrag]);
  const handlePointerCancel = useCallback((e) => endDrag(e, true), [endDrag]);

  const renderGlyph = useCallback((code, square, isDragging) => {
    const squareWidth = boardWidth / 8;
    if (customPieces && typeof customPieces[code] === 'function') {
      return customPieces[code]({ squareWidth, square, isDragging });
    }
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
  }, [boardWidth, customPieces]);

  const dark = customDarkSquareStyle || { backgroundColor: '#b58863' };
  const light = customLightSquareStyle || { backgroundColor: '#f0d9b5' };
  const notation = showBoardNotation ?? showNotation;

  /* Inside-square coordinates for frameless mode. Rank numbers go in the
     top-left corner of the left-most file squares; file letters go in the
     bottom-right corner of the bottom-rank squares. Colors are chosen to
     contrast with the square's own colour. */
  const insideSq = boardWidth / 8;
  const coordFontSize = Math.max(10, Math.round(insideSq * 0.22));
  /* Coordinate ink has to contrast with the square it sits on. The old pair
     reused the OPPOSITE square's fill, which is pretty but only ever ~2.8:1;
     at 10px that is barely readable. Pick dark ink on a light square and light
     ink on a dark one, so both orientations clear 4.5:1. */
  const darkSqFill = (typeof dark.backgroundColor === 'string' && dark.backgroundColor) || '#b58863';
  const lightSqFill = (typeof light.backgroundColor === 'string' && light.backgroundColor) || '#f0d9b5';
  const inkFor = (fill) => (lum(fill) > 0.45 ? '#1f2937' : '#f8fafc');
  const darkCoordColor = inkFor(lightSqFill);   /* drawn on a light square */
  const lightCoordColor = inkFor(darkSqFill);   /* drawn on a dark square */

  /* Legal-move hints, keyed by destination square (true = capture → ring,
     false = quiet → dot). Both the click-selected targets (legalTargets) and the
     in-flight drag targets (dragTargets) feed the SAME in-cell mark, so a hint is
     always one mark centred in its own square and can never drift out of
     register with the square it belongs to. */
  const hints = new Map();
  const addHint = (t) => {
    const sq = typeof t === 'string' ? t : t && t.to;
    if (!sq) return;
    const capture = typeof t === 'string'
      ? false
      : Boolean(t.captured || (t.flags && t.flags.includes('e')) || (t.san && t.san.includes('x')));
    hints.set(sq, hints.get(sq) || capture);
  };
  if (Array.isArray(legalTargets)) legalTargets.forEach(addHint);
  if (Array.isArray(dragTargets)) dragTargets.forEach(addHint);

  const squares = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const sq = displayToSquare(col, row, boardOrientation);
      const file = sq.charCodeAt(0) - 97;
      const rank = Number(sq[1]) - 1;
      const isDark = (file + rank) % 2 === 0;
      const extra = (customSquareStyles && customSquareStyles[sq]) || null;
      const hasHint = hints.has(sq);
      /* Pieces have pointer-events:none, so the cell beneath owns the cursor.
         A "hand" on squares whose piece can be picked up makes click-to-move
         discoverable without turning the whole board into a pointer. */
      const clickable = cursorForSquare ? Boolean(cursorForSquare(sq)) : false;
      squares.push(
        <div
          key={sq}
          className={`ab-cell ${isDark ? 'ab-dark' : 'ab-light'}`}
          style={{
            position: 'relative',
            display: 'grid',
            placeItems: 'center',
            ...(isDark ? dark : light),
            ...(extra || {}),
            cursor: clickable ? 'pointer' : undefined,
          }}
        >
          {sq === dragOverSq && <span className="ab-cell-drag" />}
          {hasHint && (
            <span className={hints.get(sq) ? 'ab-cell-ring' : 'ab-cell-dot'} />
          )}
          {insideNotation && col === 0 && (
            <span
              className="ab-inside-coord ab-inside-rank"
              style={{
                color: isDark ? lightCoordColor : darkCoordColor,
                fontSize: coordFontSize,
              }}
            >
              {sq[1]}
            </span>
          )}
          {insideNotation && row === 7 && (
            <span
              className="ab-inside-coord ab-inside-file"
              style={{
                color: isDark ? lightCoordColor : darkCoordColor,
                fontSize: coordFontSize,
              }}
            >
              {sq[0]}
            </span>
          )}
        </div>,
      );
    }
  }

  const pieceNodes = pieces.map((p) => {
    const pos = squareToDisplay(p.square, boardOrientation);
    const isHidden = (p.id === hiddenId) || (settle && settle.id === p.id);
    const opacity = p.die ? 0 : (isHidden ? 0 : 1);
    const transforms = `translate(${pos.col * 100}%, ${pos.row * 100}%)`;
    /* A piece that is currently hidden behind the drag/settle clone must NOT
       transition its transform: it should already be sitting on its final square
       the instant the clone is removed, so there is never a visible replay from
       the origin square. */
    const transitions = animate && ready && !p.die && !isHidden ? [`transform ${durationMs}ms ${easing}`] : [];
    if (p.die) transitions.push(`opacity ${durationMs}ms ${easing}`);
    const glyph = p.promoteTo ? (
      <>
        <span className="ab-promo-old" style={{ animationDelay: `${durationMs}ms` }}>{renderGlyph(p.code, p.square)}</span>
        <span className="ab-promo-new" style={{ animationDelay: `${durationMs}ms` }}>{renderGlyph(p.promoteTo, p.square)}</span>
      </>
    ) : renderGlyph(p.code, p.square);
    return (
      <div
        key={p.id}
        className="ab-piece"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '12.5%',
          height: '12.5%',
          transform: transforms,
          opacity,
          /* The MoveEffect overlay renders its own copies while it animates;
             visibility (not display) keeps the board's own state and layout
             untouched so nothing jumps when control comes back. */
          visibility: isHiddenSquare(p.square) ? 'hidden' : undefined,
          transition: transitions.length ? transitions.join(', ') : 'none',
          willChange: 'transform',
          zIndex: p.die ? 4 : 5,
          pointerEvents: 'none',
        }}
      >
        <div className="ab-piece-inner" style={{ width: '100%', height: '100%' }}>{glyph}</div>
      </div>
    );
  });

  return (
    <div
      ref={rootRef}
      className="ab-board"
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: 'repeat(8, 1fr)',
        gridTemplateRows: 'repeat(8, 1fr)',
        width: boardWidth,
        height: boardWidth,
        aspectRatio: '1 / 1',
        overflow: 'hidden',
        userSelect: 'none',
        touchAction: (arePiecesDraggable || lockTouch) ? 'none' : undefined,
        cursor: arePiecesDraggable ? 'grab' : 'default',
        ...(customBoardStyle || {}),
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      {squares}

      <div key={boardOrientation} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {pieceNodes}
      </div>

      {drag && (
        <div
          className="ab-floating"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '12.5%',
            height: '12.5%',
            transform: `translate(${drag.x}px, ${drag.y}px) translate(-50%, -50%)`,
            pointerEvents: 'none',
            zIndex: 9,
          }}
        >
          <div className="ab-piece-inner ab-lifted" style={{ width: '100%', height: '100%' }}>
            {renderGlyph(drag.code, dragOverSq || undefined, true)}
          </div>
        </div>
      )}

      {settle && (
        <div
          className="ab-floating"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '12.5%',
            height: '12.5%',
            transform: `translate(${settle.phase === 'go' ? settle.endX : settle.startX}px, ${settle.phase === 'go' ? settle.endY : settle.startY}px) translate(-50%, -50%)`,
            transition: settle.phase === 'go' && animate ? `transform ${durationMs}ms ${easing}` : 'none',
            pointerEvents: 'none',
            zIndex: 9,
          }}
        >
          <div className="ab-piece-inner" style={{ width: '100%', height: '100%' }}>
            {renderGlyph(settle.code, undefined, false)}
          </div>
        </div>
      )}

      {notation && (
        <>
          {FILES.split('').map((f, i) => {
            const shown = boardOrientation === 'black' ? FILES[7 - i] : f;
            return (
              <span
                key={`f-${f}`}
                className="ab-coord ab-coord-file"
                style={{ left: `${i * 12.5}%`, width: '12.5%', ...(customNotationStyle || {}) }}
              >
                {shown}
              </span>
            );
          })}
          {[8, 7, 6, 5, 4, 3, 2, 1].map((r, i) => {
            const shown = boardOrientation === 'black' ? i + 1 : r;
            return (
              <span
                key={`r-${r}`}
                className="ab-coord ab-coord-rank"
                style={{ top: `${i * 12.5}%`, height: '12.5%', ...(customNotationStyle || {}) }}
              >
                {shown}
              </span>
            );
          })}
        </>
      )}
    </div>
  );
}
