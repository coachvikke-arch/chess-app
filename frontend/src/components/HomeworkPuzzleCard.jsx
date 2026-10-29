import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import AnimatedBoard from './board/AnimatedBoard';
import { Chip, Spinner } from './ui';
import { getPieceTheme, buildCustomPieces } from '../config/pieceTheme';
import { getBoardTheme, getBoardThemeStyles } from '../config/boardThemes';
import { ornateSquareStyles } from '../config/ornateTheme';
import { useAuth } from '../context/AuthContext';

/* Static board preview using the user's board prefs (mirrors PuzzleCard). */
function MiniBoard({ fen, width }) {
  const { boardTheme: boardThemeId, pieceSet } = useAuth();
  const boardTheme = getBoardTheme(boardThemeId);
  const customPieces = useMemo(() => buildCustomPieces(getPieceTheme(pieceSet || 'cburnett')), [pieceSet]);
  const themeStyles = getBoardThemeStyles(boardTheme);

  return (
    <AnimatedBoard
      position={fen}
      boardWidth={Math.max(120, Math.round(width))}
      boardOrientation="white"
      arePiecesDraggable={false}
      arePiecesAnimated={false}
      animationDuration={0}
      showNotation
      customPieces={customPieces}
      customDarkSquareStyle={themeStyles.darkSquareStyle || { backgroundColor: boardTheme.darkSq }}
      customLightSquareStyle={themeStyles.lightSquareStyle || { backgroundColor: boardTheme.lightSq }}
      customSquareStyles={ornateSquareStyles(boardTheme) || undefined}
      customBoardStyle={themeStyles.boardStyle || { borderRadius: '10px', overflow: 'hidden' }}
    />
  );
}

function MoveNav({ moveCount, index, onChange }) {
  const btn =
    'h-8 w-8 grid place-items-center rounded-lg border border-ivory-700/50 bg-black/[0.04] text-sm ' +
    'hover:bg-black/5 hover:border-gold-500/40 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-black/[0.04] disabled:hover:border-ivory-700/50 transition';
  const fire = (fn) => (e) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div className="flex items-center justify-center gap-1.5 mt-1 select-none" onClick={(e) => e.stopPropagation()}>
      <button title="Go to first move" className={btn} disabled={index === 0} onClick={fire(() => onChange(0))}>⏮️</button>
      <button title="Go to previous move" className={btn} disabled={index === 0} onClick={fire(() => onChange(index - 1))}>◀️</button>
      <span className="min-w-[3rem] text-center text-[0.68rem] text-ivory-500 font-mono">{index}/{moveCount}</span>
      <button title="Go to next move" className={btn} disabled={index >= moveCount} onClick={fire(() => onChange(index + 1))}>▶️</button>
      <button title="Go to last move" className={btn} disabled={index >= moveCount} onClick={fire(() => onChange(moveCount))}>⏭️</button>
    </div>
  );
}

/* Replay solution (stored as UCI or SAN, sometimes mixed) into valid SAN plies
   from the initial FEN so the preview + nav always steps cleanly. */
function replay(item) {
  const g = new Chess(item.fen);
  const san = [];
  for (const m of item.solution || []) {
    const raw = String(m);
    const uci = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(raw);
    try {
      const mv = g.move(uci ? { from: raw.slice(0, 2), to: raw.slice(2, 4), promotion: raw.length > 4 ? raw[4] : undefined } : raw);
      if (mv) san.push(mv.san);
    } catch {
      break;
    }
  }
  return san;
}

