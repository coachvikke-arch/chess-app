import { useCallback, useEffect, useMemo, memo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Chess } from 'chess.js';
import ArenaBoard from '../components/ArenaBoard';
import PlayerAvatar from '../components/PlayerAvatar';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { useFullHeight } from '../context/FullHeightContext';
import usePageTitle from '../hooks/usePageTitle';
import useArrowKeys from '../hooks/useArrowKeys';
import { playSound } from '../utils/sound';
import { useSound } from '../context/SoundContext';
import { useShowLegalMoves } from '../config/legalMoves';

/* ------------------------------- helpers ---------------------------------- */

function rebuildGame(init, movesList) {
  const g = new Chess(init === 'start' ? undefined : init);
  for (const m of movesList) {
    try { g.move(m); } catch { break; }
  }
  return g;
}

function getHistory(g) {
  const verbose = g.history({ verbose: true });
  return { san: verbose.map((m) => m.san), last: verbose.length ? verbose[verbose.length - 1] : null };
}

const GLYPH = {
  w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' },
  b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' },
};
const MVAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function computeCaptured(init, movesList) {
  const g = rebuildGame(init, movesList);
  const hist = g.history({ verbose: true });
  const white = [], black = [];
  let wv = 0, bv = 0;
  for (const m of hist) {
    if (!m.captured) continue;
    const glyph = GLYPH[m.color === 'w' ? 'b' : 'w'][m.captured];
    if (m.color === 'w') { white.push(glyph); wv += MVAL[m.captured]; }
    else                 { black.push(glyph); bv += MVAL[m.captured]; }
  }
  return { white, black, whiteValue: wv, blackValue: bv };
}

const ARENA_NOTATION_KEY = 'knightpath-play-arena-notation';
const ARENA_HIGHLIGHT_KEY = 'knightpath-play-arena-highlight';

function readBoolPref(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === '1';
  } catch {
    return fallback;
  }
}

/* ================================ component ================================ */

