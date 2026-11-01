
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, memo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { Chess } from 'chess.js';
import ArenaBoard from '../components/ArenaBoard';
import useVisibleEffectHost from '../hooks/useVisibleEffectHost';
import { PIECE_THEMES } from '../config/pieceTheme';
import { BOARD_THEMES, BOARD_THEMES_HIDDEN_IN_SETTINGS, getBoardTheme } from '../config/boardThemes';
import { useAutoQueen, setAutoQueen } from '../config/autoQueen';
import { useShowLegalMoves, setShowLegalMoves } from '../config/legalMoves';
import { framePalette, shade } from '../config/ornateTheme';
import { searchBest, searchTopMoves, stopEngineSearch } from '../utils/engine';
import { BOT_LEVELS, botLevelConfig, suggestedLevelForRating } from '../utils/botLevels';

import { Card } from '../components/ui';
import usePageTitle from '../hooks/usePageTitle';
import { playSound, unlockAudio } from '../utils/sound';
import { formatDateTime12 } from '../utils/time';
import { useSound } from '../context/SoundContext';
import { analyzeGame, accuracyFor, VERDICT_META } from '../utils/gameAnalysis';
import { clearMoveEffects, revealAfterCheckmate } from '../effects/moveEffect';
import { playEffectForMove } from '../effects/moveEffect/playForMove';
import { ANALYSIS_DEPTH, ANALYSIS_TIME_MS, ANALYSIS_MULTIPV } from '../utils/reviewConfig';
import PostGameResultPopup from '../components/PostGameResultPopup';
import PlayerAvatar from '../components/PlayerAvatar';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { matchRequestKey } from '../utils/toastDedupe';
import { useFullHeight } from '../context/FullHeightContext';
import { useLeaveGameGuard } from '../hooks/useLeaveGameGuard';
import LeaveGameConfirmDialog from '../components/LeaveGameConfirmDialog';
import {
  listUsers,
  listGames,
  listLiveSessions,
  createGame,
  fetchGame,
  acceptGame,
  declineGame,
  abortGame,
  resignGame,
  timeoutGame,
  sendMove,
  offerDraw,
  respondDraw,
  fetchRatingResult,
} from '../utils/online';
import {
  joinGameRoom,
  leaveGameRoom,
  onGameUpdate,
  sendGameReaction,
  onGameReaction,
  onGameInvite,
  onLiveGamesChanged,
  registerComputerSpec,
  updateComputerSpec,
  endComputerSpec,
} from '../services/socket';
import SpectatorBoard from '../components/SpectatorBoard';
import Modal from '../components/Modal';
import TimeControlPicker from '../components/TimeControlPicker';
import { isTimeControlValid, timeControlFamily } from '../utils/timeControl';
import { RATING_CLASS_BY_FAMILY, filterOnlinePlayers, ratingForPlayer, ratingPoolLabel } from '../utils/onlinePlayers';
import useArrowKeys from '../hooks/useArrowKeys';
import Button from '../components/Button';
import reactionAngry from '../assets/mp4/angry.mp4';
import reactionClap from '../assets/mp4/clap.mp4';
import reactionCrying from '../assets/mp4/crying.mp4';
import reactionFire from '../assets/mp4/fire.mp4';
import reactionHandshake from '../assets/mp4/handshake.mp4';
import reactionLaughing from '../assets/mp4/laughing.mp4';
import reactionParty from '../assets/mp4/party.mp4';
import reactionThumbsUp from '../assets/mp4/thumbs-up.mp4';
import reactionWow from '../assets/mp4/wow.mp4';

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

function getStatus(g) {
  if (g.isCheckmate()) {
    const winner = g.turn() === 'w' ? 'Black' : 'White';
    return { label: `Checkmate — ${winner} wins`, tone: 'red', over: true, winner };
  }
  if (g.isStalemate())          return { label: 'Stalemate — draw',              tone: 'amber', over: true,  winner: null };
  if (g.isThreefoldRepetition()) return { label: 'Draw by repetition',            tone: 'amber', over: true,  winner: null };
  if (g.isInsufficientMaterial()) return { label: 'Draw — insufficient material', tone: 'amber', over: true,  winner: null };
  if (g.isDrawByFiftyMoves())    return { label: 'Draw by fifty-move rule',       tone: 'amber', over: true,  winner: null };
  if (g.inCheck())               return { label: 'Check!',                        tone: 'gold',  over: false, winner: null };
  return { label: 'In Progress', tone: '', over: false, winner: null };
}

/* Human label for a persisted online termination reason. Unknown/absent reasons
   return null so callers can fall back to a neutral "Game Over" instead of
   inventing a cause. */
const ONLINE_REASON_LABELS = {
  checkmate: 'Checkmate',
  resignation: 'Resignation',
  timeout: 'Timeout',
  stalemate: 'Stalemate',
  repetition: 'Threefold repetition',
  'fifty-move': 'Fifty-move rule',
  insufficient: 'Insufficient material',
  agreement: 'Agreement',
  abandoned: 'Match ended',
  aborted: 'Match never started',
};

function onlineReasonLabel(reason) {
  return ONLINE_REASON_LABELS[reason] || null;
}

/* Rating-based bot level label: "Name · ~rating band" (see utils/botLevels). */
function skillLabel(level) {
  const lvl = botLevelConfig(level);
  return `${lvl.label} · ${lvl.ratingMax >= 9999 ? lvl.ratingMin + '+' : lvl.ratingMin + '-' + lvl.ratingMax}`;
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

function fmtClock(ms, forceFloor) {
  const s    = Math.max(0, ms / 1000);
  const secs = forceFloor ? Math.floor(s) : Math.ceil(s);
  const h    = Math.floor(secs / 3600);
  const m    = Math.floor((secs % 3600) / 60);
  const r    = String(secs % 60).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${r}`;
  return `${m}:${r}`;
}

function hexToRgba(hex, alpha) {
  if (!hex) return `rgba(59,130,246,${alpha})`;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return `rgba(59,130,246,${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function OnlinePlayerCard({ player, selected, timeClass, onSelect }) {
  const rating = ratingForPlayer(player, timeClass);
  const roleLabel = player.role === 'coach' ? 'Coach' : player.role === 'admin' ? 'Academy' : 'Unrated';
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`online-pick-card${selected ? ' online-pick-card-on' : ''}`}
      onClick={() => onSelect(player)}
    >
      <span className="online-pick-media">
        <PlayerAvatar player={player} size={40} />
        {selected && <span className="online-pick-check" aria-hidden="true">✓</span>}
      </span>
      <span className="online-pick-body">
        <span className="online-pick-name" title={player.name}>{player.name}</span>
        <span className="online-pick-meta">
          {rating != null ? (
            <span className="online-pick-rating">
              <b>{rating}</b> {ratingPoolLabel(timeClass)}
            </span>
          ) : (
            <span className="online-pick-rating online-pick-unrated">{roleLabel}</span>
          )}
          {player.online === true && <span className="online-pick-status">● Online</span>}
        </span>
      </span>
    </button>
  );
}

/* Common time-control presets — one click sets hours/base/inc.
   Lichess-style families: Bullet, Blitz, Rapid, Classical. */
const TIME_PRESETS = [
  { label: 'Bullet',   time: '1+0',  hours: 0, base: 1,  inc: 0,  icon: '⚡' },
  { label: 'Blitz',    time: '3+0',  hours: 0, base: 3,  inc: 0,  icon: '🔥' },
  { label: 'Blitz+',   time: '3+2',  hours: 0, base: 3,  inc: 2,  icon: '⏱' },
  { label: 'Rapid',    time: '10+0', hours: 0, base: 10, inc: 0,  icon: '🚀' },
  { label: 'Rapid+',   time: '15+10',hours: 0, base: 15, inc: 10, icon: '♟' },
  { label: 'Classical',time: '30+0', hours: 0, base: 30, inc: 0,  icon: '🏆' },
];

/* The Play Arena's tools. Each tile opens the shared centered modal; the
   modal body still calls the exact handlers the old inline sections used. */
const ARENA_TILES = [
  { id: 'online',   icon: '♟', label: 'Online Match',  desc: 'Invite a player to a live game — choose colour and time control.' },
  { id: 'computer', icon: '🤖', label: 'vs Computer',  desc: 'Practise against the engine at a level that suits your rating.' },
  { id: 'live',     icon: '👁', label: 'Live games',   desc: 'Watch games other players are playing right now.' },
  { id: 'annotate', icon: '✎', label: 'Annotate & Save', desc: 'Write notes on the position and save it to this device.' },
  { id: 'saved',    icon: '⚑', label: 'Saved',         desc: 'Reopen or delete an analysis you saved earlier.' },
  { id: 'settings', icon: '⚙', label: 'Settings',      desc: 'Board look and how the board behaves. Changes apply immediately.' },
];

const ARENA_NOTATION_KEY = 'knightpath-play-arena-notation';
const ARENA_HIGHLIGHT_KEY = 'knightpath-play-arena-highlight';
const ARENA_CONFIRM_MOVE_KEY = 'knightpath-play-arena-confirm-move';
const ARENA_HINTS_KEY = 'knightpath-play-arena-hints';
const ARENA_TAKEBACK_KEY = 'knightpath-play-arena-takeback';

/* Online time control is picked in <TimeControlPicker>: presets plus separate
   hours / minutes / increment chip rows, so every value is its own option. */

function readBoolPref(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === '1';
  } catch {
    return fallback;
  }
}

function writeBoolPref(key, value) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* storage may be unavailable — the in-memory choice still applies */
  }
}

/* ================================ component ================================ */

/* The Play Arena page board uses the flat look (no decorative frame). Set to
   false to bring the old framed board back. Play Mode is unaffected. */
const PAGE_BOARD_FLAT = true;

