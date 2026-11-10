
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
  cancelGameRequest,
  resignGame,
  timeoutGame,
  sendMove,
  offerDraw,
  respondDraw,
  requestRematch,
  respondRematch,
  cancelRematch,
  fetchRatingResult,
} from '../utils/online';
import {
  joinGameRoom,
  leaveGameRoom,
  onGameUpdate,
  onGameMove,
  onSocketConnect,
  onSocketDisconnect,
  isSocketConnected,
  on as onSocketEvent,
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

/* A reaction bubble's life, and the lock-out after sending one, both in ms.
   The life is the same number as the `ab-reaction-life` keyframes in index.css:
   the emoji floats up and fades out inside that window and the node is removed
   just after it ends. Longer leaves an invisible bubble squatting in the slot;
   shorter cuts the fade mid-flight. The cooldown was two seconds, which is what
   made a reacted board feel deaf — the sender could not tell whether their tap
   had registered. */
const REACTION_LIFE_MS = 1800;
const REACTION_COOLDOWN_MS = 1000;

/* The ceiling on a piece's glide DURING A LIVE ONLINE MATCH. The saved Animation
   preference still picks the style and whether to animate at all; this only
   shortens it, because a piece that takes 450 ms to land is a piece that is
   visibly behind the opponent's move — and two moves in a row then look like the
   board has stalled. Kept inside the 120–200 ms band a fast game actually feels
   responsive in. */
const ONLINE_MOVE_MS = 200;

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

/* How long a rematch offer stays alive on this client. The server keeps the same
   window (plus a little slack for a request already in flight) and refuses an
   answer that arrives after it, so a tab that slept through the deadline cannot
   accept its way into a game the other side gave up on. */
const REMATCH_WINDOW_MS = 30000;

/* A timeout claim that the server refuses is not the end of the story: the
   refusal means the server's own clock had not crossed zero yet, so the claim
   has to be made again shortly. This is the floor between attempts — the flag
   check itself runs four times a second, and without a floor a refused claim
   would become a request every 250 ms. */
const FLAG_RETRY_MS = 2000;

/* Only a finished PLAYER-vs-PLAYER match can be rematched. A bot game needs no
   consent and restarts on the spot; a classroom board is paired by the coach; an
   aborted match was never played, so there is nothing to redo. The server
   enforces all of this too — the check exists so the button is never offered in a
   mode where clicking it can only fail. */
function onlineRematchTarget(game) {
  if (!game || game.status !== 'finished' || game.result === 'aborted') return null;
  if (game.isBot || game.classId) return null;
  return game;
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

/* Can this side still deliver mate? FIDE 6.9: a player who runs out of time
   only LOSES if the opponent has material to mate with, so a flag against a bare
   king — or against a king with a lone bishop or knight — is a draw. Anything
   that cannot mate is impossible to promote out of, so the rule is decided by the
   pieces alone, not by whether a win is actually reachable. The server applies
   the same test to online clocks; this copy decides the bot game, where there is
   no server clock to ask. */
function sideHasMatingMaterial(g, color) {
  if (!g) return true;
  const mine = color === 'white' ? 'w' : 'b';
  let bishops = 0;
  let knights = 0;
  for (const row of g.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== mine) continue;
      if (sq.type === 'p' || sq.type === 'r' || sq.type === 'q') return true;
      if (sq.type === 'b') bishops += 1;
      if (sq.type === 'n') knights += 1;
    }
  }
  /* Two bishops, or bishop plus knight, mate with the help of the enemy king;
     three knights can too. One minor piece on its own never can. */
  return bishops >= 2 || (bishops === 1 && knights >= 1) || knights >= 3;
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
];

function ColorCards({ value, onChange }) {
  return <div className="arena-color-grid">{[['white','♔','White','You move first'],['black','♚','Black','Opponent moves first']].map(([id,piece,label,help]) => <button type="button" key={id} className={`arena-color-card${value === id ? ' selected' : ''}`} onClick={() => onChange(id)}><span className="arena-check">✓</span><span className={`arena-piece ${id}`}>{piece}</span><b>{label}</b><small>{help}</small></button>)}<button type="button" className={`arena-color-random${value === 'random' ? ' selected' : ''}`} onClick={() => onChange('random')}><span className="arena-check">✓</span>🎲 Random</button></div>;
}

function TimeStep({ timeSel, setTimeSel, customTime, setCustomTime, timePicked, setTimePicked, presets }) {
  const time = (h, m) => h * 60 + m;
  return <div className="arena-time-groups">{presets.map((group, i) => <section key={i}><h4>{group[0][0]}</h4><div className="arena-time-grid">{group.map(([family,label,minutes,inc]) => <button type="button" key={label} className={`arena-time-card${!customTime && timeSel.hours === 0 && timeSel.base === minutes && timeSel.inc === inc ? ' selected' : ''}`} onClick={() => { setCustomTime(false); setTimePicked(true); setTimeSel({ hours: 0, base: minutes, inc }); }}><span className="arena-check">✓</span><b>{label}</b><small>{minutes} min</small></button>)}</div></section>)}<button type="button" className={`arena-custom-card${customTime ? ' selected' : ''}`} onClick={() => { setCustomTime(true); setTimePicked(true); }}><span className="arena-check">✓</span><b>Custom time</b><small>{timeSel.hours ? `${timeSel.hours}h ` : ''}{timeSel.base}m + {timeSel.inc}s</small></button>{customTime && <div className="arena-custom-fields">{[['Hours','hours',[0,1,2,3,4,5],(n)=>`${n}h`],['Minutes','base',[0,1,2,3,4,5,10,15,20,30,45,60],(n)=>`${n}m`],['Extra seconds after each move','inc',[0,1,2,3,5,10,15,20,30],(n)=>`+${n}s`]].map(([label,key,options,format]) => <label key={key}><span>{label}</span><select className="chess-input arena-select" value={timeSel[key]} onChange={(e) => { setTimePicked(true); setTimeSel((t) => ({ ...t, [key]: Number(e.target.value) })); }}>{options.map((n)=><option key={n} value={n}>{format(n)}</option>)}</select></label>)}{time(timeSel.hours,timeSel.base) === 0 && <p className="arena-time-warning">Pick at least 1 minute to continue</p>}</div>}</div>;
}

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
/* The low-time warning (under a minute, on the clock) lives once in index.css as
   .ab-clock-low — it has to reach the Play Mode copy too, which is portalled out
   of .ab-root. GameClock decides when the class is on. */

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

/* ── Rematch card ─────────────────────────────────────────────────────────
   Both halves of one offer, in the slot the result card just vacated:
     they asked → "<name> wants a rematch"  + Accept / Reject
     I asked    → "Waiting for <name>…"     + Cancel
   The layer is centred but transparent to taps, so the finished board stays
   readable and clickable behind a card that has nothing to do with it. White
   card, blue action — the same language as the result popup it replaces.
   At phone widths the two buttons take the full row so they stay real tap
   targets instead of squashing the sentence above them. */