const PLAY_ARENA_UI_CSS = `
/* ===== Play Arena — a plain board page ===== */
.ab-root.ab-root{
  height:100%;min-height:0;max-width:none;margin:0;padding:0;
  overflow:hidden;background:#F4F6FA;color:#0F172A;
}
.ab-root.ab-root .ab-layout{
  display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);
  grid-template-rows:minmax(0,1fr);gap:16px;
  height:100%;min-height:0;min-width:0;width:100%;
  max-width:1200px;margin:0 auto;padding:16px;box-sizing:border-box;
  align-items:stretch;overflow:hidden;
}

/* ── left: black strip, board, moves, white strip ── */
.ab-root.ab-root .ab-board-col{
  display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;
  gap:8px;height:100%;min-height:0;min-width:0;width:100%;overflow:hidden;
}
.ab-root.ab-root .ab-player-row{
  flex:0 0 auto;display:flex;align-items:center;gap:10px;
  height:48px;min-height:48px;max-height:48px;padding:0 12px;box-sizing:border-box;
  background:#fff;border:1px solid #E3E8F0;border-radius:12px;
  box-shadow:0 1px 2px rgba(15,23,42,.06);
}
.ab-root.ab-root .ab-avatar{flex:none;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;overflow:hidden;box-sizing:border-box;background:#F1F5F9}
.ab-root.ab-root .ab-avatar > img,
.ab-root.ab-root .ab-avatar > svg{width:100%;height:100%;display:block}
.ab-root.ab-root .ab-avatar-black{background:#1E293B;color:#F1F5F9;box-shadow:0 0 0 2px #1E293B}
.ab-root.ab-root .ab-avatar-white{background:#F1F5F9;color:#1E293B;box-shadow:0 0 0 2px #CBD5E1}
.ab-root.ab-root .ab-player-meta{display:flex;flex-direction:column;justify-content:center;min-width:0;line-height:1.2}
.ab-root.ab-root .ab-player-name{font-size:14px;font-weight:600;color:#0F172A;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ab-root.ab-root .ab-player-label{font-size:11px;color:#64748B}
.ab-root.ab-root .ab-clock{
  margin-left:auto;flex:none;padding:4px 10px;border-radius:8px;
  background:#F4F6FA;border:1px solid #E3E8F0;
}
.ab-root.ab-root .ab-clock-time{font-size:14px;font-weight:700;color:#0F172A}

/* board band — the square is sized from this box by the fit effect */
.ab-root.ab-root .ab-boardarea{
  flex:1 1 0;min-height:0;min-width:0;
  display:grid;place-items:center;overflow:hidden;
}
.ab-root.ab-root .ab-board-wrap{
  position:relative;display:flex;align-items:center;justify-content:center;
  max-width:100%;max-height:100%;min-height:0;
}
.ab-root.ab-root .ab-board-inner{
  display:flex;align-items:center;justify-content:center;
  width:auto;min-width:0;max-width:100%;
}

/* moves strip — one horizontal row, current move in the accent colour */
.ab-root.ab-root .ab-movestrip{
  flex:0 0 auto;display:flex;flex-wrap:nowrap;align-items:center;gap:4px;
  height:40px;min-height:40px;max-height:40px;box-sizing:border-box;
  overflow-x:auto;overflow-y:hidden;white-space:nowrap;overscroll-behavior-x:contain;
  background:#fff;border:1px solid #E3E8F0;border-radius:10px;padding:5px 10px;
  scrollbar-width:thin;box-shadow:0 1px 2px rgba(15,23,42,.06);
}
.ab-root.ab-root .ab-mvpair{flex:none;display:inline-flex;align-items:center;gap:2px}
.ab-root.ab-root .ab-mvnum{margin-left:10px;font:400 12px ui-monospace,Menlo,monospace;color:#64748B}
.ab-root.ab-root .ab-mv{flex:none;font-weight:600;font-size:14px;padding:3px 9px;border-radius:6px;cursor:pointer;color:#0F172A;background:transparent;border:0;line-height:1.3}
.ab-root.ab-root .ab-mv:hover{background:#EEF2F7}
.ab-root.ab-root .ab-mv.is-current{background:#DBEAFE;color:#111}
.ab-root.ab-root .ab-mv.is-latest:not(.is-current){background:#F1F5F9;box-shadow:inset 0 0 0 1px #CBD5E1}
.ab-root.ab-root .ab-moves-empty{font-size:13px;color:#64748B;white-space:nowrap}
.ab-root.ab-root .ab-note{flex:0 0 auto;margin:0;font-size:11px;color:#64748B;text-align:center}

/* ── right column ── */
.ab-root.ab-root .ab-side-panel{
  display:flex;flex-direction:column;gap:8px;
  width:auto;max-width:none;height:100%;min-height:0;min-width:0;
  margin-top:0 !important;max-height:none !important;position:static !important;
  overflow:hidden;align-self:stretch;
}

/* one row of six equal navigation buttons */
.ab-root.ab-root .ab-ctrl-row{
  display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px;flex:0 0 auto;
}
.ab-root.ab-root .ab-ctrl-row .ab-ctrl-btn{
  display:flex;align-items:center;justify-content:center;
  height:36px;padding:0;border-radius:8px;
  background:#fff;border:1px solid #E3E8F0;color:#475569;
  font-size:14px;line-height:1;cursor:pointer;
  box-shadow:0 1px 2px rgba(15,23,42,.06);
  transition:background .15s,border-color .15s,color .15s;
}
.ab-root.ab-root .ab-ctrl-row .ab-ctrl-btn:hover:not(:disabled){background:#EAF1FF;border-color:#2563EB;color:#2563EB}
.ab-root.ab-root .ab-ctrl-row .ab-ctrl-btn:disabled{opacity:.4;cursor:not-allowed}

/* FEN / PGN card — the only part of the column that can scroll */
.ab-root.ab-root .ab-info-card{
  flex:1 1 0;min-height:0;
  display:flex;flex-direction:column;
  background:#fff;border:1px solid #E3E8F0;border-radius:12px;
  padding:8px;box-sizing:border-box;overflow:hidden;
  box-shadow:0 1px 2px rgba(15,23,42,.06);
}
.ab-root.ab-root .ab-info-tabs{display:flex;gap:4px;flex:0 0 auto;margin-bottom:6px}
.ab-root.ab-root .ab-info-tab{
  font:inherit;font-size:12px;font-weight:700;line-height:1;
  padding:4px 12px;border-radius:999px;cursor:pointer;
  background:#fff;border:1px solid #E3E8F0;color:#64748B;
}
.ab-root.ab-root .ab-info-tab.is-active{background:#EAF1FF;border-color:#2563EB;color:#2563EB}
.ab-root.ab-root .ab-info-body{
  flex:1 1 auto;min-height:0;overflow:auto;margin:0;
  background:#F4F6FA;border-radius:8px;padding:8px;
  font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  color:#334155;white-space:pre-wrap;overflow-wrap:anywhere;
  scrollbar-width:thin;
}

/* Share / Download */
.ab-root.ab-root .ab-actions{
  display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;flex:0 0 auto;
  position:relative;
}
.ab-root.ab-root .ab-action-btn{
  display:flex;align-items:center;justify-content:center;gap:6px;
  width:100%;height:40px;border-radius:10px;
  background:#fff;border:1px solid #E3E8F0;color:#0F172A;
  font:inherit;font-size:13px;font-weight:600;cursor:pointer;
  box-shadow:0 1px 2px rgba(15,23,42,.06);
  transition:background .15s,border-color .15s,color .15s;
}
.ab-root.ab-root .ab-action-btn:hover{background:#EAF1FF;border-color:#2563EB;color:#2563EB}

/* Card wrappers used only by the desktop right column. Below 901px they
   collapse into their parent (display:contents) and their titles are hidden,
   so the phone/tablet tree keeps its original spacing. */
.ab-root.ab-root .ab-side-card{display:contents}
.ab-root.ab-root .ab-card-title{display:none}

/* short screens: shave the fixed rows, never the board */
@media (max-height:800px){
  .ab-root.ab-root .ab-layout{padding:10px 12px;gap:10px}
  .ab-root.ab-root .ab-board-col{gap:6px}
  .ab-root.ab-root .ab-side-panel{gap:6px}
  .ab-root.ab-root .ab-player-row{height:44px;min-height:44px;max-height:44px;padding:0 10px}
  .ab-root.ab-root .ab-ctrl-row .ab-ctrl-btn{height:32px}
  .ab-root.ab-root .ab-action-btn{height:36px}
  .ab-root.ab-root .ab-movestrip{height:36px;min-height:36px;max-height:36px}
  .ab-root.ab-root .ab-note{display:none}
}

/* ── phones / portrait tablets: one column, and the PAGE scrolls ── */
@media (max-width:900px){
  .ab-root.ab-root{height:auto;min-height:100%;overflow:visible}
  .ab-root.ab-root .ab-layout{
    display:flex;flex-direction:column;gap:8px;padding:8px 8px 20px;
    height:auto;min-height:0;overflow:visible;
  }
  .ab-root.ab-root .ab-board-col{flex:0 0 auto;height:auto;overflow:visible;gap:6px}
  .ab-root.ab-root .ab-boardarea{flex:0 0 auto;overflow:visible}
  .ab-root.ab-root .ab-side-panel{
    flex:0 0 auto;min-height:0;height:auto;
    overflow:visible;padding-bottom:8px;
  }
  .ab-root.ab-root .ab-info-card{flex:0 0 auto;height:auto;min-height:180px;max-height:260px}
  .ab-root.ab-root .ab-note{display:none}
}

/* ── laptops / desktops (901px+): the two-column board page ────────────────
   The board is a square sized from the viewport — height first, then whatever
   width the 360px side column leaves over — and the page itself never scrolls:
   the layout is exactly one viewport tall and only the FEN box scrolls. */
@media (min-width:901px){
  .ab-root.ab-root{
    --board:min(calc(100dvh - var(--app-nav-h,68px) - 104px),calc(100vw - 528px));
    --panel:360px;
  }
  .ab-root.ab-root .ab-layout{
    grid-template-columns:var(--board) var(--panel);
    justify-content:center;align-items:stretch;
    gap:14px;padding:8px 52px;
    height:100%;max-width:none;
  }

  /* left column — [opponent] [board] [you] */
  .ab-root.ab-root .ab-board-col{
    width:var(--board);height:100%;gap:4px;justify-content:flex-start;
  }
  .ab-root.ab-root .ab-player-row{height:40px;min-height:40px;max-height:40px;padding:0 10px}
  .ab-root.ab-root .ab-boardarea{flex:0 0 auto;width:var(--board);height:var(--board)}
  .ab-root.ab-root .ab-note{display:none}

  /* right column — one card per job, same height as the board column */
  .ab-root.ab-root .ab-side-panel{
    height:100%;gap:10px;overflow:hidden;
  }
  .ab-root.ab-root .ab-side-card{
    display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden;
    padding:10px;box-sizing:border-box;
    background:#fff;border:1px solid #E3E8F0;border-radius:14px;
    box-shadow:0 1px 2px rgba(15,23,42,.06);
  }
  .ab-root.ab-root .ab-card-title{
    display:block;flex:0 0 auto;
    font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
    color:#64748B;
  }
  .ab-root.ab-root .ab-side-card-moves{flex:0 0 auto}
  .ab-root.ab-root .ab-side-card-controls{flex:1 1 auto}

  /* Moves — the same horizontal strip, now a card of its own */
  .ab-root.ab-root .ab-side-card-moves .ab-movestrip{
    height:40px;min-height:40px;max-height:40px;width:100%;
  }

  /* Controls — nav row, FEN/PGN tabs, Share/Download, then the text box */
  .ab-root.ab-root .ab-side-card-controls .ab-info-card{display:contents}
  .ab-root.ab-root .ab-side-card-controls .ab-ctrl-row{order:1}
  .ab-root.ab-root .ab-side-card-controls .ab-info-tabs{order:2;margin-bottom:0}
  .ab-root.ab-root .ab-side-card-controls .ab-actions{order:3}
  .ab-root.ab-root .ab-side-card-controls .ab-info-body{
    order:4;flex:1 1 auto;min-height:90px;
  }
  .ab-root.ab-root .ab-side-card-controls .ab-ctrl-row .ab-ctrl-btn{height:34px}
  .ab-root.ab-root .ab-side-card-controls .ab-action-btn{height:36px}
}

/* Back to the student dashboard, top-left. Desktop only: at 901px+ this route
   hides the sidebar column, so the arrow is the way out of the page. Below
   901px the shell's Back row and the drawer already cover it. */
.ab-root .ab-back-btn{display:none}
@media (min-width:901px){
  .ab-root .ab-back-btn{
    position:fixed;top:calc(var(--app-nav-h,68px) + 10px);left:14px;z-index:45;
    width:38px;height:38px;padding:0;display:grid;place-items:center;
    border-radius:10px;border:1px solid #E3E8F0;background:#fff;color:#475569;
    font:inherit;font-size:18px;line-height:1;cursor:pointer;
    box-shadow:0 1px 2px rgba(15,23,42,.06);
    transition:background .15s,border-color .15s,color .15s;
  }
  .ab-root .ab-back-btn:hover{background:#EAF1FF;border-color:#2563EB;color:#2563EB}
  .ab-root .ab-back-btn:focus-visible{outline:2px solid #2563EB;outline-offset:2px}
}
`;