function cap(v) {
  return v && String(v).charAt(0).toUpperCase() + String(v).slice(1);
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function HomeworkPuzzleCard({ item, expanded, detail, detailLoading, detailError, onToggle }) {
  const [index, setIndex] = useState(0);
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(240);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(Math.min(el.clientWidth, 220));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sanMoves = useMemo(() => (item.fen ? replay(item) : []), [item.fen, item.solution]);
  const moveCount = sanMoves.length;

  const previewFen = useMemo(() => {
    const g = new Chess(item.fen);
    for (let i = 0; i < index; i++) {
      try {
        g.move(sanMoves[i]);
      } catch {
        break;
      }
    }
    return g.fen();
  }, [item.fen, sanMoves, index]);

  const overdue = !item.submitted && item.dueDate && new Date(item.dueDate) < new Date();
  const total = item.activities || 1;
  const attemptsArr = detail?.attempts || [];

  /** Replay an attempt's stored UCI into SAN plies from the puzzle FEN. */
  const attemptMoves = (at) => replay({ fen: item.fen, solution: at.played_moves || [] });

  return (
    <article
      ref={wrapRef}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggle(); }}
      className={`rounded-2xl border p-2.5 flex flex-col gap-2 cursor-pointer transition select-none ${expanded
          ? 'border-gold-500/50 bg-gold-500/[0.06]'
          : 'border-ivory-700/50 bg-black/[0.03] hover:border-gold-500/40 hover:bg-black/[0.05]'
        }`}
    >
      <div className="flex items-start justify-between gap-2 px-0.5">
        <h3 className="text-xs font-semibold text-ivory-300 truncate">{item.title}</h3>
      </div>

      <div className="w-full flex justify-center pointer-events-none">
        <div className="w-full max-w-[220px] flex flex-col items-center">
          <MiniBoard fen={previewFen} width={width} />
        </div>
      </div>

      {moveCount > 0 && <MoveNav moveCount={moveCount} index={index} onChange={setIndex} />}

      <div className="flex flex-wrap items-center gap-1.5 px-0.5">
        {overdue
          ? <Chip tone="">Overdue</Chip>
          : item.submitted
            ? (item.approved ? <Chip tone="green">Graded · Approved</Chip> : <Chip tone="green">Submitted</Chip>)
            : null}
        {item.themes && item.themes.length > 0 && (
          <Chip>{item.themes.slice(0, 2).map((t) => cap(t)).join(' · ')}</Chip>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mt-auto px-0.5 pt-1 border-t border-ivory-700/40 text-[0.68rem]">
        <span className="text-gold-400">
          {item.submitted ? item.activities : 0}/{total} moves solved
          {item.attempts > 0 && <span className="text-ivory-500"> · {item.attempts} attempt{item.attempts === 1 ? '' : 's'}</span>}
          {item.submitted && <span className="text-ivory-500"> · Best {item.score} pts</span>}
        </span>
        <span className="inline-flex items-center gap-1 text-gold-400 font-medium hover:underline">
          Attempts {expanded ? '▴' : '▾'}
        </span>
      </div>

      <div className="px-0.5 text-[0.62rem] text-ivory-500">
        {item.assignedAt ? `Assigned ${fmtDate(item.assignedAt)}` : ''}
        {item.assignedAt && item.dueDate ? ' · ' : ''}
        {item.dueDate ? `Due ${fmtDate(item.dueDate)}` : ''}
      </div>

      {expanded && (
        <div className="px-0.5 pt-2 mt-1 border-t border-ivory-700/40 space-y-1.5">
          {detailLoading ? (
            <div className="flex items-center gap-2 text-[0.7rem] text-ivory-500"><Spinner /> Loading attempts…</div>
          ) : detailError ? (
            <p className="text-[0.7rem] text-red-600">{detailError}</p>
          ) : detail ? (
            attemptsArr.length === 0 ? (
              <p className="text-[0.7rem] text-ivory-500">No attempt yet for this puzzle.</p>
            ) : (
              <>
                <div className="flex items-center gap-1 overflow-x-auto py-0.5">
                  {(() => {
                    const seen = new Set();
                    const chips = [];
                    attemptsArr.forEach((at) => {
                      const plies = attemptMoves(at);
                      if (plies.length === 0) {
                        const right = at.result === 'correct';
                        const key = `fb:${right}`;
                        if (seen.has(key)) return;
                        seen.add(key);
                        chips.push(
                          <span
                            key={key}
                            className={`font-mono rounded-full px-2 py-0.5 border shrink-0 ${right
                                ? 'border-green-500/40 bg-green-500/10 text-green-600'
                                : 'border-red-500/50 bg-red-500/15 text-red-600'
                              }`}
                          >
                            {right ? '✓ Right' : '✗ Wrong'}
                          </span>
                        );
                        return;
                      }
                      plies.forEach((san, i) => {
                        const key = `${i}|${san}`;
                        if (seen.has(key)) return;
                        seen.add(key);
                        const isCorrectMove = san === sanMoves[i];
                        chips.push(
                          <span
                            key={`${at.attempt_no ?? at.attempted_at}-${i}-${san}`}
                            className={`font-mono rounded-full px-2 py-0.5 border shrink-0 ${isCorrectMove
                                ? 'border-green-500/40 bg-green-500/10 text-green-600'
                                : 'border-red-500/50 bg-red-500/15 text-red-600'
                              }`}
                          >
                            {san}
                          </span>
                        );
                      });
                    });
                    return chips;
                  })()}
                  {attemptsArr.reduce((acc, at) => acc + (at.time_taken ?? 0), 0) > 0 ? (
                    <span className="text-ivory-500 shrink-0 pl-1">
                      {attemptsArr.reduce((acc, at) => acc + (at.time_taken ?? 0), 0)}s
                    </span>
                  ) : null}
                </div>
              </>
            )
          ) : null}
        </div>
      )}
    </article>
  );
}