const PLAY_ARENA_UI_CSS = `
/* ===== Play Arena UI refresh (CSS only, no logic changes) ===== */
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

/* ── left: black card, board, moves, white card ── */
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
/* Player photo circle. The ring (dark for Black's seat, light for White's) is
   what the old B/W letter used to communicate, so the colour stays readable
   without printing a letter over the photo. */
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
.ab-root.ab-root .ab-clock.ab-clock-active{background:#EAF1FF;border-color:#2563EB;box-shadow:none}
.ab-root.ab-root .ab-clock.ab-clock-active .ab-clock-time{color:#2563EB}
.ab-root.ab-root .ab-clock.ab-clock-low{border-color:#DC2626}
.ab-root.ab-root .ab-clock.ab-clock-low .ab-clock-time{color:#DC2626}

/* board band — the square is sized from this box by the existing effect */
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
/* Play Mode trigger — its own compact row above the board, never over it */
.ab-root.ab-root .ab-board-toolbar{
  flex:0 0 auto;display:flex;justify-content:flex-end;align-items:center;gap:8px;
  margin:0 auto;padding:0;min-height:0;max-width:100%;
}
.ab-root.ab-root .ab-board-toolbar button{
  display:inline-flex;align-items:center;gap:6px;
  height:28px;padding:0 12px !important;font-size:12px !important;line-height:1;
  border-radius:8px !important;box-shadow:0 1px 2px rgba(15,23,42,.06) !important;
}

/* ── Resign / Offer Draw, behind the ⋮ menu ────────────────────────────────
   The two buttons used to sit permanently in the banner and in the Play Mode
   controls, which on a phone is exactly where a thumb lands — one mistap ended a
   game. They now live in a popover opened from a 3-dot button next to Play Mode.
   The trigger keeps its own size: the toolbar rule above shrinks every button to
   28px, and 28px is below the 44px minimum touch target.
   Deliberately NOT scoped under .ab-root — the same menu is mounted inside the
   Play Mode portal, which lives outside that subtree. */
.ab-menu-anchor{position:relative;display:inline-flex;flex:0 0 auto}
.ab-menu-btn{
  width:44px;height:44px;min-width:44px;min-height:44px;padding:0 !important;
  display:inline-flex;align-items:center;justify-content:center;
  border-radius:10px !important;font-size:20px;line-height:1;
  color:#334155;background:rgba(255,255,255,.72);
  border:1px solid #D7E0EE !important;box-shadow:0 1px 2px rgba(15,23,42,.06) !important;
  -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
}
.ab-menu-btn[aria-expanded="true"]{background:#EEF2F7;border-color:#2563EB !important;color:#2563EB}
.ab-menu-pop{
  position:absolute;top:calc(100% + 8px);right:0;z-index:60;
  display:flex;flex-direction:column;gap:4px;min-width:190px;padding:6px;
  background:rgba(248,250,252,.92);border:1px solid #D7E0EE;border-radius:12px;
  box-shadow:0 10px 28px rgba(15,23,42,.18);
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);
  /* Never run off the screen: the anchor sits at the right edge of a row that is
     already as wide as the board, so on a narrow phone this can only overshoot
     to the right. */
  max-width:min(190px,72vw);
}
.ab-menu-pop button{
  min-height:44px;justify-content:flex-start;gap:8px;width:100%;
  padding:0 12px !important;font-size:13px !important;font-weight:600;
  border-radius:9px !important;
}
.ab-menu-confirm{
  min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:0 10px;font-size:12px;font-weight:600;color:#B42318;
  background:#FEF3F2;border:1px solid #FDA29B;border-radius:9px;
}
.ab-menu-confirm>span{flex:1 1 auto;min-width:0}
.ab-menu-confirm>button{
  flex:0 0 auto;min-height:36px;width:auto;padding:0 10px !important;font-size:12px !important;
}

/* Play Mode is a dark surface: the same menu, in the overlay's own palette. */
.play-mode-overlay .ab-menu-btn{
  color:var(--ivory-100);background:var(--ink-800);
  border:1.5px solid var(--surface-border) !important;
}
.play-mode-overlay .ab-menu-btn:hover{background:var(--ink-900)}
.play-mode-overlay .ab-menu-btn[aria-expanded="true"]{background:var(--ink-900);color:var(--ivory-100)}
.play-mode-head-actions{display:inline-flex;align-items:center;gap:8px;flex:0 0 auto}
/* The waiting overlay is absolutely positioned inside the Play Mode board area,
   which index.css leaves unpositioned — without this it would anchor to the
   overlay itself and cover the whole screen. */
.play-mode-board-area{position:relative}
/* …and in the overlay's own palette, so the spinner reads on the dark surface. */
.play-mode-overlay .ab-waiting{background:rgba(15,23,42,.55)}
.play-mode-overlay .ab-waiting-text{color:var(--ivory-100)}
.play-mode-overlay .ab-waiting-spinner{border-color:rgba(236,205,118,.22);border-top-color:#ECD186}

/* ── "Waiting for opponent" — a spinner over the board, not a strip of text ──
   pointer-events:none so the overlay itself never swallows a tap; interaction is
   switched off separately by the board's own interactive prop. Unscoped for
   the same reason as the ⋮ menu: it also sits over the Play Mode portal board. */
.ab-waiting{
  position:absolute;inset:0;z-index:40;pointer-events:none;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
  background:rgba(255,255,255,.62);
  -webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);
  border-radius:inherit;
}
.ab-waiting-spinner{
  width:52px;height:52px;border-radius:50%;
  border:4px solid #DBE4F0;border-top-color:#2563EB;
  animation:ab-spin .8s linear infinite;
}
.ab-waiting-text{font-size:14px;font-weight:600;color:#334155}
@keyframes ab-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){
  .ab-waiting-spinner{animation-duration:2.4s}
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
.ab-root.ab-root .ab-mv.is-current{background:#2563EB;color:#fff}
.ab-root.ab-root .ab-moves-empty{font-size:13px;color:#64748B;white-space:nowrap}
.ab-root.ab-root .ab-note{flex:0 0 auto;margin:0;font-size:11px;color:#64748B;text-align:center}

/* review mode must never push the page taller than the viewport */
.ab-root.ab-root .ab-review-panel{flex:0 1 auto;min-height:0;max-height:45%;overflow:hidden}

/* ── right column ── */
.ab-root.ab-root .ab-side-panel{
  display:flex;flex-direction:column;gap:8px;
  width:auto;max-width:none;height:100%;min-height:0;min-width:0;
  margin-top:0 !important;max-height:none !important;position:static !important;
  overflow:hidden;align-self:stretch;
}
.ab-root.ab-root .ab-tool-grid{
  display:grid !important;grid-template-columns:repeat(2,minmax(0,1fr)) !important;gap:8px;
  flex:0 0 auto;
}
/* One button shape, a different accent per mode — the mixed-colour palette. */
.ab-root.ab-root #ab-tool-online{--tile-ink:#1D4ED8;--tile-line:#BFDBFE;--tile-fill:#EFF6FF;--tile-chip:#DBEAFE;--tile-ring:rgba(37,99,235,.2)}
.ab-root.ab-root #ab-tool-computer{--tile-ink:#6D28D9;--tile-line:#DDD6FE;--tile-fill:#F5F3FF;--tile-chip:#EDE9FE;--tile-ring:rgba(109,40,217,.18)}
.ab-root.ab-root #ab-tool-live{--tile-ink:#047857;--tile-line:#A7F3D0;--tile-fill:#ECFDF5;--tile-chip:#D1FAE5;--tile-ring:rgba(5,150,105,.18)}
.ab-root.ab-root #ab-tool-annotate{--tile-ink:#B45309;--tile-line:#FDE68A;--tile-fill:#FFFBEB;--tile-chip:#FEF3C7;--tile-ring:rgba(180,83,9,.18)}
.ab-root.ab-root #ab-tool-saved{--tile-ink:#BE185D;--tile-line:#FBCFE8;--tile-fill:#FDF2F8;--tile-chip:#FCE7F3;--tile-ring:rgba(190,24,93,.18)}
.ab-root.ab-root #ab-tool-settings{--tile-ink:#334155;--tile-line:#CBD5E1;--tile-fill:#F8FAFC;--tile-chip:#E2E8F0;--tile-ring:rgba(51,65,85,.16)}

.ab-root.ab-root .ab-tool-tile{
  display:flex !important;flex-direction:row !important;align-items:center;justify-content:flex-start;
  gap:14px;width:100%;height:67px;min-height:67px;padding:0 17px;box-sizing:border-box;
  font-size:21px;font-weight:500;text-align:left;white-space:nowrap;min-width:0;
  color:var(--tile-ink,#334155);
  background:linear-gradient(135deg,#fff 0%,var(--tile-fill,#F8FAFC) 100%);
  border:1px solid var(--tile-line,#E3E8F0);border-radius:12px;
  box-shadow:0 1px 2px rgba(15,23,42,.06);cursor:pointer;
  transition:background .15s,border-color .15s,color .15s,box-shadow .15s;
}
.ab-root.ab-root .ab-tool-tile:hover{background:var(--tile-fill,#F8FAFC);border-color:var(--tile-ink,#2563EB)}
.ab-root.ab-root .ab-tool-tile.is-active{
  background:var(--tile-fill,#EAF1FF);border-color:var(--tile-ink,#2563EB);color:var(--tile-ink,#2563EB);
  box-shadow:0 0 0 3px var(--tile-ring,rgba(37,99,235,.2));
}
.ab-root.ab-root .ab-tool-icon{
  flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:11px;
  font-size:25px;line-height:1;text-align:center;background:var(--tile-chip,#EEF2F7);
}
.ab-root.ab-root .ab-tool-label{flex:1 1 auto;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis}
.ab-root.ab-root .ab-tool-badge{margin-left:auto}

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

/* short screens: shave the fixed rows, never the board */
@media (max-height:800px){
  .ab-root.ab-root .ab-layout{padding:10px 12px;gap:10px}
  .ab-root.ab-root .ab-board-col{gap:6px}
  .ab-root.ab-root .ab-side-panel{gap:6px}
  .ab-root.ab-root .ab-tool-grid{gap:6px}
  .ab-root.ab-root .ab-tool-tile{height:59px;min-height:59px;font-size:20px;padding:0 15px}
  .ab-root.ab-root .ab-player-row{height:44px;min-height:44px;max-height:44px;padding:0 10px}
  .ab-root.ab-root .ab-ctrl-row .ab-ctrl-btn{height:32px}
  .ab-root.ab-root .ab-action-btn{height:36px}
  .ab-root.ab-root .ab-movestrip{height:36px;min-height:36px;max-height:36px}
  .ab-root.ab-root .ab-note{display:none}
}

/* ── phones / portrait tablets: one column, and the PAGE scrolls ──
   Nothing is clamped to the viewport here: the board, the tool tiles and the
   FEN/PGN card all sit in normal flow, so the reader can scroll from top to
   bottom. Piece dragging is unaffected — the board sets touch-action:none. */
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
  .ab-root.ab-root .ab-tool-tile{height:62px;min-height:62px;font-size:20px}
  .ab-root.ab-root .ab-info-card{flex:0 0 auto;height:auto;min-height:180px;max-height:260px}
  .ab-root.ab-root .ab-note{display:none}
}

/* phones: two big tiles per row still need the whole label visible, so the
   label may wrap instead of truncating. */
@media (max-width:640px){
  .ab-root.ab-root .ab-tool-tile{
    height:66px;min-height:66px;font-size:19px;gap:10px;padding:0 12px;
    white-space:normal;line-height:1.15;
  }
  .ab-root.ab-root .ab-tool-icon{font-size:22px;width:34px;height:34px;border-radius:9px}
  .ab-root.ab-root .ab-tool-label{white-space:normal}
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
  /* Reset on unmount: the shell is now persistent across routes, so the
     full-height flag must not leak into the next page. */
  useEffect(() => {
    requestFullHeight(true);
    return () => requestFullHeight(false);
  }, [requestFullHeight]);

  const location      = useLocation();
  const navigate      = useNavigate();
  const { user, boardTheme: savedBoardTheme, pieceSet, boardFrame, updatePrefs } = useAuth();
  /* Play Arena renders its board WITHOUT a `frameless` prop, so ChessBoard falls
     back to this saved preference (ChessBoard.jsx: `frameless === null ?
     boardFrame : !frameless`). The board-fit maths below must reserve room for
     that frame, or the band pushes the bottom of the board out of the overlay. */
  const showPmFrame = !!boardFrame;
  const { showToast } = useToast();
  const gameRef       = useRef(new Chess());
  const engineToken   = useRef(0);
  const computerToken = useRef(0);
  const analysisToken = useRef(0);

  const [initialFen, setInitialFen] = useState('start');
  const [moves,      setMoves]      = useState([]);
  const [moveIndex,  setMoveIndex]  = useState(0);
  const [fen,        setFen]        = useState(gameRef.current.fen());
  const [status,     setStatus]     = useState({ label: 'In Progress', tone: '', over: false, winner: null });
  const [lastMove,   setLastMove]   = useState(null);
  const [boardResetKey, setBoardResetKey] = useState(0);
  const [resettingPlayArena, setResettingPlayArena] = useState(false);
  const resetInProgressRef = useRef(false);
  const arenaResetVersionRef = useRef(0);
  const notificationPanelOpenRef = useRef(false);
  /* The result card is held back while a mating move's animation plays. */
  const [resultRevealPending, setResultRevealPending] = useState(false);
  const resultRevealCancelRef = useRef(null);
  const pendingRevealToRef = useRef(null);
  /* Only a live online finish deserves the animation wait; a game opened from
     history shows its result immediately. */
  const onlineSeenActiveRef = useRef(null);

  const [orientation,   setOrientation]   = useState('white');
  const [boardWidth,    setBoardWidth]    = useState(440);
  const boardColRef     = useRef(null);          // measured so the board fills its column proportionally
  /* Side-panel alignment: the board column stacks [top player row] → [toolbar]
     → [board], but the side panel is a grid sibling with `align-items: start`,
     so it begins at the very top of the row and its first card ("♟ Online
     Match") floats well above the board. These two refs + `panelOffset` drop
     the panel down so its sections start level with the top of the board. */
  const layoutRef       = useRef(null);          // the .ab-layout grid
  const boardInnerRef   = useRef(null);          // the board itself
  /* The flexible band the board sits in. Measured so the square board can be
     sized from the space it actually has (see the responsiveness effect). */
  const boardAreaRef    = useRef(null);
  /* The single-row moves strip, so the move being viewed can be kept centred. */
  const stripRef        = useRef(null);
  const [panelOffset,   setPanelOffset]   = useState(0);
  /* Play Mode — fullscreen immersive overlay. Purely a VIEW switch: the page
     (and every game/time/connection state) stays mounted underneath. */
  const [playMode,      setPlayMode]      = useState(false);
  const { open: leaveOpen, stay: leaveStay, leave: leaveLeave } = useLeaveGameGuard(playMode);

  /* The two boards this page mounts: the page board and the full-screen Play
     Mode board (a portal above the page). They share ONE Chess instance, so a
     move applied on either is seen by both — and the effect run is global, so
     the board that is behind the other one must never take the effect.
     Naming them lets every effect be addressed to the board the user is
     actually looking at. */
  const pageBoardHostId = useId();
  const playModeBoardHostId = useId();
  useVisibleEffectHost(playMode ? playModeBoardHostId : pageBoardHostId);
  const pmAreaRef       = useRef(null);          // overlay board area (measured for auto-fit)
  const [pmSize,        setPmSize]        = useState({ w: 0, h: 0 });
  /* Sound is an APP-WIDE preference, not a Play Arena one. It used to be local
     `useState` seeded to `true`, which meant the toggle reset on every visit,
     no other board could see it, and Settings had no way to change it. Reading
     it from `useSound()` means the switch here, in Settings, or anywhere else
     all drive the same persisted value — and every board in the app follows. */
  const { soundOn, setSoundOn, volume, setVolume } = useSound();
  const showLegal = useShowLegalMoves();
  const autoQueen = useAutoQueen();
  const [showNotation,  setShowNotation]  = useState(() => readBoolPref(ARENA_NOTATION_KEY, true));
  const [highlightLast, setHighlightLast] = useState(() => readBoolPref(ARENA_HIGHLIGHT_KEY, true));
  const [confirmMove,   setConfirmMoveState] = useState(() => readBoolPref(ARENA_CONFIRM_MOVE_KEY, false));
  const [computerHints, setComputerHintsState] = useState(() => readBoolPref(ARENA_HINTS_KEY, false));
  const [computerTakeback, setComputerTakebackState] = useState(() => readBoolPref(ARENA_TAKEBACK_KEY, true));
  /* One state value drives all six popups: null | online | computer | live |
     annotate | saved | settings. The Modal instance below reads it. */
  const [activePopup, setActivePopup] = useState(null);
  const popupTriggerRef = useRef(null);
  const [computerColorChoice, setComputerColorChoice] = useState('black');
  const [onlineOpponentType, setOnlineOpponentType] = useState('player');
  const [onlineSearching, setOnlineSearching] = useState(false);
  const onlineSearchToken = useRef(0);
  const [onlineWaiting, setOnlineWaiting] = useState(null);
  const [saveTags, setSaveTags] = useState('');
  const [saveVisibility, setSaveVisibility] = useState('private');
  const [annotationError, setAnnotationError] = useState('');
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const annotationBaseline = useRef(null);
  const [savedQuery, setSavedQuery] = useState('');
  const [savedDeleteId, setSavedDeleteId] = useState(null);
  const [pendingConfirm, setPendingConfirm] = useState(null);
  /* Derived from the saved preference rather than copied into state: the copy
     needed an effect to stay in sync and could still paint one stale frame
     after a change made elsewhere (Settings page, another mounted board). */
  const pieceSel = pieceSet || 'cburnett';

  const setNotationPref = (value) => {
    setShowNotation(value);
    writeBoolPref(ARENA_NOTATION_KEY, value);
  };
  const setHighlightPref = (value) => {
    setHighlightLast(value);
    writeBoolPref(ARENA_HIGHLIGHT_KEY, value);
  };
  const setConfirmMovePref = (value) => {
    setConfirmMoveState(value);
    writeBoolPref(ARENA_CONFIRM_MOVE_KEY, value);
    if (!value) setPendingConfirm(null);
  };
  const setComputerHints = (value) => {
    setComputerHintsState(value);
    writeBoolPref(ARENA_HINTS_KEY, value);
  };
  const setComputerTakeback = (value) => {
    setComputerTakebackState(value);
    writeBoolPref(ARENA_TAKEBACK_KEY, value);
  };

  function openPopup(id, trigger) {
    popupTriggerRef.current = trigger || null;
    setActivePopup(id);
    setDiscardConfirm(false);
    setAnnotationError('');
    if (id === 'annotate') {
      annotationBaseline.current = { title: saveName, notes, tags: saveTags, visibility: saveVisibility };
    }
    if (id === 'live') refreshLive();
    if (id === 'online') {
      setOnlineSearching(false);
      loadOnlineUsers();
      refreshOnlineMatches();
    }
    if (id === 'saved') setSavedDeleteId(null);
  }

  function closePopup() {
    onlineSearchToken.current += 1;
    setOnlineSearching(false);
    setOnlineWaiting(null);
    setDiscardConfirm(false);
    setActivePopup(null);
  }

  function annotationDirty() {
    const base = annotationBaseline.current;
    if (!base) return false;
    return base.title !== saveName
      || base.notes !== notes
      || base.tags !== saveTags
      || base.visibility !== saveVisibility;
  }

  function requestClosePopup() {
    if (activePopup === 'annotate' && annotationDirty()) {
      setDiscardConfirm(true);
      return;
    }
    closePopup();
  }

  const popupMeta = ARENA_TILES.find((t) => t.id === activePopup) || null;

  /* theme-tinted CSS vars for the ⛶ Play Mode button (matches the board frame) */
  const pmTheme = getBoardTheme(savedBoardTheme);
  const pmPal = framePalette(pmTheme);
  const pmCss = {
    '--pm-gold': pmPal.gold,
    '--pm-gold-soft': hexToRgba(pmPal.gold, 0.55),
    '--pm-gold-tint': hexToRgba(pmPal.gold, 0.16),
    '--pm-gold-tint-hover': hexToRgba(pmPal.gold, 0.32),
    '--pm-text': shade(pmPal.gold, -0.38),
    '--pm-shadow': hexToRgba(pmTheme.darkSq, 0.28),
    /* overlay vars — accent on the dark immersive background: */
    '--pmg': pmPal.gold,
    '--pmg-bright': shade(pmPal.gold, 0.22),
    '--pmg-darktext': shade(pmPal.gold, -0.38),
    '--pmg-soft': hexToRgba(pmPal.gold, 0.55),
    '--pmg-line': hexToRgba(pmPal.gold, 0.2),
    '--pmg-tint': hexToRgba(pmPal.gold, 0.12),
    '--pmg-wash': hexToRgba(pmPal.gold, 0.22),
    '--pmg-glow': hexToRgba(pmPal.gold, 0.35),
  };

  /* The Play Arena's inline position editor ("Setup Board") was removed, and with
     it every piece of setup-mode state. Nothing on this page places pieces on the
     board any more; Game Review and the Library still open the shared
     CustomizePositionModal. */

  /* The engine is always on now that the Start/Stop panel is gone, so this is a
     plain constant rather than state. `refreshEngine` and the ChessBoard's
     `engineOn` prop still read it exactly as before. */
  const engineOn = true;
  const [thinking,  setThinking]  = useState(false);
  /* `evalDiff` was deleted here: the ♜ Engine panel was its only reader. */
  const [best,      setBest]      = useState(null);
  const [bestFen,   setBestFen]   = useState('');
  const [lines,     setLines]     = useState([]);

  const [notes,    setNotes]    = useState('');
  const [saveName, setSaveName] = useState('');
  const [shareMsg, setShareMsg] = useState('');

  /* online */
  const [onlineUsers,     setOnlineUsers]     = useState([]);
  const [onlineUsersLoading, setOnlineUsersLoading] = useState(false);
  const [onlineUsersError, setOnlineUsersError] = useState('');
  const [onlineSearch,    setOnlineSearch]    = useState('');
  const [onlineSelId,     setOnlineSelId]     = useState('');
  const [onlineSelName,   setOnlineSelName]   = useState('');
  const [onlineMatches,   setOnlineMatches]   = useState([]);
  const [onlineGame,      setOnlineGame]      = useState(null);
  const [onlineMyColor,   setOnlineMyColor]   = useState('white');
  const [onlineTurn,      setOnlineTurn]      = useState('white');
  const [onlineColorSel,  setOnlineColorSel]  = useState('white');
  const [timeSel,         setTimeSel]         = useState({ hours: 0, base: 5, inc: 0 });
  const [onlineBusy,      setOnlineBusy]      = useState(false);
  const [onlineError,     setOnlineError]     = useState('');
  const [onlineNotice,    setOnlineNotice]    = useState('');
  const [inviteBar,       setInviteBar]       = useState(null);   // bottom-of-page invite bar
  /* Pending draw offer on the open game: { byName, mine, at } or null.
     `mine` distinguishes "I offered, waiting" from "they offered, I must
     answer" — the same row carries both states and only that flag tells them
     apart, so it is read straight off the server payload rather than guessed. */
  const [drawOffer,       setDrawOffer]       = useState(null);
  const inviteBarTimer    = useRef(null);
  const onlineSelStudent  = useRef(null);
  /* Cards show the rating pool the picked clock belongs to, and the search +
     self filter run on the directory the API already returned. */
  const onlineTimeClass   = RATING_CLASS_BY_FAMILY[timeControlFamily(timeSel)] || 'rapid';
  const visibleOnlinePlayers = filterOnlinePlayers(onlineUsers, {
    query: onlineSearch,
    excludeId: user?.id,
  });
  const onlineSelectedPlayer =
    onlineUsers.find((u) => String(u.id) === String(onlineSelId)) || null;
  const onlineGameRef     = useRef(null);
  const activeGameIdRef   = useRef(null);
  const ignoredGameIdsRef = useRef(new Set());
  const gameSocketCleanupRef = useRef(null);
  const reactionSocketCleanupRef = useRef(null);
  const flagSentRef       = useRef(null);

  /* The last position this board actually RENDERED, as `{ id, ply, pgn }`.
     Every inbound update — the socket push, the 2.5 s poll, and the reply to
     your own `sendMove` — is checked against it, so the same move arriving twice
     is applied once and an update that is BEHIND the board (a poll that lost the
     race) can never roll a piece back and replay it. Keyed by game id so a new
     match starting at ply 0 is not mistaken for a stale row. */
  const appliedRef        = useRef({ id: null, ply: 0, pgn: '' });

  /* live-game spectating: sessions announced by other players' clients */
  const specKeyRef        = useRef(null);
  const [liveSessions,    setLiveSessions]    = useState([]);
  const [liveRefreshing,  setLiveRefreshing]  = useState(false);
  const [spectateSession, setSpectateSession] = useState(null);

  /* computer */
  const [computerOn,       setComputerOn]       = useState(false);
  const [computerColor,    setComputerColor]    = useState('black');
  const [computerLevel,    setComputerLevel]    = useState(() =>
    Math.max(1, Math.min(12, suggestedLevelForRating(user?.chess_rating || user?.rating || 1000)))
  );
  const [computerThinking, setComputerThinking] = useState(false);

  /* fair-fight bot suggestion based on the student's rating (if known) */
  const recommendedLevel = suggestedLevelForRating(user?.chess_rating || user?.rating || 1000);

  /* clock */
  const [clock,        setClock]        = useState(null);
  const [clockRunning, setClockRunning] = useState(false);
  const [clockOver,    setClockOver]    = useState(null);
  const [reviewMode,   setReviewMode]   = useState(false); // dismiss overlay, browse finished game

  /* reactions / analysis */
  const [playerReactions, setPlayerReactions] = useState({ mine: null, opponent: null });
  const [reactionCooling, setReactionCooling] = useState(false);
  const [pressedReaction, setPressedReaction] = useState('');
  const [showReactPicker, setShowReactPicker] = useState(false);
  /* Which readout the FEN / PGN card shows. Presentation only. */
  const [infoTab,         setInfoTab]         = useState('fen');
  const reactionId        = useRef(0);
  const reactionCooldownRef = useRef(0);
  const reactionTimersRef = useRef({ mine: null, opponent: null, cooldown: null, pressed: null });
  const [gameAnalysis,    setGameAnalysis]    = useState(null);
  const [analyzing,       setAnalyzing]       = useState(false);
  const [showReviewPopup, setShowReviewPopup] = useState(false);
  const [confetti,        setConfetti]        = useState([]);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);

  /* post-game result popup — auto-opens on game end, dismissible + re-openable */
  const [resultPopup,   setResultPopup]   = useState(null);   // descriptor or null
  const [resultDismiss, setResultDismiss] = useState(false);
  const resultSeenRef   = useRef(null);                       // which game-end we already showed
  const gameSessionIdRef = useRef(`local-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  /* The result card is shown ONCE per game: undoing and redoing the mating move
     replays the animation but never the card. That guard now lives in the
     popup's own reveal key (effects/moveEffect/completion.js), so there is no
     second copy of it here. */
  const savedGameRef    = useRef(null);                       // which computer game-end we already saved to DB

  /* My rating change for the game that just finished, or null.
     Fetched from its own participant-scoped endpoint rather than read off the
     game payload, because the game state is broadcast to BOTH players - a delta
     travelling with it would expose the opponent's rating. Null for bot games:
     they are never rated, so there is no number to show. */
  const [ratingResult, setRatingResult] = useState(null);

  /* ─── responsiveness ─────────────────────────────────────── */
  /* The board is now the flexible band of the left column, so its square is
     sized from the SPACE IT HAS rather than from the viewport/column width —
     that is what keeps the whole page inside the viewport with no page scroll.

     The themed frame around the board is not a fixed ratio: ChessBoard sizes
     its band as `remC = clamp(boardWidth * 0.082, 20, 46)` plus a 13px frame
     pad on each side, so the outer width is `boardWidth + 2*remC + 26`. remC
     depends on boardWidth, so the fit is a fixed-point solve (guess, measure
     the implied outer size, correct) — the same one the Play Mode board uses.
     It converges because remC is monotonic in boardWidth. */
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
      const budget = Math.max(160, raw - 4);
      const cap = vw < 640 ? 340 : vw < 1024 ? 420 : 620;

      if (!showPmFrame || PAGE_BOARD_FLAT) {
        setBoardWidth(Math.round(Math.max(160, Math.min(cap, budget))));
        return;
      }
      const remC = (w) => Math.min(46, Math.max(20, Math.round(w * 0.082)));
      let w = Math.min(cap, budget);
      for (let i = 0; i < 8; i += 1) {
        const outer = w + 2 * remC(w) + 26;
        const next = budget - (outer - w);
        if (Math.abs(next - w) < 1) { w = next; break; }
        w = next;
      }
      setBoardWidth(Math.round(Math.max(160, Math.min(cap, w))));
    };
    solve();
    const ro = (typeof ResizeObserver !== 'undefined' && area) ? new ResizeObserver(solve) : null;
    if (ro) ro.observe(area);
    window.addEventListener('resize', solve);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', solve); };
  }, [showPmFrame, orientation, playMode]);

  /* Moves strip — keep the move being viewed centred in its single row.
   *
   * Done by writing the strip's OWN scrollLeft, not with scrollIntoView.
   * scrollIntoView walks every scrollable ancestor, so on a phone it could drag
   * the PAGE sideways/vertically to bring the chip into view — that was the page
   * shake during a game. This only ever moves the strip. */
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const cur = strip.querySelector('.ab-mv.is-current');
    if (!cur) return;
    const target = cur.offsetLeft - (strip.clientWidth - cur.offsetWidth) / 2;
    const max = strip.scrollWidth - strip.clientWidth;
    strip.scrollTo({ left: Math.max(0, Math.min(max, target)), behavior: 'smooth' });
  }, [moveIndex, moves.length]);

  /* Side-panel alignment — keep the ♟/🤖/👁/⚙ cards level with the BOARD.
     The board column puts a player row and the Play Mode toolbar ABOVE the
     board, so the measured distance from the top of the grid down to the top
     of the board is exactly the amount the side panel needs to be nudged to
     line up with it.

     This is measured rather than hard-coded because the offset is not a
     constant: the setup banner appears/disappears above the board, the player
     rows wrap, and the board itself is responsive — so any fixed value would
     drift out of alignment on some viewport.

     Below 960px `.ab-layout` collapses to a single column and the panel drops
     UNDER the board, so the offset is removed entirely (and re-measured when
     the layout flips back, which the resize listener covers). */
  useEffect(() => {
    const layout = layoutRef.current;
    const board  = boardInnerRef.current;
    if (!layout || !board) return;

    const measure = () => {
      // Single column → panel is below the board, no offset wanted.
      if (window.innerWidth <= 960) { setPanelOffset(0); return; }
      const delta = board.getBoundingClientRect().top - layout.getBoundingClientRect().top;
      setPanelOffset((prev) => (Math.abs(prev - delta) < 1 ? prev : Math.max(0, Math.round(delta))));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(board);
    ro.observe(layout);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [boardWidth, orientation, playMode]);

  /* Play Mode — measure the overlay's board area so the board auto-fits the
     available fullscreen space (bigger squares, comfortable on any screen). */
  useEffect(() => {
    if (!playMode) return;
    const el = pmAreaRef.current;
    if (!el) return;
    const set = () => {
      /* Measure the CONTENT box, not the border box. getBoundingClientRect()
         includes padding, and this element's padding differs by breakpoint
         (3.5rem top on desktop for the fixed ✕, 0.75rem all round on mobile),
         so hard-coding the subtraction would be wrong at one of the two sizes.
         Reading the resolved padding keeps the fit exact at both. */
      const cs = window.getComputedStyle(el);
      const px = (v) => (parseFloat(v) || 0);
      const w = el.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
      const h = el.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom);
      setPmSize({ w: Math.floor(w), h: Math.floor(h) });
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [playMode]);

  /* Play Mode — close with the Escape key (common fullscreen expectation). */
  useEffect(() => {
    if (!playMode) return;
    const onKey = (e) => { if (e.key === 'Escape') setPlayMode(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playMode]);

  const captured = useMemo(() => computeCaptured(initialFen, moves), [initialFen, moves]);

  /* Play Mode — board size derived from the measured board area, clamped so it
     can never overflow; falls back to the normal board before the first measure.

     The themed frame around the board is NOT a fixed ratio: ChessBoard sizes its
     band as `remC = clamp(boardWidth * 0.082, 20, 46)` plus a 13px frame pad on
     each side, so the outer width is `boardWidth + 2*remC + 26`. An older version
     approximated that as `/1.164`, which under-sizes a large board (at 560px the
     real frame adds 118px, not 87px). The overlay area is the other half of the
     same trap: measuring its PADDED box, or budgeting no frame at all, overflows
     it and `overflow: hidden` cuts the bottom off the board.

     Both are handled below. The frame is deliberately NOT disabled here — with
     `frameless`, ChessBoard returns early and never renders its a-h / 1-8
     coordinate labels (ChessBoard.jsx), so the band is what carries them. */
  const pmBoardWidth = (() => {
    /* pmSize is already the CONTENT box of .play-mode-board-area: the measuring
       effect above subtracts the resolved padding, which differs per breakpoint.
       So the whole area is available here. */
    const availW = pmSize.w;
    const availH = pmSize.h;
    if (availW <= 0 || availH <= 0) return boardWidth;

    /* ChessBoard is rendered here WITHOUT a `frameless` prop, so it follows the
       user's saved frame preference (useAuth boardFrame). When that frame is on,
       the rendered element is `boardWidth + 2*remC + 26` across — the marble
       band (remC, 20..46px a side) plus 13px of frame padding a side. Sizing to
       the raw area therefore overflowed and the bottom of the board was cut off
       by the overlay's `overflow: hidden`.

       So the fit has to budget for the frame the board will actually draw. The
       same fixed-point solve as the main board is correct here: remC depends on
       boardWidth, so guess, measure the implied outer width, and correct. It
       converges because remC is monotonic in boardWidth. */
    const budget = Math.min(availW, availH);
    if (!showPmFrame) {
      /* No frame: the board IS the full square. A 4px shave keeps its edge from
         sitting flush against the viewport where sub-pixel rounding can clip a
         border. */
      return Math.round(Math.max(160, budget - 4));
    }

    const remC = (w) => Math.min(46, Math.max(20, Math.round(w * 0.082)));
    let w = budget;
    for (let i = 0; i < 8; i += 1) {
      const outer = w + 2 * remC(w) + 26;
      const next = budget - (outer - w);
      if (Math.abs(next - w) < 1) { w = next; break; }
      w = next;
    }
    return Math.round(Math.max(160, w));
  })();

  /* Sound no longer needs pushing into the module here: `useSound()` writes
     straight through to `utils/sound`, which owns persistence. The old effects
     ran on every render and are what made the old per-page toggle fight the
     module-level `enabled` flag. */

  /* ─── sync helper ────────────────────────────────────────── */
  /* Checkmate: keep both result surfaces (page overlay and Play Mode popup)
     hidden until the mating animation has finished. Keyed by destination so the
     position-change and move callbacks for one move cannot restart the wait. */
  function waitForMateReveal(to) {
    /* Destinations repeat, so key by the resulting position: a redo of the
       same mating move is the same attempt, but a different game/line is not. */
    const key = `${to || 'any'}:${gameRef.current?.fen?.() || ''}`;
    if (pendingRevealToRef.current === key) return;
    pendingRevealToRef.current = key;
    if (resultRevealCancelRef.current) { resultRevealCancelRef.current(); resultRevealCancelRef.current = null; }
    setResultRevealPending(true);
    resultRevealCancelRef.current = revealAfterCheckmate({ to }, () => {
      resultRevealCancelRef.current = null;
      /* Keep the key set: a later sync() on this same mating position must not
         re-arm the gate and hide the card it just showed. `clearMateReveal`
         (any other position, any load/reset) is what releases it. */
      setResultRevealPending(false);
    });
  }

  function clearMateReveal() {
    if (!resultRevealCancelRef.current && pendingRevealToRef.current == null) return;
    if (resultRevealCancelRef.current) { resultRevealCancelRef.current(); resultRevealCancelRef.current = null; }
    pendingRevealToRef.current = null;
    setResultRevealPending(false);
  }

  function sync() {
    const g = gameRef.current;
    const { san, last } = getHistory(g);
    setFen(g.fen());
    setMoves(san);
    setMoveIndex(san.length);
    setLastMove(last ? { from: last.from, to: last.to } : null);
    setStatus(getStatus(g));

    if (g.isCheckmate()) waitForMateReveal(last?.to);
    else clearMateReveal();

    if (engineOn && !(inOnline)) refreshEngine();
  }

  /* `evalDiff` was removed with the ♜ Engine panel: that readout was its only
     consumer, and runEngine writes it on every search, so keeping the state
     would leave a value computed constantly and never read. */
  function setEvalFromScore(_pawns) {
    /* no-op — re-wire here if the eval is ever displayed again (see the note at
       the old Engine section in the side panel). */
  }

  async function runEngine() {
    /* Live analysis and the computer share one engine pool. While it's the
       bot's turn in a computer game, skip the live analysis so the bot's own
       search never queues behind a length-5s multi-PV search — otherwise the
       bot appears to freeze for 10+ seconds after every human move. */
    if (computerOn && !inOnline && gameRef.current.turn() !== (computerColor === 'white' ? 'w' : 'b')) return;
    const token = ++engineToken.current;
    setThinking(true);
    await new Promise((r) => setTimeout(r, 40));
    if (token !== engineToken.current) return;
    try {
      const g   = gameRef.current;
      const top = await searchTopMoves(g.fen(), { maxDepth: ANALYSIS_DEPTH, timeMs: ANALYSIS_TIME_MS, multiPv: ANALYSIS_MULTIPV });
      if (token !== engineToken.current) return;
      const res = top[0] || null;
      setLines(top.slice(0, 3));
      setBest(res);
      setBestFen(g.fen());
      if (res) setEvalFromScore(res.score / 100);
      else if (g.isCheckmate()) setEvalFromScore(g.turn() === 'w' ? -1000 : 1000);
      else if (g.isDraw() || g.isInsufficientMaterial()) setEvalFromScore(0);
    } catch {
      if (token === engineToken.current) { setBest(null); setLines([]); setBestFen(''); }
    } finally {
      if (token === engineToken.current) setThinking(false);
    }
  }

  function refreshEngine() {
    if (!engineOn) return;
    runEngine();
  }

  /* ─── load from URL ──────────────────────────────────────── */

  /* Deep-link into one online game: /analysis?game=<id>

     Accepting a match request navigates here, so without this the board would
     open EMPTY and "accept took me to the board" would look broken even though
     the navigation did happen. The row is re-scoped to this viewer before being
     applied - exactly like the polling path does - so a link cannot be used to
     drive somebody else's board, and only a game this viewer is actually part of
     may be opened. */
  useEffect(() => {
    const gameId = new URLSearchParams(location.search).get('game');
    if (!gameId) return undefined;
    let cancelled = false;
    fetchGame(gameId)
      .then((row) => {
        if (cancelled || !row) return;
        const mine = row.meId === user?.id ? row : null;
        if (!mine) return;
        if (ignoredGameIdsRef.current.has(String(mine.id))) return;
        if (!['active', 'finished', 'pending'].includes(mine.status)) return;
        applyOnlineRow(mine);
        setOnlineNotice(
          mine.status === 'active'
            ? 'Loaded your live game.'
            : mine.status === 'pending'
              ? 'Loaded your pending challenge.'
              : 'Loaded your finished game.'
        );
        if (soundOn) playSound('good');
      })
      .catch(() => { /* a stale link must never break the page */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const fenParam = params.get('fen');
    const pgnParam = params.get('pgn');
    if (fenParam || pgnParam) {
      if (pgnParam) loadPgn(pgnParam, true);
      else loadFen(fenParam, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.get('fen') && !params.get('pgn')) refreshEngine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!status.over) return;
    /* Stop the clock when the game is over. `liveRemaining` only freezes while
       `clockRunning` is false, and every computer-game finish path returned
       early on `isGameOver()` without ever clearing it - so after checkmate the
       side that just moved kept ticking down forever, even though the result
       popup was already up.

       Only ever set false here: this must never restart a clock, or undoing a
       move with goToMove (which recomputes status from an earlier position)
       would silently resume a finished game. */
    setClockRunning(false);
    if (soundOn) playSound('victory');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.over]);

  /* ─── game setters ───────────────────────────────────────── */
  function setGame(g, init, movesList) {
    gameRef.current = g;
    setInitialFen(init);
    setMoves(movesList);
    setMoveIndex(movesList.length);
    setFen(g.fen());
    const { last } = getHistory(g);
    setLastMove(last ? { from: last.from, to: last.to } : null);
    setStatus(getStatus(g));
    clearMateReveal();
    refreshEngine();
  }

  function loadFen(f, silent) {
    try {
      const g = new Chess(f);
      /* A new position is not the move the previous effect belonged to. */
      clearMoveEffects('load-fen');
      const hist = getHistory(g);
      gameRef.current = g;
      setInitialFen(f);
      setMoves(hist.san);
      setMoveIndex(hist.san.length);
      setFen(g.fen());
      setLastMove(hist.last ? { from: hist.last.from, to: hist.last.to } : null);
      setStatus(getStatus(g));
      clearMateReveal();
      refreshEngine();
    } catch {
      // invalid FEN — leave the current position untouched
    }
  }

  function loadPgn(pgn, silent) {
    try {
      const startPos = gameRef.current.fen();
      const g = new Chess(startPos === 'start' ? undefined : startPos);
      g.loadPgn(pgn, { strict: false });
      /* Loading a PGN lands somewhere other than the effect's move. */
      clearMoveEffects('load-pgn');
      const hist = getHistory(g);
      gameRef.current = g;
      setMoves(hist.san);
      setMoveIndex(hist.san.length);
      setFen(g.fen());
      setLastMove(hist.last ? { from: hist.last.from, to: hist.last.to } : null);
      setStatus(getStatus(g));
      clearMateReveal();
      refreshEngine();
    } catch {
      // invalid PGN — leave the current position untouched
    }
  }

  function clearOnline(clocks) {
    onlineSeenActiveRef.current = null;
    clearMateReveal();
    setOnlineGame(null);
    onlineGameRef.current = null;
    activeGameIdRef.current = null;
    setOnlineMyColor('white');
    setOnlineTurn('white');
    clearTimeout(reactionTimersRef.current.mine);
    clearTimeout(reactionTimersRef.current.opponent);
    setPlayerReactions({ mine: null, opponent: null });
    setShowReactPicker(false);
    flagSentRef.current  = null;
    /* An offer belongs to ONE match. Without this it survives leaving the board
       and the next game opens showing "X offers a draw" for a game nobody is
       playing. */
    setDrawOffer(null);
    if (clocks) { setClock(null); setClockRunning(false); }
  }

  function onBoardPositionChange() {
    if (inOnline) return;
    /* With "Confirm move" on, the move is already applied to the shared game
       but not yet committed. Let onBoardMove own the sync so the move list and
       clocks do not advance before the player confirms. */
    if (confirmMove && computerOn && !status.over) return;
    sync();
  }

  function commitBoardMove(move) {
    if (inOnline) {
      if (gameRef.current.isCheckmate()) waitForMateReveal(move.to);
      const moverColor = onlineMyColor;
      /* The board has already put this move on the shared game, so the position is
         live before the server ever answers. Record it as applied — otherwise the
         `sendMove` reply, and every socket/poll carrying the same PGN, would look
         like a NEW position and rebuild the board under the player's own move. */
      appliedRef.current = {
        id: onlineGame.id,
        ply: gameRef.current.history().length,
        pgn: gameRef.current.pgn(),
      };
      sendMove(onlineGame.id, { from: move.from, to: move.to, promotion: move.promotion || 'q' })
        .then((row) => applyOnline(row))
        .catch(() => {
          try { gameRef.current.undo(); } catch { /* ignore */ }
          sync();
          /* The move never reached the server, so the ply recorded above is one
             ahead of reality. Put the marker back or the next genuine update —
             which is now legitimately shorter — would be dismissed as stale. */
          appliedRef.current = {
            id: onlineGame.id,
            ply: gameRef.current.history().length,
            pgn: gameRef.current.pgn(),
          };
        });
      bumpClock(moverColor);
      return;
    }
    if (computerOn) {
      bumpClock(computerColor);
      scheduleComputerMove();
    }
    sync();
  }

  function onBoardMove(move) {
    /* "Confirm move" only gates live play (online / vs computer), not free
       analysis or review. The board has already applied the move to the shared
       Chess instance; we hold it here until the player confirms. */
    if (confirmMove && (inOnline || computerOn) && !status.over && !reviewMode) {
      setPendingConfirm({ move });
      return;
    }
    commitBoardMove(move);
  }

  function confirmPendingMove() {
    const move = pendingConfirm?.move;
    setPendingConfirm(null);
    if (move) commitBoardMove(move);
  }

  function cancelPendingMove() {
    setPendingConfirm(null);
    try { gameRef.current.undo(); } catch { /* move may already be gone */ }
    sync();
  }

  /* Stable identities for the two props the memoised board receives from the
     page, so a panel opening or a clock state change cannot repaint it. */
  const handlePositionChange = useStableCallback(onBoardPositionChange);
  const handleBoardMove      = useStableCallback(onBoardMove);

  /* ─── navigation ─────────────────────────────────────────── */
  function goToMove(idx) {
    const target = Math.max(0, Math.min(moves.length, idx));
    const g = rebuildGame(initialFen, moves.slice(0, target));
    gameRef.current = g;
    setMoveIndex(target);
    setFen(g.fen());
    const hist = getHistory(g);
    setLastMove(hist.last ? { from: hist.last.from, to: hist.last.to } : null);
    setStatus(getStatus(g));
    const verdict = gameAnalysis?.verdicts?.[target - 1];
    playEffectForMove(target, 'analysis-review', {
      game: g,
      verdict: verdict?.verdict || null,
      sacrifice: Boolean(verdict?.sacrifice),
      orientation,
    });
    refreshEngine();
    if (soundOn) playSound('select');
  }

  /* The memoised move list needs a handler whose identity never changes; a fresh
     closure on every render would repaint the whole list anyway. */
  const handleNavMove = useStableCallback(goToMove);

  /* Same for the verdict array: `gameAnalysis` is rebuilt by the analysis run, so
     reading `.verdicts` off it inline hands the list a new array every render. */
  const verdictList = gameAnalysis?.verdicts || null;

  function undoMove() {
    if (moveIndex <= 0) return;
    goToMove(moveIndex - 1);
  }

  function redoMove() {
    if (moveIndex >= moves.length) return;
    /* Must go through goToMove, NOT `game.move(...)` + sync().
       `sync()` rebuilds `moves` from the CURRENT game, so replaying a single
       move after undoing several truncated the move list: a 10-move game
       undone 3 times and redone once came back as 8 moves, with the rest of
       the game destroyed. goToMove rebuilds from the full `moves` array and
       never rewrites it, so redo is non-destructive. */
    goToMove(moveIndex + 1);
  }

  function reset() {
    /* Position-only reset. This used to call setMoves([]), which silently
       deleted the entire game — a rated game lost to a "Reset position"
       click, with no way to get it back. Keeping the move list means the game
       can simply be replayed with ▶ / ⏭. Starting a genuinely fresh game is
       the separate "♞ New game" button (startNewGame / fullReset). */
    goToMove(0);
  }

  function startNewGame() {
    gameSessionIdRef.current = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    loadFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', false);
  }

  function markCurrentResultSeen(onlineId = null) {
    const gameId = onlineId != null ? `online-${onlineId}`
      : onlineGame?.id ? `online-${onlineGame.id}` : gameSessionIdRef.current;
    try {
      const key = `mz-result-seen-${user?.id || 'anon'}`;
      const ids = JSON.parse(localStorage.getItem(key) || '[]');
      const next = [...new Set([...ids, gameId])].slice(-100);
      localStorage.setItem(key, JSON.stringify(next));
    } catch { /* storage can be disabled; the in-memory guard still applies */ }
    resultSeenRef.current = gameId;
  }

  function fullReset() {
    markCurrentResultSeen();
    endSpecSession();
    clearOnline(true);
    setComputerOn(false);
    computerToken.current++;
    setComputerThinking(false);
    setClockOver(null);
    setGameAnalysis(null);
    setAnalyzing(false);
    setReviewMode(false);
    setResultPopup(null);
    setResultDismiss(false);
    startNewGame();
  }

  async function resetPlayArena() {
    if (resetInProgressRef.current) return;
    resetInProgressRef.current = true;
    setResettingPlayArena(true);

    const oldGameId = onlineGame?.id ?? onlineWaiting?.id ?? activeGameIdRef.current;
    const pendingId = onlineWaiting?.id ?? (onlineGame?.status === 'pending' ? onlineGame.id : null);
    if (oldGameId != null) ignoredGameIdsRef.current.add(String(oldGameId));
    if (pendingId != null) ignoredGameIdsRef.current.add(String(pendingId));
    if (oldGameId != null) markCurrentResultSeen(oldGameId);
    else markCurrentResultSeen();

    // Detach the precise game handler and leave its room before changing state.
    const cleanupGameSocket = gameSocketCleanupRef.current;
    cleanupGameSocket?.();
    gameSocketCleanupRef.current = null;
    reactionSocketCleanupRef.current?.();
    reactionSocketCleanupRef.current = null;
    if (!cleanupGameSocket && oldGameId != null) leaveGameRoom(oldGameId);
    onlineGameRef.current = null;
    activeGameIdRef.current = null;
    onlineSeenActiveRef.current = null;

    // Withdraw a still-pending challenge without surfacing a toast or error.
    if (pendingId != null) {
      const cancelPending = onlineWaiting?.id || onlineGame?.canAbort
        ? abortGame(pendingId)
        : declineGame(pendingId);
      cancelPending.catch(() => {});
    }
    endSpecSession();
    onlineSearchToken.current += 1;
    arenaResetVersionRef.current += 1;
    computerToken.current += 1;
    engineToken.current += 1;
    analysisToken.current += 1;
    clearMateReveal();
    Object.values(reactionTimersRef.current).forEach((timer) => clearTimeout(timer));
    reactionTimersRef.current = { mine: null, opponent: null, cooldown: null, pressed: null };
    window.clearTimeout(inviteBarTimer.current);
    window.clearTimeout(showOnlineNotice._t);

    // Play Arena does not persist game snapshots. Clear known legacy snapshot
    // keys while preserving the result-seen marker, sign-in and board settings.
    const transientKeys = [
      'mz-active-game', 'mz-active-game-id', 'mz-game-state', 'mz-saved-fen',
      'mz-saved-pgn', 'mz-saved-clocks', 'mz-result',
    ];
    for (const store of [window.localStorage, window.sessionStorage]) {
      try {
        transientKeys.forEach((key) => store.removeItem(key));
      } catch { /* storage may be unavailable */ }
    }

    // The mount-time `?game=` loader is the only restore path for online games.
    if (location.search) navigate(location.pathname, { replace: true });

    const fresh = new Chess();
    gameRef.current = fresh;
    setInitialFen('start'); setMoves([]); setMoveIndex(0); setFen(fresh.fen());
    setLastMove(null); setStatus(getStatus(fresh)); setBoardResetKey((key) => key + 1);
    setOrientation('white'); setPlayMode(false);
    setComputerOn(false); setComputerThinking(false); setComputerColor('black');
    setClock(null); setClockRunning(false); setClockOver(null);
    setTimeSel({ hours: 0, base: 5, inc: 0 });
    setOnlineGame(null); setOnlineMyColor('white'); setOnlineTurn('white');
    setOnlineSelId(''); setOnlineSelName(''); onlineSelStudent.current = null;
    setOnlineColorSel('white'); setOnlineOpponentType('player');
    setOnlineBusy(false); setOnlineSearching(false); setOnlineWaiting(null);
    setOnlineError(''); setOnlineNotice(''); setInviteBar(null); setDrawOffer(null);
    setPendingConfirm(null); setActivePopup(null);
    setPlayerReactions({ mine: null, opponent: null }); setShowReactPicker(false);
    setReactionCooling(false); setPressedReaction(''); reactionCooldownRef.current = 0;
    setSpectateSession(null); setLiveSessions([]); setLiveRefreshing(false);
    setGameAnalysis(null); setAnalyzing(false); setAnalyzeProgress(0);
    setThinking(false); setBest(null); setBestFen(''); setLines([]);
    setReviewMode(false); setResultPopup(null); setResultDismiss(false);
    setResultRevealPending(false); setRatingResult(null); setConfetti([]);
    setShowReviewPopup(false);
    setInfoTab('fen');
    appliedRef.current = { id: null, ply: 0, pgn: '' };
    flagSentRef.current = oldGameId ?? null; savedGameRef.current = null;
    gameSessionIdRef.current = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    refreshOnlineMatches();

    window.setTimeout(() => {
      resetInProgressRef.current = false;
      setResettingPlayArena(false);
    }, 350);
  }

  /* Rematch — same mode/color/level/time, fresh board */
  function rematch() {
    markCurrentResultSeen();
    setReviewMode(false);
    setClockOver(null);
    setGameAnalysis(null);
    setAnalyzing(false);
    setResultPopup(null);
    setResultDismiss(false);
    if (computerOn || clockOver) {
      // restart computer game with same settings
      startComputerGame(computerColor);
    } else {
      startNewGame();
    }
  }

  /* Review — dismiss overlay, auto-analyze, navigate to start */
  function startReview() {
    setReviewMode(true);
    // go to move 0 so user steps forward through the game
    goToMove(0);
    // auto-run analysis if not already done
    if (!gameAnalysis && !analyzing && moves.length > 0) {
      runGameAnalysis();
    }
  }

  /* Open Game Review — navigate to the full /review page with this game's PGN.
     The standalone Game Review screen auto-runs Stockfish analysis and shows
     accuracy + per-move classification (Brilliant/Best/Blunder…) with badges. */
  function goToGameReview() {
    const prefix = location.pathname.startsWith('/admin') ? 'admin' : 'student';
    const pgn = gameRef.current.pgn();
    let query = (pgn && moves.length > 0)
      ? `?pgn=${encodeURIComponent(pgn)}`
      : `?fen=${encodeURIComponent(gameRef.current.fen())}`;
    // also pass the exact online-game session id when it exists, so the review
    // is identifiable against Game History / Analysis for that specific game.
    if (onlineGame && onlineGame.id) query += `${query.includes('=') ? '&' : ''}id=${encodeURIComponent(onlineGame.id)}&src=online`;
    navigate(`/${prefix}/review${query}`);
  }

  /* ─── engine ───────────────────────────────────────────────
     With the ♜ Engine panel gone there is no Start/Stop button, so the engine is
     always on. `stopEngineSearch` now runs on unmount instead: without a Stop
     control, navigating away would otherwise leave a depth-22 search running
     against a dead component. */
  useEffect(() => () => {
    engineToken.current++;
    stopEngineSearch();
    if (resultRevealCancelRef.current) {
      resultRevealCancelRef.current();
      resultRevealCancelRef.current = null;
    }
    pendingRevealToRef.current = null;
  }, []);

  /* ─── save / share ───────────────────────────────────────── */
  function saveAnalysis() {
    const title = saveName.trim();
    if (!title) {
      setAnnotationError('Give this analysis a title before saving.');
      return;
    }
    setAnnotationError('');
    const list = JSON.parse(localStorage.getItem('kpa_analyses') || '[]');
    const tags = saveTags.split(',').map((t) => t.trim()).filter(Boolean);
    const item = {
      id:    `a_${Date.now()}`,
      name:  title,
      fen, pgn: gameRef.current.pgn(), notes,
      tags,
      visibility: saveVisibility,
      at: formatDateTime12(new Date()),
    };
    list.unshift(item);
    localStorage.setItem('kpa_analyses', JSON.stringify(list));
    setSaveName('');
    setSaveTags('');
    setSaveVisibility('private');
    annotationBaseline.current = null;
    setDiscardConfirm(false);
    refreshSaved();
    setActivePopup(null);
    if (soundOn) playSound('good');
    showToast('Analysis saved to this device.', { tone: 'success', title: 'Saved' });
  }

  function deleteSaved(id) {
    const list = JSON.parse(localStorage.getItem('kpa_analyses') || '[]').filter((s) => s.id !== id);
    localStorage.setItem('kpa_analyses', JSON.stringify(list));
    setSavedDeleteId(null);
    refreshSaved();
  }

  async function share() {
    const pgn = gameRef.current.pgn();
    const payload = pgn ? `pgn=${encodeURIComponent(pgn)}` : `fen=${encodeURIComponent(fen)}`;
    const url = `${window.location.origin}${window.location.pathname}?${payload}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareMsg('Link copied!');
    } catch {
      setShareMsg(url);
    }
    setTimeout(() => setShareMsg(''), 3500);
  }

  function copyText(text, what) {
    navigator.clipboard?.writeText(text).then(() => setShareMsg(`${what} copied!`)).catch(() => {});
    setTimeout(() => setShareMsg(''), 2500);
  }

  function downloadPgn() {
    const blob = new Blob([gameRef.current.pgn() || 'No moves yet'], { type: 'application/x-chess-pgn' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'analysis.pgn'; a.click();
    URL.revokeObjectURL(url);
    if (soundOn) playSound('good');
  }

  /* ─── clock helpers ──────────────────────────────────────── */
  function bumpClock(moverColor) {
    setClock((prev) => {
      if (!prev) return prev;
      const now = Date.now();
      const key = moverColor === 'white' ? 'whiteMs' : 'blackMs';
      const remaining = Math.max(0, prev[key] - Math.max(0, now - (prev.serverNow || prev.startedAt)));
      return {
        ...prev,
        [key]: remaining + prev.incMs,
        turn: moverColor === 'white' ? 'black' : 'white',
        startedAt: now,
        serverNow: now,
      };
    });
  }

  function liveRemaining(color) {
    if (!clock) return 0;
    const stored = color === 'white' ? clock.whiteMs : clock.blackMs;
    if (!clockRunning || clock.turn !== color) return stored;
    return Math.max(0, stored - Math.max(0, Date.now() - (clock.serverNow || Date.now())));
  }

  /* derived: is an online game currently active? */
  const inOnline = onlineGame && onlineGame.status === 'active';
  const canReact = Boolean(!spectateSession && ((inOnline && onlineGame?.myColor) || computerOn));

  /* Which colour is the LOCAL player? Drives the "move-self" vs
     "move-opponent" sample. Against the bot it is the bot's OPPONENT's colour,
     because `computerColor` - despite the name - stores the colour the human
     plays (see startComputerGame: `setComputerColor(playAs)` together with
     `setOrientation(playAs)`). So the local colour IS computerColor, and
     inverting it here (as this used to) made the board treat the human as the
     opponent whenever they played White against the bot - the wrong cue played
     for every move. Online it is the side we picked; in free play both sides are
     us, so null (which the board reads as "every move is self"). */
  const selfColorCode = computerOn
    ? (computerColor === 'white' ? 'w' : 'b')
    : inOnline
      ? (onlineColorSel === 'white' ? 'w' : 'b')
      : null;

  /* ← / → keyboard move navigation (matches the ⏮ ◀ ▶ ⏭ buttons) */
  useArrowKeys(undoMove, redoMove, { enabled: !inOnline });

  /* computer flag-fall */
  useEffect(() => {
    if (!computerOn || !clockRunning || !clock || inOnline) return;
    /* `computerColor` holds the colour the HUMAN plays (misnomer - see
       startComputerGame), so it is the human whose flag we watch here. */
    const human = computerColor;
    const bot = human === 'white' ? 'black' : 'white';
    const t = setInterval(() => {
      /* The bot had no flag-fall check at all, so if it ever ran its clock out
         the game never ended and its clock sat pinned at 00:00 forever. Rare,
         but it left the game unfinishable with no way out but "Exit game". */
      if (clock?.turn === bot && liveRemaining(bot) <= 0) {
        clearInterval(t);
        setClockRunning(false);
        setComputerThinking(false);
        setComputerOn(false);
        computerToken.current++;
        setClockOver({ winner: human, humanWon: true, title: 'You won on time', sub: `${skillLabel(computerLevel)} ran out of time.` });
        return;
      }
      if (clock?.turn === human && liveRemaining(human) <= 0) {
        clearInterval(t);
        setClockRunning(false);
        setComputerThinking(false);
        setComputerOn(false);
        computerToken.current++;
        setClockOver({ winner: bot, humanWon: false, title: 'You lost on time', sub: 'Better luck next time!' });
      }
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computerOn, clockRunning, computerColor, clock?.turn]);

  /* online flag-fall — report the clock, NOT a resignation.
   *
   * This used to ride on the page-wide 200 ms `clockTick`, which is exactly why
   * the tick existed. That counter is gone (see GameClock) so this effect owns
   * its own interval, and only the two colours' remaining time is read through
   * the pure helper rather than a closure over the render. */
  useEffect(() => {
    if (!inOnline || !clockRunning || !clock) return undefined;
    const check = () => {
      if (clock.turn !== onlineMyColor) return;
      if (remainingMs(clock, true, onlineMyColor) > 0) return;
      if (flagSentRef.current !== onlineGame.id) {
        flagSentRef.current = onlineGame.id;
        flagOnlineCurrent();
      }
    };
    check();
    const t = setInterval(check, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inOnline, clockRunning, clock, onlineMyColor]);

  /* ─── computer mode ──────────────────────────────────────── */
  /* ─── live-game spectating helpers ─────────────────────── */
  function endSpecSession() {
    if (specKeyRef.current) {
      endComputerSpec(specKeyRef.current);
      specKeyRef.current = null;
    }
  }

  function pushSpec(key, patch) {
    if (!key) return;
    updateComputerSpec({ key, ...patch });
  }

  async function refreshLive() {
    setLiveRefreshing(true);
    try {
      const rows = await listLiveSessions();
      setLiveSessions((rows || []).filter((s) => s.status === 'active'));
    } catch {
      /* keep the last known list */
    } finally {
      setLiveRefreshing(false);
    }
  }

  /* keep the live-games modal fresh while it's open: poll as a fallback, and
     drop a card the instant the server says that board is over. Only the one
     finished game is removed locally (no refetch, no flicker); the pending
     move/result of every other card is untouched. */
  useEffect(() => {
    if (activePopup !== 'live') return undefined;
    refreshLive();
    const t = setInterval(refreshLive, 5000);
    const offEnded = onLiveGamesChanged((evt) => {
      const id = evt?.gameId;
      if (id == null) return;
      setLiveSessions((prev) => prev.filter(
        (s) => !(s.type === 'online' && String(s.gameId) === String(id))
      ));
    });
    return () => { clearInterval(t); offEnded(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePopup]);

  /* broadcast live updates of my computer game to spectators — interval-based so
     updates keep flowing even while our clocks tick every 250 ms (the previous
     trailing-350ms-timeout effect was reset by every tick and never fired) */
  const livePublish = useRef({});
  const clockRef = useRef(null);
  const clockRunningRef = useRef(false);
  livePublish.current = {
    fen: gameRef.current.fen(),
    pgn: gameRef.current.pgn(),
    clk: clock,
    over: status.over,
    winner: status.winner,
  };
  clockRef.current = clock;
  clockRunningRef.current = clockRunning;
  useEffect(() => {
    if (!computerOn || !specKeyRef.current) return;
    const key = specKeyRef.current;
    const t = setInterval(() => {
      if (specKeyRef.current !== key) return;
      const p = livePublish.current;
      const clk = clockRef.current;
      if (!clk) return;
      const remaining = (color) => {
        const stored = color === 'white' ? clk.whiteMs : clk.blackMs;
        if (!clockRunningRef.current || clk.turn !== color) return stored;
        return Math.max(0, stored - Math.max(0, Date.now() - (clk.serverNow || clk.startedAt)));
      };
      pushSpec(key, {
        fen: p.fen,
        pgn: p.pgn,
        whiteMs: Math.round(remaining('white')),
        blackMs: Math.round(remaining('black')),
        turn: clk.turn,
        status: p.over ? 'finished' : 'active',
        result: p.winner ? (p.winner === 'White' ? 'white' : 'black') : null,
      });
    }, 800);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computerOn]);

  /* my computer game finished by checkmate/flag → push final state + unregister */
  useEffect(() => {
    if (!computerOn || !specKeyRef.current) return;
    if (!status.over && !clockOver) return;
    const key = specKeyRef.current;
    const clk = clock;
    pushSpec(key, {
      fen: gameRef.current.fen(),
      pgn: gameRef.current.pgn(),
      whiteMs: clk?.whiteMs || 0,
      blackMs: clk?.blackMs || 0,
      turn: clockOver ? (clk?.turn === 'white' ? 'black' : 'white') : (clk?.turn || 'white'),
      status: 'finished',
      /* `result` is the WINNER's colour. This used to be
         `clockOver.winner === 'white' ? 'black' : 'white'` - an inversion that
         only produced the right answer because `clockOver.winner` was secretly
         storing the LOSER. With `winner` now meaning the winner, the inversion
         has to go, or every flagged game is broadcast to spectators with the
         result flipped. */
      result: clockOver
        ? clockOver.winner
        : (status.winner ? (status.winner === 'White' ? 'white' : 'black') : 'draw'),
    });
    const k = key;
    setTimeout(() => endComputerSpec(k), 250);
    specKeyRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.over, clockOver]);

  function compOpts() {
    const cfg = botLevelConfig(computerLevel);
    return { maxDepth: cfg.maxDepth, timeMs: cfg.timeMs, skillLevel: cfg.skillLevel, blunderPct: cfg.blunderPct };
  }

  function scheduleComputerMove() {
    const token = ++computerToken.current;
    if (gameRef.current.isGameOver()) return;
    setComputerThinking(true);
    setTimeout(() => {
      if (token !== computerToken.current) return;
      const g = gameRef.current;
      if (g.isGameOver()) { setComputerThinking(false); return; }
      const opts = compOpts();

      /* Low-level bots sometimes play a random legal move on purpose
         (blunderPct 0-1) — this is what makes beginner levels feel human. */
      const shouldBlunder = opts.blunderPct > 0 && Math.random() < opts.blunderPct;
      if (shouldBlunder) {
        const legal = g.moves({ verbose: false });
        if (legal.length) {
          const san = legal[Math.floor(Math.random() * legal.length)];
          try {
            const mv = g.move(san);
            /* No manual cue here: ChessBoard now detects externally-applied
               moves and plays the correct chess.com cue, including "move
               opponent" for the bot and "capture" for a take. Firing both here
               and there would double every bot move. */
            bumpClock(mv.color === 'w' ? 'white' : 'black');
            sync();
          } catch { /* ignore */ }
          setComputerThinking(false);
          return;
        }
      }

      searchBest(g.fen(), opts)
        .then((res) => {
          if (token !== computerToken.current || !res) {
            if (token === computerToken.current) setComputerThinking(false);
            return;
          }
          const g2 = gameRef.current;
          if (g2.isGameOver()) { setComputerThinking(false); return; }
          try {
            const mv = g2.move(res.san);
            /* ChessBoard plays the cue for this externally-applied move (see the
               random-blunder branch above). */
            bumpClock(mv.color === 'w' ? 'white' : 'black');
            sync();
          } catch { /* ignore */ }
          setComputerThinking(false);
        })
        .catch(() => setComputerThinking(false));
    }, 450);
  }

  function startComputerGame(playAs) {
    gameSessionIdRef.current = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    endSpecSession();
    setPendingConfirm(null);
    const g = rebuildGame('start', []);
    gameRef.current = g;
    setInitialFen('start');
    setMoves([]); setMoveIndex(0);
    setFen(g.fen()); setLastMove(null);
    setStatus(getStatus(g));
    setClockOver(null); setGameAnalysis(null);
    setReviewMode(false);
    setComputerOn(true);
    setComputerColor(playAs);
    setOrientation(playAs);
    setClock({
      whiteMs: (timeSel.hours * 60 + timeSel.base) * 60000,
      blackMs: (timeSel.hours * 60 + timeSel.base) * 60000,
      baseMs:  (timeSel.hours * 60 + timeSel.base) * 60000,
      incMs:   timeSel.inc * 1000,
      turn:    'white',
      startedAt: Date.now(),
      serverNow: Date.now(),
    });
    setClockRunning(true);
    /* announce this game to spectators (live list + coach watch panels) */
    const totalMs = (timeSel.hours * 60 + timeSel.base) * 60000;
    const key = `C${user?.id ?? 'guest'}-${Date.now()}`;
    registerComputerSpec({
      key,
      whiteId: playAs === 'white' ? user?.id : null,
      blackId: playAs === 'white' ? null : user?.id,
      whiteName: playAs === 'white' ? (user?.name || 'Player') : 'Computer',
      blackName: playAs === 'white' ? 'Computer' : (user?.name || 'Player'),
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      pgn: '',
      whiteMs: totalMs,
      blackMs: totalMs,
      turn: 'white',
      status: 'active',
      level: `Level ${computerLevel} · ${skillLabel(computerLevel)}`,
      baseMinutes: timeSel.hours * 60 + timeSel.base,
      incrementSeconds: timeSel.inc,
    });
    specKeyRef.current = key;
    refreshEngine();
    setActivePopup(null);
    if (soundOn) playSound('select');
  }

  function exitComputer() {
    endSpecSession();
    setComputerOn(false);
    setPendingConfirm(null);
    computerToken.current++;
    setComputerThinking(false);
    setClock(null); setClockRunning(false); setClockOver(null);
    setActivePopup(null);
  }

  /* Take back the last full move (the human's move + the bot's reply) so the
     human is on turn again. Calls the existing goToMove replay path — it does
     not mutate the game directly. */
  function takebackComputerMove() {
    if (!computerOn || computerThinking) return;
    const human = computerColor === 'white' ? 'w' : 'b';
    if (gameRef.current.turn() !== human) return;
    const target = Math.max(0, moves.length - 2);
    if (target === moves.length) return;
    goToMove(target);
    if (soundOn) playSound('select');
  }

  /* computer opens by moving first when you chose Black */
  useEffect(() => {
    if (computerOn && !inOnline && !status?.over) {
      const human = computerColor === 'white' ? 'w' : 'b';
      if (gameRef.current.turn() !== human) scheduleComputerMove();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computerOn]);

  /* ─── online helpers ─────────────────────────────────────── */

  /* The non-position part of a server row: who is playing, the clock and the
     status. These change WITHOUT a move being played, so they follow the server
     on every row that is not stale, whether or not the board moved. */
  function applyOnlineMeta(row) {
    if (row.status === 'active') onlineSeenActiveRef.current = row.id;
    activeGameIdRef.current = row.id;
    onlineGameRef.current = row;
    const ownColor = row.myColor || 'white';
    setOnlineGame(row);
    setOnlineMyColor(ownColor);
    if (row.clock) {
      setClock({
        whiteMs: row.clock.whiteMs,
        blackMs: row.clock.blackMs,
        baseMs:  (Number(row.clock.baseMinutes) || 0) * 60000,
        incMs:   row.clock.incrementSeconds * 1000,
        turn:    row.clock.turn,
        startedAt: row.clock.startedAt,
        serverNow: row.serverNow || Date.now(),
      });
    }
    setClockRunning(row.status === 'active');
  }

  function applyOnline(row) {
    if (!row) return;
    if (ignoredGameIdsRef.current.has(String(row.id))) return;
    const g = new Chess();
    try { g.loadPgn(row.pgn || '', { strict: false }); } catch { /* start pos */ }
    const { san, last } = getHistory(g);

    /* ── dedupe: one position is applied exactly once ──────────────────────
       Three paths hand this function a row — the socket push, the 2.5 s poll, and
       the reply to your own `sendMove` — and before, every one of them rebuilt the
       game and re-ran the move animation. That is the "piece moves twice".
       A row BEHIND the board (a poll that lost the race) is dropped outright: it
       would roll a move back and replay it.
       A row at the SAME ply with the SAME PGN is a duplicate delivery; the board
       is already correct so only the metadata is taken.
       A row from a DIFFERENT game always applies in full — a new match legitimately
       starts at ply 0. */
    const prev = appliedRef.current;
    const pgn = row.pgn || '';
    const sameGame = prev.id === row.id;
    if (sameGame && san.length < prev.ply) return;
    applyOnlineMeta(row);
    if (sameGame && san.length === prev.ply && pgn === prev.pgn) return;
    appliedRef.current = { id: row.id, ply: san.length, pgn };

    gameRef.current = g;
    setOnlineTurn(san.length % 2 === 0 ? 'white' : 'black');
    setOrientation(row.myColor || 'white');
    setMoves(san); setMoveIndex(san.length);
    setFen(g.fen());
    setLastMove(last ? { from: last.from, to: last.to } : null);
    setStatus(getStatus(g));
    if (g.isCheckmate() && onlineSeenActiveRef.current === row.id) waitForMateReveal(last?.to);
    else if (!g.isCheckmate()) clearMateReveal();
  }

  /* The opponent cards need the full directory (photo, avatar, ratings, online
     flag), so a failed load is surfaced with a Retry instead of an empty grid. */
  function loadOnlineUsers() {
    setOnlineUsersLoading(true);
    setOnlineUsersError('');
    listUsers()
      .then((rows) => setOnlineUsers(Array.isArray(rows) ? rows : []))
      .catch((e) => setOnlineUsersError(
        e?.response?.data?.message || 'Could not load players. Check your connection and try again.'
      ))
      .finally(() => setOnlineUsersLoading(false));
  }

  function refreshOnlineMatches() {
    listGames().then((rows) => setOnlineMatches(
      rows.filter((row) => !ignoredGameIdsRef.current.has(String(row.id)))
    )).catch(() => {});
  }

  async function startOnlineMatch() {
    if (onlineBusy) return;
    const resetVersion = arenaResetVersionRef.current;

    let sid = onlineSelStudent.current;

    /* Random opponent = one of the players currently online. The server only
       supports direct challenges, so "random" picks an online player and sends
       them the same invite — no fabricated matchmaking queue. */
    if (onlineOpponentType === 'random') {
      const pool = onlineUsers.filter((u) => u.online && String(u.id) !== String(user?.id));
      if (pool.length === 0) {
        setOnlineError('No other players are online right now. Try again in a moment.');
        return;
      }
      setOnlineError('');
      setOnlineBusy(true);
      setOnlineSearching(true);
      const token = ++onlineSearchToken.current;
      await new Promise((resolve) => setTimeout(resolve, 700));
      if (token !== onlineSearchToken.current) { setOnlineBusy(false); return; }
      const pick = pool[Math.floor(Math.random() * pool.length)];
      sid = String(pick.id);
      onlineSelStudent.current = sid;
      setOnlineSelId(sid);
      setOnlineSelName(pick.name);
    }

    if (!sid) {
      setOnlineError(
        onlineOpponentType === 'link'
          ? 'Choose who the invite link is for.'
          : 'Choose a player first.'
      );
      setOnlineSearching(false);
      setOnlineBusy(false);
      return;
    }

    setOnlineError('');
    setOnlineBusy(true);
    try {
      const chosenColor = onlineColorSel === 'random'
        ? (Math.random() < 0.5 ? 'white' : 'black')
        : onlineColorSel;
      const row = await createGame({
        studentId: Number(sid),
        adminColor: chosenColor,
        timeControl: { baseMinutes: timeSel.hours * 60 + timeSel.base, incrementSeconds: timeSel.inc },
      });
      if (resetVersion !== arenaResetVersionRef.current) {
        abortGame(row.id).catch(() => {});
        return;
      }
      applyOnline(row);
      refreshOnlineMatches();
      if (soundOn) playSound('good');

      if (onlineOpponentType === 'link') {
        const url = `${window.location.origin}${window.location.pathname}?game=${row.id}`;
        let msg = `Invite link: ${url}`;
        try {
          await navigator.clipboard.writeText(url);
          msg = 'Invite link copied — share it with your opponent.';
        } catch {
          /* clipboard unavailable — the URL itself is the useful fallback */
        }
        /* The modal closes right after this, so the notice chip inside it is
           never seen — mirror the message as a toast that outlives the popup. */
        showOnlineNotice(msg);
        showToast(msg, { tone: 'success', title: 'Invite link' });
        setOnlineSearching(false);
        setActivePopup(null);
        return;
      }

      if (onlineOpponentType === 'random') {
        /* Keep the modal open so Cancel can still withdraw the challenge. */
        setOnlineWaiting({ id: row.id, name: onlineSelName || 'your opponent' });
        setOnlineSearching(false);
        showOnlineNotice(`Match request sent to ${onlineSelName || 'your opponent'} — waiting for them to accept.`);
        return;
      }

      showOnlineNotice('Invite sent — waiting for your opponent to accept.');
      setOnlineSearching(false);
      setActivePopup(null);
    } catch (e) {
      setOnlineError(e.response?.data?.message || 'Could not start the match.');
      setOnlineSearching(false);
    } finally {
      setOnlineBusy(false);
    }
  }

  async function cancelOnlineSearch() {
    onlineSearchToken.current += 1;
    setOnlineSearching(false);
    setOnlineBusy(false);

    const id = onlineWaiting?.id;
    setOnlineWaiting(null);
    if (!id) return;

    try {
      const row = await abortGame(id);
      if (row && onlineGame && row.id === onlineGame.id) clearOnline(true);
    } catch {
      /* the challenge may already have been accepted or declined */
    }
    refreshOnlineMatches();
    showOnlineNotice('Match request cancelled.');
  }

  function showOnlineNotice(msg) {
    setOnlineNotice(msg);
    window.clearTimeout(showOnlineNotice._t);
    showOnlineNotice._t = window.setTimeout(() => setOnlineNotice(''), 30000);
  }

  async function acceptOnline(m) {
    setOnlineBusy(true);
    try {
      const row = await acceptGame(m.id);
      applyOnline(row); refreshOnlineMatches();
      if (soundOn) playSound('good');
      window.clearTimeout(inviteBarTimer.current);
      setInviteBar(null);
    } catch (e) {
      setOnlineError(e.response?.data?.message || 'Could not accept.');
    } finally { setOnlineBusy(false); }
  }

  async function abortOnline(m) {
    setOnlineBusy(true);
    try {
      const row = await abortGame(m.id);
      if (row && onlineGame && row.id === onlineGame.id) clearOnline(true);
      refreshOnlineMatches();
      if (soundOn) playSound('select');
    } catch (e) {
      setOnlineError(e.response?.data?.message || 'Could not abort.');
    } finally { setOnlineBusy(false); }
  }

  async function declineOnline(m) {
    setOnlineBusy(true);
    try {
      await declineGame(m.id);
      if (onlineGame && m.id === onlineGame.id) clearOnline(true);
      refreshOnlineMatches();
      window.clearTimeout(inviteBarTimer.current);
      setInviteBar(null);
      showOnlineNotice('Match request declined.');
      if (soundOn) playSound('select');
    } catch (e) {
      setOnlineError(e.response?.data?.message || 'Could not decline.');
    } finally { setOnlineBusy(false); }
  }

  async function resignOnlineCurrent() {
    if (!onlineGame) return;
    setOnlineBusy(true);
    try {
      const row = await resignGame(onlineGame.id);
      applyOnline(row); refreshOnlineMatches();
      if (soundOn) playSound('capture');
    } catch (e) {
      setOnlineError(e.response?.data?.message || 'Could not resign.');
    } finally { setOnlineBusy(false); }
  }

  /* My clock ran out. Reported through the timeout route so the game is stored
     as a timeout — never as a resignation — and the winner is decided by who
     still had time (or a draw when the opponent cannot mate). */
  async function flagOnlineCurrent() {
    if (!onlineGame) return;
    try {
      const row = await timeoutGame(onlineGame.id);
      applyOnline(row); refreshOnlineMatches();
      if (soundOn) playSound('capture');
    } catch (e) {
      setOnlineError(e.response?.data?.message || 'Could not flag the match.');
    }
  }

  function openOnline(m) { applyOnline(m); if (soundOn) playSound('select'); }

  /* Offer a draw. This only records a pending offer — the game carries on and
     the opponent has to accept it. It used to call the `/end` endpoint, which
     finished the match immediately, so a single click ended the game with the
     other player never asked. The `/end` route still exists on the server for
     the abandon-style flow; nothing on this page calls it any more. */
  async function offerDrawOnline() {
    if (!onlineGame) return;
    setOnlineBusy(true);
    setOnlineError('');
    try {
      const updated = await offerDraw(onlineGame.id);
      applyOnline(updated);
      setDrawOffer(updated?.drawOffer || null);
      refreshOnlineMatches();
    } catch (e) {
      setOnlineError(e.response?.data?.message || 'Could not offer a draw.');
    } finally { setOnlineBusy(false); }
  }

  /* Accept or decline the opponent's offer. `accept` decides which. */
  async function respondDrawOnline(accept) {
    if (!onlineGame) return;
    setOnlineBusy(true);
    setOnlineError('');
    try {
      const updated = await respondDraw(onlineGame.id, accept);
      applyOnline(updated);
      setDrawOffer(updated?.drawOffer || null);
      refreshOnlineMatches();
    } catch (e) {
      setOnlineError(e.response?.data?.message || 'Could not answer the draw offer.');
    } finally { setOnlineBusy(false); }
  }

  function showPlayerReaction(emoji, who) {
    const id = ++reactionId.current;
    clearTimeout(reactionTimersRef.current[who]);
    setPlayerReactions((prev) => ({ ...prev, [who]: { id, emoji } }));
    reactionTimersRef.current[who] = setTimeout(() => {
      setPlayerReactions((prev) => prev[who]?.id === id ? { ...prev, [who]: null } : prev);
    }, 2800);
  }

  function onReact(emoji) {
    if (!canReact || Date.now() < reactionCooldownRef.current) return;
    setShowReactPicker(false);
    reactionCooldownRef.current = Date.now() + 2000;
    setReactionCooling(true);
    clearTimeout(reactionTimersRef.current.cooldown);
    reactionTimersRef.current.cooldown = setTimeout(() => setReactionCooling(false), 2000);
    setPressedReaction(emoji);
    clearTimeout(reactionTimersRef.current.pressed);
    reactionTimersRef.current.pressed = setTimeout(() => setPressedReaction(''), 300);
    showPlayerReaction(emoji, 'mine');
    if (inOnline && onlineGame?.id) sendGameReaction(onlineGame.id, user?.id, emoji);
  }

  useEffect(() => {
    if (!inOnline || !onlineGame?.id) return undefined;
    const cleanup = onGameReaction((payload) => {
      if (ignoredGameIdsRef.current.has(String(payload?.gameId))) return;
      if (Number(payload?.gameId) !== Number(onlineGame.id)) return;
      if (Number(payload?.senderId) === Number(user?.id)) return;
      showPlayerReaction(payload?.emoji, 'opponent');
    });
    reactionSocketCleanupRef.current = cleanup;
    return () => {
      cleanup();
      if (reactionSocketCleanupRef.current === cleanup) reactionSocketCleanupRef.current = null;
    };
    // The per-player timer replaces old reactions on the same card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inOnline, onlineGame?.id, user?.id]);

  useEffect(() => () => {
    Object.values(reactionTimersRef.current).forEach(clearTimeout);
  }, []);

  /* load users + matches on mount */
  useEffect(() => {
    const resetVersion = arenaResetVersionRef.current;
    loadOnlineUsers();
    listGames()
      .then((gs) => {
        if (resetVersion !== arenaResetVersionRef.current) return;
        const visibleGames = gs.filter((m) => !ignoredGameIdsRef.current.has(String(m.id)));
        setOnlineMatches(visibleGames);
        const target = visibleGames.find((m) => m.status === 'active')
          || visibleGames.find((m) => m.status === 'pending' && !m.canAccept);
        if (target) applyOnline(target);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* A random challenge created from the modal: close the modal the moment the
     opponent accepts, and drop the pending marker once it can no longer be
     cancelled. */
  useEffect(() => {
    if (activePopup !== 'online' || !onlineWaiting) return;
    if (onlineGame?.status === 'active') {
      setOnlineWaiting(null);
      setOnlineSearching(false);
      setActivePopup(null);
      showOnlineNotice('Opponent accepted — game on!');
    } else if (onlineGame?.status === 'aborted' || onlineGame?.status === 'finished') {
      setOnlineWaiting(null);
      setOnlineSearching(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineGame?.status, activePopup, onlineWaiting]);

  /* real-time invite notifications — refresh match list when a new invite arrives */
  useEffect(() => {
    const panelState = (event) => { notificationPanelOpenRef.current = !!event.detail?.open; };
    window.addEventListener('chess-notif-panel', panelState);
    const cleanup = onGameInvite((payload) => {
      refreshOnlineMatches();
      if (notificationPanelOpenRef.current) return;
      if (soundOn) playSound('good');
      const fromName = payload.from?.name || 'Someone';
      const msg = `${fromName} invited you to a game (${payload.timeLabel || '5+0'}).`;
      showOnlineNotice(msg);
      // floating toast — top-right, stays 30s, with Accept + Decline buttons.
      // Same dedupe key as the bell's match-request popup for this game:
      // the backend emits both `game-invite` and a `notification` row for one
      // request, so without a shared key the Play Arena stacks two popups.
      showToast(msg, {
        title: '♟ Online game request',
        duration: 30000,
        dedupeKey: matchRequestKey(payload.game?.id, user?.id),
        source: 'AnalysisBoard:game_invite',
        actions: [
          { label: '✔ Accept', onClick: () => acceptOnline(payload.game) },
          { label: '✕ Decline', onClick: () => declineOnline(payload.game) },
        ],
      });
      // also keep the message at the bottom of the page, same 30s window
      window.clearTimeout(inviteBarTimer.current);
      setInviteBar({ msg, game: payload.game });
      inviteBarTimer.current = window.setTimeout(() => setInviteBar(null), 30000);
    });
    return () => {
      cleanup();
      window.removeEventListener('chess-notif-panel', panelState);
      window.clearTimeout(inviteBarTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast]);

  /* keep onlineGameRef in sync for Socket.IO callback closure */
  useEffect(() => { onlineGameRef.current = onlineGame; }, [onlineGame]);

  /* a request I SENT was just declined — the backend emits "match-declined" to
     me only; MatchDeclineListener toasts it and re-broadcasts it as a DOM event.
     Here we close the invite bar, drop the declined game off the board if it's
     the one currently open, and refresh the match list — live, no re-fetch. */
  useEffect(() => {
    const onMatchDeclined = (e) => {
      const p = e.detail || {};
      window.clearTimeout(inviteBarTimer.current);
      setInviteBar(null);
      if (p.gameId && onlineGameRef.current && onlineGameRef.current.id === p.gameId) {
        clearOnline(true);
      }
      refreshOnlineMatches();
      if (soundOn) playSound('select');
    };
    window.addEventListener('match-declined', onMatchDeclined);
    return () => window.removeEventListener('match-declined', onMatchDeclined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The ONE funnel for an inbound online-game row, shared by the socket push and
     the polling fallback. `applyOnline` owns the dedupe and the clock/reaction
     metadata, so this only adds what is not part of the position: the draw offer
     (which changes neither the board nor the status) and keeping the match list
     honest when something really did move.
   *
     Wrapped in useStableCallback so the socket subscription below never has to
     re-subscribe because a render changed a closure — that re-subscribe is how
     listeners used to stack when Play Mode was opened and closed. */
  const applyOnlineRow = useStableCallback((row) => {
    if (!row) return;
    if (ignoredGameIdsRef.current.has(String(row.id))) return;
    setDrawOffer(row.drawOffer || null);
    const before = appliedRef.current;
    const prevStatus = onlineGameRef.current?.status;
    applyOnline(row);
    /* A row that actually changed the board, or ended the game, is worth a list
       refresh; a duplicate delivery is not — it would re-fetch the whole match
       list on every poll. */
    if (appliedRef.current !== before || (row.status && row.status !== prevStatus)) {
      refreshOnlineMatches();
    }
  });

  /* ONE Socket.IO subscription for the whole page.
   *
   * There were two: one mounted at page load that only refreshed the match list,
   * and one per game that drove the board. Both stayed attached to the socket
   * singleton at the same time, so every `game-update` was handled twice, and the
   * board one re-subscribed whenever its callback identity moved. A single
   * listener, kept in sync through refs rather than re-created per render, means
   * exactly one handler per event for the whole life of the page.
   *
   * Cleanup runs on unmount AND on game change, so opening/closing Play Mode or
   * starting a rematch never leaves an old subscription behind. */
  useEffect(() => {
    const id = onlineGame?.id;
    const myId = user?.id;
    if (id) joinGameRoom(id);

    const cleanup = onGameUpdate(({ forAdmin, forStudent }) => {
      // Pick the payload scoped to this viewer by id (robust for any role/position combo).
      const cur = onlineGameRef.current;
      let row = forAdmin && forAdmin.meId === myId ? forAdmin
        : forStudent && forStudent.meId === myId ? forStudent
        : null;
      if (!row && cur) {
        row = cur.myRole === 'admin' ? forAdmin : forStudent;
      }
      if (!row) return;
      if (ignoredGameIdsRef.current.has(String(row.id))) return;
      /* An update about some OTHER match: keep the pending/active list in sync,
         leave the board alone. */
      if (!cur || row.id !== cur.id) {
        refreshOnlineMatches();
        return;
      }
      // The other side closed a pending request (declined/aborted) — take it off
      // the board and refresh instead of popping an empty start-position game.
      if (row.status === 'declined' || row.status === 'aborted') {
        clearOnline(true);
        refreshOnlineMatches();
        return;
      }
      applyOnlineRow(row);
    });

    let cleaned = false;
    const cleanGameSocket = () => {
      if (cleaned) return;
      cleaned = true;
      cleanup();
      if (id) leaveGameRoom(id);
    };
    gameSocketCleanupRef.current = cleanGameSocket;
    return () => {
      cleanGameSocket();
      if (gameSocketCleanupRef.current === cleanGameSocket) gameSocketCleanupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineGame?.id, user?.id]);

  /* Polling fallback for the active online game: if any Socket.IO push is missed
     (connection blip, handshake delay, etc.) this converges the board to the latest
     server position automatically — no page refresh needed. */
  useEffect(() => {
    const id = onlineGame?.id;
    if (!id || onlineGame?.status !== 'active') return;
    let stopped = false;
    let timer = null;

    const poll = async () => {
      try {
        const row = await fetchGame(id);
        if (stopped) return;
        // Re-scope the returned payload to this viewer before applying.
        const mine = row && row.meId === user?.id ? row : null;
        if (mine) applyOnlineRow(mine);
      } catch { /* ignore transient network errors */ }
    };

    poll();
    timer = setInterval(poll, 2500);

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineGame?.id, onlineGame?.status]);

  /* ─── derived values ─────────────────────────────────────── */
  const onlineFinished   = onlineGame && (onlineGame.status === 'finished' || onlineGame.status === 'aborted');
  const opponentName     = inOnline || onlineFinished ? onlineGame.opponentName : '';

  // locked for board interaction; undo/redo/reset are always allowed in computer mode
  const boardLocked = inOnline;
  const navLocked   = inOnline; // only live online blocks navigation; review mode is always free

  /* verdict color for the current move position (used during review) */
  const reviewVerdictColor = reviewMode && gameAnalysis && moveIndex > 0
    ? (VERDICT_META[gameAnalysis.verdicts[moveIndex - 1]?.verdict]?.color ?? null)
    : null;

  /* move badge overlay (identical to GameReview) */
  const reviewMoveBadge = useMemo(() => {
    if (!reviewMode || !gameAnalysis || moveIndex < 1) return null;
    const v = gameAnalysis.verdicts[moveIndex - 1];
    if (!v || !v.uci || v.uci.length < 4) return null;
    const to = v.uci.slice(2, 4);
    return {
      verdict: v.verdict,
      sacrifice: Boolean(v.sacrifice),
      square: to,
      file: to.charCodeAt(0) - 97,
      rank: Number(to[1]) - 1,
    };
  }, [reviewMode, gameAnalysis, moveIndex]);

  /* best-move arrow for the current position (identical to GameReview) */
  const reviewArrow = useMemo(() => {
    if (!reviewMode || !gameAnalysis || moveIndex < 1) return null;
    const v = gameAnalysis.verdicts[moveIndex - 1];
    const uci = v?.bestUci;
    if (!uci || uci.length < 4) return null;
    return { from: uci.slice(0, 2), to: uci.slice(2, 4), uci };
  }, [reviewMode, gameAnalysis, moveIndex]);
  const reviewArrows = reviewArrow ? [{ from: reviewArrow.from, to: reviewArrow.to, color: '#008000' }] : [];

  /* Hints — a single arrow from the engine's current best move, only while the
     human is on turn in a computer game. Off by default and never shown in
     review. `bestFen` guards against showing an arrow computed for the previous
     position. */
  const hintArrows = useMemo(() => {
    if (!computerOn || !computerHints || reviewMode || status.over) return [];
    if (!best?.from || !best?.to || bestFen !== fen) return [];
    const humanTurn = computerColor === 'white'
      ? gameRef.current.turn() === 'w'
      : gameRef.current.turn() === 'b';
    return humanTurn ? [{ from: best.from, to: best.to, color: '#19c9c3' }] : [];
  }, [computerOn, computerHints, reviewMode, status.over, best, bestFen, fen, computerColor]);

  /* The arrows array has to be identity-stable or the memoized board re-renders
     on every parent render — and `reviewArrows` above is a fresh literal each
     time. */
  const boardArrows = useMemo(
    () => (reviewMode ? reviewArrows : hintArrows),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviewMode, reviewArrow, hintArrows],
  );


  const { list: savedList, refresh: refreshSaved } = useSavedAnalyses();

  /* Search across the title, notes and tags shown in the Saved modal. */
  const filteredSaved = useMemo(() => {
    const q = savedQuery.trim().toLowerCase();
    if (!q) return savedList;
    return savedList.filter((s) => {
      const haystack = [s.name, s.notes, ...(Array.isArray(s.tags) ? s.tags : [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [savedList, savedQuery]);

  const statusTone  = status.tone ? `chess-chip-${status.tone}` : '';
  const topColor    = orientation === 'white' ? 'black' : 'white';
  const bottomCaptured = captured[orientation];
  const topCaptured    = captured[topColor];

  /* The result card is the ONE PostGameResultPopup (see `resultCard` below),
     so the old page-only "game over" overlay — and the dismiss/seen state it
     needed — are gone. The popup keeps its own dismissal state
     (`resultDismiss`), which is what "View Result" restores. */

  const humanIsComputerTurn = computerOn
    ? (computerColor === 'white' ? gameRef.current.turn() === 'w' : gameRef.current.turn() === 'b')
    : false;
  const boardInteractive = reviewMode ? false  // review: navigate only, no new moves
    : inOnline
      ? onlineMyColor === onlineTurn
      : computerOn
        ? humanIsComputerTurn && !computerThinking
        : true;

  /* "Waiting for opponent" — a spinner over the board, not a strip of text.
   *
   * It covers the stretch before the opponent is really IN the game: a challenge
   * they have not accepted, or a match that is live but has not seen their first
   * move. Mid-game "it is their turn to think" is deliberately NOT waiting —
   * blanking the board on every one of their moves would hide the very position
   * you are watching.
   *
   * The moment the opponent joins (their accept lands, or their first move
   * arrives) one of these conditions stops holding and the overlay is gone; there
   * is no timer and nothing to dismiss. */
  const waitingForOpponent = Boolean(onlineGame) && !onlineFinished && (
    onlineGame.status === 'pending'
      ? !onlineGame.canAccept
      : (inOnline && onlineTurn !== onlineMyColor && moves.length === 0)
  );

  /* Pieces cannot be picked up while the overlay is up, and the banner strip that
     used to carry the message is replaced by it — except when it still has a
     button the player needs (Accept / Abort). */
  const boardLive = boardInteractive && !waitingForOpponent;
  const hideWaitingBanner = waitingForOpponent
    && onlineGame?.status === 'pending'
    && !onlineGame?.canAccept;

  /* online banner */
  let onlineBanner = null;
  if (inOnline) {
    onlineBanner = { text: onlineTurn === onlineMyColor ? 'Your move!' : 'Waiting for opponent…', actions: 'active' };
  } else if (onlineGame && onlineGame.status === 'pending') {
    onlineBanner = {
      text: onlineGame.canAccept ? 'Challenge waiting — accept it to start.' : 'Waiting for opponent to accept…',
      actions: 'pending',
    };
  } else if (onlineFinished) {
    const r = onlineGame.result;
    const why = onlineReasonLabel(onlineGame.resultReason);
    const tail = why ? ` · ${why}` : '';
    onlineBanner = {
      text: r === 'abandoned' ? `Match ended${tail || ' · draw'}`
        : r === 'draw' ? `Match ended — draw${tail}`
        : r === 'aborted' ? 'Match aborted'
        : `Match finished — ${r} wins${tail}`,
      actions: 'finished',
    };
  }

  /* ─── player name helpers ────────────────────────────────── */
  const bottomLabel = inOnline || onlineFinished
    ? `${onlineGame.myName ?? 'You'}`
    : computerOn
      ? 'You'
      : orientation === 'white' ? '⚪ White' : '⚫ Black';

  const topLabel = inOnline || onlineFinished
    ? `${opponentName}`
    : computerOn
      ? 'Computer'
      : topColor === 'white' ? '⚪ White' : '⚫ Black';

  /* One picture per player row: the opponent beside the opponent's colour and
     me beside mine. The colour is carried by the ring on the circle and by the
     "Black"/"White" line under the name, so the name itself stays clean. */
  const selfProfile = user
    ? { id: user.id, name: user.name, profile_image: user.profile_image, avatar_config: user.avatar_config }
    : null;
  const bottomProfile = inOnline || onlineFinished
    ? (onlineGame.myProfile || selfProfile)
    : selfProfile;
  const topProfile = inOnline || onlineFinished ? (onlineGame.opponentProfile || null) : null;
  const topAvatarSeed = computerOn ? `bot_${computerLevel}` : `side_${topColor}`;
  const bottomAvatarSeed = user ? `user_${user.id}` : 'user_self';

  /* ─── post-game result descriptor ───────────────────────── */
  // Determines win/loss/draw + reason + accent tone + whose moves to grade.
  function buildResult() {
    // online match (finished)
    if (onlineFinished) {
      const r = onlineGame.result;
      const myColor = onlineMyColor;
      const why = onlineReasonLabel(onlineGame.resultReason);
      if (r === 'abandoned') return { title: 'Game Drawn', reason: 'By Agreement', tone: 'draw', mySide: myColor, wantsReview: false };
      if (r === 'aborted')   return { title: 'Match Aborted', reason: 'Match never started', tone: 'draw', mySide: myColor, wantsReview: false };
      if (r === 'draw')      return { title: 'Game Drawn', reason: why ? `By ${why}` : 'By Agreement', tone: 'draw', mySide: myColor, wantsReview: true };
      const won = r === myColor;
      return {
        title: won ? 'You Won!' : 'You Lost',
        reason: why ? `By ${why}` : 'Game Over',
        tone: won ? 'win' : 'loss',
        winner: r, mySide: myColor, wantsReview: true,
      };
    }
    // clock / timeout
    if (clockOver && clockOver.title) {
      const myColor = computerOn ? computerColor : orientation;
      /* Read the explicit flag rather than inferring it: `winner` is now the
         colour that WON, and myColor is the colour we played, so they are equal
         exactly when we won. */
      const won = clockOver.humanWon ?? clockOver.winner === myColor;
      return {
        title: won ? 'You Won!' : 'You Lost',
        reason: 'By Timeout',
        tone: won ? 'win' : 'loss',
        winner: clockOver.winner, mySide: myColor, wantsReview: true,
      };
    }
    // board rule outcome — only when there are real moves played
    if (status.over && moves.length > 0) {
      const myColor = computerOn ? computerColor : orientation;
      if (status.winner) {
        const won = status.winner === (myColor === 'white' ? 'White' : 'Black');
        return {
          title: won ? 'You Won!' : 'You Lost',
          reason: 'By Checkmate',
          tone: won ? 'win' : 'loss',
          winner: status.winner === 'White' ? 'white' : 'black',
          mySide: myColor, wantsReview: true,
        };
      }
      // draw — derive a clean reason from the board label
      const label = status.label.replace(/[—–-]/g, ' ');
      const reason =
        /stalemate/i.test(label)   ? 'By Stalemate'   :
        /repetition/i.test(label)  ? 'By Threefold Repetition'  :
        /insufficient/i.test(label)? 'By Insufficient Material' :
        /fifty|50-move/i.test(label) ? 'By Fifty-Move Rule' :
          'By Draw';
      return { title: 'Game Drawn', reason, tone: 'draw', mySide: myColor, wantsReview: true };
    }
    return null;
  }

  const finalResult = buildResult();

  /* auto-open the popup the moment a game ends (guards each distinct end state) */
  useEffect(() => {
    if (!finalResult) { return; }
    const gameId = onlineGame?.id ? `online-${onlineGame.id}` : gameSessionIdRef.current;
    // A finished online game fetched on reload is history, not a new finish in
    // this session. Only show the card after this tab observed its active state.
    if (onlineFinished && onlineSeenActiveRef.current !== onlineGame?.id) return;
    const seenKey = `mz-result-seen-${user?.id || 'anon'}`;
    let seen = [];
    try { seen = JSON.parse(localStorage.getItem(seenKey) || '[]'); } catch { /* ignore */ }
    if (seen.includes(gameId) || resultSeenRef.current === gameId) return;
    const key = gameId;
    if (resultSeenRef.current === key) return;
    resultSeenRef.current = key;
    setResultPopup(finalResult);
    setResultDismiss(false);

    // ─── fetch MY rating change for a finished rated online game ──────────
    // Only for real player-vs-player matches. Bot games and practice games come
    // back { rated: false } and simply render no rating line. The popup opens
    // immediately either way; the number fills in when the request lands, so a
    // slow request never delays seeing the result.
    if (onlineFinished && onlineGame?.id) {
      const gameId = onlineGame.id;
      setRatingResult(null);
      fetchRatingResult(gameId)
        .then((r) => {
          /* Ignore a response for a game we have already navigated away from. */
          if (activeGameIdRef.current !== gameId) return;
          setRatingResult((prev) => (prev && prev.gameId !== gameId ? prev : { ...r, gameId }));
        })
        .catch(() => setRatingResult(null));
    } else if (!onlineFinished) {
      setRatingResult(null);
    }

    // NOTE: the board orientation is deliberately left UNCHANGED here. An
    // earlier version rotated the board to the winner's side on game end; the
    // user asked for the opposite — after a game the board should simply RESET
    // (see `onClose` in resultPopupProps, which now clears it), not change
    // sides under them. Flipping here was also unsafe: in pass-and-play
    // buildResult() derives the player's own side from `orientation`
    // (`computerOn ? computerColor : orientation`), so flipping would rewrite
    // "You Won!" as "You Lost" and re-fire this effect in a loop.

    // ─── Save COMPUTER game to the backend ──────────────────────────────
    // Only when it's NOT an online match (those are saved server-side already)
    // and when at least one move has been played (avoid saving empty "games").
    const isComputerGame = computerOn && !inOnline && !onlineFinished;
    if ((isComputerGame || (clockOver && !onlineFinished)) && moves.length > 0) {
      const saveKey = `${key}-${computerLevel}-${computerColor}`;
      if (savedGameRef.current !== saveKey) {
        savedGameRef.current = saveKey;
        (async () => {
          try {
            const myColor = finalResult.mySide || (computerOn ? computerColor : orientation);
            const winnerColor = finalResult.winner || null;
            const rawReason = (finalResult.reason || '').toLowerCase();
            let resultVal = winnerColor;
            if (finalResult.tone === 'draw') resultVal = 'draw';
            let reasonCode = null;
            if (rawReason.includes('checkmate') || rawReason.includes('mate')) reasonCode = 'checkmate';
            else if (rawReason.includes('timeout') || rawReason.includes('time')) reasonCode = 'timeout';
            else if (rawReason.includes('resign')) reasonCode = 'resignation';
            else if (rawReason.includes('stalemate')) reasonCode = 'stalemate';
            else if (rawReason.includes('repetition')) reasonCode = 'repetition';
            else if (rawReason.includes('insufficient')) reasonCode = 'insufficient';
            else if (rawReason.includes('fifty') || rawReason.includes('50')) reasonCode = 'fifty-move';
            else if (rawReason.includes('agreement') || finalResult.tone === 'draw') reasonCode = 'draw';
            const analysisPayload = gameAnalysis
              ? {
                  counts: gameAnalysis.counts || null,
                  accuracy: gameAnalysis.accuracy || null,
                  verdicts: (gameAnalysis.verdicts || []).slice(0, 500),
                }
              : null;
            /* This board is also mounted for staff (/admin/analysis), but
               POST /game-history/computer is student-only and needs a `students`
               row. A staff account therefore always 403s here, so the save is
               skipped instead of firing a request that cannot succeed. */
            if (user?.role !== 'student') {
              console.info('[game-history] skipped: history belongs to student accounts only');
              return;
            }
            await api.post('/game-history/computer', {
              playerColor: myColor,
              computerLevel: Number(computerLevel) || 10,
              fen: gameRef.current.fen(),
              pgn: gameRef.current.pgn() || '',
              result: resultVal,
              resultReason: reasonCode,
              movesCount: moves.length,
              timeBaseMinutes: (timeSel.hours * 60) + timeSel.base,
              timeIncrementSeconds: timeSel.inc,
              analysisData: analysisPayload,
            });
          } catch (e) {
            // Non-fatal: the history save failing should never break the UX.
            console.warn('[game-history] could not save computer game:', e?.response?.data?.message || e?.message);
          }
        })();
      }
    }

    // kick off move-quality analysis so the stats row fills in (non-blocking)
    // silent = no standalone "Analysis Complete" popup overlapping the result.
    if (finalResult.wantsReview && moves.length > 0 && !gameAnalysis && !analyzing) {
      runGameAnalysis(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalResult, gameAnalysis, analyzing, onlineFinished, onlineGame?.id, user?.id]);

  /* move-quality stats for the student's side + rule-based coach message */
  const resultPopupProps = useMemo(() => {
    if (!resultPopup) return null;

    /* ── match summary: both players, each with an honest identity ──
       White is always listed first, so "Winner"/"Loser" is readable without
       knowing which side the viewer sat on; the "You" tag marks ownership. */
    /* A computer game cleared `computerOn` on flag-fall, so the mode alone cannot
       identify the opponent here; `clockOver` survives until the next game. */
    const vsComputer = computerOn || Boolean(clockOver);
    const myColor = resultPopup.mySide || (vsComputer ? computerColor : orientation);
    const oppColor = myColor === 'white' ? 'black' : 'white';
    const winner = resultPopup.winner || null;
    const aborted = resultPopup.title === 'Match Aborted';
    const resultFor = (color) => (
      aborted ? null
        : resultPopup.tone === 'draw' ? 'Draw'
          : winner ? (winner === color ? 'Winner' : 'Loser')
            : null
    );

    const live = inOnline || onlineFinished;
    const sideName = (color) => (color === 'white' ? 'White player' : 'Black player');
    const meName = live
      ? (onlineGame?.myName || 'You')
      : vsComputer ? (user?.name || 'You') : sideName(myColor);
    const oppName = live
      ? (onlineGame?.opponentName || 'Opponent')
      : vsComputer ? 'Computer' : sideName(oppColor);

    const selfProfile = user
      ? { id: user.id, name: user.name, profile_image: user.profile_image, avatar_config: user.avatar_config }
      : null;
    const meProfile = live
      ? (onlineGame?.myProfile || selfProfile)
      : vsComputer ? selfProfile : null;
    const oppProfile = live ? (onlineGame?.opponentProfile || null) : null;

    const seedFor = (color) => {
      if (color === myColor && user) return `user_${user.id}`;
      if (vsComputer && color === oppColor) return `bot_${computerLevel}`;
      return `side_${color}`;
    };
    const playerFor = (color) => ({
      id: color,
      name: color === myColor ? meName : oppName,
      color,
      profile: color === myColor ? meProfile : oppProfile,
      seed: seedFor(color),
      /* Pass-and-play has no single owner of a side, so no "You" tag there. */
      isMe: (live || vsComputer) && color === myColor,
      result: resultFor(color),
    });
    const players = [playerFor('white'), playerFor('black')];

    const secondary = [];
    /* Online rematch has no backend contract, so it is offered only where a
       fresh local game can be started against the same opponent/settings. */
    if (!inOnline && !onlineFinished && moves.length > 0) {
      secondary.push({ label: 'Rematch', onClick: rematch, primary: true });
    }
    secondary.push({ label: 'New game', onClick: fullReset });

    return {
      ...resultPopup,
      players,
      /* null for bot games / practice games, which are never rated */
      rating: ratingResult,
      secondary,
      onReview: (resultPopup.wantsReview && moves.length > 0)
        ? () => { markCurrentResultSeen(); setResultPopup(null); setResultDismiss(true); goToGameReview(); }
        : null,
      /* Dismissing the result deliberately does NOT touch the board. The board
         stays on the final position so the finished game can still be read,
         replayed (⏮ ◀ ▶ ⏭) or reviewed. Resetting is the user's explicit
         choice, via the ↺ "Reset position" button (`reset()` → `goToMove(0)`),
         which returns the board to the start while KEEPING the move list.
         An earlier version reset here automatically; the user asked for reset
         on the button only. */
      onClose: () => { markCurrentResultSeen(); fullReset(); },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    resultPopup, inOnline, onlineFinished, onlineGame, moves.length, orientation,
    computerOn, clockOver, computerColor, computerLevel, ratingResult, user,
  ]);

  /* Re-show the result after it was dismissed ("View Result").
     There is ONE card (the popup), so this simply re-opens it from the
     finished game's state. */
  const openResultPopup = () => {
    const r = buildResult();
    if (r) { setResultPopup(r); setResultDismiss(false); }
  };

  /* post-game result card — rendered on the page, or over Play Mode when active */
  const resultCard = resultPopupProps ? (
    <PostGameResultPopup
      open={!resultDismiss && !resultRevealPending}
      title={resultPopupProps.title}
      reason={resultPopupProps.reason}
      tone={resultPopupProps.tone}
      players={resultPopupProps.players}
      rating={resultPopupProps.rating}
      onClose={resultPopupProps.onClose}
      onReview={resultPopupProps.onReview}
      secondary={resultPopupProps.secondary}
    />
  ) : null;

  /* ========================= RENDER ========================= */
  const leaveDialog = <LeaveGameConfirmDialog open={leaveOpen} onStay={leaveStay} onLeave={leaveLeave} />;
  return (
    <div className="ab-root">
      <style>{PLAY_ARENA_UI_CSS}</style>
      {leaveDialog}
      {/* ── party burst ── */}
      {confetti.length > 0 && (
        <div className="confetti-wrap">
          {confetti.map((p) => (
            <div
              key={p.id}
              className={`confetti-piece ${p.color}`}
              style={{
                left: `${p.left}%`,
                width: `${p.size}px`,
                height: `${p.size * (p.aspect ?? 0.7)}px`,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.dur}s`,
                transform: `rotate(${p.rotate}deg)`,
                '--drift': `${p.drift}px`,
              }}
            />
          ))}
        </div>
      )}
      {showReviewPopup && (
        <ReviewCompletePopup
          analysis={gameAnalysis}
          soundOn={soundOn}
          onClose={() => setShowReviewPopup(false)}
        />
      )}

      {/* The Customize Position modal that used to be mounted here is gone with
          the "Setup Board" section — its only trigger on this page was that
          section's "Open setup on the board" button. Game Review and the Library
          still open the same shared modal. */}

      {/* One completion card only: `resultCard` (the PostGameResultPopup). The
          page's old `.game-over-card` overlay was removed — mounting both put
          two result cards on screen at once ("You Lost" + coach line, then
          "Nagavel k wins"). The popup now carries the title, reason, both
          players with their real pictures, the game details, move quality and
          the rating moves, and it is the same card Play Mode shows. */}

      <div className="ab-layout" ref={layoutRef}>
        {/* ════════════════ LEFT COLUMN — players, board, moves ════════════════ */}
        <div className="ab-board-col" ref={boardColRef}>

          {/* top player card (opponent / engine) */}
          <div className="ab-player-row ab-player-row-reactions">
            {!playMode && <ReactionBubble reaction={playerReactions.opponent} boardRef={boardAreaRef} />}
            <span className={`ab-avatar ${topColor === 'black' ? 'ab-avatar-black' : 'ab-avatar-white'}`}>
              <PlayerAvatar player={topProfile} seed={topAvatarSeed} size={32} />
            </span>
            <span className="ab-player-meta">
              <span className="ab-player-name">{topLabel}</span>
              <span className="ab-player-label">{topColor === 'black' ? 'Black' : 'White'}</span>
            </span>
            <CapturedTray pieces={topCaptured}
              diff={captured[`${topColor}Value`] - captured[`${topColor === 'white' ? 'black' : 'white'}Value`]} />
            <GameClock
              clock={clock}
              running={clockRunning}
              color={topColor}
              forceFloor={clock?.incMs === 0}
            />
          </div>

          {/* The setup-mode banner is gone with the editor it belonged to. */}

          {/* Play Mode trigger — its own row above the board, matched to the
              board's width so it lines up with the board's right edge. */}
          <div className="ab-board-toolbar" style={{ ...pmCss, width: boardWidth }}>
            {inOnline && !onlineFinished && (
              <ResignDrawMenu
                busy={onlineBusy}
                isBot={onlineGame?.isBot}
                drawOffer={drawOffer}
                opponentName={opponentName}
                onResign={resignOnlineCurrent}
                onOfferDraw={offerDrawOnline}
              />
            )}
            <Button
              onClick={() => setPlayMode(true)}
              variant="primary" size="md" className="!py-2 !px-4 text-sm"
              title="Play Mode — immersive fullscreen"
              aria-label="Play Mode"
            >
              <span className="text-sm leading-none">⛶</span>
              <span>Play Mode</span>
            </Button>
          </div>

          {/* board — the flexible band; the square board is sized to fit it */}
          <div className="ab-boardarea" ref={boardAreaRef}>
          <div className="ab-board-wrap" style={{ position: 'relative' }}>
            <div className="ab-board-inner" ref={boardInnerRef}>
              {/* The black/white eval bar that used to sit beside the board is
                  gone, so the board now fills the whole inner width. */}

              {/* `setupMode` / `setupSelected` / `onSetupSquare` are no longer
                  passed: the inline piece-placing editor left the page with the
                  "Setup Board" section, and ChessBoard already treats all three
                  as absent (off) by default, so dropping them is exactly the
                  behaviour the board had outside setup mode. */}
              {/* ONE live board per game. The Play Mode board is a portal of the
                  same Chess instance mounted on top of this one, and two mounted
                  boards were what let one move land twice: each board ran its own
                  position watcher and its own animation against the same game, so
                  the hidden one replayed what the visible one had already shown.
                  The page board unmounts while Play Mode is open. */}
              {!playMode && (
                <ArenaBoard
                  key={boardResetKey}
                  game={gameRef.current}
                  orientation={orientation}
                  boardWidth={boardWidth}
                  onPositionChange={handlePositionChange}
                  onMove={handleBoardMove}
                  interactive={boardLive}
                  showLegalMoves={showLegal}
                  showNotation={showNotation}
                  soundOn={soundOn}
                  selfColor={selfColorCode}
                  highlightLastMove={highlightLast}
                  lastMove={lastMove}
                  pieceTheme={pieceSel}
                  customArrows={boardArrows}
                  engineOn={engineOn && !inOnline}
                  reviewVerdictColor={reviewVerdictColor}
                  moveBadge={reviewMoveBadge}
                  /* Named, so an effect started by the page (a move-list click,
                     an undo/redo) lands on THIS board. */
                  effectHostId={pageBoardHostId}
                  flat={PAGE_BOARD_FLAT}
                />
              )}
              {waitingForOpponent && <WaitingOverlay />}
            </div>

            {/* Confirm move — held back until the player accepts the move. */}
            {pendingConfirm && (
              <div className="ab-move-confirm" role="alertdialog" aria-label="Confirm move" aria-live="assertive">
                <span>Play <strong>{pendingConfirm.move?.san || 'this move'}</strong>?</span>
                <Button type="button" variant="primary" size="sm" onClick={confirmPendingMove} className="!py-1 !px-3 text-xs">Play</Button>
                <Button type="button" variant="secondary" size="sm" onClick={cancelPendingMove} className="!py-1 !px-3 text-xs">Cancel</Button>
              </div>
            )}

            {/* THE completion card. There is ONE card now: the same
                PostGameResultPopup the Play Mode board shows, rendered here on
                the page too, so the result UI, the buttons and the timing are
                identical in both modes. It is a fixed overlay, so it is
                rendered outside the board column.
                It waits for the checkmate animation before it opens
                (`resultRevealPending`) — that behaviour is unchanged. */}
            {!playMode && resultCard}

            {/* review mode ribbon — shown instead of overlay */}
            {reviewMode && (status.over || clockOver || onlineFinished) && (
              <div className="review-ribbon">
                <span className="review-ribbon-label">📖 Reviewing game</span>
                <div className="review-ribbon-btns">
                  <Button onClick={() => setReviewMode(false)} variant="secondary" size="sm" className="!py-1 !px-3 text-xs">✕ Exit review</Button>
                </div>
              </div>
            )}

          </div>
          </div>{/* end board area */}

          {/* online banner — suppressed while the board is showing its own
              "Waiting for opponent" spinner, so the message is not stated twice.
              It stays when it still carries a button the player needs (Accept /
              Abort a challenge they sent YOU). */}
          {onlineBanner && !hideWaitingBanner && (
            <div className={`ab-banner ${
              onlineBanner.actions === 'active'   ? 'ab-banner-active'   :
              onlineBanner.actions === 'finished' ? 'ab-banner-finished' : 'ab-banner-pending'
            }`}>
              <span className="ab-banner-icon">
                {onlineBanner.actions === 'active' ? '⚔' : onlineBanner.actions === 'finished' ? '🏁' : '⏳'}
              </span>
              <span className="ab-banner-text">{onlineBanner.text}</span>
              <div className="ab-banner-actions">
                {onlineBanner.actions === 'active' && (
                  <DrawOfferPrompt
                    busy={onlineBusy}
                    drawOffer={drawOffer}
                    opponentName={opponentName}
                    onRespondDraw={respondDrawOnline}
                  />
                )}
                {onlineBanner.actions === 'pending' && onlineGame?.canAccept && (
                  <Button onClick={() => acceptOnline(onlineGame)} disabled={onlineBusy} variant="primary" size="sm" className="!py-1 !px-2.5 text-xs">
                    {onlineBusy ? 'Accepting…' : '✔ Accept'}
                  </Button>
                )}
                {onlineBanner.actions === 'pending' && onlineGame?.canAbort && (
                  <Button onClick={() => abortOnline(onlineGame)} disabled={onlineBusy} variant="danger" size="sm" className="!py-1 !px-2.5 text-xs">✕ Abort</Button>
                )}
                {onlineBanner.actions === 'finished' && (
                  <Button onClick={resetPlayArena} disabled={resettingPlayArena} variant="primary" size="sm" className="!py-1 !px-2.5 text-xs">♞ New</Button>
                )}
              </div>
            </div>
          )}

          {/* ── moves — ONE horizontal row (or the review panel while reviewing) ── */}
          {reviewMode ? (
            <ReviewPanel
              moves={moves}
              moveIndex={moveIndex}
              verdicts={gameAnalysis?.verdicts ?? null}
              analyzing={analyzing}
              analyzeProgress={analyzeProgress}
              onNavigate={goToMove}
              onExitReview={() => setReviewMode(false)}
              onRematch={rematch}
              onNewGame={fullReset}
              canRematch={!inOnline && moves.length > 0}
            />
          ) : (
            <MoveList
              variant="strip"
              moves={moves}
              moveIndex={moveIndex}
              verdicts={verdictList}
              navLocked={navLocked}
              goToMove={handleNavMove}
              containerRef={stripRef}
              emptyText="No moves yet. Play on the board or load a game."
            />
          )}

          {/* bottom player card (me) — under the moves strip */}
          <div className="ab-player-row ab-player-row-reactions">
            {!playMode && <ReactionBubble reaction={playerReactions.mine} boardRef={boardAreaRef} />}
            <span className={`ab-avatar ${orientation === 'black' ? 'ab-avatar-black' : 'ab-avatar-white'}`}>
              <PlayerAvatar player={bottomProfile} seed={bottomAvatarSeed} size={32} />
            </span>
            <span className="ab-player-meta">
              <span className="ab-player-name">{bottomLabel}</span>
              <span className="ab-player-label">You, {orientation === 'black' ? 'Black' : 'White'}</span>
            </span>
            <CapturedTray pieces={bottomCaptured}
              diff={captured[`${orientation}Value`] - captured[`${orientation === 'white' ? 'black' : 'white'}Value`]} />
            {canReact && !playMode && <EmojiReactControl open={showReactPicker} disabled={reactionCooling} pressed={pressedReaction} onToggle={() => setShowReactPicker((value) => !value)} onReact={onReact} onClose={() => setShowReactPicker(false)} />}
            <GameClock
              clock={clock}
              running={clockRunning}
              color={orientation}
              forceFloor={clock?.incMs === 0}
            />
          </div>

          <p className="ab-note">Click a piece, then a square to move. Use the arrows to replay.</p>
        </div>

        {/* ════════════════ SIDE PANEL ════════════════
             marginTop (not paddingTop) drops the panel so "♟ Online Match",
             "🤖 vs Computer", "👁 Live games" and "⚙ Setup Board" all start at
             the same height as the top of the board. Margin — not padding —
             because the panel is a sticky, max-height + overflow-y:auto box;
             padding would eat into that scrollable height instead of moving
             the box down. */}
        <div className="ab-side-panel" style={panelOffset ? {
          marginTop: panelOffset,
          /* Shrink the sticky box by the same amount it was pushed down, so the
             panel still fits the viewport at first paint instead of running
             off the bottom. Only the panel's own height changes — the board's
             top is unaffected, so this cannot feed back into the measurement. */
          maxHeight: `calc(100dvh - 80px - ${panelOffset}px)`,
        } : undefined}>

          {/* Tool tiles — one per option. Clicking one opens the shared
              centered modal above the page; the board stays mounted behind it. */}
          <div className="ab-tool-grid" role="group" aria-label="Play Arena options">
            {ARENA_TILES.map((tile) => {
              const active = activePopup === tile.id;
              return (
                <button
                  key={tile.id}
                  type="button"
                  id={`ab-tool-${tile.id}`}
                  className={`ab-tool-tile${active ? ' is-active' : ''}`}
                  aria-haspopup="dialog"
                  aria-expanded={active}
                  onClick={(event) => openPopup(tile.id, event.currentTarget)}
                >
                  <span className="ab-tool-icon" aria-hidden>{tile.icon}</span>
                  <span className="ab-tool-label">{tile.label}</span>
                  {tile.id === 'saved' && savedList.length > 0 && (
                    <span className="ab-tool-badge" aria-label={`${savedList.length} saved analyses`}>
                      {savedList.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Navigation controls — same handlers as the Play Mode controls. */}
          <div className="ab-ctrl-row" role="group" aria-label="Board navigation">
            <button type="button" onClick={() => goToMove(0)} disabled={navLocked || moveIndex === 0} className="ab-ctrl-btn" title="First move">⏮</button>
            <button type="button" onClick={undoMove} disabled={navLocked || moveIndex === 0} className="ab-ctrl-btn" title="Previous move">◀</button>
            <button type="button" onClick={redoMove} disabled={navLocked || moveIndex >= moves.length} className="ab-ctrl-btn" title="Next move">▶</button>
            <button type="button" onClick={() => goToMove(moves.length)} disabled={navLocked || moveIndex >= moves.length} className="ab-ctrl-btn" title="Last move">⏭</button>
            <button type="button" onClick={reset} disabled={navLocked} className="ab-ctrl-btn" title="Reset position">↺</button>
            <button type="button"
              onClick={() => { setOrientation((o) => (o === 'white' ? 'black' : 'white')); if (soundOn) playSound('select'); }}
              className="ab-ctrl-btn" title="Flip board">⇄</button>
          </div>

          {/* FEN / PGN readout — read-only, like the share popup. */}
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

          {/* Share / Download — same handlers as before. */}
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

        </div>{/* end side panel */}
      </div>

      {/* ════════════════ Play Arena popups — one shared Modal ════════════════ */}
      <Modal
        open={!!activePopup}
        onClose={requestClosePopup}
        title={popupMeta?.label || 'Play Arena'}
        description={popupMeta?.desc}
        icon={popupMeta?.icon}
        id="play-arena-modal"
        size={activePopup === 'live' ? 'lg' : 'md'}
        returnFocusRef={popupTriggerRef}
        busy={onlineSearching}
        footer={(
          <>
            {activePopup === 'online' && (
              (onlineSearching || onlineWaiting) ? (
                <Button variant="danger" size="md" onClick={cancelOnlineSearch}>
                  {onlineSearching ? 'Cancel search' : 'Cancel request'}
                </Button>
              ) : (
                <>
                  <Button variant="secondary" size="md" onClick={requestClosePopup}>Cancel</Button>
                  <Button variant="primary" size="md" onClick={startOnlineMatch} disabled={onlineBusy || !isTimeControlValid(timeSel)}>
                    {onlineBusy
                      ? 'Starting…'
                      : onlineOpponentType === 'random'
                        ? 'Find Match'
                        : onlineOpponentType === 'link'
                          ? 'Create invite link'
                          : 'Send Challenge'}
                  </Button>
                </>
              )
            )}

            {activePopup === 'computer' && (
              computerOn ? (
                <>
                  <Button variant="secondary" size="md" onClick={requestClosePopup}>Close</Button>
                  <Button variant="danger" size="md" onClick={exitComputer}>Exit game</Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" size="md" onClick={requestClosePopup}>Cancel</Button>
                  <Button
                    variant="primary" size="md"
                    onClick={() => startComputerGame(
                      computerColorChoice === 'random'
                        ? (Math.random() < 0.5 ? 'white' : 'black')
                        : computerColorChoice
                    )}
                  >
                    Start Game
                  </Button>
                </>
              )
            )}

            {activePopup === 'live' && (
              <>
                <Button variant="secondary" size="md" onClick={refreshLive} disabled={liveRefreshing}>
                  {liveRefreshing ? 'Refreshing…' : 'Refresh'}
                </Button>
                <Button variant="primary" size="md" onClick={requestClosePopup}>Close</Button>
              </>
            )}

            {activePopup === 'annotate' && (
              <>
                <Button variant="secondary" size="md" onClick={requestClosePopup}>Cancel</Button>
                <Button variant="primary" size="md" onClick={saveAnalysis}>Save</Button>
              </>
            )}

            {activePopup === 'saved' && (
              <Button variant="primary" size="md" onClick={requestClosePopup}>Close</Button>
            )}

            {activePopup === 'settings' && (
              <>
                <Button variant="secondary" size="md" onClick={requestClosePopup}>Close</Button>
                <Button
                  variant="primary" size="md"
                  onClick={() => {
                    closePopup();
                    showToast('Your board settings are applied.', { tone: 'success', title: 'Settings' });
                  }}
                >
                  Apply
                </Button>
              </>
            )}
          </>
        )}
      >
        {/* ── Online Match ─────────────────────────────────────────────── */}
        {activePopup === 'online' && (
          <>
            {onlineError && <div className="chess-error !mb-2 !py-1.5 text-xs" role="alert">{onlineError}</div>}
            {onlineNotice && <div className="chess-chip chess-chip-gold !mb-2 !py-1.5 text-xs">{onlineNotice}</div>}

            {onlineSearching ? (
              <div className="py-6 text-center" aria-live="polite">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-cyan-300/60 bg-cyan-50 text-xl animate-pulse">♞</div>
                <p className="mt-3 text-sm font-bold text-ivory-200">Searching for an opponent…</p>
                <p className="mt-1 text-xs text-ivory-500">Matching you with a player who is online right now.</p>
              </div>
            ) : onlineWaiting ? (
              <div className="py-6 text-center" aria-live="polite">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-cyan-300/60 bg-cyan-50 text-xl">♟</div>
                <p className="mt-3 text-sm font-bold text-ivory-200">Challenge sent to {onlineWaiting.name}</p>
                <p className="mt-1 text-xs text-ivory-500">Waiting for them to accept. You can cancel while it is still pending.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <span className="text-xs font-semibold text-ivory-300">Opponent</span>
                  <div className="mt-1 mz-chip-row">
                    {[
                      ['player', 'Friend / student'],
                      ['random', '🎲 Random'],
                      ['link', '🔗 Invite link'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => { setOnlineOpponentType(value); setOnlineError(''); }}
                        className={`flex-1 chess-chip text-xs ${onlineOpponentType === value ? 'chess-chip-gold' : ''}`}
                        aria-pressed={onlineOpponentType === value}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {(onlineOpponentType === 'player' || onlineOpponentType === 'link') && (
                  <div>
                    <input
                      type="search"
                      className="chess-input !text-xs !py-1.5 w-full online-pick-search"
                      placeholder="Search players by name…"
                      aria-label="Search players"
                      value={onlineSearch}
                      onChange={(e) => setOnlineSearch(e.target.value)}
                      disabled={onlineUsersLoading}
                    />

                    {onlineUsersError ? (
                      <div className="online-pick-state online-pick-error" role="alert">
                        <span>{onlineUsersError}</span>
                        <Button type="button" variant="secondary" size="sm" onClick={loadOnlineUsers}>
                          Retry
                        </Button>
                      </div>
                    ) : onlineUsersLoading && onlineUsers.length === 0 ? (
                      <div className="online-pick-state" aria-live="polite">Loading players…</div>
                    ) : visibleOnlinePlayers.length === 0 ? (
                      <div className="online-pick-state" aria-live="polite">
                        {onlineSearch.trim()
                          ? `No players match “${onlineSearch.trim()}”.`
                          : 'No other players are available yet.'}
                      </div>
                    ) : (
                      <div className="online-pick-grid" role="listbox" aria-label="Players">
                        {visibleOnlinePlayers.map((u) => (
                          <OnlinePlayerCard
                            key={u.id}
                            player={u}
                            timeClass={onlineTimeClass}
                            selected={String(u.id) === String(onlineSelId)}
                            onSelect={(p) => {
                              onlineSelStudent.current = String(p.id);
                              setOnlineSelId(String(p.id));
                              setOnlineSelName(p.name);
                              setOnlineError('');
                            }}
                          />
                        ))}
                      </div>
                    )}

                    {onlineSelectedPlayer && (
                      <div className="online-pick-selected" aria-live="polite">
                        <PlayerAvatar player={onlineSelectedPlayer} size={32} />
                        <span className="online-pick-selected-body">
                          <span className="online-pick-selected-label">
                            {onlineOpponentType === 'link' ? 'Invite link for' : 'Challenging'}
                          </span>
                          <span className="online-pick-selected-name">{onlineSelectedPlayer.name}</span>
                        </span>
                        <span className="online-pick-selected-rating">
                          {(() => {
                            const r = ratingForPlayer(onlineSelectedPlayer, onlineTimeClass);
                            return r != null ? `${r} ${ratingPoolLabel(onlineTimeClass)}` : 'Unrated';
                          })()}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {onlineOpponentType === 'random' && (
                  <p className="text-[11px] leading-snug text-ivory-500">
                    We&apos;ll pick a player who is online and send them the challenge.
                  </p>
                )}
                {onlineOpponentType === 'link' && (
                  <p className="text-[11px] leading-snug text-ivory-500">
                    Choose the player, then we&apos;ll copy a direct link to the challenge for them.
                  </p>
                )}

                <div>
                  <span className="text-xs font-semibold text-ivory-300">Play as</span>
                  <div className="mt-1 mz-chip-row">
                    {[
                      ['white', '⚪ White'],
                      ['black', '⚫ Black'],
                      ['random', '🎲 Random'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setOnlineColorSel(value)}
                        className={`flex-1 chess-chip text-xs ${onlineColorSel === value ? 'chess-chip-gold' : ''}`}
                        aria-pressed={onlineColorSel === value}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-xs font-semibold text-ivory-300">Time control</span>
                  <div className="mt-1">
                    <TimeControlPicker
                      value={timeSel}
                      onChange={setTimeSel}
                      disabled={onlineBusy || onlineSearching}
                    />
                  </div>
                  {!isTimeControlValid(timeSel) && (
                    <p className="mt-1 text-[11px] font-semibold text-amber-600">
                      Pick at least 1 minute for the starting clock.
                    </p>
                  )}
                </div>

                <div>
                  <span className="text-xs font-semibold text-ivory-300">Game type</span>
                  <div className="mt-1">
                    <span className="chess-chip chess-chip-gold inline-block text-xs">✓ Rated</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-ivory-500">
                    Rated games update academy ratings. Games hosted by a coach are always practice.
                  </p>
                </div>

                {/* Live matches only (pending invite / active game) */}
                {(() => {
                  const live = onlineMatches.filter((m) => m.status === 'pending' || m.status === 'active');
                  if (live.length === 0) return null;
                  return (
                    <div>
                      <span className="text-xs font-semibold text-ivory-300">Open matches</span>
                      <div className="ab-match-list">
                        {live.map((m) => (
                          <div key={m.id} className="ab-match-item">
                            <div className="ab-match-top">
                              <span className="text-xs text-ivory-300 truncate">{m.myName} vs {m.opponentName}</span>
                              <span className={`chess-chip text-[0.6rem] ${m.status === 'active' ? 'chess-chip-gold' : ''}`}>{m.status}</span>
                            </div>
                            <div className="ab-match-bot">
                              <span className="text-[0.65rem] text-ivory-500">
                                {m.status === 'active'
                                  ? `${m.myColor === 'white' ? '⚪' : '⚫'} ${m.myColor}`
                                  : 'Challenge sent…'}
                              </span>
                              <div className="flex gap-1">
                                {m.status === 'pending' && m.canAccept && (
                                  <>
                                    <Button type="button" variant="primary" size="sm" onClick={() => acceptOnline(m)} disabled={onlineBusy}>Accept</Button>
                                    <Button type="button" variant="danger" size="sm" onClick={() => declineOnline(m)} disabled={onlineBusy}>Decline</Button>
                                  </>
                                )}
                                {m.status === 'pending' && m.canAbort && (
                                  <Button type="button" variant="danger" size="sm" onClick={() => abortOnline(m)} disabled={onlineBusy}>Abort</Button>
                                )}
                                <Button
                                  type="button" variant="secondary" size="sm"
                                  onClick={() => { openOnline(m); setActivePopup(null); }}
                                >
                                  Open
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}

        {/* ── vs Computer ─────────────────────────────────────────────── */}
        {activePopup === 'computer' && (
          computerOn ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-cyan-300/50 bg-cyan-50/60 p-3">
                <p className="text-sm font-bold text-ivory-200">Game in progress</p>
                <p className="mt-1 text-xs text-ivory-300">
                  You: <b>{computerColor === 'white' ? '⚪ White' : '⚫ Black'}</b>
                  {' · '}Skill {computerLevel} · {skillLabel(computerLevel)}
                </p>
                <p className="mt-0.5 text-xs text-ivory-500">
                  {computerThinking
                    ? '🤖 Thinking…'
                    : gameRef.current.turn() === (computerColor === 'white' ? 'w' : 'b')
                      ? 'Your move!'
                      : 'Machine thinking…'}
                </p>
                {computerTakeback && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    onClick={takebackComputerMove}
                    disabled={computerThinking || gameRef.current.turn() !== (computerColor === 'white' ? 'w' : 'b')}
                  >
                    ↶ Take back
                  </Button>
                )}
              </div>
              <p className="text-xs text-ivory-500">
                Exit the game to set up a new one. Hints and takeback can be changed below at any time.
              </p>
              <div className="space-y-0.5">
                <label className="chess-toggle !py-1.5">
                  <span className="text-xs text-ivory-300">Hints (engine arrow on your turn)</span>
                  <input type="checkbox" checked={computerHints} onChange={(e) => setComputerHints(e.target.checked)} />
                </label>
                <label className="chess-toggle !py-1.5">
                  <span className="text-xs text-ivory-300">Allow takeback</span>
                  <input type="checkbox" checked={computerTakeback} onChange={(e) => setComputerTakeback(e.target.checked)} />
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <span className="text-xs font-semibold text-ivory-300">Play as</span>
                <div className="mt-1 mz-chip-row">
                  {[
                    ['white', '⚪ White'],
                    ['black', '⚫ Black'],
                    ['random', '🎲 Random'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setComputerColorChoice(value)}
                      className={`flex-1 chess-chip text-xs ${computerColorChoice === value ? 'chess-chip-gold' : ''}`}
                      aria-pressed={computerColorChoice === value}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-xs font-semibold text-ivory-300">Difficulty</span>
                <select
                  className="chess-input mt-1 !text-xs !py-1.5"
                  value={computerLevel}
                  onChange={(e) => setComputerLevel(Number(e.target.value))}
                  aria-label="Difficulty"
                >
                  {BOT_LEVELS.map((lvl) => (
                    <option key={lvl.level} value={lvl.level}>
                      Lv{lvl.level} · {lvl.label} ({lvl.ratingMax >= 9999 ? lvl.ratingMin + '+' : lvl.ratingMin + '-' + lvl.ratingMax})
                    </option>
                  ))}
                </select>
                {recommendedLevel && (
                  <p className="mt-1 text-[11px] leading-snug text-gold-500">
                    🎯 Suggested for your rating: Level {recommendedLevel} ({skillLabel(recommendedLevel)})
                  </p>
                )}
              </div>

              <div>
                <span className="text-xs font-semibold text-ivory-300">Time control</span>
                <div className="mt-1">
                  <TimePresetRow selected={timeSel} onSelect={(p) => setTimeSel({ hours: p.hours, base: p.base, inc: p.inc })} />
                </div>
                <div className="flex gap-1.5">
                  <select className="chess-input !text-xs !py-1.5" value={timeSel.hours}
                    onChange={(e) => setTimeSel((t) => ({ ...t, hours: Number(e.target.value) }))} aria-label="Hours">
                    {[0,1,2,3,4,5].map((h) => <option key={h} value={h}>{h}h</option>)}
                  </select>
                  <select className="chess-input !text-xs !py-1.5" value={timeSel.base}
                    onChange={(e) => setTimeSel((t) => ({ ...t, base: Number(e.target.value) }))} aria-label="Minutes">
                    {[0,1,2,3,4,5,10,15,20,30,45,60].map((m) => <option key={m} value={m}>{m}m</option>)}
                  </select>
                  <select className="chess-input !text-xs !py-1.5" value={timeSel.inc}
                    onChange={(e) => setTimeSel((t) => ({ ...t, inc: Number(e.target.value) }))} aria-label="Increment">
                    {[0,1,2,3,5,10,15,20,30].map((s) => <option key={s} value={s}>+{s}s</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-0.5">
                <label className="chess-toggle !py-1.5">
                  <span className="text-xs text-ivory-300">Hints (engine arrow on your turn)</span>
                  <input type="checkbox" checked={computerHints} onChange={(e) => setComputerHints(e.target.checked)} />
                </label>
                <label className="chess-toggle !py-1.5">
                  <span className="text-xs text-ivory-300">Allow takeback</span>
                  <input type="checkbox" checked={computerTakeback} onChange={(e) => setComputerTakeback(e.target.checked)} />
                </label>
              </div>
            </div>
          )
        )}

        {/* ── Live games ──────────────────────────────────────────────── */}
        {activePopup === 'live' && (
          <>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs text-ivory-500">Watch any game being played on the arena right now.</p>
              <span className="chess-chip text-[0.6rem]">{liveSessions.length} live</span>
            </div>
            {liveSessions.length === 0 ? (
              <div className="live-sessions">
                <p className="live-sessions-empty">No live games right now — start one to be watchable.</p>
              </div>
            ) : (
              <div className="live-sessions">
                {liveSessions.map((s) => {
                  const whiteRating = s.whiteRating ?? s.white_rating ?? null;
                  const blackRating = s.blackRating ?? s.black_rating ?? null;
                  return (
                    <button
                      key={`${s.type}-${s.gameId || s.key}`}
                      type="button"
                      className="live-session-item"
                      onClick={() => { setSpectateSession(s); setActivePopup(null); }}
                    >
                      <span className="live-session-names">
                        <span className="live-session-white">⚪ {s.whiteName}{whiteRating ? ` (${whiteRating})` : ''}</span>
                        <span className="live-session-vs">vs</span>
                        <span className="live-session-black">⚫ {s.blackName}{blackRating ? ` (${blackRating})` : ''}</span>
                      </span>
                      <span className="live-session-meta">
                        {s.type === 'computer' ? `🤖 ${s.level || 'Computer'}` : '♟ Player vs Player'}
                        {(s.baseMinutes || s.baseMinutes === 0) ? ` · ${s.baseMinutes}+${s.incrementSeconds}` : ''}
                      </span>
                      <span className="live-session-watch">Watch →</span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ── Annotate & Save ─────────────────────────────────────────── */}
        {activePopup === 'annotate' && (
          <div className="space-y-3">
            <div>
              <label htmlFor="ab-note-title" className="text-xs font-semibold text-ivory-300">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                id="ab-note-title"
                value={saveName}
                onChange={(e) => { setSaveName(e.target.value); setAnnotationError(''); }}
                placeholder="e.g. Sicilian Najdorf — key ideas"
                className="chess-input mt-1 w-full !text-xs !py-1.5"
                aria-invalid={!!annotationError}
                aria-describedby={annotationError ? 'ab-note-title-error' : undefined}
              />
              {annotationError && (
                <p id="ab-note-title-error" className="mt-1 text-[11px] text-red-600" role="alert">{annotationError}</p>
              )}
            </div>

            <div>
              <label htmlFor="ab-note-body" className="text-xs font-semibold text-ivory-300">Notes / annotation</label>
              <textarea
                id="ab-note-body"
                placeholder="Your notes, ideas and analysis…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={5}
                className="chess-input mt-1 resize-none !text-xs !py-1.5"
              />
            </div>

            <div>
              <label htmlFor="ab-note-tags" className="text-xs font-semibold text-ivory-300">Tags</label>
              <input
                id="ab-note-tags"
                value={saveTags}
                onChange={(e) => setSaveTags(e.target.value)}
                placeholder="opening, tactics, endgame"
                className="chess-input mt-1 w-full !text-xs !py-1.5"
              />
              <p className="mt-1 text-[11px] text-ivory-500">Separate tags with commas.</p>
            </div>

            <div>
              <span className="text-xs font-semibold text-ivory-300">Visibility</span>
              <div className="mt-1 mz-chip-row">
                {[
                  ['private', '🔒 Private'],
                  ['shared', '👥 Shared'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSaveVisibility(value)}
                    className={`flex-1 chess-chip text-xs ${saveVisibility === value ? 'chess-chip-gold' : ''}`}
                    aria-pressed={saveVisibility === value}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-ivory-500">
                {saveVisibility === 'private'
                  ? 'Only this device can see the saved analysis.'
                  : 'Shared marks the analysis for sharing with others.'}
              </p>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-xl border border-cyan-300/40 bg-cyan-50/50 px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ivory-200">Share this position</p>
                <p className="text-[11px] text-ivory-500">Copy a link with the current PGN or FEN.</p>
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={share}>Copy link</Button>
            </div>
            {shareMsg && <p className="text-[11px] text-emerald-600" role="status">{shareMsg}</p>}

            {discardConfirm && (
              <div className="mz-discard" role="alertdialog" aria-label="Discard unsaved changes">
                <p>Discard your unsaved changes?</p>
                <Button type="button" variant="danger" size="sm" onClick={closePopup}>Discard</Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setDiscardConfirm(false)}>Keep editing</Button>
              </div>
            )}
          </div>
        )}

        {/* ── Saved analyses ──────────────────────────────────────────── */}
        {activePopup === 'saved' && (
          <div className="space-y-3">
            <input
              type="search"
              value={savedQuery}
              onChange={(e) => setSavedQuery(e.target.value)}
              placeholder="Search by title, notes or tag…"
              className="chess-input w-full !text-xs !py-1.5"
              aria-label="Search saved analyses"
            />

            {savedList.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-sm font-bold text-ivory-200">No saved analyses yet</p>
                <p className="mt-1 text-xs text-ivory-500">Save the current position from Annotate &amp; Save.</p>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="mt-3"
                  onClick={() => openPopup('annotate', popupTriggerRef.current)}
                >
                  Annotate &amp; Save
                </Button>
              </div>
            ) : filteredSaved.length === 0 ? (
              <p className="py-4 text-center text-xs text-ivory-500">
                No analyses match “{savedQuery}”.
              </p>
            ) : (
              <div className="space-y-2">
                {filteredSaved.map((s) => (
                  <div key={s.id} className="ab-saved-item">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ivory-100 truncate">{s.name}</p>
                        <p className="text-[0.62rem] text-ivory-500">{s.at}</p>
                      </div>
                      <span className={`chess-chip shrink-0 text-[0.55rem] ${s.visibility === 'shared' ? 'chess-chip-gold' : ''}`}>
                        {s.visibility === 'shared' ? 'Shared' : 'Private'}
                      </span>
                    </div>
                    {s.notes && <p className="mt-1 text-[0.65rem] text-ivory-500 line-clamp-2">{s.notes}</p>}
                    {Array.isArray(s.tags) && s.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {s.tags.map((tag) => (
                          <span key={tag} className="chess-chip text-[0.55rem]">{tag}</span>
                        ))}
                      </div>
                    )}

                    {savedDeleteId === s.id ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-red-700">
                        <span className="flex-1">Delete “{s.name}”?</span>
                        <Button type="button" variant="danger" size="sm" onClick={() => deleteSaved(s.id)}>Delete</Button>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setSavedDeleteId(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <div className="mt-2 flex gap-1">
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            loadFen(s.fen, false);
                            setNotes(s.notes || '');
                            setActivePopup(null);
                            showToast(`Opened “${s.name}”.`, { tone: 'success', title: 'Saved analysis' });
                          }}
                        >
                          Load
                        </Button>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setSavedDeleteId(s.id)}>Delete</Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Settings ────────────────────────────────────────────────── */}
        {activePopup === 'settings' && (
          <div className="space-y-1">
            {[
              /* "everywhere" because the preference is app-wide: this switch
                 governs every board in the academy, puzzles, live classes and
                 tournaments, not just the arena. */
              ['Sound effects (everywhere)', soundOn, setSoundOn],
              ['Show legal moves', showLegal, setShowLegalMoves],
              ['Coordinates', showNotation, setNotationPref],
              ['Highlight last move', highlightLast, setHighlightPref],
              ['Auto-queen promotion', autoQueen, setAutoQueen],
              ['Confirm move', confirmMove, setConfirmMovePref],
            ].map(([label, val, setter]) => (
              <label key={label} className="chess-toggle !py-1.5">
                <span className="text-xs text-ivory-300">{label}</span>
                <input type="checkbox" checked={val} onChange={(e) => setter(e.target.checked)} />
              </label>
            ))}
            <p className="!mt-0 pb-1 text-[11px] leading-snug text-ivory-500">
              Confirm move asks before every move in online and computer games.
            </p>

            {/* Volume — directly under Sound effects because it only means
                anything when sound is on. */}
            <div className={`pt-1 ${soundOn ? '' : 'opacity-40'}`}>
              <div className="flex items-center justify-between">
                <label htmlFor="ab-volume" className="text-xs text-ivory-300">Volume</label>
                <span className="text-xs text-ivory-500 tabular-nums">{Math.round(volume * 100)}%</span>
              </div>
              <input
                id="ab-volume"
                type="range"
                className="chess-range mt-1"
                min="0" max="2" step="0.05"
                value={volume}
                disabled={!soundOn}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="Sound volume"
              />
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="text-[10px] leading-snug text-ivory-500">100% = as designed. Up to 200%.</p>
                <Button
                  type="button"
                  onClick={() => { unlockAudio(); playSound('move'); }}
                  disabled={!soundOn}
                  variant="secondary" size="md" className="!py-1 !px-2 text-[10px] shrink-0"
                >
                  🔊 Test
                </Button>
              </div>
            </div>

            <div className="pt-1.5">
              <label htmlFor="ab-settings-board" className="text-xs font-semibold text-ivory-300">Board theme</label>
              <select
                id="ab-settings-board"
                value={getBoardTheme(savedBoardTheme).id}
                onChange={(e) => {
                  updatePrefs({ boardTheme: e.target.value }).catch(() =>
                    showToast('Could not save board theme — try again.', { tone: 'error', title: 'Board theme' })
                  );
                }}
                className="chess-input mt-1 !text-xs !py-1.5"
              >
                {BOARD_THEMES.filter((t) => !BOARD_THEMES_HIDDEN_IN_SETTINGS.has(t.id)).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            <div className="pt-1.5">
              <label htmlFor="ab-settings-pieces" className="text-xs font-semibold text-ivory-300">Piece set</label>
              <select
                id="ab-settings-pieces"
                value={PIECE_THEMES[pieceSel] ? pieceSel : 'cburnett'}
                onChange={(e) => {
                  updatePrefs({ pieceSet: e.target.value }).catch(() =>
                    showToast('Could not save piece theme — try again.', { tone: 'error', title: 'Piece theme' })
                  );
                }}
                className="chess-input mt-1 !text-xs !py-1.5"
              >
                {Object.values(PIECE_THEMES).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className="pt-1.5">
              <label htmlFor="ab-settings-orientation" className="text-xs font-semibold text-ivory-300">Orientation</label>
              <select
                id="ab-settings-orientation"
                value={orientation}
                onChange={(e) => setOrientation(e.target.value)}
                className="chess-input mt-1 !text-xs !py-1.5"
              >
                <option value="white">White (bottom)</option>
                <option value="black">Black (bottom)</option>
              </select>
            </div>
          </div>
        )}
      </Modal>

      {/* ── online game request — bottom-of-page notice bar ── */}
      {inviteBar && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[var(--z-toast)] w-[min(94vw,560px)]">
          <div className="pointer-events-auto chess-toast rounded-xl border border-gold-500/40 shadow-[0_10px_30px_-8px_rgba(96,165,250,0.35)] bg-ink-800 px-4 py-3 flex items-center gap-3 shadow-2xl">
            <span className="grid place-items-center w-7 h-7 shrink-0 rounded-lg border text-xs font-bold text-gold-400 bg-gold-500/15 border-gold-400/30">♟</span>
            <p className="flex-1 text-xs text-ivory-300 leading-snug">{inviteBar.msg}</p>
            <Button
              onClick={() => acceptOnline(inviteBar.game)}
              disabled={onlineBusy}
              variant="primary" size="sm" className="!px-4 !py-1.5 text-xs shrink-0"
            >
              {onlineBusy ? 'Accepting…' : '✔ Accept'}
            </Button>
            <Button
              onClick={() => declineOnline(inviteBar.game)}
              disabled={onlineBusy}
              variant="danger" size="sm" className="!px-3 !py-1.5 text-xs shrink-0"
            >
              ✕ Decline
            </Button>
            <button
              onClick={() => { setInviteBar(null); window.clearTimeout(inviteBarTimer.current); }}
              className="shrink-0 text-ivory-500 hover:text-ivory-300 text-sm leading-none"
              aria-label="Dismiss invite"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ════════════ Play Mode — fullscreen immersive board ════════════ */}
      {playMode && createPortal(
        <div className="play-mode-overlay" style={pmCss} data-play-mode role="dialog" aria-modal="true" aria-label="Play Mode">
          <button className="play-mode-exit" onClick={() => setPlayMode(false)} aria-label="Exit Play Mode" title="Exit Play Mode (Esc)">✕</button>

          {/* Phones get their own header row ABOVE the board. The fixed ✕ it
              replaces sat on the board's corner and covered the rook on the
              back rank. */}
          <div className="play-mode-mobile-head">
            <span className="play-mode-title">♖ Play Arena</span>
            <span className="play-mode-head-actions">
              {/* The same ⋮ the page toolbar carries, so resigning and offering a
                  draw stay reachable once the overlay covers the page. */}
              {inOnline && !onlineFinished && (
                <ResignDrawMenu
                  busy={onlineBusy}
                  isBot={onlineGame?.isBot}
                  drawOffer={drawOffer}
                  opponentName={opponentName}
                  onResign={resignOnlineCurrent}
                  onOfferDraw={offerDrawOnline}
                />
              )}
              <button
                type="button"
                className="play-mode-exit-bar"
                onClick={() => setPlayMode(false)}
                aria-label="Exit Play Mode"
                title="Exit Play Mode"
              >
                ✕
              </button>
            </span>
          </div>

          <div className="play-mode-panel">
          <div className="play-mode-top">
            <span className="play-mode-title">♖ Play Arena</span>
            {inOnline && !onlineFinished && (
              <ResignDrawMenu
                busy={onlineBusy}
                isBot={onlineGame?.isBot}
                drawOffer={drawOffer}
                opponentName={opponentName}
                onResign={resignOnlineCurrent}
                onOfferDraw={offerDrawOnline}
              />
            )}
            <span className="play-mode-sub">
              {onlineBanner ? onlineBanner.text
                : computerOn
                  ? (computerThinking ? '🤖 Thinking…' : gameRef.current.turn() === (computerColor === 'white' ? 'w' : 'b') ? 'Your move!' : 'Machine thinking…')
                  : `${bottomLabel} · ${topLabel}`}
            </span>
          </div>

          <div className="play-mode-panel-scroll">
            {/* top (opponent) player row */}
            <div className="play-mode-player play-mode-player-top ab-player-row-reactions">
              <ReactionBubble reaction={playerReactions.opponent} boardRef={pmAreaRef} />
              <span className="ab-player-name">{topLabel}</span>
              <CapturedTray
                pieces={topCaptured}
                diff={captured[`${topColor}Value`] - captured[`${topColor === 'white' ? 'black' : 'white'}Value`]}
              />
              <GameClock
                clock={clock}
                running={clockRunning}
                color={topColor}
                forceFloor={clock?.incMs === 0}
              />
            </div>

            {/* bottom (you) player row */}
            <div className="play-mode-player play-mode-player-bot ab-player-row-reactions">
              <ReactionBubble reaction={playerReactions.mine} boardRef={pmAreaRef} />
              <span className="ab-player-name">{bottomLabel}</span>
              {canReact && playMode && <EmojiReactControl open={showReactPicker} disabled={reactionCooling} pressed={pressedReaction} onToggle={() => setShowReactPicker((value) => !value)} onReact={onReact} onClose={() => setShowReactPicker(false)} />}
              <CapturedTray
                pieces={bottomCaptured}
                diff={captured[`${orientation}Value`] - captured[`${orientation === 'white' ? 'black' : 'white'}Value`]}
              />
              <ClockBox
                color={orientation}
                time={clock ? fmtClock(liveRemaining(orientation), clock.incMs === 0) : null}
                active={!!(clock && clock.turn === orientation)}
                low={!!(clock && liveRemaining(orientation) < 10000 && clock.turn === orientation)}
              />
            </div>

            {/* controls + status */}
            <div className="play-mode-controls">
              <div className="ab-ctrl-group">
                <Button onClick={() => goToMove(0)} disabled={navLocked || moveIndex === 0} variant="secondary" size="sm" className="!py-1 !px-2 text-xs" title="Start">⏮</Button>
                <Button onClick={undoMove}           disabled={navLocked || moveIndex === 0} variant="secondary" size="sm" className="!py-1 !px-2 text-xs" title="Undo">◀</Button>
                <Button onClick={redoMove}           disabled={navLocked || moveIndex >= moves.length} variant="secondary" size="sm" className="!py-1 !px-2 text-xs" title="Redo">▶</Button>
                <Button onClick={() => goToMove(moves.length)} disabled={navLocked || moveIndex >= moves.length} variant="secondary" size="sm" className="!py-1 !px-2 text-xs" title="End">⏭</Button>
                <Button onClick={reset}              disabled={navLocked} variant="secondary" size="sm" className="!py-1 !px-2 text-xs" title="Reset position">↺</Button>
                <Button onClick={() => { setOrientation((o) => (o === 'white' ? 'black' : 'white')); if (soundOn) playSound('select'); }}
                  variant="secondary" size="sm" className="!py-1 !px-2 text-xs" title="Flip board">⇄</Button>
              </div>
              <div className="ab-ctrl-chips">
                <span className="chess-chip" style={{ fontSize: '0.65rem' }}>
                  {gameRef.current.turn() === 'w' ? '⚪' : '⚫'} {gameRef.current.turn() === 'w' ? 'White' : 'Black'}
                </span>
                {status.label !== 'In Progress' && (
                  <span className={`chess-chip ${statusTone}`} style={{ fontSize: '0.65rem' }}>{status.label}</span>
                )}
                {computerOn && (
                  <span className="chess-chip chess-chip-gold" style={{ fontSize: '0.65rem' }}>
                    🤖 Lv{computerLevel} {skillLabel(computerLevel)}
                  </span>
                )}
                {inOnline && !onlineFinished && (
                  <DrawOfferPrompt
                    busy={onlineBusy}
                    drawOffer={drawOffer}
                    opponentName={opponentName}
                    onRespondDraw={respondDrawOnline}
                  />
                )}
              </div>
            </div>

{/* move list - using Card component */}
              <Card title="Moves" piece="♘" className="play-mode-moves-card">
                <div className="ab-moves-header">
                  <span className="ab-moves-title">♘ Moves</span>
                  <span className="ab-moves-counter">{moveIndex} / {moves.length}</span>
                </div>
                <MoveList
                  variant="list"
                  moves={moves}
                  moveIndex={moveIndex}
                  verdicts={verdictList}
                  navLocked={navLocked}
                  goToMove={handleNavMove}
                  emptyText="No moves yet — play on the board or load a game."
                />
              </Card>
          </div>
        </div>

        {/* board — the star: fills every free pixel, side details stay in the panel */}
        <div className="play-mode-board-area" ref={pmAreaRef}>
          <ArenaBoard
            key={boardResetKey}
            game={gameRef.current}
            orientation={orientation}
            boardWidth={pmBoardWidth}
            onPositionChange={handlePositionChange}
            onMove={handleBoardMove}
            interactive={boardLive}
            showLegalMoves={showLegal}
            showNotation={showNotation}
            soundOn={soundOn}
            selfColor={selfColorCode}
            highlightLastMove={highlightLast}
            lastMove={lastMove}
            pieceTheme={pieceSel}
            customArrows={boardArrows}
            engineOn={engineOn && !inOnline}
            reviewVerdictColor={reviewVerdictColor}
            moveBadge={reviewMoveBadge}
            /* The Play Mode board is the one on top while it is open, so every
               effect must be addressed to it — not to the page board behind
               the overlay. */
            effectHostId={playModeBoardHostId}
          />

          {waitingForOpponent && <WaitingOverlay />}

          {pendingConfirm && (
            <div className="ab-move-confirm" role="alertdialog" aria-label="Confirm move" aria-live="assertive">
              <span>Play <strong>{pendingConfirm.move?.san || 'this move'}</strong>?</span>
              <Button type="button" variant="primary" size="sm" onClick={confirmPendingMove} className="!py-1 !px-3 text-xs">Play</Button>
              <Button type="button" variant="secondary" size="sm" onClick={cancelPendingMove} className="!py-1 !px-3 text-xs">Cancel</Button>
            </div>
          )}
        </div>

          {/* post-game result card — shown over the board when the game ends in Play Mode */}
          {resultCard}
        </div>
        ,
        document.body
      )}

      {/* ── Spectator view of the selected live game ── */}
      {spectateSession && (
        <SpectatorBoard session={spectateSession} onClose={() => setSpectateSession(null)} />
      )}
    </div>
  );

  /* ─── confetti spawner ─────────────────────────────────── */
  function spawnConfetti() {
    /* 65 % golden, rest spread across amber / white / green */
    const COLORS = [
      'confetti-gold',  'confetti-gold',  'confetti-gold',  'confetti-gold',
      'confetti-gold2', 'confetti-gold2', 'confetti-gold2',
      'confetti-amber', 'confetti-amber',
      'confetti-white',
      'confetti-green',
    ];
    const pieces = Array.from({ length: 80 }, (_, i) => ({
      id: i,
      color: COLORS[i % COLORS.length],
      left: Math.random() * 100,
      delay: Math.random() * 1.1,
      dur: 2.4 + Math.random() * 2.2,
      size: 6 + Math.random() * 10,
      rotate: Math.random() * 360,
      /* drift gives each piece a sideways spiral; CSS var consumed by confetti-fall */
      drift: (Math.random() - 0.5) * 160,
      /* alternate shape: some are wider rectangles, some are circles (handled in CSS by color class) */
      aspect: 0.35 + Math.random() * 0.9,
    }));
    setConfetti(pieces);
    setTimeout(() => setConfetti([]), 5500);
  }

  /* ─── game analysis runner ───────────────────────────────── */
  // `silent` suppresses the standalone "Analysis Complete!" popup/confetti so it
  // can back-fill the post-game result popup (game-end) without double overlays.
  async function runGameAnalysis(silent) {
    if (!moves.length || analyzing) return;
    const token = ++analysisToken.current;
    setAnalyzing(true);
    setGameAnalysis(null);
    setAnalyzeProgress(0);
    try {
      /* The game's canonical identity when it came from a stored source, so an
         analysis this game already has is reused rather than re-run. */
      const onlineGame = onlineGameRef.current;
      const gameRef = onlineGame && onlineGame.id
        ? { gameSource: 'online', gameId: onlineGame.id }
        : null;
      const res = await analyzeGame(initialFen, moves, {
        gameRef,
        onProgress: (done, total) => setAnalyzeProgress(Math.round((done / total) * 100)),
        isCancelled: () => token !== analysisToken.current,
      });
      if (token === analysisToken.current && res) {
        setGameAnalysis(res);
        if (!silent) {
          setShowReviewPopup(true);
          spawnConfetti();
          /* sound is now played by ReviewCompletePopup on mount */
        }
      }
    } catch {
      /* The finished game is untouched; the review simply has no grades. */
    }
    if (token === analysisToken.current) setAnalyzing(false);
  }
}

/* ══════════════════════ sub-components ══════════════════════ */

/* The move list, memoised.
 *
 * Both surfaces render one — the page's single scrolling strip and Play Mode's
 * boxed list — and they were two hand-copied blocks of markup that had already
 * started to drift. Worse, they sat inline in the page body, so ANY page state
 * change repainted every move button on the board.
 *
 * Now the repaint is driven by the four things a move button actually depends
 * on: the SAN list, which ply is being viewed, the verdict badges, and whether
 * navigation is locked. Clocks, panels, toasts and reactions cannot touch it.
 *
 * `variant` picks the styling the two surfaces already had; the markup is shared.
 */
const MoveList = memo(function MoveList({
  variant,
  moves,
  moveIndex,
  verdicts,
  navLocked,
  goToMove,
  containerRef,
  emptyText,
}) {
  if (moves.length === 0) {
    return variant === 'strip'
      ? <div className="ab-movestrip" ref={containerRef}><span className="ab-moves-empty">{emptyText}</span></div>
      : <p className="ab-moves-empty">{emptyText}</p>;
  }

  const pairClass = variant === 'strip' ? 'ab-mvpair' : 'ab-move-pair';
  const numClass = variant === 'strip' ? 'ab-mvnum' : 'ab-move-num';
  const btnBase = variant === 'strip' ? 'ab-mv' : 'ab-move-btn';
  const currentClass = variant === 'strip' ? 'is-current' : 'active';

  const rows = Array.from({ length: Math.ceil(moves.length / 2) }, (_, i) => (
    <span key={i} className={pairClass}>
      <span className={numClass}>{i + 1}.</span>
      {[0, 1].map((offset) => {
        const idx = i * 2 + offset;
        if (idx >= moves.length) {
          return variant === 'strip' ? null : <span key={offset} className={btnBase} />;
        }
        const v = verdicts ? verdicts[idx] : null;
        const vm = v ? VERDICT_META[v.verdict] : null;
        const current = idx + 1 === moveIndex;
        return (
          <button
            key={offset}
            type="button"
            onClick={() => goToMove(idx + 1)}
            disabled={navLocked}
            title={vm ? `${vm.label}${v.loss > 0 ? ` (−${v.loss} pawns)` : ''}` : ''}
            className={`${btnBase}${current ? ` ${currentClass}` : ''}${vm ? ` ab-move-verdict-${vm.tone}` : ''}`}
          >
            {vm && <span className={`mv-badge mv-badge-${vm.tone}`} title={vm.label}>{vm.symbol}</span>}
            {moves[idx]}
          </button>
        );
      })}
    </span>
  ));

  return variant === 'strip'
    ? <div className="ab-movestrip" ref={containerRef}>{rows}</div>
    : <PlayModeMoveList followKey={`${moveIndex}/${moves.length}`}>{rows}</PlayModeMoveList>;
});

/* Play Mode's boxed list scrolls VERTICALLY inside itself. When the viewed ply
 * changes — a new move, or the reader stepping back — only THIS container is
 * moved. `scrollIntoView` is not used anywhere on this page: it walks every
 * scrollable ancestor and could drag the whole overlay/page along with it, which
 * is the page shake. */
function PlayModeMoveList({ children, followKey }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cur = el.querySelector('.ab-move-btn.active');
    if (!cur) return;
    const top = cur.offsetTop - (el.clientHeight - cur.offsetHeight) / 2;
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTo({ top: Math.max(0, Math.min(max, top)), behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followKey]);
  return <div className="ab-move-list" ref={ref}>{children}</div>;
}

/* The board's "waiting" overlay: a circular spinner with the message under it,
 * sitting ON the board instead of the thin strip of text it replaced.
 *
 * Purely presentational and `pointer-events:none` — it never eats a tap. The
 * board itself is switched off by `interactive`, which is why a waiting player
 * cannot pick up a piece while this is up. */
function WaitingOverlay() {
  return (
    <div className="ab-waiting" role="status" aria-live="polite">
      <span className="ab-waiting-spinner" aria-hidden="true" />
      <span className="ab-waiting-text">Waiting for opponent</span>
    </div>
  );
}

function ClockBox({ color, time, active, low }) {
  return (
    <div className={`ab-clock${active ? ' ab-clock-active' : ''}${low ? ' ab-clock-low' : ''}${!time ? ' ab-clock-static' : ''}`}>
      <span className="ab-clock-color">{color === 'white' ? '⚪' : '⚫'}</span>
      <span className="ab-clock-time">{time ?? '--:--'}</span>
    </div>
  );
}

/* Milliseconds left on one side, read live. The stored value is a snapshot taken
   when that side last moved, so the side on clock is that snapshot minus the time
   that has passed since. Pure, so the clock display and the flag-fall checks can
   never disagree about what the clock says. */
function remainingMs(clock, running, color) {
  if (!clock) return 0;
  const stored = color === 'white' ? clock.whiteMs : clock.blackMs;
  if (!running || clock.turn !== color) return stored;
  return Math.max(0, stored - Math.max(0, Date.now() - (clock.serverNow || Date.now())));
}

/* A ticking clock, isolated in its own component. The page used to hold a
   `clockTick` counter and repaint itself five times a second, so every tick
   re-rendered the board, the move list and both side panels — the single
   biggest reason a live game felt like it was hanging. Now only this subtree
   sees the beat. */
function GameClock({ clock, running, color, forceFloor }) {
  const [, setBeat] = useState(0);
  const ticking = !!clock && running && clock.turn === color;

  useEffect(() => {
    if (!ticking) return undefined;
    const t = setInterval(() => setBeat((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [ticking]);

  const left = remainingMs(clock, running, color);
  return (
    <ClockBox
      color={color}
      time={clock ? fmtClock(left, forceFloor) : null}
      active={!!(clock && clock.turn === color)}
      low={!!(clock && left < 10000 && clock.turn === color)}
    />
  );
}

/* Resign / Offer draw, plus the pending draw-offer prompt.
 *
 * One component for both call sites (the page banner and the Play Mode controls)
 * so the two cannot drift — they were byte-identical copies, and that is how the
 * Draw button ended up wired to an instant-finish call in both places.
 *
 * Draw is an OFFER. Clicking it asks the opponent; the game only ends if they
 * accept. While an offer is outstanding this renders one of two states, told
 * apart by the server's `mine` flag rather than inferred from the name:
 *
 *   mine  → "Draw offered — waiting for <opponent>"   (nothing to click but info)
 *   !mine → "<opponent> offers a draw"  + Accept / Decline
 *
 * The offer is hidden against a computer: there is nobody to accept it, and the
 * endpoint refuses it anyway.
 *
 * This prompt stays always-visible — it is the OPPONENT asking something of you,
 * so hiding it behind a menu you have to open would silently ignore them. The
 * two buttons YOU press (Resign / Offer Draw) moved to ResignDrawMenu.
 */
function DrawOfferPrompt({
  busy, drawOffer, opponentName = 'your opponent', onRespondDraw,
}) {
  const theirs = drawOffer && !drawOffer.mine;
  const mine   = drawOffer && drawOffer.mine;
  const who    = drawOffer?.byName || opponentName;

  if (!theirs && !mine) return null;

  return (
    <>
      {theirs && (
        <div className="ab-draw-offer" role="alertdialog" aria-label="Draw offer">
          <span className="ab-draw-offer-text">
            <span aria-hidden="true">🤝</span> {who} offers a draw
          </span>
          <span className="ab-draw-offer-actions">
            <Button
              type="button"
              onClick={() => onRespondDraw(true)}
              disabled={busy}
              variant="primary" size="sm" className="!py-1 !px-2.5 text-xs"
            >
              ✓ Accept
            </Button>
            <Button
              type="button"
              onClick={() => onRespondDraw(false)}
              disabled={busy}
              variant="secondary" size="sm" className="!py-1 !px-2.5 text-xs"
            >
              ✕ Decline
            </Button>
          </span>
        </div>
      )}

      {mine && (
        <span className="ab-draw-pending" role="status">
          <span aria-hidden="true">🤝</span> Draw offered — waiting for {who}
        </span>
      )}
    </>
  );
}

/* The ⋮ menu that holds Resign and Offer Draw.
 *
 * Both used to sit permanently beside the board. On a phone that is thumb height
 * and thumb reach at once, and a single mistap ended a live game — so they are
 * behind one 44px icon button now, anchored to it.
 *
 * Each action is a two-tap confirm: the row turns into "Resign this game? /
 * Yes · No" instead of firing immediately. That replaces the confirm dialog the
 * page never had, and keeps the actual `onResign` / `onOfferDraw` calls — and the
 * draw-offer logic behind them — exactly as they were.
 *
 * Closes on an outside tap, on Escape, and after an action is taken. The popover
 * is a child of the anchor (not a portal), so `contains()` is a valid outside
 * test here.
 */
function ResignDrawMenu({
  busy, isBot, drawOffer, opponentName = 'your opponent', onResign, onOfferDraw,
}) {
  const [open,     setOpen]    = useState(false);
  const [confirm,  setConfirm] = useState(null);   // 'resign' | 'draw' | null
  const anchorRef  = useRef(null);

  const close = useCallback(() => {
    setConfirm(null);
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target)) close();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true, capture: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const alreadyOffered = Boolean(drawOffer && drawOffer.mine);

  /* First tap arms the row, second tap runs the original handler and closes. */
  const run = (kind) => {
    if (confirm !== kind) { setConfirm(kind); return; }
    close();
    if (kind === 'resign') onResign();
    else onOfferDraw();
  };

  const row = (kind, label, disabled, variant) => (
    confirm === kind ? (
      <div className="ab-menu-confirm" key={kind}>
        <span>{kind === 'resign' ? 'Resign this game?' : 'Offer a draw?'}</span>
        <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => run(kind)}>Yes</Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setConfirm(null)}>No</Button>
      </div>
    ) : (
      <Button
        type="button"
        role="menuitem"
        key={kind}
        onClick={() => run(kind)}
        disabled={busy || disabled}
        variant={variant}
        size="sm"
      >
        {label}
      </Button>
    )
  );

  return (
    <div className="ab-menu-anchor" ref={anchorRef}>
      <button
        type="button"
        className="ab-menu-btn"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Game options"
        title="Game options"
      >
        <span aria-hidden>⋮</span>
      </button>
      {open && (
        <div className="ab-menu-pop" role="menu" aria-label="Game options">
          {row('resign', '♟ Resign', false, 'danger')}
          {!isBot && row('draw', alreadyOffered ? '🤝 Draw already offered' : '🤝 Offer Draw', alreadyOffered, 'secondary')}
        </div>
      )}
    </div>
  );
}

const GAME_REACTIONS = [
  { key: 'thumbs_up', label: '👍', title: 'Like', video: reactionThumbsUp },
  { key: 'laugh', label: '😂', title: 'Laugh', video: reactionLaughing },
  { key: 'wow', label: '😮', title: 'Wow', video: reactionWow },
  { key: 'sad', label: '😢', title: 'Sad', video: reactionCrying },
  { key: 'angry', label: '😡', title: 'Angry', video: reactionAngry },
  { key: 'fire', label: '🔥', title: 'Fire', video: reactionFire },
  { key: 'clap', label: '👏', title: 'Clap', video: reactionClap },
  { key: 'handshake', label: '🤝', title: 'Good game', video: reactionHandshake },
  { key: 'gg', label: '🎉', title: 'GG', video: reactionParty },
];
const REACTION_PARTICLES = [
  [-34, -24, -18], [-13, -34, 12], [16, -32, 24], [36, -10, -10],
  [30, 20, 18], [5, 34, -24], [-25, 26, 8], [-39, 2, -6],
];

function ReactionBubble({ reaction, boardRef }) {
  const anchorRef = useRef(null);
  const [point, setPoint] = useState(null);
  const [reducedMotion, setReducedMotion] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ));
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return undefined;
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  useLayoutEffect(() => {
    if (!reaction || !anchorRef.current) { setPoint(null); return undefined; }
    const boardArea = boardRef?.current;
    if (!boardArea) return undefined;
    const update = () => {
      const rect = boardArea.getBoundingClientRect();
      setPoint({ left: Math.max(8, rect.left + rect.width / 2 - 48), top: Math.max(8, rect.top + rect.height / 2 - 48) });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(boardArea);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      observer?.disconnect();
    };
  }, [reaction?.id, boardRef]);
  if (!reaction) return null;
  const item = GAME_REACTIONS.find((candidate) => candidate.key === reaction.emoji);
  if (!item) return null;
  return (
    <>
      <span ref={anchorRef} className="ab-reaction-anchor-point" aria-hidden="true" />
      {point && createPortal(
        <div key={reaction.id} className={`ab-reaction-bubble ab-reaction-${item.key}`} style={{ left: point.left, top: point.top }} aria-hidden="true">
          <span className="ab-reaction-main">
            <span className="ab-reaction-character">
              {reducedMotion
                ? item.label
                : <KeyedReactionVideo className="ab-reaction-motion" src={item.video} />}
            </span>
            {item.key === 'sad' && <span className="ab-reaction-tears"><i /><i /></span>}
          </span>
          <span className="ab-reaction-particles">
            {REACTION_PARTICLES.map(([x, y, rotation], index) => (
              <i key={index} style={{ '--rx': `${x}px`, '--ry': `${y}px`, '--rr': `${rotation}deg`, animationDelay: `${index * 18}ms` }}>{item.label}</i>
            ))}
          </span>
        </div>,
        document.body,
      )}
    </>
  );
}

/* Remove only near-white pixels connected to the video frame edges. Interior
   whites (eyes, highlights and lettering) stay intact. The source video remains
   muted and hidden; its decoded frames are painted onto a transparent canvas. */
function KeyedReactionVideo({ src, className = '' }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return undefined;
    const width = 128;
    const height = 128;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return undefined;
    let frameRequest = 0;
    let previousTime = -1;
    const isBackgroundWhite = (data, offset) => {
      const red = data[offset], green = data[offset + 1], blue = data[offset + 2];
      return Math.min(red, green, blue) >= 205 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 52;
    };
    const renderFrame = () => {
      frameRequest = requestAnimationFrame(renderFrame);
      if (video.readyState < 2 || video.currentTime === previousTime) return;
      previousTime = video.currentTime;
      context.drawImage(video, 0, 0, width, height);
      const image = context.getImageData(0, 0, width, height);
      const { data } = image;
      const count = width * height;
      const seen = new Uint8Array(count);
      const queue = new Uint32Array(count);
      let head = 0, tail = 0;
      const add = (index) => {
        if (seen[index]) return;
        seen[index] = 1;
        if (isBackgroundWhite(data, index * 4)) queue[tail++] = index;
      };
      for (let x = 0; x < width; x += 1) {
        add(x);
        add((height - 1) * width + x);
      }
      for (let y = 1; y < height - 1; y += 1) {
        add(y * width);
        add(y * width + width - 1);
      }
      while (head < tail) {
        const index = queue[head++];
        data[index * 4 + 3] = 0;
        const x = index % width;
        const y = (index - x) / width;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) add(ny * width + nx);
          }
        }
      }
      context.putImageData(image, 0, 0);
    };
    video.play().catch(() => {});
    frameRequest = requestAnimationFrame(renderFrame);
    return () => {
      cancelAnimationFrame(frameRequest);
      video.pause();
    };
  }, [src]);
  return (
    <>
      <video
        ref={videoRef}
        src={src}
        autoPlay
        muted
        playsInline
        preload="auto"
        tabIndex={-1}
        aria-hidden="true"
        className="ab-reaction-video-source"
      />
      <canvas ref={canvasRef} width={128} height={128} className={`ab-reaction-video ${className}`} aria-hidden="true" />
    </>
  );
}

function ReactionPicker({ disabled, pressed, onReact }) {
  return (
    <div className="ab-react-picker" role="group" aria-label="Choose a reaction">
      {GAME_REACTIONS.map((reaction) => (
        <button
          key={reaction.key}
          type="button"
          className={`ab-react-emoji${pressed === reaction.key ? ' is-pressed' : ''}`}
          onClick={() => onReact(reaction.key)}
          disabled={disabled}
          title={reaction.title}
          aria-label={reaction.title}
        >
          {reaction.label}
        </button>
      ))}
    </div>
  );
}

function EmojiReactControl({ open, disabled, pressed, onToggle, onReact, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event) => { if (!ref.current?.contains(event.target)) onClose(); };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [open, onClose]);
  return (
    <span ref={ref} className="ab-react-anchor ab-react-inline">
      <button
        type="button"
        className={`ab-reaction-trigger-button${disabled ? ' is-cooling' : ''}${pressed ? ' is-pressed' : ''}`}
        onClick={onToggle}
        title="React"
        aria-label="Choose a reaction"
        aria-expanded={open}
      >
        <span aria-hidden>😊</span>
      </button>
      {open && <ReactionPicker disabled={disabled} pressed={pressed} onReact={onReact} />}
    </span>
  );
}

/* Quick time-control preset chips (Bullet / Blitz / Rapid / …). Clicking a chip
   syncs the shared hours/base/inc selectors below it. */
function TimePresetRow({ selected, onSelect }) {
  return (
    <div className="flex flex-wrap gap-1 mb-1.5">
      {TIME_PRESETS.map((p) => {
        const active =
          selected.hours === p.hours &&
          selected.base === p.base &&
          selected.inc === p.inc;
        return (
          <button
            key={p.time}
            type="button"
            onClick={() => onSelect(p)}
            className={`flex-1 min-w-[4.4rem] chess-chip !px-1 text-xs text-center ${
              active ? 'chess-chip-gold' : ''
            }`}
            title={`${p.label} — ${p.hours}h ${p.base}m +${p.inc}s`}
          >
            {p.time}
          </button>
        );
      })}
    </div>
  );
}

function CapturedTray({ pieces, diff, vertical }) {
  if (pieces.length === 0) return null;
  return (
    <div className={`ab-captured ${vertical ? 'ab-captured-side' : ''}`}>
      {pieces.map((g, i) => (
        <span key={i} className={`cp ${['♔','♙','♘','♗','♖','♕'].includes(g) ? 'cp-white' : 'cp-black'}`}>{g}</span>
      ))}
      {diff !== 0 && <span className="cp-diff">{diff > 0 ? '+' : ''}{diff}</span>}
    </div>
  );
}

function useSavedAnalyses() {
  const [tick, setTick] = useState(0);
  const [list, setList] = useState([]);
  useEffect(() => {
    setList(JSON.parse(localStorage.getItem('kpa_analyses') || '[]'));
  }, [tick]);
  return { list, refresh: () => setTick((t) => t + 1) };
}

/* ── review-complete party popup ────────────────────────── */

function ReviewPanel({ moves, moveIndex, verdicts, analyzing, analyzeProgress, onNavigate, onExitReview, onRematch, onNewGame, canRematch }) {
  return (
    <div className="ab-review-panel">
      <div className="ab-review-top">
        <Button type="button" variant="secondary" size="sm" onClick={onExitReview}>← Board</Button>
        {canRematch && <Button type="button" variant="primary" size="sm" onClick={onRematch}>Rematch</Button>}
        <Button type="button" variant="secondary" size="sm" onClick={onNewGame}>New</Button>
      </div>

      {analyzing && (
        <div className="ab-review-progress">
          <div className="ab-review-progress-bar" style={{ width: `${analyzeProgress}%` }} />
          <span className="ab-review-progress-text">Analyzing… {analyzeProgress}%</span>
        </div>
      )}

      <div className="ab-review-moves">
        {moves.length === 0 && <p className="ab-moves-empty">No moves to review.</p>}
        {moves.map((san, i) => {
          const moveNum = Math.floor(i / 2) + 1;
          const isWhite = i % 2 === 0;
          const v = verdicts?.[i] ?? null;
          const meta = v ? VERDICT_META[v.verdict] : null;
          const isActive = i === moveIndex;
          return (
            <button
              key={i}
              onClick={() => onNavigate(i)}
              className={`ab-review-move ${isActive ? 'ab-review-move-active' : ''}`}
              title={meta ? `${meta.label} move` : 'No analysis'}
            >
              {isWhite && <span className="ab-review-num">{moveNum}.</span>}
              {!isWhite && moveNum === 1 && <span className="ab-review-num">&nbsp;&nbsp;&nbsp;</span>}
              <span className="ab-review-san">{san}</span>
              {meta && (
                <span className="ab-review-verdict" style={{ color: meta.color, borderColor: meta.color + '55', background: meta.color + '18' }}>
                  {meta.glyph}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── review-complete party popup ────────────────────────── */

function ReviewCompletePopup({ analysis, onClose, soundOn }) {
  /* play the loud celebrate fanfare exactly once when this mounts */
  useEffect(() => {
    if (soundOn) playSound('celebrate');
    // lock scroll while open
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!analysis) return null;
  const { counts } = analysis;
  const wAcc = accuracyFor(counts.white);
  const bAcc = accuracyFor(counts.black);

  const VERDICTS = [
    { key: 'brilliant',  icon: '★',  label: 'Brilliant',  color: '#19c9c3' },
    { key: 'great',      icon: '!',  label: 'Great',      color: '#3d7ff5' },
    { key: 'book',       icon: '☰',  label: 'Book',       color: '#0369a1' },
    { key: 'best',       icon: '✓',  label: 'Best',       color: '#7bc96f' },
    { key: 'good',       icon: '!',  label: 'Good',       color: '#a3d977' },
    { key: 'inaccuracy', icon: '?!', label: 'Inaccuracy', color: '#93c5fd' },
    { key: 'mistake',    icon: '?',  label: 'Mistake',    color: '#e58f4a' },
    { key: 'miss',       icon: '✕',  label: 'Miss',       color: '#c241e0' },
    { key: 'blunder',    icon: '??', label: 'Blunder',    color: '#f87171' },
  ];

  const totalMoves = VERDICTS.reduce(
    (s, v) => s + (counts.white[v.key] || 0) + (counts.black[v.key] || 0), 0
  );

  /* only show verdicts that have at least one occurrence across both sides */
  const activeVerdicts = VERDICTS.filter(
    (v) => (counts.white[v.key] || 0) + (counts.black[v.key] || 0) > 0
  );

  return (
    <div className="party-overlay" onClick={onClose}>
      <div className="party-card" onClick={(e) => e.stopPropagation()} style={{ maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
        {/* animated golden top bar */}
        <div className="party-card-bar" />

        <button className="party-close" onClick={onClose} title="Close">✕</button>

        {/* trophy / fireworks icon */}
        <p style={{
          fontSize: '3.6rem', lineHeight: 1, marginBottom: '0.3rem',
          marginTop: '0.5rem',
          animation: 'game-over-glow 1.8s ease-in-out infinite',
          filter: 'drop-shadow(0 0 16px rgba(96,165,250,0.7))',
        }}>🎉</p>

        <p className="party-card-title">Analysis Complete!</p>
        <p className="party-card-sub">{totalMoves} moves classified</p>

        {/* accuracy row */}
        <div className="party-accuracy">
          {[['White', '⚪', wAcc], ['Black', '⚫', bAcc]].map(([side, icon, acc]) => (
            <div key={side} className="party-acc-side">
              <span className="party-acc-label">{icon} {side}</span>
              <span className="party-acc-num">{acc}</span>
              <span className="party-acc-pct">% accuracy</span>
            </div>
          ))}
        </div>

        {/* verdict count cards — 3-column grid with stagger bounce */}
        {activeVerdicts.length > 0 && (
          <div className="party-verdict-cards">
            {activeVerdicts.map((v, i) => {
              const wc = counts.white[v.key] || 0;
              const bc = counts.black[v.key] || 0;
              const total = wc + bc;
              return (
                <div
                  key={v.key}
                  className="party-vcard"
                  style={{
                    borderColor: v.color + '55',
                    background: v.color + '12',
                    animationDelay: `${0.18 + i * 0.07}s`,
                  }}
                >
                  <span className="party-vcard-icon" style={{ color: v.color }}>{v.icon}</span>
                  <span className="party-vcard-count" style={{ color: v.color }}>{total}</span>
                  <span className="party-vcard-label">{v.label}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* white / black breakdown table */}
        {activeVerdicts.length > 0 && (
          <div className="party-verdict-table">
            <div className="party-verdict-row party-verdict-header">
              <span>Move type</span><span>⚪</span><span>⚫</span>
            </div>
            {activeVerdicts.map((v) => (
              <div key={v.key} className="party-verdict-row">
                <span style={{ color: v.color, fontWeight: 700 }}>{v.icon} {v.label}</span>
                <span style={{ color: v.color }}>{counts.white[v.key] || 0}</span>
                <span style={{ color: v.color }}>{counts.black[v.key] || 0}</span>
              </div>
            ))}
          </div>
        )}

        <Button onClick={onClose} variant="primary" size="md" fullWidth className="!w-full !py-2.5 text-sm">
          Got it 👍
        </Button>
      </div>
    </div>
  );
}

/* __VITE_STALE_PROBE_9137__ */