/* A callback whose identity never changes but whose body is always the current
   render's. The board is memoised, and an inline function prop would hand it a
   new identity on every parent render, which throws the memo away. */
function useStableCallback(fn) {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((...args) => ref.current(...args), []);
}

export default function AnalysisBoard() {
  usePageTitle('Analysis Board');
  const { requestFullHeight } = useFullHeight();
  useEffect(() => {
    requestFullHeight(true);
    return () => requestFullHeight(false);
  }, [requestFullHeight]);

  const location      = useLocation();
  const navigate      = useNavigate();
  const { user, pieceSet } = useAuth();
  const { showToast } = useToast();
  const { soundOn }   = useSound();
  const showLegal     = useShowLegalMoves();

  const gameRef = useRef(new Chess());

  const [initialFen, setInitialFen] = useState('start');
  const [moves,      setMoves]      = useState([]);
  const [moveIndex,  setMoveIndex]  = useState(0);
  const [fen,        setFen]        = useState(gameRef.current.fen());
  const [lastMove,   setLastMove]   = useState(null);
  const [orientation, setOrientation] = useState('white');
  const [boardOuter,  setBoardOuter]  = useState(440);
  const [infoTab,     setInfoTab]     = useState('fen');
  const [showNotation]  = useState(() => readBoolPref(ARENA_NOTATION_KEY, true));
  const [highlightLast] = useState(() => readBoolPref(ARENA_HIGHLIGHT_KEY, true));
  const boardAreaRef = useRef(null);
  const stripRef     = useRef(null);

  /* Mirrors the CSS breakpoint exactly (the stacked block stops at 900px). It
     only decides WHERE the moves pane is rendered — on desktop it is the right
     column's "Moves" card, below 901px it stays between the board and the
     bottom player strip. */
  const [wideArena, setWideArena] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(min-width: 901px)').matches
  ));
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 901px)');
    const onChange = (event) => setWideArena(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /* The board is the flexible band of the left column, so it is sized from the
     SPACE IT HAS rather than from the viewport/column width — that is what keeps
     the whole page inside the viewport with no page scroll. */
  useEffect(() => {
    const area = boardAreaRef.current;
    const solve = () => {
      const vw = window.innerWidth;
      const availW = area ? area.clientWidth : 0;
      const availH = area ? area.clientHeight : 0;
      /* Stacked (single-column) layouts size the board from the viewport height
         instead: the band there is not a flexible one. */
      const stacked = vw <= 900;
      const raw = stacked
        ? Math.min(availW || vw, Math.round(window.innerHeight * 0.46))
        : Math.min(availW || vw, availH || vw);
      /* A 4px shave keeps the board's edge from sitting flush against the band,
         where sub-pixel rounding can clip a border. */
      const budget = Math.max(160, raw - 4);
      const cap = vw < 640 ? 420 : vw < 901 ? 480 : 1600;
      setBoardOuter(Math.round(Math.max(160, Math.min(cap, budget))));
    };
    solve();
    const ro = (typeof ResizeObserver !== 'undefined' && area) ? new ResizeObserver(solve) : null;
    if (ro) ro.observe(area);
    window.addEventListener('resize', solve);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', solve); };
  }, [orientation]);

  /* Moves strip — keep the move being viewed centred in its single row. Writes
     the strip's own scrollLeft, never scrollIntoView, so it cannot drag the
     page sideways. */
  useEffect(() => {
    centreMoveStrip(stripRef.current);
  }, [moveIndex, moves.length]);

  const captured = useMemo(() => computeCaptured(initialFen, moves), [initialFen, moves]);

  /* ─── position helpers ──────────────────────────────────── */
  function sync() {
    const g = gameRef.current;
    const { san, last } = getHistory(g);
    setMoves(san);
    setMoveIndex(san.length);
    setFen(g.fen());
    setLastMove(last ? { from: last.from, to: last.to } : null);
  }

  function onBoardPositionChange() {
    sync();
  }

  function loadFen(f) {
    try {
      const g = new Chess(f);
      const hist = getHistory(g);
      gameRef.current = g;
      setInitialFen(f);
      setMoves(hist.san);
      setMoveIndex(hist.san.length);
      setFen(g.fen());
      setLastMove(hist.last ? { from: hist.last.from, to: hist.last.to } : null);
    } catch {
      // invalid FEN — leave the current position untouched
    }
  }

  function loadPgn(pgn) {
    try {
      const g = new Chess();
      g.loadPgn(pgn, { strict: false });
      const hist = getHistory(g);
      const headerFen = g.getHeaders?.().FEN;
      gameRef.current = g;
      setInitialFen(headerFen || 'start');
      setMoves(hist.san);
      setMoveIndex(hist.san.length);
      setFen(g.fen());
      setLastMove(hist.last ? { from: hist.last.from, to: hist.last.to } : null);
    } catch {
      // invalid PGN — leave the current position untouched
    }
  }

  /* A shared link carries the game: ?pgn= replays it, ?fen= restores a position. */
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const fenParam = params.get('fen');
    const pgnParam = params.get('pgn');
    if (pgnParam) loadPgn(pgnParam);
    else if (fenParam) loadFen(fenParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── navigation ─────────────────────────────────────────── */
  function goToMove(idx) {
    const target = Math.max(0, Math.min(moves.length, idx));
    const g = rebuildGame(initialFen, moves.slice(0, target));
    gameRef.current = g;
    setMoveIndex(target);
    setFen(g.fen());
    const hist = getHistory(g);
    setLastMove(hist.last ? { from: hist.last.from, to: hist.last.to } : null);
    if (soundOn) playSound('select');
  }

  /* The memoised move list needs a handler whose identity never changes; a fresh
     closure on every render would repaint the whole list anyway. */
  const handleNavMove = useStableCallback(goToMove);

  function undoMove() {
    if (moveIndex <= 0) return;
    goToMove(moveIndex - 1);
  }

  function redoMove() {
    if (moveIndex >= moves.length) return;
    /* Must go through goToMove, NOT game.move() + sync(): sync rebuilds `moves`
       from the current game, which would truncate the rest of the game. */
    goToMove(moveIndex + 1);
  }

  function reset() {
    /* Position-only reset: the move list is kept, so ▶ / ⏭ can replay it. */
    goToMove(0);
  }

  const handlePositionChange = useStableCallback(onBoardPositionChange);

  /* ← / → keyboard move navigation (matches the ⏮ ◀ ▶ ⏭ buttons) */
  useArrowKeys(undoMove, redoMove);

  /* ─── share / download ──────────────────────────────────── */
  async function share() {
    const pgn = gameRef.current.pgn();
    const payload = pgn ? `pgn=${encodeURIComponent(pgn)}` : `fen=${encodeURIComponent(fen)}`;
    const url = `${window.location.origin}${window.location.pathname}?${payload}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied to your clipboard.', { tone: 'success', title: 'Share' });
    } catch {
      showToast('Could not copy the link — your browser blocked the clipboard.', { tone: 'error', title: 'Share' });
    }
  }

  function downloadPgn() {
    const blob = new Blob([gameRef.current.pgn() || 'No moves yet'], { type: 'application/x-chess-pgn' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'analysis.pgn'; a.click();
    URL.revokeObjectURL(url);
    if (soundOn) playSound('good');
  }

  /* ─── derived display values ─────────────────────────────── */
  const topColor = orientation === 'white' ? 'black' : 'white';
  const selfProfile = user
    ? { id: user.id, name: user.name, profile_image: user.profile_image, avatar_config: user.avatar_config }
    : null;
  const isStudentRoute = location.pathname.startsWith('/student');

  const movesPane = (
    <MoveList
      moves={moves}
      moveIndex={moveIndex}
      goToMove={handleNavMove}
      containerRef={stripRef}
      emptyText="No moves yet. Play on the board or load a game."
    />
  );

  return (
    <div className="ab-root">
      <style>{PLAY_ARENA_UI_CSS}</style>
      {isStudentRoute && (
        <button
          type="button"
          className="ab-back-btn"
          onClick={() => navigate('/student/dashboard')}
          title="Back to dashboard"
          aria-label="Back to student dashboard"
        >
          <span aria-hidden="true">←</span>
        </button>
      )}

      <div className="ab-layout">
        {/* ════════════════ LEFT COLUMN — players, board, moves ════════════════ */}
        <div className="ab-board-col">

          {/* top player strip (the side opposite the viewer's seat) */}
          <div className="ab-player-row">
            <span className={`ab-avatar ${topColor === 'black' ? 'ab-avatar-black' : 'ab-avatar-white'}`}>
              <PlayerAvatar player={null} seed={`side_${topColor}`} size={32} />
            </span>
            <span className="ab-player-meta">
              <span className="ab-player-name">{topColor === 'white' ? '⚪ White' : '⚫ Black'}</span>
              <span className="ab-player-label">{topColor === 'white' ? 'White' : 'Black'}</span>
            </span>
            <CapturedTray
              pieces={captured[topColor]}
              diff={captured[`${topColor}Value`] - captured[`${topColor === 'white' ? 'black' : 'white'}Value`]}
            />
            <ClockBox color={topColor} />
          </div>

          {/* board — the flexible band; the square board is sized to fit it */}
          <div className="ab-boardarea" ref={boardAreaRef}>
            <div className="ab-board-wrap">
              <div className="ab-board-inner">
                <ArenaBoard
                  game={gameRef.current}
                  orientation={orientation}
                  outerWidth={boardOuter}
                  onPositionChange={handlePositionChange}
                  showLegalMoves={showLegal}
                  showNotation={showNotation}
                  soundOn={soundOn}
                  highlightLastMove={highlightLast}
                  lastMove={lastMove}
                  pieceTheme={pieceSet || 'auto'}
                />
              </div>
            </div>
          </div>

          {/* moves — one horizontal row. On desktop this pane is rendered in the
              right column instead, so the left column is exactly [opponent]
              [board] [you]. */}
          {!wideArena && movesPane}

          {/* bottom player strip (the viewer's seat) */}
          <div className="ab-player-row">
            <span className={`ab-avatar ${orientation === 'black' ? 'ab-avatar-black' : 'ab-avatar-white'}`}>
              <PlayerAvatar
                player={selfProfile}
                seed={user ? `user_${user.id}` : 'user_self'}
                size={32}
              />
            </span>
            <span className="ab-player-meta">
              <span className="ab-player-name">{orientation === 'white' ? '⚪ White' : '⚫ Black'}</span>
              <span className="ab-player-label">You, {orientation === 'white' ? 'White' : 'Black'}</span>
            </span>
            <CapturedTray
              pieces={captured[orientation]}
              diff={captured[`${orientation}Value`] - captured[`${orientation === 'white' ? 'black' : 'white'}Value`]}
            />
            <ClockBox color={orientation} />
          </div>

          <p className="ab-note">Click a piece, then a square to move. Use the arrows to replay.</p>
        </div>

        {/* ════════════════ SIDE PANEL ════════════════ */}
        <div className="ab-side-panel">

          {/* Moves — a card of its own on desktop; below 901px the same pane
              still renders under the board and this node is not mounted. */}
          {wideArena && (
            <div className="ab-side-card ab-side-card-moves">
              <span className="ab-card-title">Moves</span>
              {movesPane}
            </div>
          )}

          {/* Controls — nav row, FEN/PGN tabs, Share/Download, FEN box. */}
          <div className="ab-side-card ab-side-card-controls">
            <span className="ab-card-title">Controls</span>

            <div className="ab-ctrl-row" role="group" aria-label="Board navigation">
              <button type="button" onClick={() => goToMove(0)} disabled={moveIndex === 0} className="ab-ctrl-btn" title="First move">⏮</button>
              <button type="button" onClick={undoMove} disabled={moveIndex === 0} className="ab-ctrl-btn" title="Previous move">◀</button>
              <button type="button" onClick={redoMove} disabled={moveIndex >= moves.length} className="ab-ctrl-btn" title="Next move">▶</button>
              <button type="button" onClick={() => goToMove(moves.length)} disabled={moveIndex >= moves.length} className="ab-ctrl-btn" title="Last move">⏭</button>
              <button type="button" onClick={reset} disabled={moves.length === 0} className="ab-ctrl-btn" title="Reset position">↺</button>
              <button
                type="button"
                onClick={() => { setOrientation((o) => (o === 'white' ? 'black' : 'white')); if (soundOn) playSound('select'); }}
                className="ab-ctrl-btn"
                title="Flip board"
              >⇄</button>
            </div>

            {/* FEN / PGN readout — read-only, like the share link. */}
            <div className="ab-info-card">
              <div className="ab-info-tabs" role="tablist" aria-label="Position readout">
                <button
                  type="button"
                  role="tab"
                  aria-selected={infoTab === 'fen'}
                  className={`ab-info-tab${infoTab === 'fen' ? ' is-active' : ''}`}
                  onClick={() => setInfoTab('fen')}
                >
                  FEN
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={infoTab === 'pgn'}
                  className={`ab-info-tab${infoTab === 'pgn' ? ' is-active' : ''}`}
                  onClick={() => setInfoTab('pgn')}
                >
                  PGN
                </button>
              </div>
              <pre className="ab-info-body" role="tabpanel">
                {infoTab === 'fen'
                  ? fen
                  : (gameRef.current.pgn() || 'No moves yet.')}
              </pre>
            </div>

            <div className="ab-actions">
              <button type="button" className="ab-action-btn" onClick={share} title="Share">
                <span aria-hidden>🔗</span>
                <span>Share</span>
              </button>
              <button type="button" className="ab-action-btn" onClick={downloadPgn} title="Download PGN">
                <span aria-hidden>⬇</span>
                <span>Download</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ subcomponents ------------------------------ */

/* Keep the viewed move chip centred in its single row. Works on the element's
   own scrollLeft rather than scrollIntoView so it cannot move the page. */
function centreMoveStrip(strip) {
  if (!strip) return;
  const cur = strip.querySelector('.ab-mv.is-current');
  if (!cur) return;
  const chip = cur.getBoundingClientRect();
  const host = strip.getBoundingClientRect();
  const target = strip.scrollLeft + (chip.left - host.left) - (host.width - chip.width) / 2;
  const max = strip.scrollWidth - strip.clientWidth;
  strip.scrollTo({ left: Math.max(0, Math.min(max, target)), behavior: 'smooth' });
}

/* One row, standard notation — `1. e4 e5  2. Nf3 Nc6` — with the move number
   small and grey and every half-move its own tappable chip. A chip calls
   `goToMove`, so tapping re-VIEWS a position; it can never play one. */
const MoveList = memo(function MoveList({
  moves,
  moveIndex,
  goToMove,
  containerRef,
  emptyText,
}) {
  if (moves.length === 0) {
    return (
      <div className="ab-movestrip" ref={containerRef}>
        <span className="ab-moves-empty">{emptyText}</span>
      </div>
    );
  }

  const rows = Array.from({ length: Math.ceil(moves.length / 2) }, (_, i) => (
    <span key={i} className="ab-mvpair">
      <span className="ab-mvnum">{i + 1}.</span>
      {[0, 1].map((offset) => {
        const idx = i * 2 + offset;
        if (idx >= moves.length) return null;
        const current = idx + 1 === moveIndex;
        return (
          <button
            key={offset}
            type="button"
            onClick={() => goToMove(idx + 1)}
            className={`ab-mv${current ? ' is-current' : ''}${idx + 1 === moves.length ? ' is-latest' : ''}`}
          >
            {moves[idx]}
          </button>
        );
      })}
    </span>
  ));

  return (
    <div className="ab-movestrip" ref={containerRef}>
      {rows}
    </div>
  );
});

/* With every timed mode gone this page has no clock to run, so the strip keeps
   the same box and shows the idle readout the free-analysis board always had. */
function ClockBox({ color }) {
  return (
    <div className="ab-clock ab-clock-static">
      <span className="ab-clock-color">{color === 'white' ? '⚪' : '⚫'}</span>
      <span className="ab-clock-time">--:--</span>
    </div>
  );
}

function CapturedTray({ pieces, diff }) {
  if (pieces.length === 0) return null;
  return (
    <div className="ab-captured">
      {pieces.map((g, i) => (
        <span key={i} className={`cp ${['♔','♙','♘','♗','♖','♕'].includes(g) ? 'cp-white' : 'cp-black'}`}>{g}</span>
      ))}
      {diff !== 0 && <span className="cp-diff">{diff > 0 ? '+' : ''}{diff}</span>}
    </div>
  );
}
