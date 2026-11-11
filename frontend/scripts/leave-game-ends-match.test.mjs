/* Leaving a game ends it. There is no "Leave the game? Your game is still in
 * progress." confirmation anywhere in the app.
 *
 * Regression guard for four exits that must all end the match on the server:
 *
 *   Play Arena (AnalysisBoard)   navigating away  -> POST /online/games/:id/leave
 *   vs Computer (BotGamePage)    navigating away  -> useBotGame.abandon()
 *   Live Classroom PvP board     closing the card -> leave that game
 *   Live Classroom (any tab)     leaving the room -> POST /online/leave-active
 *
 * The result is decided server-side (aborted before a move, resignation after),
 * so the client only ever asks to leave — it never picks the outcome.
 *
 * Run: node --test scripts/leave-game-ends-match.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const ARENA = read('src/pages/AnalysisBoard.jsx');
const BOT = read('src/pages/BotGamePage.jsx');
const BOT_HOOK = read('src/hooks/useBotGame.js');
const PVP = read('src/components/liveclass/PvPPlayBoard.jsx');
const CLASSROOM = read('src/pages/LiveClassroom.jsx');
const ONLINE = read('src/utils/online.js');
const HISTORY = read('src/pages/GameHistory.jsx');

const srcFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.jsx?$/.test(entry.name)) srcFiles.push(full);
  }
}(path.join(ROOT, 'src')));

/* ── the dialog is gone ───────────────────────────────────────────────────── */

test('the confirmation card, its hook and its every caller are deleted', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'src/hooks/useLeaveGameGuard.js')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'src/components/LeaveGameConfirmDialog.jsx')), false);

  for (const file of srcFiles) {
    const body = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(body, /useLeaveGameGuard|LeaveGameConfirmDialog/, `${file} still references the removed dialog`);
  }
});

test('nothing in the app still asks whether the game is in progress', () => {
  for (const file of srcFiles) {
    const body = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(body, /Your game is still in progress|Leave the game\?/i,
      `${file} still shows the old prompt`);
  }
});

/* ── Play Arena ───────────────────────────────────────────────────────────── */

test('Play Arena asks the server to leave the match it had open when it unmounts', () => {
  assert.match(ONLINE, /export async function leaveGame\(id\) \{\s*return \(await api\.post\(`\/online\/games\/\$\{id\}\/leave`/);
  const effect = ARENA.slice(ARENA.indexOf('const leaveGameTimer = useRef(null);'));
  assert.match(effect.slice(0, 900), /leaveGame\(active\.id\)/);
  /* A remount (StrictMode) cancels the pending request before it is sent. */
  assert.match(effect.slice(0, 900), /window\.clearTimeout\(leaveGameTimer\.current\)/);
  assert.match(ARENA, /^import \{[^}]*leaveGame[^}]*\} from '\.\.\/utils\/online';$/m);
});

/* ── vs Computer ──────────────────────────────────────────────────────────── */

test('leaving a computer game resigns it once a move exists', () => {
  const abandon = BOT_HOOK.slice(BOT_HOOK.indexOf('const abandon = useCallback'));
  assert.match(abandon.slice(0, 400), /moveCountRef\.current === 0\) return;/,
    'an untouched board has no game worth saving');
  assert.match(abandon.slice(0, 400), /finish\('resignation'\)/);
  assert.match(BOT_HOOK, /^\s*abandon,$/m, 'the page has to be able to call it');

  const effect = BOT.slice(BOT.indexOf('const abandonRef = useRef(game.abandon);'));
  assert.match(effect.slice(0, 700), /abandonRef\.current\(\)/);
  assert.match(effect.slice(0, 700), /window\.clearTimeout\(abandonTimerRef\.current\)/);
});

/* ── Live Classroom ───────────────────────────────────────────────────────── */

test('closing a classroom board ends that game', () => {
  const hide = PVP.slice(PVP.indexOf('const handleHide = useCallback('));
  assert.match(hide.slice(0, 400), /leaveGame\(game\.id\)/);
  assert.doesNotMatch(PVP, /window\.confirm/);
  assert.doesNotMatch(PVP, /Close — the game keeps running/,
    'the close button cannot promise a game that no longer survives it');
});

test('a route away from the classroom board ends it, a tab switch does not', () => {
  const effect = PVP.slice(PVP.indexOf('const liveGameIdRef = useRef(null);'));
  assert.match(effect.slice(0, 700), /window\.location\.pathname === classPath/);
  assert.match(effect.slice(0, 900), /leaveGame\(id\)/);
});

test('leaving the classroom settles the boards it hosted, and only those', () => {
  assert.match(ONLINE, /export async function leaveActiveGames\(classId\) \{\s*return \(await api\.post\('\/online\/leave-active', \{ classId \}/);
  const goHome = CLASSROOM.slice(CLASSROOM.indexOf('const goHome = () => {'));
  assert.match(goHome.slice(0, 400), /leaveActiveGames\(classMeta\.id\)/);
  /* The route-away net: a back press skips goHome and may never have mounted
     the board, so the page's own unmount asks for the same settle. */
  const net = CLASSROOM.slice(CLASSROOM.indexOf('const classLeaveTimer = useRef(null);'));
  assert.match(net.slice(0, 700), /leaveActiveGames\(id\)/);
  assert.match(net.slice(0, 500), /window\.clearTimeout\(classLeaveTimer\.current\)/);
});

/* ── lists catch up on their own ──────────────────────────────────────────── */

test('game history and the live list refresh when a match ends', () => {
  assert.match(HISTORY, /^import \{ onGameUpdate, onLiveGamesChanged \} from '\.\.\/services\/socket';$/m);
  assert.match(HISTORY, /onGameUpdate\(/);
  assert.match(HISTORY, /onLiveGamesChanged\(/);
  assert.match(HISTORY, /row\.status !== 'active'/);
});