.ab-rematch-layer{
  position:fixed;inset:0;z-index:var(--z-alert,9999);pointer-events:none;
  display:grid;place-items:center;padding:14px;
}
.ab-rematch-card{
  pointer-events:auto;
  display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  width:min(460px,100%);
  padding:13px 15px;background:#fff;color:#0f172a;
  border:1px solid #dbe4f0;border-radius:15px;
  box-shadow:0 16px 38px rgba(15,23,42,.18),0 2px 8px rgba(15,23,42,.06);
  font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;
  animation:ab-rematch-in .18s cubic-bezier(.22,1,.36,1) both;
}
@keyframes ab-rematch-in{
  from{opacity:0;transform:translateY(6px) scale(.995)}
  to{opacity:1;transform:none}
}
.ab-rematch-body{flex:1 1 200px;min-width:0;display:flex;flex-direction:column;gap:2px}
.ab-rematch-title{margin:0;font-size:14px;font-weight:700;line-height:1.3;overflow-wrap:anywhere}
.ab-rematch-sub{margin:0;font-size:11.5px;font-weight:600;color:#64748b;line-height:1.35}
.ab-rematch-actions{display:flex;gap:8px;flex:0 0 auto;align-items:center}
.ab-rematch-spinner{
  width:22px;height:22px;border-radius:50%;flex:0 0 auto;
  border:3px solid #dbe4f0;border-top-color:#2563EB;
  animation:ab-spin .8s linear infinite;
}
@media (max-width:430px){
  .ab-rematch-actions{flex:1 1 100%}
  .ab-rematch-actions>button{flex:1 1 0}
}
@media (prefers-reduced-motion:reduce){
  .ab-rematch-card{animation:none}
  .ab-rematch-spinner{animation-duration:2.4s}
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
  /* A tile block, never a layer: the popup tier (--z-alert) must always paint
     over these, so the grid owns its own z-index:0 and creates no ambiguity. */
  position:relative;z-index:0;
}
/* One button shape, a different accent per mode — the mixed-colour palette. */
.ab-root.ab-root #ab-tool-online{--tile-ink:#1D4ED8;--tile-line:#BFDBFE;--tile-fill:#EFF6FF;--tile-chip:#DBEAFE;--tile-ring:rgba(37,99,235,.2)}
.ab-root.ab-root #ab-tool-computer{--tile-ink:#6D28D9;--tile-line:#DDD6FE;--tile-fill:#F5F3FF;--tile-chip:#EDE9FE;--tile-ring:rgba(109,40,217,.18)}
.ab-root.ab-root #ab-tool-live{--tile-ink:#047857;--tile-line:#A7F3D0;--tile-fill:#ECFDF5;--tile-chip:#D1FAE5;--tile-ring:rgba(5,150,105,.18)}
.ab-root.ab-root #ab-tool-annotate{--tile-ink:#B45309;--tile-line:#FDE68A;--tile-fill:#FFFBEB;--tile-chip:#FEF3C7;--tile-ring:rgba(180,83,9,.18)}
.ab-root.ab-root #ab-tool-saved{--tile-ink:#BE185D;--tile-line:#FBCFE8;--tile-fill:#FDF2F8;--tile-chip:#FCE7F3;--tile-ring:rgba(190,24,93,.18)}
.ab-root.ab-root #ab-tool-settings{--tile-ink:#334155;--tile-line:#CBD5E1;--tile-fill:#F8FAFC;--tile-chip:#E2E8F0;--tile-ring:rgba(51,65,85,.16)}

.ab-root.ab-root .ab-tool-tile{
  position:relative;z-index:0;transform:none;filter:none;
  display:flex !important;flex-direction:row !important;align-items:center;justify-content:flex-start;
  gap:7px;width:100%;height:68px;min-height:68px;padding:0 10px;box-sizing:border-box;
  font-size:14px;font-weight:600;text-align:left;white-space:nowrap;min-width:0;
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
  flex:none;display:grid;place-items:center;width:24px;height:24px;border-radius:6px;
  font-size:16px;line-height:1;text-align:center;background:var(--tile-chip,#EEF2F7);
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
  .ab-root.ab-root .ab-tool-tile{height:68px;min-height:68px;font-size:14px;padding:0 10px}
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
  .ab-root.ab-root .ab-tool-tile{height:68px;min-height:68px;font-size:14px}
  .ab-root.ab-root .ab-info-card{flex:0 0 auto;height:auto;min-height:180px;max-height:260px}
  .ab-root.ab-root .ab-note{display:none}
}

/* phones: two big tiles per row still need the whole label visible, so the
   label may wrap instead of truncating. */
@media (max-width:640px){
  .ab-root.ab-root .ab-tool-tile{
    height:68px;min-height:68px;font-size:13px;gap:6px;padding:6px 8px;
    white-space:normal;line-height:1.15;
  }
  .ab-root.ab-root .ab-tool-icon{font-size:14px;width:22px;height:22px;border-radius:6px}
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
  const { user, boardTheme: savedBoardTheme, pieceSet, updatePrefs } = useAuth();
  /* Both boards are handed the OUTER box they may occupy and ChessBoard carves
     the themed frame out of it, following the saved `boardFrame` preference — so
     the fit below needs no frame arithmetic and the board is the same size with
     the frame on as off. */
  const { showToast, claimToast } = useToast();
  const gameRef       = useRef(new Chess());
  const liveReviewGameRef = useRef(null);
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
  const [boardOuter,    setBoardOuter]    = useState(440);
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
  /* The single-row moves strips, so the move being viewed can be kept centred.
     The page stays mounted underneath Play Mode, so the overlay gets its own
     ref rather than sharing the page's. */
  const stripRef        = useRef(null);
  const pmStripRef      = useRef(null);
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
  const [computerTakeback, setComputerTakebackState] = useState(() => readBoolPref(ARENA_TAKEBACK_KEY, false));
  /* One state value drives all six popups: null | online | computer | live |
     annotate | saved | settings. The Modal instance below reads it. */
  const [activePopup, setActivePopup] = useState(null);
  const [setupStep, setSetupStep] = useState(1);
  const [customTime, setCustomTime] = useState(false);
  const [timePicked, setTimePicked] = useState(false);
  const popupTriggerRef = useRef(null);
  const [computerColorChoice, setComputerColorChoice] = useState('');
  const [onlineOpponentType, setOnlineOpponentType] = useState('player');
  const [onlineSearching, setOnlineSearching] = useState(false);
  const onlineSearchToken = useRef(0);
  const [onlineWaiting, setOnlineWaiting] = useState(null);
  const onlineWaitingTimer = useRef(null);
  const onlineCancelLock = useRef(false);
  const [saveTags, setSaveTags] = useState('');
  const [saveVisibility, setSaveVisibility] = useState('private');
  const [annotationError, setAnnotationError] = useState('');
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const annotationBaseline = useRef(null);
  const [savedQuery, setSavedQuery] = useState('');
  const [savedDeleteId, setSavedDeleteId] = useState(null);
  const [savedMessage, setSavedMessage] = useState('');
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
    if (id === 'online' || id === 'computer') { setSetupStep(1); setCustomTime(false); setTimePicked(false); }
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
    if (activePopup === 'online' && onlineWaiting) return;
    if (activePopup === 'online' && onlineSearching) { cancelOnlineSearch(); return; }
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
  const [onlineColorSel,  setOnlineColorSel]  = useState('');
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
  /* Rematch on a FINISHED player-vs-player match, in the two shapes one offer
     can take for the viewer:
       ask    → "I asked, waiting for <opponent>" + Cancel
       invite → "<them> wants a rematch"          + Accept / Reject
     Both hold the finished game's id and a client-side expiry, so the requester
     is never left staring at a dead "waiting" card when the opponent's tab is
     closed. Kept in page state (not only on the game row) because the offer must
     stay visible after the result card itself is dismissed. */
  const [rematchAsk,      setRematchAsk]      = useState(null);
  const [rematchInvite,   setRematchInvite]   = useState(null);
  const [rematchBusy,     setRematchBusy]     = useState(false);
  const rematchAskTimer   = useRef(null);
  const rematchInviteTimer = useRef(null);
  const rematchAskRef     = useRef(null);
  const rematchInviteRef  = useRef(null);
  /* While a rematch card is on screen the result card steps aside. This is
     derived, not remembered: the popup's own one-tap lock releases whenever its
     `open` prop flips, so an ask that ends must always re-open the card and a
     card the player had already dismissed must never come back. */
  const rematchLive = Boolean(rematchAsk || rematchInvite);
  /* The rematch socket handlers subscribe once for the life of the page, so they
     read the live card through refs rather than closing over one render. */
  rematchAskRef.current = rematchAsk;
  rematchInviteRef.current = rematchInvite;
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
  const flagClaimRef      = useRef(null);

  /* The last position this board actually RENDERED, as `{ id, ply, pgn }`.
     Every inbound update — the socket push, the 2.5 s poll, and the reply to
     your own `sendMove` — is checked against it, so the same move arriving twice
     is applied once and an update that is BEHIND the board (a poll that lost the
     race) can never roll a piece back and replay it. Keyed by game id so a new
     match starting at ply 0 is not mistaken for a stale row. */
  const appliedRef        = useRef({ id: null, ply: 0, pgn: '' });

  /* The challenge this page sent and is still waiting on. The same game is ALSO
     on the board as a `pending` row, so this is a second marker for one match,
     not a second match — and it is what the Cancel button acts on. It matters for
     catch-up because a pending row is exactly the state the old poll refused to
     look at (`status !== 'active'`), so a missed accept had no way to converge:
     the spinner stayed up over a game that had already started. Every realtime
     and catch-up path below tests this id alongside the current game. */
  const onlineWaitingRef = useRef(null);

  /* When this game last heard anything from the server. Catch-up fetches only
     when the realtime channel has gone quiet, so a healthy match issues none. */
  const lastContactRef = useRef(0);
  /* Driven by the socket's own connect/disconnect: shows "Reconnecting…" and,
     more importantly, tells catch-up that the quiet is expected rather than a
     lost push. */
  const [serverLinked, setServerLinked] = useState(true);
  const catchUpInFlightRef = useRef(null);

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
  /* A LIST per side, not one slot: `playerReactions.opponent` used to hold a
     single emoji, so a second reaction replaced the first and the shared timer
     cancelled the animation still playing on screen. */
  const [playerReactions, setPlayerReactions] = useState({ mine: [], opponent: [] });
  const [reactionCooling, setReactionCooling] = useState(false);
  const [pressedReaction, setPressedReaction] = useState('');
  const [showReactPicker, setShowReactPicker] = useState(false);
  /* Which readout the FEN / PGN card shows. Presentation only. */
  const [infoTab,         setInfoTab]         = useState('fen');
  const reactionId        = useRef(0);
  const reactionCooldownRef = useRef(0);
  const reactionTimersRef = useRef({ cooldown: null, pressed: null });
  /* One removal timer per bubble, so an old one finishing does not cancel a new
     one and vice versa. */
  const reactionItemTimers = useRef(new Map());
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
  /* The board is the flexible band of the left column, so it is sized from the
     SPACE IT HAS rather than from the viewport/column width — that is what keeps
     the whole page inside the viewport with no page scroll.

     What is solved for is the OUTER box, themed frame included: ChessBoard takes
     that number and carves the frame out of it, so switching the Board Frame
     setting on or off neither grows nor shrinks anything on this page. */
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
      const cap = vw < 640 ? 420 : vw < 1024 ? 480 : 620;

      setBoardOuter(Math.round(Math.max(160, Math.min(cap, budget))));
    };
    solve();
    const ro = (typeof ResizeObserver !== 'undefined' && area) ? new ResizeObserver(solve) : null;
    if (ro) ro.observe(area);
    window.addEventListener('resize', solve);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', solve); };
  }, [orientation, playMode]);

  /* Moves strip — keep the move being viewed centred in its single row.
   *
   * Done by writing the strip's OWN scrollLeft, not with scrollIntoView.
   * scrollIntoView walks every scrollable ancestor, so on a phone it could drag
   * the PAGE sideways/vertically to bring the chip into view — that was the page
   * shake during a game. This only ever moves the strip.
   *
   * Both strips are covered because Play Mode is an overlay on top of a page that
   * stays mounted, and a new move or a step back has to re-centre whichever one
   * the player is looking at. */
  useEffect(() => {
    centreMoveStrip(stripRef.current);
    centreMoveStrip(pmStripRef.current);
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
  }, [boardOuter, orientation, playMode]);

  /* Play Mode — measure the overlay's board area so the board auto-fits the
     available fullscreen space (bigger squares, comfortable on any screen).

     A layout effect, not a plain one: the overlay's first paint uses the
     fallback page-board size, and an effect that runs after paint resizes the
     board in front of the user. Measuring before paint puts the board at its
     final size on the very first frame. */
  useLayoutEffect(() => {
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
      const w = Math.floor(el.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight));
      const h = Math.floor(el.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom));
      /* A collapsed reading is not a size. Accepting one would drop the board
         back onto the page-board fallback and then re-fit it — one jump. */
      if (w <= 0 || h <= 0) return;
      /* Rebuilding the board is expensive, so a measurement has to be actually
         different to count as one. Rounding inside the flex column can report a
         1px change from frame to frame with nothing having moved, and each one
         used to resize the board again — the jump seen on phones. */
      setPmSize((prev) => (Math.abs(prev.w - w) <= 2 && Math.abs(prev.h - h) <= 2
        ? prev
        : { w, h }));
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

  /* Play Mode — the outer box the board gets inside the measured overlay area,
     clamped so it can never overflow; falls back to the page board before the
     first measure.

     The overlay area is the trap: measuring its PADDED box, or budgeting nothing
     for the board's decoration, overflows it and `overflow: hidden` cuts the bottom
     off the board. The measuring effect above already hands us the CONTENT box,
     and the frame now sits inside the number below, so the fit is a plain clamp.

     The frame is deliberately NOT disabled here — with `frameless`, ChessBoard
     returns early and never renders its a-h / 1-8 coordinate labels
     (ChessBoard.jsx), so the band is what carries them. */
  const pmBoardOuter = (() => {
    /* pmSize is already the CONTENT box of .play-mode-board-area: the measuring
       effect above subtracts the resolved padding, which differs per breakpoint.
       So the whole area is available here. */
    const availW = pmSize.w;
    const availH = pmSize.h;
    if (availW <= 0 || availH <= 0) return boardOuter;

    const budget = Math.min(availW, availH);
    /* A 4px shave keeps the board's edge from sitting flush against the viewport
       where sub-pixel rounding can clip a border. */
    return Math.round(Math.max(160, budget - 4));
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
    const reviewingLive = (onlineGame || computerOn) && moveIndex < moves.length;
    setMoves(san);
    if (reviewingLive) {
      const ply = Math.min(moveIndex, san.length);
      const reviewed = rebuildGame(initialFen, san.slice(0, ply));
      liveReviewGameRef.current = reviewed;
      setMoveIndex(ply);
      setFen(reviewed.fen());
      const reviewedLast = getHistory(reviewed).last;
      setLastMove(reviewedLast ? { from: reviewedLast.from, to: reviewedLast.to } : null);
    } else {
      liveReviewGameRef.current = null;
      setFen(g.fen());
      setMoveIndex(san.length);
      setLastMove(last ? { from: last.from, to: last.to } : null);
    }
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
    liveReviewGameRef.current = null;
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
      liveReviewGameRef.current = null;
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
      liveReviewGameRef.current = null;
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
    clearReactionBubbles();
    setShowReactPicker(false);
    flagClaimRef.current  = null;
    /* An offer belongs to ONE match. Without this it survives leaving the board
       and the next game opens showing "X offers a draw" for a game nobody is
       playing. */
    setDrawOffer(null);
    /* Same rule as the draw offer: a rematch request belongs to the match it was
       made on, so leaving that board takes the card with it. */
    window.clearTimeout(rematchAskTimer.current);
    window.clearTimeout(rematchInviteTimer.current);
    setRematchAsk(null);
    setRematchInvite(null);
    if (clocks) { setClock(null); setClockRunning(false); }
  }

  function resetAfterPendingRequest() {
    clearOnline(true);
    const g = new Chess();
    gameRef.current = g;
    setInitialFen('start'); setMoves([]); setMoveIndex(0); setFen(g.fen());
    setLastMove(null); setStatus(getStatus(g)); setClockOver(null); setReviewMode(false);
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
      const moverColor = onlineMyColor;
      /* Paint the page's own view of this move NOW. Nothing else does:
         `onBoardPositionChange` refuses to sync while a match is live, and the
         row that carries this very move is dismissed by `applyOnline` as a
         duplicate (same ply, same PGN) before it reaches `setLastMove`. So the
         amber from/to squares stayed on the OPPONENT's previous move, the new
         ply was missing from the move list, and a mating move never set
         `status.over`. `sync` also arms the checkmate reveal gate, which is the
         only reason the old inline `waitForMateReveal` was here. */
      sync();
      /* The same swallowed update also left the turn behind: `onlineTurn` is
         only advanced on applyOnline's full path, so after your own move the
         banner kept saying "Your move!", the board stayed live for a second
         drag the server would refuse, and the waiting overlay never appeared.
         The turn is a fact about the position the board already holds. */
      setOnlineTurn(gameRef.current.turn() === 'w' ? 'white' : 'black');
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
          /* Rolling the move back gives the turn to me as well, so the hand-off
             recorded above has to be rolled back too — otherwise the board sits
             "waiting for opponent" over a move that never happened. */
          setOnlineTurn(gameRef.current.turn() === 'w' ? 'white' : 'black');
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
    if (onlineGame || computerOn) {
      if (target < moves.length) {
        liveReviewGameRef.current = g;
        setMoveIndex(target);
        setFen(g.fen());
        const hist = getHistory(g);
        setLastMove(hist.last ? { from: hist.last.from, to: hist.last.to } : null);
      } else {
        liveReviewGameRef.current = null;
        setMoveIndex(moves.length);
        setFen(gameRef.current.fen());
        const hist = getHistory(gameRef.current);
        setLastMove(hist.last ? { from: hist.last.from, to: hist.last.to } : null);
      }
      if (soundOn) playSound('select');
      return;
    }
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

  function returnToLive() {
    if (!onlineGame && !computerOn) return;
    liveReviewGameRef.current = null;
    const g = gameRef.current;
    const hist = getHistory(g);
    setMoveIndex(hist.san.length);
    setFen(g.fen());
    setLastMove(hist.last ? { from: hist.last.from, to: hist.last.to } : null);
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
    /* Starting a new game settles an outstanding request the same way the server
       does when a fresh challenge is sent: the opponent gets told, the card goes
       away, and nobody is left waiting on a match they have already left. */
    if (rematchAskRef.current?.gameId != null) {
      cancelRematch(rematchAskRef.current.gameId).catch(() => {});
    }
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
    /* A rematch request dies with the arena reset too — the player is explicitly
       starting over, so the opponent must not keep a popup that leads nowhere. */
    window.clearTimeout(rematchAskTimer.current);
    window.clearTimeout(rematchInviteTimer.current);
    if (rematchAsk?.gameId != null) cancelRematch(rematchAsk.gameId).catch(() => {});
    setRematchAsk(null);
    setRematchInvite(null);
    endSpecSession();
    onlineSearchToken.current += 1;
    arenaResetVersionRef.current += 1;
    computerToken.current += 1;
    engineToken.current += 1;
    analysisToken.current += 1;
    clearMateReveal();
    clearReactionBubbles();
    reactionTimersRef.current = { cooldown: null, pressed: null };
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
    setOnlineColorSel(''); setOnlineOpponentType('player');
    setOnlineBusy(false); setOnlineSearching(false); setOnlineWaiting(null);
    setOnlineError(''); setOnlineNotice(''); setInviteBar(null); setDrawOffer(null);
    setPendingConfirm(null); setActivePopup(null);
    setPlayerReactions({ mine: [], opponent: [] }); setShowReactPicker(false);
    setReactionCooling(false); setPressedReaction(''); reactionCooldownRef.current = 0;
    setSpectateSession(null); setLiveSessions([]); setLiveRefreshing(false);
    setGameAnalysis(null); setAnalyzing(false); setAnalyzeProgress(0);
    setThinking(false); setBest(null); setBestFen(''); setLines([]);
    setReviewMode(false); setResultPopup(null); setResultDismiss(false);
    setResultRevealPending(false); setRatingResult(null); setConfetti([]);
    setShowReviewPopup(false);
    setInfoTab('fen');
    appliedRef.current = { id: null, ply: 0, pgn: '' };
    flagClaimRef.current = oldGameId ? { gameId: oldGameId, settled: true, attemptedAt: 0 } : null;
    savedGameRef.current = null;
    gameSessionIdRef.current = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    refreshOnlineMatches();

    window.setTimeout(() => {
      resetInProgressRef.current = false;
      setResettingPlayArena(false);
    }, 350);
  }

  /* Rematch, from the review panel. The result card reaches the mode-correct
     handler itself; this one has to pick the same two modes, because restarting
     a finished online match as a practice board left the opponent's row attached
     to the page — and that row's next push put the match that had just ended back
     on the board.
       finished player-vs-player → ask the opponent
       computer                  → restart on the spot, colours swapped
     A practice board has no opponent to rematch, so the panel shows no button for
     it at all (`canRematch` below hands back the same two conditions). */
  function rematch() {
    if (onlineRematchTarget(onlineGame)) { askRematchOnline(); return; }
    if (computerOn || clockOver) rematchComputer();
  }

  /* Rematch versus the computer, from the result card. There is nobody to ask —
     the opponent is the engine — so it starts on the spot with the SAME settings
     (level, clock, hints, confirm-move: none of those are touched) and my colour
     flipped. A game started on random colour stays random.

     The engine readout is cleared because it describes the position the game ENDED
     on: leaving it would flash last game's evaluation and, with hints on, an
     arrow pointing at a move no longer available. */
  function rematchComputer() {
    const nextColor = computerColorChoice === 'random'
      ? (Math.random() < 0.5 ? 'white' : 'black')
      : (computerColor === 'white' ? 'black' : 'white');
    const botHadTheMove = computerOn;
    markCurrentResultSeen();
    setBest(null); setLines([]); setBestFen('');
    setReviewMode(false);
    setResultPopup(null);
    setResultDismiss(false);
    setClockOver(null);
    setGameAnalysis(null);
    setAnalyzing(false);
    startComputerGame(nextColor);
    /* The "bot opens as White" effect runs when `computerOn` turns on. In a
       rematch it is already on, so the opening has to be scheduled here —
       otherwise the bot, now playing White, would sit forever on the first move. */
    if (botHadTheMove && nextColor === 'black') scheduleComputerMove();
  }

  /* Review — dismiss overlay, auto-analyze, navigate to start */  function startReview() {
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
    setAnnotationError('');
    const tags = saveTags.split(',').map((t) => t.trim()).filter(Boolean);
    const savedAt = new Date().toISOString();
    const pgn = gameRef.current.pgn();
    const item = {
      id:    `a_${Date.now()}`,
      userId: user?.id ?? null,
      name:  title || 'Untitled',
      fen, initialFen, pgn, notes,
      tags,
      visibility: saveVisibility,
      at: formatDateTime12(new Date(savedAt)),
      savedAt,
      players: onlineGame ? `${onlineGame.myName || user?.name || 'You'} vs ${onlineGame.opponentName || 'Opponent'}` : computerOn ? `${user?.name || 'You'} vs Computer` : '',
      color: onlineGame ? onlineMyColor : computerOn ? computerColor : '',
      result: status.over ? status.label : '',
      moveCount: moves.length,
    };
    try {
      const list = JSON.parse(localStorage.getItem(savedStorageKey) || '[]');
      localStorage.setItem(savedStorageKey, JSON.stringify([item, ...list]));
    } catch {
      setAnnotationError('Could not save this item on this device. Check available storage and try again.');
      return;
    }
    setSaveName('');
    setSaveTags('');
    setSaveVisibility('private');
    annotationBaseline.current = null;
    setDiscardConfirm(false);
    refreshSaved();
    setSavedMessage('Saved successfully. It is now in your Saved list below.');
    if (soundOn) playSound('good');
    showToast('Your game or position and notes were saved.', { tone: 'success', title: 'Saved' });
  }

  function deleteSaved(id) {
    const list = JSON.parse(localStorage.getItem(savedStorageKey) || '[]').filter((s) => s.id !== id);
    localStorage.setItem(savedStorageKey, JSON.stringify(list));
    setSavedDeleteId(null);
    refreshSaved();
  }

  function openSavedAnalysis(item) {
    try {
      const start = item.initialFen && item.initialFen !== 'start' ? item.initialFen : undefined;
      const g = new Chess(start);
      if (item.pgn) g.loadPgn(item.pgn, { strict: false });
      else if (item.fen) g.load(item.fen);
      clearMoveEffects('load-saved-analysis');
      const hist = getHistory(g);
      gameRef.current = g;
      setInitialFen(item.initialFen || item.fen || 'start');
      setMoves(hist.san); setMoveIndex(hist.san.length); setFen(g.fen());
      setLastMove(hist.last ? { from: hist.last.from, to: hist.last.to } : null);
      setStatus(getStatus(g)); setNotes(item.notes || ''); setSaveName(item.name === 'Untitled' ? '' : item.name);
      setSaveTags(Array.isArray(item.tags) ? item.tags.join(', ') : '');
      setSaveVisibility(item.visibility || 'private');
      if (item.color === 'white' || item.color === 'black') setOrientation(item.color);
      setActivePopup(null); setOnlineWaiting(null); setClock(null); setClockRunning(false);
      setComputerOn(false); setOnlineGame(null); onlineGameRef.current = null;
      refreshEngine();
      showToast(`Opened ${item.name || 'saved position'} with its notes.`, { tone: 'success', title: 'Saved item opened' });
    } catch {
      showToast('This saved item could not be opened.', { tone: 'error', title: 'Could not open' });
    }
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

  /* Pin the clock that fell at 0:00. Each side's stored time is a snapshot taken
     on its previous move and only decays while it is on the clock, so the moment
     the game stops, a flagged clock would jump back up to that stale snapshot —
     the loser showing 0:03 on the very turn it reached 0:00. Writing the zero
     into the state is also what makes the box read as "flagged" rather than
     merely stopped, and keeps the number the saved game is built from. */
  function zeroFlaggedClock(color) {
    setClock((c) => (c
      ? { ...c, [color === 'white' ? 'whiteMs' : 'blackMs']: 0 }
      : c));
  }

  /* The other half of FIDE 6.9 for the bot game: flagging only LOSES when the
     side still holding time can mate. A human who "wins on time" with nothing but
     a king — or with a lone bishop or knight — is handed a draw instead, exactly
     as the server rules an online clock that falls against bare material.
     Returns the fields that override a win, so the branches below still name the
     winner they saw first and this is the one place the ruling is revised. */
  function drawOnFlag(winnerColor) {
    if (sideHasMatingMaterial(rebuildGame(initialFen, moves), winnerColor)) return {};
    return {
      winner: null,
      humanWon: null,
      draw: true,
      title: 'Drawn',
      sub: 'No material to mate with.',
    };
  }

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
        zeroFlaggedClock(bot);
        setComputerThinking(false);
        setComputerOn(false);
        computerToken.current++;
        setClockOver({ winner: human, humanWon: true, title: 'You won on time', sub: `${skillLabel(computerLevel)} ran out of time.`, ...drawOnFlag(human) });
        return;
      }
      if (clock?.turn === human && liveRemaining(human) <= 0) {
        clearInterval(t);
        setClockRunning(false);
        zeroFlaggedClock(human);
        setComputerThinking(false);
        setComputerOn(false);
        computerToken.current++;
        setClockOver({ winner: bot, humanWon: false, title: 'You lost on time', sub: 'Better luck next time!', ...drawOnFlag(bot) });
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
   * the pure helper rather than a closure over the render.
   *
   * Whichever side is ON the clock at zero triggers the claim — not only my own.
   * The opponent is the one who needs the result: they sit looking at a board
   * whose last move has no answer coming, and they are owed the win. The server
   * works out who actually flagged from its own clocks and never takes the
   * caller's word for it, so a claim from the wrong end of the board cannot give
   * anybody a result they did not earn.
   *
   * A claim is remembered per game and retried until the server agrees. Once
   * latched to the game id (the old behaviour) a single failed request — the tab
   * losing the network for a second, a 409 from a clock the server still reads as
   * fractionally short of zero — left the match active forever with nobody ever
   * asking again. */
  useEffect(() => {
    if (!inOnline || !clockRunning || !clock) return undefined;
    const check = () => {
      const color = clock.turn;
      if (remainingMs(clock, true, color) > 0) return;
      const claim = flagClaimRef.current;
      if (claim && String(claim.gameId) === String(onlineGame.id)
        && (claim.settled || Date.now() - claim.attemptedAt < FLAG_RETRY_MS)) return;
      const gid = onlineGame.id;
      flagClaimRef.current = { gameId: gid, settled: false, attemptedAt: Date.now() };
      flagOnlineCurrent(gid).then((settled) => {
        const claim = flagClaimRef.current;
        if (settled && claim && String(claim.gameId) === String(gid)) claim.settled = true;
      });
    };
    check();
    const t = setInterval(check, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inOnline, clockRunning, clock]);

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
        ? (clockOver.winner || 'draw')
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
    const onlineInitialFen = g.header().FEN || 'start';

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
    const reviewingLive = sameGame && moveIndex < moves.length;
    if (sameGame && san.length < prev.ply) return;
    applyOnlineMeta(row);
    if (sameGame && san.length === prev.ply && pgn === prev.pgn) return;
    appliedRef.current = { id: row.id, ply: san.length, pgn };

    gameRef.current = g;
    setInitialFen(onlineInitialFen);
    setOnlineTurn(san.length % 2 === 0 ? 'white' : 'black');
    setOrientation(row.myColor || 'white');
    setMoves(san);
    if (reviewingLive) {
      const ply = Math.min(moveIndex, san.length);
      const reviewed = rebuildGame(onlineInitialFen, san.slice(0, ply));
      liveReviewGameRef.current = reviewed;
      setMoveIndex(ply);
      setFen(reviewed.fen());
      const reviewedLast = getHistory(reviewed).last;
      setLastMove(reviewedLast ? { from: reviewedLast.from, to: reviewedLast.to } : null);
    } else {
      liveReviewGameRef.current = null;
      setMoveIndex(san.length);
      setFen(g.fen());
      setLastMove(last ? { from: last.from, to: last.to } : null);
    }
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

      const waiting = {
        id: row.id,
        name: onlineSelName || row.opponentName || 'your opponent',
        createdAt: row.createdAt || row.updatedAt || new Date().toISOString(),
      };
      try { sessionStorage.setItem('mz-pending-match-request', JSON.stringify(waiting)); } catch { /* optional */ }
      setOnlineWaiting(waiting);
      setOnlineSearching(false);
      setActivePopup('online');
      showOnlineNotice(`Invite sent — waiting for ${waiting.name} to accept.`);
    } catch (e) {
      setOnlineError(e.response?.data?.message || 'Could not start the match.');
      setOnlineSearching(false);
    } finally {
      setOnlineBusy(false);
    }
  }

  async function cancelOnlineSearch() {
    onlineSearchToken.current += 1;
    const id = onlineWaiting?.id;
    if (!id) {
      if (onlineBusy) return;
      setOnlineSearching(false);
      setOnlineBusy(false);
      return;
    }
    if (onlineCancelLock.current) return;
    onlineCancelLock.current = true;
    setOnlineBusy(true);
    try {
      const row = await cancelGameRequest(id);
      try { sessionStorage.removeItem('mz-pending-match-request'); } catch { /* optional */ }
      if (row.status === 'active' || row.cancelIgnored) {
        setOnlineWaiting(null); setOnlineSearching(false); setActivePopup(null);
        applyOnline(row);
        showOnlineNotice('Your opponent accepted — the game has started.');
      } else {
        setOnlineWaiting(null); setOnlineSearching(false); setSetupStep(1); setActivePopup('online');
        resetAfterPendingRequest(); refreshOnlineMatches();
        showOnlineNotice(row.status === 'declined' ? 'Opponent declined.' : row.status === 'aborted' && onlineWaiting?.expiryRetry ? 'No response — the request expired.' : 'Match request cancelled.');
      }
    } catch (e) {
      const latest = await fetchGame(id).catch(() => null);
      if (latest?.status === 'active') {
        try { sessionStorage.removeItem('mz-pending-match-request'); } catch { /* optional */ }
        setOnlineWaiting(null); setOnlineSearching(false); setActivePopup(null); applyOnline(latest);
        showOnlineNotice('Your opponent accepted — the game has started.');
      } else if (latest?.status === 'aborted' || latest?.status === 'declined') {
        try { sessionStorage.removeItem('mz-pending-match-request'); } catch { /* optional */ }
        setOnlineWaiting(null); setOnlineSearching(false); setSetupStep(1); setActivePopup('online');
        resetAfterPendingRequest(); refreshOnlineMatches();
        showOnlineNotice(latest.status === 'declined' ? 'Opponent declined.' : 'Match request cancelled.');
      } else {
        setOnlineError(e.response?.data?.message || 'Could not cancel yet. Your request is still waiting.');
      }
    } finally {
      onlineCancelLock.current = false;
      setOnlineBusy(false);
    }
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

  /* Somebody's clock reached 0:00, on this board or on the other side of it.
     Reported through the timeout route so the game is stored as a timeout — never
     as a resignation — with the server deciding WHO flagged from its own clocks
     and what the flag is worth (a win for the side that can still mate, a draw
     against a bare king).

    Returns whether the match is settled, which is what lets the claim retry
    instead of latching on the first attempt. */
  async function flagOnlineCurrent(gameIdArg) {
    const gameId = gameIdArg ?? onlineGame?.id;
    if (!gameId) return true;
    try {
      const row = await timeoutGame(gameId);
      applyOnline(row); refreshOnlineMatches();
      if (soundOn) playSound('capture');
      return true;
    } catch (e) {
      /* 409 is the server saying "nobody has run out yet" — our reading of the
         clock is a hair ahead of theirs, so ask again after the retry floor.
         403/404 will never succeed. Anything else, including 400 "match is not in
         progress" (the opponent's claim, a reload or the server's own sweep got
         there first), is answered by reading the row back: `GET /games/:id`
         settles an expired clock on its way out, so the fetch both confirms the
         result and puts it on a board that never received the push. */
      const status = e.response?.status;
      if (status === 409) return false;
      if (status === 403 || status === 404) return true;
      await catchUpOnline(gameId);
      return onlineGameRef.current?.status !== 'active';
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

  /* ── Rematch (a finished player-vs-player match) ──────────────────────────
     The offer lives on the server, on the finished match — these are only the two
     cards that describe it from the viewer's side:

       rematchAsk    → I asked. "Waiting for <opponent>" + Cancel
       rematchInvite → they asked. "<name> wants a rematch" + Accept / Reject

     They live on the page rather than inside PostGameResultPopup for two reasons:
     the popup disables its own buttons after the first tap until it re-opens, and
     the opponent's invite has to appear even after they dismissed their result
     card. So the card steps aside for the duration and comes back exactly as it
     was. */

  /* Ask the opponent for another game. */
  async function askRematchOnline() {
    const game = onlineRematchTarget(onlineGame);
    if (!game || rematchBusy) return;
    setRematchBusy(true);
    setOnlineError('');
    try {
      const updated = await requestRematch(game.id);
      applyOnline(updated);
      /* The card says who I am waiting for, so it is the OPPONENT's name — never
         `rematchRequest.byName`, which on my own request is my own name. */
      const who = game.opponentName || updated?.opponentName || 'your opponent';
      window.clearTimeout(rematchAskTimer.current);
      setRematchAsk({ gameId: game.id, opponentName: who });
      /* The requester should not have to guess whether the other tab is even
         open: after the window closes the request is withdrawn on the server,
         which also takes the card off the opponent's screen. */
      rematchAskTimer.current = window.setTimeout(() => {
        if (!rematchAskRef.current) return;
        cancelRematch(game.id).catch(() => {});
        setRematchAsk(null);
        showToast(`No response from ${who}.`, {
          tone: 'info', title: '♞ Rematch', source: 'AnalysisBoard:rematch_timeout',
          dedupeKey: `rematch-timeout-${game.id}`,
        });
      }, REMATCH_WINDOW_MS);
      refreshOnlineMatches();
    } catch (e) {
      const why = e.response?.data?.message || 'Could not ask for a rematch.';
      setOnlineError(why);
      /* The banner above the board is easy to miss the moment the popup is what
         you are looking at, and a request that never left the device is exactly
         the failure that needs to be impossible to overlook. */
      showToast(why, {
        tone: 'danger', title: '♞ Rematch', source: 'AnalysisBoard:rematch_send_failed',
        dedupeKey: `rematch-send-fail-${game.id}`,
      });
    } finally { setRematchBusy(false); }
  }

  /* Withdraw my own request before the window runs out. */
  function cancelRematchAsk() {
    const ask = rematchAskRef.current;
    if (!ask) return;
    window.clearTimeout(rematchAskTimer.current);
    setRematchAsk(null);
    cancelRematch(ask.gameId).catch(() => {});
    refreshOnlineMatches();
  }

  /* Answer their request. Accepting is the only side that changes the board, and
     the new game also arrives over `rematch-started`, so this must stay safe to
     call alongside it — entering the same row twice is a no-op by design. */
  async function answerRematchInvite(accept) {
    const invite = rematchInviteRef.current;
    if (!invite || rematchBusy) return;
    setRematchBusy(true);
    try {
      const row = await respondRematch(invite.gameId, accept);
      stopRematchTimers();
      setRematchInvite(null);
      if (accept) {
        enterRematchGame(row);
      } else {
        refreshOnlineMatches();
      }
    } catch (e) {
      stopRematchTimers();
      setRematchInvite(null);
      setOnlineError(e.response?.data?.message || 'Could not answer the rematch request.');
    } finally { setRematchBusy(false); }
  }

  function stopRematchTimers() {
    window.clearTimeout(rematchAskTimer.current);
    window.clearTimeout(rematchInviteTimer.current);
    rematchAskTimer.current = null;
    rematchInviteTimer.current = null;
  }

  /* Move both players into the game that was just created for them: the board,
     the clocks and the move list all come off the new row, so a rematch opens on
     the starting position with the original time control and the finished match
     left behind exactly as it was saved. */
  const enterRematchGame = useStableCallback((row) => {
    if (!row || row.meId == null) return;
    if (ignoredGameIdsRef.current.has(String(row.id))) return;
    /* The acceptor hears about the new match twice — once from their own request
       and once from the socket push that also carries it to the other player.
       Already on that board means the second delivery is a no-op. */
    if (onlineGameRef.current && String(onlineGameRef.current.id) === String(row.id)) return;
    /* The match being replaced, read before anything is cleared. It is finished
       and already saved, so from this point its row is retired for the page:
       every guard below (the ?game= loader, applyOnline, the room subscription,
       the catch-up fetch) checks this set, and without it a reload, a Back, or a
       late push can put the previous match back on the board. */
    const replacedId = onlineGameRef.current?.id ?? activeGameIdRef.current;
    stopRematchTimers();
    setRematchAsk(null);
    setRematchInvite(null);
    clearOnline(true);
    setClockOver(null);
    setReviewMode(false);
    setResultPopup(null);
    setResultDismiss(false);
    /* An offer that outlived its match belongs to no game at all, and a resign
       or draw dialog left over from the old one must not be sitting over a board
       that has not started yet. */
    setDrawOffer(null);
    setPendingConfirm(null);
    setActivePopup(null);
    if (replacedId != null) {
      ignoredGameIdsRef.current.add(String(replacedId));
      markCurrentResultSeen(replacedId);
    }
    applyOnline(row);
    /* The URL is the durable half of that retirement: `ignoredGameIdsRef` dies
       with the page, so a stale `?game=<old id>` — which is how an accepted
       challenge and a rematch notification both land here — would reload the
       finished match on the next mount. Dropping the query leaves the mount
       auto-attach, which follows the ACTIVE game, to do the right thing. */
    if (location.search) navigate(location.pathname, { replace: true });
    refreshOnlineMatches();
    if (soundOn) playSound('select');
  });

  /* One place where a request stops existing, whichever card it was on. The
     server sends the same three endings (declined / withdrawn / expired) as
     separate events because the wording the player needs differs. */
  const resolveRematchCards = useStableCallback((gameId, message, kind) => {
    const id = String(gameId ?? '');
    const ask = rematchAskRef.current;
    const invite = rematchInviteRef.current;
    if (!ask && !invite) return;
    if ((!ask || String(ask.gameId) !== id) && (!invite || String(invite.gameId) !== id)) return;
    stopRematchTimers();
    setRematchAsk(null);
    setRematchInvite(null);
    if (message) {
      showToast(message, {
        tone: 'info', title: '♞ Rematch', source: 'AnalysisBoard:rematch_end',
        /* Each ending carries different news, so each gets its own key — one
           shared key let the central 8s dedupe swallow a decline that arrived
           just after an expiry on the same game. */
        dedupeKey: `rematch-end-${kind || 'end'}-${id}`,
      });
    }
  });

  /* A rematch offer for the match I am looking at, or one the server is still
     holding on the game row — which is how a reload lands back on the exact same
     "waiting / answer me" card instead of silently dropping a live request. */
  const applyRematchFromRow = useStableCallback((row) => {
    const req = row?.rematchRequest;
    if (!req) {
      resolveRematchCards(row?.id, null);
      return;
    }
    if (req.mine) {
      if (rematchAskRef.current) return;
      /* `byName` is the requester — me, in this branch — so the name the waiting
         card needs is the row's opponent. */
      setRematchAsk({ gameId: row.id, opponentName: row.opponentName || 'your opponent' });
      window.clearTimeout(rematchAskTimer.current);
      const left = REMATCH_WINDOW_MS - Math.max(0, Date.now() - (req.at || Date.now()));
      rematchAskTimer.current = window.setTimeout(() => cancelRematchAsk(), Math.max(500, left));
      return;
    }
    if (rematchInviteRef.current) return;
    setRematchInvite({ gameId: row.id, fromName: req.byName || row.opponentName || 'Your opponent' });
    window.clearTimeout(rematchInviteTimer.current);
    const left = REMATCH_WINDOW_MS - Math.max(0, Date.now() - (req.at || Date.now()));
    rematchInviteTimer.current = window.setTimeout(
      () => resolveRematchCards(row.id, null),
      Math.max(500, left),
    );
  });

  /* The two handlers that need to know WHO I am. They read live values, so both
     must be stable-identity wrappers: this page subscribes once for its whole
     life, and a plain closure here would keep the `user` of the very first
     render — an identity that has not arrived yet. */
  const handleRematchInvite = useStableCallback((p) => {
    if (!p?.gameId) return;
    if (Number(p.requesterId) === Number(user?.id)) return;
    if (rematchAskRef.current) {
      /* We are the one who asked, so this is our own round trip or a race;
         the card is already up and the server refused the duplicate. */
      return;
    }
    window.clearTimeout(rematchInviteTimer.current);
    setRematchInvite({ gameId: p.gameId, fromName: p.requesterName || 'Your opponent' });
    rematchInviteTimer.current = window.setTimeout(
      () => resolveRematchCards(p.gameId, null),
      REMATCH_WINDOW_MS,
    );
  });

  const handleRematchStarted = useStableCallback((p) => {
    if (!p?.game) return;
    if (Number(p.game.meId) !== Number(user?.id)) return;
    enterRematchGame(p.game);
  });

  /* Everything the rematch needs over the socket, in ONE subscription — the
     same reason the page has one `game-update` listener: re-subscribing per
     render is how handlers used to stack. */
  useEffect(() => {
    const offs = [
      onSocketEvent('rematch-request', (p) => handleRematchInvite(p)),
      onSocketEvent('rematch-declined', (p) => {
        resolveRematchCards(p?.gameId, `${p?.declinerName || 'Your opponent'} declined the rematch.`, 'declined');
      }),
      onSocketEvent('rematch-cancelled', (p) => {
        resolveRematchCards(p?.gameId, 'The rematch request was withdrawn.', 'cancelled');
      }),
      onSocketEvent('rematch-expired', (p) => {
        resolveRematchCards(p?.gameId, 'No response — the rematch request expired.', 'expired');
      }),
      onSocketEvent('rematch-started', (p) => handleRematchStarted(p)),
    ];
    return () => offs.forEach((off) => off());
    // Stable callbacks + refs only: re-subscribing on a render would duplicate
    // every handler for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    /* Leaving the arena must not leave the other player waiting on a card that
       can no longer lead to a game. The server also drops it on disconnect, but
       an unmount with a live socket is far more common than a dropped line. */
    stopRematchTimers();
    const ask = rematchAskRef.current;
    if (ask) cancelRematch(ask.gameId).catch(() => {});
  }, []);

  function showPlayerReaction(emoji, who) {
    if (!emoji) return;
    const id = ++reactionId.current;
    setPlayerReactions((prev) => {
      const list = [...(prev[who] || []), { id, emoji }];
      /* Three at a time, oldest dropped. A fourth emoji is a worse signal than the
         one already floating, and an unbounded list turns the middle of the board
         into a pile. */
      return { ...prev, [who]: list.length > 3 ? list.slice(list.length - 3) : list };
    });
    reactionItemTimers.current.set(id, window.setTimeout(() => {
      reactionItemTimers.current.delete(id);
      /* Retired by id, never by slot: a newer reaction used to clear the timer of
         the one already on screen, which is why rapid sending showed one bubble
         rather than several. */
      setPlayerReactions((prev) => ({
        ...prev,
        [who]: (prev[who] || []).filter((item) => item.id !== id),
      }));
    }, REACTION_LIFE_MS));
  }

  /* Every bubble off the board, and their timers first — so none of them can
     fire against a list a different match is now using. */
  function clearReactionBubbles() {
    for (const timer of reactionItemTimers.current.values()) window.clearTimeout(timer);
    reactionItemTimers.current.clear();
    setPlayerReactions({ mine: [], opponent: [] });
  }

  function onReact(emoji) {
    if (!canReact || Date.now() < reactionCooldownRef.current) return;
    setShowReactPicker(false);
    /* One second, not two. The wait is what made a reacted board feel deaf —
       the sender could not tell whether their tap had registered. */
    reactionCooldownRef.current = Date.now() + REACTION_COOLDOWN_MS;
    setReactionCooling(true);
    clearTimeout(reactionTimersRef.current.cooldown);
    reactionTimersRef.current.cooldown = setTimeout(() => setReactionCooling(false), REACTION_COOLDOWN_MS);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inOnline, onlineGame?.id, user?.id]);

  useEffect(() => () => {
    Object.values(reactionTimersRef.current).forEach(clearTimeout);
    for (const timer of reactionItemTimers.current.values()) clearTimeout(timer);
    reactionItemTimers.current.clear();
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
        let rememberedRequest = null;
        try { rememberedRequest = JSON.parse(sessionStorage.getItem('mz-pending-match-request') || 'null'); } catch { /* optional */ }
        const rememberedRow = rememberedRequest && visibleGames.find((m) => String(m.id) === String(rememberedRequest.id));
        if (rememberedRow && rememberedRow.status !== 'pending') {
          try { sessionStorage.removeItem('mz-pending-match-request'); } catch { /* optional */ }
          if (rememberedRow.status === 'declined' || rememberedRow.resultReason === 'expired' || rememberedRow.resultReason === 'cancelled') {
            setSetupStep(1); setActivePopup('online');
            showOnlineNotice(rememberedRow.status === 'declined' ? 'Opponent declined.' : rememberedRow.resultReason === 'expired' ? 'No response — the request expired.' : 'Match request cancelled.');
          }
        }
        const target = visibleGames.find((m) => m.status === 'active')
          || visibleGames.find((m) => m.status === 'pending' && m.canAbort);
        if (target) {
          applyOnline(target);
          if (target.status === 'active') {
            try { sessionStorage.removeItem('mz-pending-match-request'); } catch { /* optional */ }
          }
          if (target.status === 'pending' && target.canAbort) {
            const key = 'mz-pending-match-request';
            const waiting = { id: target.id, name: target.opponentName || 'your opponent', createdAt: target.createdAt || target.updatedAt };
            try { sessionStorage.setItem(key, JSON.stringify(waiting)); } catch { /* storage is optional */ }
            setOnlineWaiting(waiting); setSetupStep(2); setActivePopup('online');
          }
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Keep a pending request recoverable across refresh and expire it after one
     minute. Server-side expiry is authoritative; this timer updates the current
     screen promptly and also cleans up older requests after reload. */
  useEffect(() => {
    if (!onlineWaiting?.id) { window.clearTimeout(onlineWaitingTimer.current); return undefined; }
    const age = Math.max(0, Date.now() - (Date.parse(onlineWaiting.createdAt) || Date.now()));
    const left = Math.max(0, 60000 - age);
    window.clearTimeout(onlineWaitingTimer.current);
    onlineWaitingTimer.current = window.setTimeout(async () => {
      if (String(onlineWaitingRef.current?.id) !== String(onlineWaiting.id)) return;
      try {
        const row = await cancelGameRequest(onlineWaiting.id);
        if (row.status === 'active') { setOnlineWaiting(null); applyOnline(row); return; }
        if (row.status === 'aborted') {
          try { sessionStorage.removeItem('mz-pending-match-request'); } catch { /* optional */ }
          setOnlineWaiting(null); setSetupStep(1); resetAfterPendingRequest();
          showOnlineNotice('No response — the request expired.');
        }
      } catch {
        setOnlineWaiting((current) => current?.id === onlineWaiting.id ? { ...current, expiryRetry: true } : current);
      }
    }, left);
    return () => window.clearTimeout(onlineWaitingTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineWaiting?.id, onlineWaiting?.createdAt]);

  useEffect(() => {
    if (activePopup !== 'online' || !onlineWaiting) return;
    if (onlineGame?.status === 'active') {
      setOnlineWaiting(null);
      setOnlineSearching(false);
      try { sessionStorage.removeItem('mz-pending-match-request'); } catch { /* optional */ }
      setActivePopup(null);
      showOnlineNotice('Opponent accepted — game on!');
    } else if (onlineGame?.status === 'aborted' || onlineGame?.status === 'finished') {
      setOnlineWaiting(null);
      setOnlineSearching(false);
      try { sessionStorage.removeItem('mz-pending-match-request'); } catch { /* optional */ }
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
      /* The invite bar at the bottom of this page IS the card for this request,
         so claim the shared dedupe key instead of raising a second toast. The
         backend also pushes a `match_request` notification row for the same
         game, and the bell's app-wide popup would otherwise appear next to this
         one — two Accept/Decline cards for one challenge. `game-invite` is
         emitted before that row, so on this page the bar always wins the claim;
         anywhere else nothing claims it and the bell pops instead. */
      claimToast(matchRequestKey(payload.game?.id, user?.id));
      // keep the bar on screen for the same window the popup used to have
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
  }, [claimToast]);

  useEffect(() => {
    const closeInvite = (payload) => {
      if (!payload?.gameId || String(inviteBar?.game?.id) !== String(payload.gameId)) return;
      window.clearTimeout(inviteBarTimer.current);
      setInviteBar(null);
      refreshOnlineMatches();
    };
    const offCancel = onSocketEvent('match-request-cancelled', closeInvite);
    const offExpiry = onSocketEvent('match-request-expired', closeInvite);
    return () => { offCancel(); offExpiry(); };
  }, [inviteBar?.game?.id]);

  /* keep onlineGameRef in sync for Socket.IO callback closure */
  useEffect(() => { onlineGameRef.current = onlineGame; }, [onlineGame]);
  useEffect(() => { onlineWaitingRef.current = onlineWaiting; }, [onlineWaiting]);

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
        resetAfterPendingRequest();
      }
      setOnlineWaiting(null); setOnlineSearching(false); setSetupStep(1); setActivePopup('online');
      try { sessionStorage.removeItem('mz-pending-match-request'); } catch { /* optional */ }
      showOnlineNotice('Opponent declined.');
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
    applyRematchFromRow(row);
    const before = appliedRef.current;
    const prevStatus = onlineGameRef.current?.status;
    applyOnline(row);
    /* A row that actually changed the board, or ended the game, is worth a list
       refresh; a duplicate delivery is not — it would re-fetch the whole match
       list on every poll. */
    if (appliedRef.current !== before || (row.status && row.status !== prevStatus)) {
      refreshOnlineMatches();
    }
    /* A challenge this page sent is marked by `onlineWaiting` as well as by
       `onlineGame`, and the marker is what keeps the "Challenge sent" card and
       the Cancel button up. Once the row says the game is no longer pending the
       wait is over, whichever way it ended. */
    if (onlineWaitingRef.current && String(onlineWaitingRef.current.id) === String(row.id)
      && row.status && row.status !== 'pending') {
      setOnlineWaiting(null);
      setOnlineSearching(false);
      try { sessionStorage.removeItem('mz-pending-match-request'); } catch { /* optional */ }
      if (row.status === 'active') {
        setActivePopup(null);
        showOnlineNotice('Opponent accepted — game on!');
      } else if (row.status === 'declined') {
        setSetupStep(1); resetAfterPendingRequest(); showOnlineNotice('Opponent declined.');
      } else if (row.status === 'aborted') {
        setSetupStep(1); resetAfterPendingRequest();
      }
    }
  });

  /* ── the fallback for an event that did not arrive ─────────────────────────
     Fetch the ONE row this page should be holding, and only when the realtime
     channel has demonstrably gone away or gone quiet: a reconnect, the tab
     coming back to the foreground, or a challenge that is still un-answered
     after the push that should have opened it has not turned up. It is not a
     timer — a healthy match issues zero of these requests.

     `catchUpInFlightRef` keeps it single-flight, because a reconnect fires
     `connect`, `online` and `visibilitychange` inside the same tick and three
     identical requests for one row is the behaviour the old 2.5 s poll had. */
  const catchUpOnline = useStableCallback(async (gameIdArg) => {
    const gameId = gameIdArg ?? onlineGameRef.current?.id ?? onlineWaitingRef.current?.id;
    if (gameId == null) return;
    if (catchUpInFlightRef.current === gameId) return;
    catchUpInFlightRef.current = gameId;
    try {
      const fetched = await fetchGame(gameId);
      /* Re-scope to this viewer — the endpoint answers for whichever side asked,
         so a row that arrives after a game switch is somebody else's game. */
      const row = fetched && fetched.meId === user?.id ? fetched : null;
      if (!row) return;
      lastContactRef.current = Date.now();
      const stillWatched = String(onlineGameRef.current?.id ?? '') === String(row.id)
        || String(onlineWaitingRef.current?.id ?? '') === String(row.id);
      if (!stillWatched) return;
      /* Still un-answered, and the board already says so: nothing was missed, and
         re-applying the same pending row every pass would only churn the page. */
      if (row.status === 'pending' && onlineGameRef.current?.status === 'pending') return;
      if (row.status === 'declined' || row.status === 'aborted') {
        const wasWaiting = String(onlineWaitingRef.current?.id ?? '') === String(row.id);
        if (onlineGameRef.current?.id === row.id || wasWaiting) resetAfterPendingRequest();
        setOnlineWaiting(null);
        setOnlineSearching(false);
        if (wasWaiting) {
          try { sessionStorage.removeItem('mz-pending-match-request'); } catch { /* optional */ }
          setSetupStep(1); setActivePopup('online');
          showOnlineNotice(row.status === 'declined' ? 'Opponent declined.' : row.resultReason === 'expired' ? 'No response — the request expired.' : 'Match request cancelled.');
        }
        refreshOnlineMatches();
        return;
      }
      applyOnlineRow(row);
    } catch {
      /* A transient failure is not a reason to blank the board; the next trigger
         (or the next push) converges it. */
    } finally {
      catchUpInFlightRef.current = null;
    }
  });

  /* ── the fast path for an opponent's move ──────────────────────────────────
     The server pushes the move itself, so the board plays that one half-move
     instead of rebuilding the entire game from PGN. It is strictly an
     OPTIMISATION: `game-update` still follows and remains the authority, so
     anything this path is not completely sure about — a ply that does not step
     forward by exactly one, a move the local engine refuses, a FEN that does not
     agree with the server's — is left alone for that row to settle. Guessing
     here is how a piece moves twice.

     `move_number` is the ply the server counted off the same PGN the board
     holds, so a move at or below what is already on the board is a duplicate and
     is dropped: the player's own move, an echoed push, or a late delivery. */
  const applyIncomingMove = useStableCallback((p) => {
    if (!p || p.gameId == null) return;
    if (ignoredGameIdsRef.current.has(String(p.gameId))) return;
    const cur = onlineGameRef.current;
    if (!cur || String(cur.id) !== String(p.gameId)) return;
    lastContactRef.current = Date.now();
    if (p.status && p.status !== 'active') {
      /* The move ended the game. The position and the result both live in the
         row that follows, so ask for it rather than half-applying this. */
      catchUpOnline(p.gameId);
      return;
    }
    if (cur.status !== 'active') return;
    const g = gameRef.current;
    const played = g.history().length;
    if (p.ply <= played || p.ply <= appliedRef.current.ply) return;
    if (p.ply !== played + 1) {
      /* A gap means moves were missed — a backgrounded tab or a brief
         disconnect. Fetch the position instead of replaying a move that is not
         the next one. */
      catchUpOnline(p.gameId);
      return;
    }
    let mv = null;
    try { mv = g.move({ from: p.from, to: p.to, promotion: p.promotion || undefined }); }
    catch { mv = null; }
    if (!mv || g.fen() !== p.fen) return;   // the row behind this carries the truth
    const { san, last } = getHistory(g);
    /* Stamp the position as applied, including the PGN: the `game-update` that
       immediately follows describes this exact position and must be recognised
       as the duplicate it is. Without the PGN it would rebuild the board and
       animate the same piece a second time. */
    appliedRef.current = { id: p.gameId, ply: san.length, pgn: g.pgn() };
    setMoves(san);
    if ((inOnline || computerOn) && moveIndex < moves.length) {
      const ply = Math.min(moveIndex, san.length);
      const reviewed = rebuildGame(initialFen, san.slice(0, ply));
      liveReviewGameRef.current = reviewed;
      setMoveIndex(ply);
      setFen(reviewed.fen());
      const reviewedLast = getHistory(reviewed).last;
      setLastMove(reviewedLast ? { from: reviewedLast.from, to: reviewedLast.to } : null);
    } else {
      liveReviewGameRef.current = null;
      setMoveIndex(san.length);
      setFen(g.fen());
      setLastMove(last ? { from: last.from, to: last.to } : null);
    }
    setStatus(getStatus(g));
    /* The hand-off happens here, not in the clock: the board must stop accepting
       drags the moment the position says it is the other side's turn. */
    setOnlineTurn(g.turn() === 'w' ? 'white' : 'black');
    if (p.clock) {
      setClock((c) => (c
        ? {
            ...c,
            whiteMs: p.clock.whiteMs,
            blackMs: p.clock.blackMs,
            turn: p.clock.turn,
            serverNow: p.serverNow || Date.now(),
          }
        : c));
    }
    if (g.isCheckmate() && String(onlineSeenActiveRef.current) === String(p.gameId)) {
      waitForMateReveal(last?.to);
    } else if (!g.isCheckmate()) {
      clearMateReveal();
    }
    /* The list only needs re-reading when a game leaves the live pool; refetching
       it every ply is the network cost this path exists to remove. */
    if (p.result || p.status === 'finished' || p.status === 'aborted') refreshOnlineMatches();
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
      /* This page follows TWO ids: the live board and the challenge it sent and
         can still cancel. Normally they name the same game, but the board can be
         put away (leaving Play Mode) while the challenge is still outstanding —
         and then the accept arrives for a game with no board to update. Matching
         on either id means that push still opens the match instead of being
         brushed into a list refresh while the player waits on a spinner. */
      const followed = cur?.id ?? onlineWaitingRef.current?.id ?? null;
      if (followed == null || String(row.id) !== String(followed)) {
        refreshOnlineMatches();
        return;
      }
      // The other side closed a pending request (declined/aborted) — take it off
      // the board and refresh instead of popping an empty start-position game.
      if (row.status === 'declined' || row.status === 'aborted') {
        const wasWaiting = onlineWaitingRef.current && String(onlineWaitingRef.current.id) === String(row.id);
        if (cur || wasWaiting) resetAfterPendingRequest();
        setOnlineWaiting(null);
        setOnlineSearching(false);
        if (wasWaiting) {
          try { sessionStorage.removeItem('mz-pending-match-request'); } catch { /* optional */ }
          setSetupStep(1); setActivePopup('online');
          showOnlineNotice(row.status === 'declined' ? 'Opponent declined.' : row.resultReason === 'expired' ? 'No response — the request expired.' : 'Match request cancelled.');
        }
        refreshOnlineMatches();
        return;
      }
      /* A challenge nobody has answered yet, with nothing on the board: the only
         news is the list. Once a game IS on the board, `pending` is a state the
         player acts on — the Accept button lives there — so it still applies. */
      if (!cur && row.status === 'pending') {
        refreshOnlineMatches();
        return;
      }
      applyOnlineRow(row);
    });

    /* The opponent's move, pushed on its own so the board steps one ply instead
       of rebuilding. Subscribed and disposed with this game, so exactly one
       handler per match — the same stacking bug `game-update` used to have. */
    const cleanupMove = onGameMove((p) => {
      lastContactRef.current = Date.now();
      applyIncomingMove(p);
    });

    let cleaned = false;
    const cleanGameSocket = () => {
      if (cleaned) return;
      cleaned = true;
      cleanup();
      cleanupMove();
      if (id) leaveGameRoom(id);
    };
    gameSocketCleanupRef.current = cleanGameSocket;
    return () => {
      cleanGameSocket();
      if (gameSocketCleanupRef.current === cleanGameSocket) gameSocketCleanupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineGame?.id, user?.id]);

  /* ─── the moments a push is actually lost ─────────────────────────────────
     These replace the 2.5 s poll, which fired a request every 2500 ms for the
     life of every match whether or not anything was missed — pure load on a
     healthy connection, and still up to 2.5 s behind on a broken one. Each
     trigger here is a real reason a delivery did not arrive, and converges by
     fetching the ONE row it concerns:
       · socket `connect`   — a reconnect gets a brand-new socket id, so the
                              server-side room is empty. Re-joining first is the
                              fix; without it every LATER move is also unheard.
       · `visibilitychange` — a backgrounded tab drops the websocket silently.
       · window `online`    — the network interface came back.
     `disconnect` only flips the "Reconnecting…" flag: socket.io reconnects on
     its own, and the `connect` handler above does the catch-up. */
  useEffect(() => {
    const id = onlineGame?.id;
    if (!id) return undefined;
    setServerLinked(isSocketConnected());
    const onConnect = () => {
      setServerLinked(true);
      joinGameRoom(id);
      catchUpOnline(id);
    };
    const offConnect = onSocketConnect(onConnect);
    const offDisconnect = onSocketDisconnect(() => setServerLinked(false));
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (isSocketConnected()) catchUpOnline(id);
      else joinGameRoom(id);
    };
    const onNetworkUp = () => {
      if (isSocketConnected()) catchUpOnline(id);
      else joinGameRoom(id);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onNetworkUp);
    return () => {
      offConnect();
      offDisconnect();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onNetworkUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineGame?.id, catchUpOnline]);

  /* The one case no event can announce: an accept — or an opponent's move — the
     server believes it pushed, over a socket that still claims to be connected.
     Bounded instead of constant: it runs ONLY while this board is genuinely
     waiting on somebody else (an un-answered challenge, or a live match whose
     move is due from the other side), asks at most once every 45 s of silence,
     and stops the moment the game starts, ends, or hands the turn back to me. */
  useEffect(() => {
    const boardId = onlineGame?.id ?? null;
    const heldId = onlineWaiting?.id ?? null;
    const id = boardId ?? heldId;
    if (!id) return undefined;
    const awaitingAccept = !boardId || onlineGame?.status === 'pending';
    const awaitingMove = onlineGame?.status === 'active' && onlineTurn !== onlineMyColor;
    if (!awaitingAccept && !awaitingMove) return undefined;

    const openedAt = Date.now();
    const timer = window.setInterval(() => {
      if (awaitingAccept) { catchUpOnline(id); return; }
      if (!serverLinked) return;
      const lastHeard = Math.max(lastContactRef.current, openedAt);
      if (Date.now() - lastHeard < 45000) return;
      catchUpOnline(id);
    }, 15000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineGame?.id, onlineGame?.status, onlineWaiting?.id, onlineTurn, onlineMyColor, serverLinked, catchUpOnline]);

  /* ─── derived values ─────────────────────────────────────── */
  const onlineFinished   = onlineGame && (onlineGame.status === 'finished' || onlineGame.status === 'aborted');
  const opponentName     = inOnline || onlineFinished ? onlineGame.opponentName : '';

  // locked for board interaction; undo/redo/reset are always allowed in computer mode
  const boardLocked = inOnline;
  const liveReviewing = Boolean((onlineGame || computerOn) && moveIndex < moves.length);
  const navLocked   = Boolean(onlineGame?.status === 'pending');
  const boardGame = liveReviewing
    ? (liveReviewGameRef.current || rebuildGame(initialFen, moves.slice(0, moveIndex)))
    : gameRef.current;

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
    if (!computerOn || !computerHints || reviewMode || liveReviewing || status.over) return [];
    if (!best?.from || !best?.to || bestFen !== fen) return [];
    const humanTurn = computerColor === 'white'
      ? gameRef.current.turn() === 'w'
      : gameRef.current.turn() === 'b';
    return humanTurn ? [{ from: best.from, to: best.to, color: '#19c9c3' }] : [];
  }, [computerOn, computerHints, reviewMode, liveReviewing, status.over, best, bestFen, fen, computerColor]);

  /* The arrows array has to be identity-stable or the memoized board re-renders
     on every parent render — and `reviewArrows` above is a fresh literal each
     time. */
  const boardArrows = useMemo(
    () => (reviewMode ? reviewArrows : hintArrows),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviewMode, reviewArrow, hintArrows],
  );


  const savedStorageKey = `kpa_analyses:${user?.id ?? 'guest'}`;
  const { list: savedList, loading: savedLoading, refresh: refreshSaved } = useSavedAnalyses(savedStorageKey);

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
  /* Nothing may be played into a game that already has a result. Each mode ends
     in its own way — an online match by the row the server sends, a bot or free
     game by the board's own rules or by a clock that fell — and all of them have
     to lock the pieces. Without this, `onlineTurn` still names whoever would
     have moved next after a flag, and a local position that reached its last
     legal move still has replies in it, so the board stayed draggable underneath
     a finished game. */
  const gameOver = onlineFinished || Boolean(clockOver) || (status.over && moves.length > 0);
  const boardInteractive = reviewMode || liveReviewing ? false  // review: navigate only, no new moves
    : gameOver ? false
    : inOnline
      ? onlineMyColor === onlineTurn
      : computerOn
        ? humanIsComputerTurn && !computerThinking
        : true;

  /* Keep the setup/accept status in the banner, but never cover the board with a
     waiting animation. */
  const waitingForOpponent = Boolean(onlineGame) && !onlineFinished && (
    onlineGame.status === 'pending'
      ? !onlineGame.canAccept
      : (inOnline && onlineTurn !== onlineMyColor && moves.length === 0)
  );

  /* Pieces cannot be picked up while the overlay is up, and the banner strip that
     used to carry the message is replaced by it — except when it still has a
     button the player needs (Accept / Abort). */
  const boardLive = boardInteractive && !waitingForOpponent;
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
      /* A clock that fell is named from the inside rather than filed under
         "By Timeout": the winner is the one who needs to be told the opponent ran
         out, and the server has already decided what the flag was worth — a
         timeout whose result is a draw is a clock that fell against a side with
         no material to mate with (FIDE 6.9), not a draw by agreement. */
      if (why === 'Timeout') {
        if (r === 'draw') {
          return { title: 'Game Drawn', reason: 'Timeout vs insufficient material', tone: 'draw', mySide: myColor, wantsReview: true };
        }
        const wonOnTime = r === myColor;
        return {
          title: wonOnTime ? 'You Won!' : 'You Lost',
          reason: wonOnTime ? 'Opponent ran out of time' : 'You ran out of time',
          tone: wonOnTime ? 'win' : 'loss',
          winner: r, mySide: myColor, wantsReview: true,
        };
      }
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
      /* A flagged clock that `drawOnFlag` ruled undeachable is a draw, and it has
         to be read before the win/loss test below: a null winner compared against
         myColor would come out as a loss for both players. */
      if (clockOver.draw) {
        return { title: 'Game Drawn', reason: 'Timeout vs insufficient material', tone: 'draw', mySide: myColor, wantsReview: true };
      }
      /* Read the explicit flag rather than inferring it: `winner` is now the
         colour that WON, and myColor is the colour we played, so they are equal
         exactly when we won. */
      const won = clockOver.humanWon ?? clockOver.winner === myColor;
      return {
        title: won ? 'You Won!' : 'You Lost',
        reason: won ? 'Opponent ran out of time' : 'You ran out of time',
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

  /* The move strip closes with the result the way a pad of scoresheet paper
     does — the score, then one short word for how it ended. Only a game that has
     finished gets one, and a match that was never played (aborted) has no score
     to post. The word comes from the machine reason the server stored, or from
     the fallen clock, never from the card's prose, so the strip and the card
     cannot disagree about what happened. */
  const endWord = onlineFinished
    ? (onlineGame.result === 'aborted' ? null : onlineReasonLabel(onlineGame.resultReason) || '')
    : (clockOver && clockOver.title) ? 'Timeout' : '';
  const moveResultToken = endWord === null || !finalResult ? null : [
    finalResult.winner === 'white' ? '1-0'
      : finalResult.winner === 'black' ? '0-1' : '½-½',
    endWord,
  ].filter(Boolean).join(' · ');

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
    /* Rematch is offered in exactly two modes, and nowhere else:

         finished player-vs-player → an OFFER. The opponent accepts or rejects,
             and accepting opens a brand new match on the server.
         vs Computer               → immediate. There is nobody to consent, so it
             restarts on the spot with the same settings and the colours swapped.

       A live board, Annotate & Save, a Saved position and Settings have no
       finished game to replay against an opponent, so they get no button. */
    if (onlineRematchTarget(onlineGame)) {
      secondary.push({ label: 'Rematch', onClick: askRematchOnline, primary: true });
    } else if (vsComputer && !onlineGame && moves.length > 0) {
      secondary.push({ label: 'Rematch', onClick: rematchComputer, primary: true });
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
      open={!resultDismiss && !resultRevealPending && !rematchLive}
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

  /* The rematch offer, in whichever of its two shapes this viewer is in. Portalled
     to the body so it renders identically on the page and inside Play Mode, and
     it never needs the board column to have room for it.
     Rendered whenever a request is live — including for a player who had already
     closed their result card, which is the whole reason this is not a row inside
     that card. */
  const rematchCard = (rematchAsk || rematchInvite) ? createPortal(
    <div className="ab-rematch-layer">
      {rematchInvite ? (
        <div className="ab-rematch-card" role="alertdialog" aria-label="Rematch request" aria-live="assertive">
          <span className="ab-rematch-body">
            <span className="ab-rematch-title">♞ {rematchInvite.fromName} wants a rematch</span>
            <span className="ab-rematch-sub">Same clock, your colours swapped.</span>
          </span>
          <span className="ab-rematch-actions">
            <Button type="button" variant="primary" size="sm" disabled={rematchBusy}
              onClick={() => answerRematchInvite(true)} className="!py-1.5 !px-3 text-xs">
              ✓ Accept
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={rematchBusy}
              onClick={() => answerRematchInvite(false)} className="!py-1.5 !px-3 text-xs">
              ✕ Reject
            </Button>
          </span>
        </div>
      ) : (
        <div className="ab-rematch-card" role="status" aria-live="polite">
          <span className="ab-rematch-spinner" aria-hidden="true" />
          <span className="ab-rematch-body">
            <span className="ab-rematch-title">Waiting for {rematchAsk.opponentName}…</span>
            <span className="ab-rematch-sub">Rematch sent. Same clock, colours swapped.</span>
          </span>
          <span className="ab-rematch-actions">
            <Button type="button" variant="danger" size="sm"
              onClick={cancelRematchAsk} disabled={rematchBusy} className="!min-h-[48px] !py-2 !px-4 text-sm font-bold">
              Cancel
            </Button>
          </span>
        </div>
      )}
    </div>,
    document.body,
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
            {!playMode && <ReactionBubble reactions={playerReactions.opponent} boardRef={boardAreaRef} />}
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
              silent={playMode}
            />
          </div>

          {/* The setup-mode banner is gone with the editor it belonged to. */}

          {/* Play Mode trigger — its own row above the board, matched to the
              board's width so it lines up with the board's right edge. */}
          <div className="ab-board-toolbar" style={{ ...pmCss, width: boardOuter }}>
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
                  game={boardGame}
                  orientation={orientation}
                  outerWidth={boardOuter}
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
                  maxMoveMs={inOnline ? ONLINE_MOVE_MS : undefined}
                />
              )}
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

          {/* Match status stays above the board while the board remains visible
              during an unanswered challenge. */}
          {onlineBanner && (
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

          {/* The socket itself reports it is not linked. Shown only while a match
              is live, and deliberately outside the banner's suppression rule: the
              board keeps its position, the reconnect path repairs it, and this is
              here so the player is not dragging pieces into a void. */}
          {inOnline && !serverLinked && (
            <div className="ab-banner ab-banner-pending" role="status" aria-live="polite">
              <span className="ab-banner-icon">📶</span>
              <span className="ab-banner-text">Reconnecting… your board catches up on its own.</span>
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
              canRematch={moves.length > 0 && (Boolean(onlineRematchTarget(onlineGame)) || computerOn || Boolean(clockOver))}
            />
          ) : (
            <MoveList
              moves={moves}
              moveIndex={moveIndex}
              verdicts={verdictList}
              navLocked={navLocked}
              goToMove={handleNavMove}
              containerRef={stripRef}
              emptyText="No moves yet. Play on the board or load a game."
              resultToken={moveResultToken}
            />
          )}
          {liveReviewing && <LiveReviewBar moveIndex={moveIndex} total={moves.length} onReturn={returnToLive} />}

          {/* bottom player card (me) — under the moves strip */}
          <div className="ab-player-row ab-player-row-reactions">
            {!playMode && <ReactionBubble reactions={playerReactions.mine} boardRef={boardAreaRef} />}
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
              silent={playMode}
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
        modalClass={activePopup === 'online' || activePopup === 'computer' ? 'arena-flow-modal' : ''}
        returnFocusRef={popupTriggerRef}
        busy={onlineSearching}
        footer={activePopup === 'online' && (onlineSearching || onlineWaiting) ? <button type="button" className="arena-cancel-request" onClick={cancelOnlineSearch} disabled={onlineBusy || onlineCancelLock.current}>{onlineBusy ? 'Cancelling…' : 'Cancel'}</button> : activePopup === 'online' ? <button type="button" className="arena-step-primary" onClick={() => setupStep === 1 ? setSetupStep(2) : startOnlineMatch()} disabled={onlineBusy || (setupStep === 1 && !onlineSelId) || (setupStep === 2 && (!onlineColorSel || !timePicked || !isTimeControlValid(timeSel)))}>{onlineBusy ? 'Starting…' : setupStep === 2 ? 'Start Game' : 'Next'}</button> : activePopup === 'computer' && !computerOn ? <button type="button" className="arena-step-primary" onClick={() => setupStep === 1 ? setSetupStep(2) : startComputerGame(computerColorChoice === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : computerColorChoice)} disabled={(setupStep === 2 && (!computerColorChoice || !timePicked || !isTimeControlValid(timeSel)))}>{setupStep === 2 ? 'Start Game' : 'Next'}</button> : activePopup === 'computer' && computerOn ? <><Button variant="secondary" size="md" onClick={requestClosePopup}>Close</Button><Button variant="danger" size="md" onClick={exitComputer}>Exit game</Button></> : activePopup === 'live' ? <><Button variant="secondary" size="md" onClick={refreshLive} disabled={liveRefreshing}>{liveRefreshing ? 'Refreshing…' : 'Refresh'}</Button><Button variant="primary" size="md" onClick={requestClosePopup}>Close</Button></> : activePopup === 'annotate' ? <><Button variant="secondary" size="md" onClick={requestClosePopup}>Cancel</Button><Button variant="primary" size="md" onClick={saveAnalysis}>Save</Button></> : null}
      >
        {activePopup === 'online' && <>
          {onlineError && <div className="chess-error !mb-2 !py-1.5 text-xs" role="alert">{onlineError}</div>}
          {onlineSearching ? <div className="py-6 text-center" aria-live="polite"><p>Finding an opponent…</p></div> : onlineWaiting ? <div className="arena-waiting" role="status" aria-live="polite"><button type="button" className="arena-close" aria-label="Cancel online match request" onClick={cancelOnlineSearch} disabled={onlineBusy}>×</button><span className="arena-waiting-spinner" aria-hidden="true" /><h3>Waiting for {onlineWaiting.name}…</h3><p>Your request will expire if there is no response in 60 seconds.</p>{onlineError && <p className="arena-waiting-error" role="alert">{onlineError}</p>}</div> : <div className="arena-setup">
            <div className="arena-setup-head"><button type="button" className="arena-back" aria-label={setupStep === 1 ? 'Close setup' : 'Previous step'} onClick={() => setupStep === 1 ? requestClosePopup() : setSetupStep((s) => s - 1)}>←</button><strong>Online Match</strong><button type="button" className="arena-close" aria-label="Close Online Match setup" onClick={() => onlineWaiting || onlineSearching ? cancelOnlineSearch() : requestClosePopup()} disabled={onlineBusy}>×</button></div>
            <div className="arena-progress" aria-label={`Step ${setupStep} of 2`}>{[1,2].map((n) => <span key={n} className={n <= setupStep ? 'filled' : ''} />)}</div>
            <h3 className="arena-question">{setupStep === 1 ? 'Who do you want to play?' : 'Choose colour and time control'}</h3>
            {setupStep === 1 && (onlineUsersError ? <div className="online-pick-state online-pick-error" role="alert">{onlineUsersError}<Button variant="secondary" size="sm" onClick={loadOnlineUsers}>Retry</Button></div> : onlineUsersLoading && onlineUsers.length === 0 ? <div className="online-pick-state">Loading players…</div> : visibleOnlinePlayers.length === 0 ? <div className="online-pick-state">No other players are available yet.</div> : <div className="arena-player-grid" role="listbox" aria-label="Players">{visibleOnlinePlayers.map((u) => <button type="button" key={u.id} role="option" aria-selected={String(u.id) === String(onlineSelId)} className={`arena-player-card${String(u.id) === String(onlineSelId) ? ' selected' : ''}`} onClick={() => { onlineSelStudent.current = String(u.id); setOnlineSelId(String(u.id)); setOnlineSelName(u.name); }}><span className="arena-check">✓</span><PlayerAvatar player={u} size={48} /><b>{u.name}</b><small>{(() => { const r = ratingForPlayer(u, onlineTimeClass); return r != null ? `${r} ${ratingPoolLabel(onlineTimeClass)}` : (u.role === 'coach' ? 'Coach' : u.role === 'student' ? 'Academy' : 'Unrated'); })()}</small>{u.online && <i className="arena-live">LIVE</i>}</button>)}</div>)}
            {setupStep === 2 && <div className="arena-setup-combined"><ColorCards value={onlineColorSel} onChange={setOnlineColorSel} /><TimeStep timeSel={timeSel} setTimeSel={setTimeSel} customTime={customTime} setCustomTime={setCustomTime} timePicked={timePicked} setTimePicked={setTimePicked} presets={[[['Bullet','1+0',1,0]],[['Blitz','3+0',3,0],['Blitz','3+2',3,2],['Blitz','5+0',5,0]],[['Rapid','10+0',10,0],['Rapid','10+3',10,3],['Rapid','30+0',30,0]]]} /></div>}
          </div>}
        </>}
        {activePopup === 'computer' && (computerOn ? <div className="space-y-3"><p>Game in progress</p><p>You: {computerColor} · Skill {computerLevel} · {skillLabel(computerLevel)}</p>{computerThinking ? '🤖 Thinking…' : 'Your move!'}{computerTakeback && <Button type="button" variant="secondary" size="sm" onClick={takebackComputerMove} disabled={computerThinking}>↶ Take back</Button>}</div> : <div className="arena-setup">
          <div className="arena-setup-head"><button type="button" className="arena-back" aria-label={setupStep === 1 ? 'Close setup' : 'Previous step'} onClick={() => setupStep === 1 ? requestClosePopup() : setSetupStep((s) => s - 1)}>←</button><strong>vs Computer</strong><button type="button" className="arena-close" aria-label="Close vs Computer setup" onClick={requestClosePopup}>×</button></div>
          <div className="arena-progress" aria-label={`Step ${setupStep} of 2`}>{[1,2].map((n) => <span key={n} className={n <= setupStep ? 'filled' : ''} />)}</div>
          <h3 className="arena-question">{setupStep === 1 ? 'Choose robot level' : 'Choose colour and time control'}</h3>
          {setupStep === 1 && <div className="arena-level-list">{BOT_LEVELS.map((lvl) => <button type="button" key={lvl.level} className={`arena-level${computerLevel === lvl.level ? ' selected' : ''}`} onClick={() => setComputerLevel(lvl.level)}><span className="arena-level-number">{lvl.level}</span><span><b>Lv{lvl.level} {lvl.label}</b><small>{lvl.ratingMax >= 9999 ? `${lvl.ratingMin}+` : `${lvl.ratingMin}-${lvl.ratingMax}`}</small></span>{lvl.level === recommendedLevel && <i>Suggested</i>}<span className="arena-check">✓</span></button>)}</div>}
          {setupStep === 2 && <div className="arena-setup-combined"><ColorCards value={computerColorChoice} onChange={setComputerColorChoice} /><TimeStep timeSel={timeSel} setTimeSel={setTimeSel} customTime={customTime} setCustomTime={setCustomTime} timePicked={timePicked} setTimePicked={setTimePicked} presets={[[['Bullet','1+0',1,0]],[['Blitz','3+0',3,0],['Blitz','3+2',3,2]],[['Rapid','10+0',10,0],['Rapid','15+10',15,10],['Rapid','30+0',30,0]]]} /></div>}
        </div>)}

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
                Title <span className="text-ivory-500">(optional)</span>
              </label>
              <input
                id="ab-note-title"
                value={saveName}
                onChange={(e) => { setSaveName(e.target.value); setAnnotationError(''); }}
                placeholder="e.g. Sicilian Najdorf — key ideas (or leave blank)"
                className="chess-input mt-1 w-full !text-xs !py-1.5"
                aria-invalid={!!annotationError}
                aria-describedby={annotationError ? 'ab-note-title-error' : undefined}
              />
              {annotationError && (
                <p id="ab-note-title-error" className="mt-1 text-[11px] text-red-600" role="alert">{annotationError}</p>
              )}
            </div>
            {savedMessage && <p className="arena-saved-success" role="status">✓ {savedMessage}</p>}

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

            <section className="arena-saved-section" aria-labelledby="arena-saved-title">
              <div className="arena-saved-heading"><h3 id="arena-saved-title">Saved</h3><span>{savedList.length}</span></div>
              <input type="search" className="chess-input w-full !text-xs !py-2" placeholder="Search saved items…" aria-label="Search saved items" value={savedQuery} onChange={(e) => setSavedQuery(e.target.value)} />
              {savedLoading ? <p className="arena-saved-state" role="status">Loading saved items…</p> : savedList.length === 0 ? <p className="arena-saved-state">Nothing saved yet. Save a game or position to see it here.</p> : filteredSaved.length === 0 ? <p className="arena-saved-state">No saved items match that search.</p> : <div className="arena-saved-list">{filteredSaved.map((item) => <article key={item.id} className="arena-saved-card">
                <div className="arena-saved-card-top"><div><h4>{item.name || 'Untitled'}</h4><time>{item.at || (item.savedAt ? formatDateTime12(new Date(item.savedAt)) : '')}</time></div>{item.color && <span className="arena-saved-chip">{item.color}</span>}</div>
                {item.players && <p className="arena-saved-meta">{item.players}</p>}
                <p className="arena-saved-meta">{item.result || 'Position saved'} · {item.moveCount ?? (item.pgn ? item.pgn.trim().split(/\s+/).filter((token) => /^\d+\.(\.\.)?$/.test(token)).length : 0)} moves</p>
                {item.notes && <p className="arena-saved-notes">{item.notes}</p>}
                <div className="arena-saved-actions">{savedDeleteId === item.id ? <><span className="arena-delete-prompt">Delete this saved item?</span><Button type="button" variant="danger" size="sm" onClick={() => deleteSaved(item.id)}>Confirm delete</Button><Button type="button" variant="secondary" size="sm" onClick={() => setSavedDeleteId(null)}>Keep</Button></> : <><Button type="button" variant="primary" size="sm" className="arena-tap-button" onClick={() => openSavedAnalysis(item)}>Open</Button><Button type="button" variant="danger" size="sm" className="arena-tap-button" onClick={() => setSavedDeleteId(item.id)}>Delete</Button></>}</div>
              </article>)}</div>}
            </section>

            {discardConfirm && (
              <div className="mz-discard" role="alertdialog" aria-label="Discard unsaved changes">
                <p>Discard your unsaved changes?</p>
                <Button type="button" variant="danger" size="sm" onClick={closePopup}>Discard</Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setDiscardConfirm(false)}>Keep editing</Button>
              </div>
            )}
          </div>
        )}

      </Modal>

      {/* ── online game request — bottom-of-page notice bar ──
          Portalled to the body on the alert tier: it used to render inside the
          page, where Play Mode and a finished-game result card cover it. */}
      {inviteBar && createPortal(
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[var(--z-alert)] w-[min(94vw,560px)]" role="status" aria-live="assertive">
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
        </div>,
        document.body
      )}

      {/* One rematch card for the whole page: portalled to the body, so the page
          board and Play Mode never disagree about whether the offer is on screen. */}
      {rematchCard}

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
              <ReactionBubble reactions={playerReactions.opponent} boardRef={pmAreaRef} />
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
              <ReactionBubble reactions={playerReactions.mine} boardRef={pmAreaRef} />
              <span className="ab-player-name">{bottomLabel}</span>
              {canReact && playMode && <EmojiReactControl open={showReactPicker} disabled={reactionCooling} pressed={pressedReaction} onToggle={() => setShowReactPicker((value) => !value)} onReact={onReact} onClose={() => setShowReactPicker(false)} />}
              <CapturedTray
                pieces={bottomCaptured}
                diff={captured[`${orientation}Value`] - captured[`${orientation === 'white' ? 'black' : 'white'}Value`]}
              />
              <GameClock
                clock={clock}
                running={clockRunning}
                color={orientation}
                forceFloor={clock?.incMs === 0}
              />
            </div>

            {/* controls + status — the four move-nav buttons now live inside the
                moves strip, so only the position-only actions remain here. */}
            <div className="play-mode-controls">
              <div className="ab-ctrl-group">
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
          </div>

          {/* moves — ONE sticky row, pinned to the bottom of the panel so it never
              scrolls away with the player rows above it. The four navigation
              buttons sit at the ends and the chips scroll between them, which is
              why the old ⏮ ◀ ▶ ⏭ row above is gone: the same four handlers, now
              one set of buttons.

              Same memoised MoveList as the page strip — same moves, same
              moveIndex, same goToMove — so a tap only re-views a position and
              can never play one. */}
          <div className="play-mode-movestrip" role="group" aria-label="Move navigation">
            <button type="button" onClick={() => goToMove(0)} disabled={navLocked || moveIndex === 0} className="pm-strip-btn" title="First move" aria-label="First move">⏮</button>
            <button type="button" onClick={undoMove} disabled={navLocked || moveIndex === 0} className="pm-strip-btn" title="Previous move" aria-label="Previous move">◀</button>
            <MoveList
              moves={moves}
              moveIndex={moveIndex}
              verdicts={verdictList}
              navLocked={navLocked}
              goToMove={handleNavMove}
              containerRef={pmStripRef}
              emptyText="No moves yet"
              resultToken={moveResultToken}
            />
            <button type="button" onClick={redoMove} disabled={navLocked || moveIndex >= moves.length} className="pm-strip-btn" title="Next move" aria-label="Next move">▶</button>
            <button type="button" onClick={() => goToMove(moves.length)} disabled={navLocked || moveIndex >= moves.length} className="pm-strip-btn" title="Last move" aria-label="Last move">⏭</button>
          </div>
          {liveReviewing && <LiveReviewBar moveIndex={moveIndex} total={moves.length} onReturn={returnToLive} />}
        </div>

        {/* board — the star: fills every free pixel, side details stay in the panel */}
        <div className="play-mode-board-area" ref={pmAreaRef}>
          <ArenaBoard
            key={boardResetKey}
            game={boardGame}
            orientation={orientation}
            outerWidth={pmBoardOuter}
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
            maxMoveMs={inOnline ? ONLINE_MOVE_MS : undefined}
          />


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

/* Scroll a moves strip so the chip for the move being viewed sits in the middle.
 * Only the strip itself moves — see the effect that calls this.
 *
 * Measured with getBoundingClientRect rather than the chip's offsetLeft:
 * offsetLeft is relative to the nearest POSITIONED ancestor, which for Play Mode
 * is the fixed overlay — it would carry the row's own left offset (the whole
 * board column, on desktop) into the scroll target and centre nothing. These two
 * rects are both in viewport space, so their difference is the chip's position
 * inside the row that is actually visible; adding the row's current scrollLeft
 * turns that into a position in the scrolled content. */
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

/* The moves strip, memoised.
 *
 * Both surfaces render one — the page's row under the board and Play Mode's
 * sticky row in the panel — and they used to be two hand-copied blocks of
 * markup, one horizontal and one a vertical box, that had already started to
 * drift. Worse, they sat inline in the page body, so ANY page state change
 * repainted every move button on the board.
 *
 * Now the repaint is driven by the four things a move button actually depends
 * on: the SAN list, which ply is being viewed, the verdict badges, and whether
 * navigation is locked. Clocks, panels, toasts and reactions cannot touch it.
 *
 * One row, standard notation — `1. e4 e5  2. Nf3 Nc6` — with the move number
 * small and grey and every half-move its own tappable chip. A chip calls
 * `goToMove`, so tapping re-VIEWS a position; it can never play one.
 */
const MoveList = memo(function MoveList({
  moves,
  moveIndex,
  verdicts,
  navLocked,
  goToMove,
  containerRef,
  emptyText,
  resultToken,
}) {
  if (moves.length === 0) {
    /* A game can end before its first move — a flag in a time scramble — so the
       result belongs in this row too, not only after a list of chips. */
    return (
      <div className="ab-movestrip" ref={containerRef}>
        <span className="ab-moves-empty">{emptyText}</span>
        {resultToken && <span className="ab-mv-result">{resultToken}</span>}
      </div>
    );
  }

  const rows = Array.from({ length: Math.ceil(moves.length / 2) }, (_, i) => (
    <span key={i} className="ab-mvpair">
      <span className="ab-mvnum">{i + 1}.</span>
      {[0, 1].map((offset) => {
        const idx = i * 2 + offset;
        if (idx >= moves.length) return null;
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
            className={`ab-mv${current ? ' is-current' : ''}${idx + 1 === moves.length ? ' is-latest' : ''}${vm ? ` ab-move-verdict-${vm.tone}` : ''}`}
          >
            {vm && <span className={`mv-badge mv-badge-${vm.tone}`} title={vm.label}>{vm.symbol}</span>}
            {moves[idx]}
          </button>
        );
      })}
    </span>
  ));

  return (
    <div className="ab-movestrip" ref={containerRef}>
      {rows}
      {resultToken && <span className="ab-mv-result">{resultToken}</span>}
    </div>
  );
});

function LiveReviewBar({ moveIndex, total, onReturn }) {
  return (
    <div className="ab-live-review-bar" role="status" aria-live="polite">
      <span>Reviewing move {moveIndex} / {total}</span>
      <button type="button" onClick={onReturn}>Return to Live</button>
    </div>
  );
}

/* The board's "waiting" overlay: a circular spinner with the message under it,
 * sitting ON the board instead of the thin strip of text it replaced.
 *
 * Purely presentational and `pointer-events:none` — it never eats a tap. The
 * board itself is switched off by `interactive`, which is why a waiting player
 * cannot pick up a piece while this is up. */
function ClockBox({ color, time, active, low, flagged }) {
  return (
    <div className={`ab-clock${active ? ' ab-clock-active' : ''}${low ? ' ab-clock-low' : ''}${flagged ? ' ab-clock-flagged' : ''}${!time ? ' ab-clock-static' : ''}`}>
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

/* A clock under a minute reads as "bullet", not "think here", so the warning is
   one minute — every time control in the arena, including 1+0, reaches it. */
const LOW_TIME_MS = 60000;

/* A ticking clock, isolated in its own component. The page used to hold a
   `clockTick` counter and repaint itself five times a second, so every tick
   re-rendered the board, the move list and both side panels — the single
   biggest reason a live game felt like it was hanging. Now only this subtree
   sees the beat.

   This is also the ONLY clock in the arena: the red-and-beat warning and its
   tick-tock live here, so every mode that has a running clock (vs Computer,
   online PvP, and the Play Mode copy of either) inherits them from one place.

   `silent` marks a copy that is on screen only as a duplicate. Play Mode portals
   a full-screen version of the arena while `.ab-layout` stays mounted behind it,
   so both halves render the same side. Only the visible one may make noise. */
function GameClock({ clock, running, color, forceFloor, silent = false }) {
  const { soundOn, playSound } = useSound();
  const [, setBeat] = useState(0);
  const ticking = !!clock && running && clock.turn === color;

  useEffect(() => {
    if (!ticking) return undefined;
    const t = setInterval(() => setBeat((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [ticking]);

  const left = remainingMs(clock, running, color);
  const low = ticking && left > 0 && left < LOW_TIME_MS;

  /* The side that ran out KEEPS the red once the game stops. `low` needs a
     ticking clock — a finished game must neither beat nor tick — so without this
     the flagger's box drops back to plain the moment the result lands and nothing
     on the board says who lost on time. A stopped clock shows its stored
     snapshot, and a settled match stores the loser at 0:00 (the server for an
     online game, zeroFlaggedClock for a bot game), which is what makes this true
     for the loser alone — on this screen, on a refresh, and for a spectator. */
  const stored = clock ? (color === 'white' ? clock.whiteMs : clock.blackMs) : null;
  const flagged = !!clock && !running && stored != null && stored <= 0;

  useEffect(() => {
    if (!low || silent || !soundOn) return undefined;
    /* The first beat lands with the warning, then once a second after it. The
       deps are the only things that can stop it, so a move, a pause, a flag,
       a resign, a new game, a rematch or leaving the page all arrive here as
       `low` or `silent` flipping — and the cleanup kills the sound. */
    playSound('tick');
    const t = setInterval(() => playSound('tick'), 1000);
    return () => clearInterval(t);
  }, [low, silent, soundOn, playSound]);

  return (
    <ClockBox
      color={color}
      time={clock ? fmtClock(left, forceFloor) : null}
      active={!!(clock && clock.turn === color)}
      low={low}
      flagged={flagged}
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
/* Where each concurrent bubble sits, indexed by AGE rather than by position in
   the list — 0 is always the newest, so the one you just sent stays dead centre
   and the older ones slide aside instead of jumping when a third arrives. */
const REACTION_FAN = [[0, 0], [-46, 20], [46, 20]];

/* Two or three at once, spread around the middle of the board, and each one
   removes itself. Before, a slot held exactly ONE reaction and a new emoji
   cancelled the timer of the one already on screen — so rapid sending did not
   show three, it showed whichever arrived last. The `key` on each bubble is the
   per-send id, so React never re-uses a node and restarts an animation that is
   already running. */
function ReactionBubble({ reactions, boardRef }) {
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
  const newestId = reactions[reactions.length - 1]?.id;
  useLayoutEffect(() => {
    if (!reactions.length || !anchorRef.current) { setPoint(null); return undefined; }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestId, boardRef]);
  if (!reactions.length) return null;
  return (
    <>
      <span ref={anchorRef} className="ab-reaction-anchor-point" aria-hidden="true" />
      {point && createPortal(
        reactions.map((reaction, index) => {
          const item = GAME_REACTIONS.find((candidate) => candidate.key === reaction.emoji);
          if (!item) return null;
          /* A fan, not a stack: the newest sits centre, the two behind it lean out
             and up so all three are readable at once. Fixed positioning means none
             of this touches the page layout, and the newest is the LAST node in
             the portal, so it paints over the older two without a second z-index
             to keep in step with the toast and modal layers. */
          const age = reactions.length - 1 - index;
          const [dx, dy] = REACTION_FAN[age] || REACTION_FAN[REACTION_FAN.length - 1];
          return (
            <div
              key={reaction.id}
              className={`ab-reaction-bubble ab-reaction-${item.key}`}
              style={{ left: point.left + dx, top: point.top + dy }}
              aria-hidden="true"
            >
              <span className="ab-reaction-main">
                <span className="ab-reaction-character">
                  {reducedMotion
                    ? item.label
                    : <KeyedReactionVideo className="ab-reaction-motion" src={item.video} />}
                </span>
                {item.key === 'sad' && <span className="ab-reaction-tears"><i /><i /></span>}
              </span>
              <span className="ab-reaction-particles">
                {REACTION_PARTICLES.map(([x, y, rotation], particleIndex) => (
                  <i key={particleIndex} style={{ '--rx': `${x}px`, '--ry': `${y}px`, '--rr': `${rotation}deg`, animationDelay: `${particleIndex * 18}ms` }}>{item.label}</i>
                ))}
              </span>
            </div>
          );
        }),
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

function useSavedAnalyses(storageKey) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => {
    setLoading(true);
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw == null) {
        /* Import the old device-wide list once for the first signed-in account.
           Keep the legacy key as a backup, while new saves stay user-scoped. */
        const legacy = localStorage.getItem('kpa_analyses');
        const migrationKey = 'kpa_analyses_migrated_to_user';
        const isGuest = storageKey.endsWith(':guest');
        if (legacy != null && !isGuest && !localStorage.getItem(migrationKey)) {
          localStorage.setItem(storageKey, legacy);
          localStorage.setItem(migrationKey, storageKey);
        }
      }
      const rows = JSON.parse(localStorage.getItem(storageKey) || '[]');
      setList((Array.isArray(rows) ? rows : []).sort((a, b) => {
        const ta = Date.parse(a.savedAt || a.at || '') || 0;
        const tb = Date.parse(b.savedAt || b.at || '') || 0;
        return tb - ta;
      }));
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [storageKey]);
  useEffect(() => {
    refresh();
    const onStorage = (event) => { if (event.key === storageKey || event.key === 'kpa_analyses') refresh(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refresh, storageKey]);
  return { list, loading, refresh };
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

  /* Portalled to the body: the overlay is `position: fixed`, and any ancestor
     with a transform would turn that into a board-sized box and trap the
     z-index below Play Mode's overlay. */
  return createPortal(
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
    </div>,
    document.body
  );
}

/* __VITE_STALE_PROBE_9137__ */
