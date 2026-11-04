/* Live online play + notification popups.
 *
 * Run: node --test scripts/live-play-realtime.test.mjs
 *
 * THE BUGS THIS LOCKS OUT
 * ----------------------
 * A1/A2  A match request popped TWICE — once from a top-positioned toast dock in
 *        Toast.jsx and once from the arena's own bar at the bottom — and after
 *        the opponent accepted, the challenger kept showing "Waiting for
 *        opponent" because the only recovery path (a poll) skipped rows whose
 *        status was still `pending`.
 * B3     Moves arrived only through a full `game-update` re-read on a 2.5 s
 *        timer, so the opponent's piece appeared up to 2.5 s after they played.
 * C4     One reaction bubble per side, and its CSS life (2.8 s) outlasted the
 *        JS removal timer, so a rapid second reaction had nowhere to land.
 * D5/D6  Saving anything in Settings gave `user` a new identity, which tore down
 *        the bell's unread effect and re-ran it at once — popping the whole
 *        unread backlog as if it had just arrived.
 * D7     Popups could appear at the top of the screen.
 *
 * These are source contracts, in the same style as the rest of scripts/: cheap,
 * deterministic, and they fail on regression without needing two logged-in
 * devices. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '..');

const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const readBackend = (...parts) => readFileSync(join(repo, 'backend', ...parts), 'utf8');

/* Comments quote the OLD code, so every assertion runs against the executable
   text with block comments removed. */
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const board = code(read('src', 'pages', 'AnalysisBoard.jsx'));
const toast = code(read('src', 'components', 'Toast.jsx'));
const bell = code(read('src', 'components', 'NotificationBell.jsx'));
const arenaBoard = code(read('src', 'components', 'ArenaBoard.jsx'));
const chessBoard = code(read('src', 'components', 'ChessBoard.jsx'));
const animatedBoard = code(read('src', 'components', 'board', 'AnimatedBoard.jsx'));
const socketService = code(read('src', 'services', 'socket.js'));
const css = read('src', 'index.css');
const onlineCtl = code(readBackend('src', 'controllers', 'onlineController.js'));

/* String.match without /g returns only the first hit, which would make every
   "exactly one listener" assertion pass by accident. */
const count = (haystack, re) => (haystack.match(new RegExp(re.source, `${re.flags}g`)) || []).length;

/* ─────────────────────────── A1 + D7: one popup, at the bottom ─────────────────────────── */

test('every popup docks at the bottom — the top dock is gone', () => {
  assert.match(toast, /fixed bottom-4 right-4/, 'the toast stack is bottom-anchored');
  assert.doesNotMatch(toast, /top-4|fixed top/, 'nothing may mount a second, top dock');
  assert.doesNotMatch(toast, /\bplacement\b/,
    'the per-call placement switch is what allowed a second dock — it must not come back');
  /* Mobile widens the SAME bottom stack; it must never re-anchor it. */
  const stackRules = [...css.matchAll(/\.fixed\.bottom-4\.right-4\s*\{[^}]*\}/g)].map((m) => m[0]).join('\n');
  assert.ok(stackRules.length > 0, 'the stack has responsive rules');
  assert.doesNotMatch(stackRules, /top:\s*\d/, 'no rule may move the stack to the top');
});

test('one accept/decline popup per match request, claimed by whichever surface sees it first', () => {
  /* Both surfaces key off the same (gameId, userId) so the second one is silent. */
  assert.match(bell, /dedupeKey:\s*matchRequestKey\(/,
    'the bell popup carries the shared match-request key');
  assert.match(board, /claimToast\(\s*matchRequestKey\(/,
    'the arena claims the same key from its own invite bar');
  assert.match(toast, /const claimToast = useCallback\(/,
    'a non-toast surface must be able to own a dedupe key');
});

test('the bell ignores requests that are no longer pending', () => {
  assert.match(bell, /n\.request_status && n\.request_status !== 'pending'/,
    'an accepted/declined row must never pop again');
});

test('socket listeners are registered once and removed on unmount', () => {
  assert.equal(count(board, /onGameInvite\(/), 1, 'one invite listener');
  assert.equal(count(board, /onGameMove\(/), 1, 'one move listener per mount');
  assert.match(board, /const cleanupMove = onGameMove\(/, 'its unsubscribe is captured');
  assert.match(board, /cleanupMove\(\)/, 'and called in the effect cleanup');
});

/* ───────────────────────── A2: accepting clears "waiting" on both sides ───────────────────────── */

test('a pending row that stops being pending clears the waiting state', () => {
  assert.match(board, /onlineWaitingRef\.current && String\(onlineWaitingRef\.current\.id\)/,
    'applyOnlineRow inspects the held (waiting) marker, not only the mounted board');
  const held = board.match(/if \(onlineWaitingRef\.current[\s\S]{0,320}?\}/)?.[0] || '';
  assert.match(held, /setOnlineWaiting\(null\)/, 'the waiting marker is dropped');
  assert.match(held, /setOnlineSearching\(false\)/, 'and the "searching" state with it');
});

test('a missed accept event falls back to fetching the game status', () => {
  assert.match(board, /const catchUpOnline = useStableCallback\(/,
    'one bounded fetch-the-row helper');
  assert.match(board, /await fetchGame\(gameId\)/, 'it reads the authoritative row');
  /* The row is only trusted for the viewer it belongs to. */
  assert.match(board, /fetched && fetched\.meId === user\?\.id/,
    'a foreign or re-scoped row must not hijack the board');
});

test('the server marks the game active and tells both players', () => {
  const accept = onlineCtl.slice(onlineCtl.indexOf('acceptGame'));
  assert.match(accept.slice(0, 4000), /'active'/, 'accept flips the status');
  assert.match(accept.slice(0, 4000), /emitGameUpdate\(/, 'and pushes the new row');
});

/* ─────────────────────── B3: realtime incremental moves, no polling ─────────────────────── */

test('the move push carries position, ply, clocks and a server timestamp', () => {
  assert.match(onlineCtl, /function emitGameMove\(req, row, move\)/, 'a dedicated move event');
  assert.match(onlineCtl, /\.emit\('game-move', pushed\)/, 'emitted to the game room');
  assert.match(onlineCtl, /row\.admin_id, 'game-move'/, 'and to both players individually');
  assert.match(onlineCtl, /row\.student_id, 'game-move'/, 'and to both players individually');
  for (const key of ['ply', 'moveNumber', 'from', 'to', 'promotion', 'fen', 'whiteMs', 'blackMs', 'serverNow', 'timestamp']) {
    assert.ok(onlineCtl.includes(`${key}:`) || onlineCtl.includes(` ${key},`),
      `the payload must carry ${key}`);
  }
});

test('the move push is emitted before the row is re-read', () => {
  const call = onlineCtl.indexOf('emitGameMove(req, row, {');
  const reread = onlineCtl.indexOf('await getGameRow', call);
  assert.ok(call > -1, 'the move handler calls emitGameMove');
  assert.ok(reread > -1, 'the move handler then re-reads the row');
  assert.ok(call < reread,
    'the push must not wait on a DB roundtrip — that delay is the opponent\'s piece');
});

test('the client applies moves incrementally and ignores plies it already has', () => {
  assert.match(board, /if \(p\.ply <= played \|\| p\.ply <= appliedRef\.current\.ply\) return/,
    'already-applied and out-of-order-low moves are dropped, so no piece replays');
  assert.match(board, /if \(p\.ply !== played \+ 1\) \{/,
    'a gap does not guess — it fetches the truth');
  assert.match(board, /catchUpOnline\(p\.gameId\)/, 'via the catch-up fetch');
  assert.match(board, /if \(!mv \|\| g\.fen\(\) !== p\.fen\) return/,
    'a FEN mismatch means the push was wrong; the row behind it is authoritative');
});

test('there is no unconditional game poll any more', () => {
  assert.doesNotMatch(board, /setInterval\([\s\S]{0,400}?, 2500\)/,
    'the 2.5 s position poll is the thing that made moves feel dropped');
  /* Only two timers remain, and both are conditional and bounded. */
  assert.match(board, /const awaitingAccept = !boardId \|\| onlineGame\?\.status === 'pending'/,
    'the accept fallback runs only while a request is outstanding');
  assert.match(board, /Date\.now\(\) - lastHeard < 45000\) return/,
    'the move fallback stays quiet while pushes are arriving');
});

test('disconnects are detected and surfaced, then the room is re-joined', () => {
  for (const fn of ['onSocketConnect', 'onSocketDisconnect', 'isSocketConnected']) {
    assert.match(socketService, new RegExp(`export function ${fn}|export const ${fn}`),
      `socket.js must expose ${fn}`);
  }
  assert.match(board, /const \[serverLinked, setServerLinked\] = useState\(true\)/, 'link state');
  assert.match(board, /Reconnecting/, 'a small indicator, not a modal');
  assert.match(board, /joinGameRoom\(id\)/, 'a reconnect is a NEW socket id — the room must be re-joined');
  assert.match(board, /document\.addEventListener\('visibilitychange'/,
    'a backgrounded tab catches up when it is shown again');
});

test('the board is memoised, the clock ticks on its own, and analysis is off in a live game', () => {
  assert.match(arenaBoard, /export default memo\(ArenaBoard/, 'the board is wrapped in React.memo');
  assert.match(arenaBoard, /\.fen\(\) !== next\.game\.fen\(\)/,
    'and compares the shared mutable instance by FEN, not by identity');
  assert.match(board, /setInterval\(\(\) => setBeat\(/, 'the clock beat lives in the clock component');
  assert.match(board, /if \(engineOn && !\(inOnline\)\) refreshEngine\(\)/,
    'live analysis never searches during an online match');
});

test('a piece in a live match glides at most 200ms, whatever the saved preference says', () => {
  assert.match(board, /const ONLINE_MOVE_MS = 200/, 'the ceiling');
  assert.equal(count(board, /maxMoveMs=\{inOnline \? ONLINE_MOVE_MS : undefined\}/), 2,
    'applied at both board surfaces (page and Play Mode)');
  assert.match(chessBoard, /maxMoveMs/, 'ChessBoard forwards it');
  assert.match(animatedBoard, /Math\.min\(preset\.duration, maxMoveMs\)/, 'and the board clamps it');
  assert.match(animatedBoard, /buildPieces\(parsed\.map\)/,
    'a jump of more than one ply skips the animation and paints the final position');
});

test('clocks are server-timed and change side the moment the push lands', () => {
  assert.match(onlineCtl, /clock: \{/, 'the move event carries both clocks');
  assert.match(board, /serverNow: p\.serverNow \|\| Date\.now\(\)/,
    'the client re-bases on the server clock, not its own');
  assert.match(board, /setOnlineTurn\(g\.turn\(\) === 'w' \? 'white' : 'black'\)/,
    'the turn flips with the move');
});

/* ───────────────────────────── C4: emoji reactions ───────────────────────────── */

test('reactions are capped at three live bubbles with a one second cooldown', () => {
  assert.match(board, /list\.length > 3 \? list\.slice\(list\.length - 3\)/, 'max three');
  assert.match(board, /const REACTION_COOLDOWN_MS = 1000/, '1s between sends');
  assert.match(board, /const REACTION_LIFE_MS = 1800/, 'and each bubble lives inside the 1.5–2s window');
  assert.match(board, /reactionItemTimers/, 'each bubble owns its own dismiss timer');
  assert.match(board, /const REACTION_FAN = \[\[0, 0\], \[-46, 20\], \[46, 20\]\]/,
    'the three land fanned out, not stacked on one point');
});

test('the reaction animation is CSS-only and cannot shift the layout', () => {
  const bubble = css.match(/\.ab-reaction-bubble \{[^}]*\}/)?.[0] || '';
  assert.match(bubble, /position: fixed/, 'fixed, so a bubble never reflows the board');
  assert.match(bubble, /pointer-events: none/, 'and never eats a tap');
  assert.match(css, /animation: ab-reaction-life 1\.8s/, 'float-and-fade inside 1.8s');
  assert.match(css, /animation: ab-reaction-reduced-fade 1\.8s/,
    'the reduced-motion variant ends on the same frame the node is removed');

  /* Every per-emoji loop must FINISH before the node is pulled at 1.8 s; a loop
     that overruns is cut mid-cycle, which reads as the emoji snapping. */
  const loops = [...css.matchAll(/animation: (ab-reaction-(?!life)[a-z-]+)([^;]*);/g)];
  assert.ok(loops.length >= 6, `expected the per-emoji loops, found ${loops.length}`);
  for (const [, name, rest] of loops) {
    const tokens = rest.trim().split(/\s+/).filter(Boolean);
    const dur = parseFloat(tokens.find((t) => /^\d*\.?\d+s$/.test(t)) || '0');
    const after = tokens.slice(tokens.indexOf(tokens.find((t) => /^\d*\.?\d+s$/.test(t))) + 1);
    const delay = parseFloat(after.find((t) => /^\d*\.?\d+s$/.test(t)) || '0');
    const times = parseInt(after.find((t) => /^\d+$/.test(t)) || '1', 10);
    const endAt = +(dur * times + delay).toFixed(3);
    assert.ok(endAt <= 1.8, `${name} ends at ${endAt}s — past the 1.8s bubble life`);
  }
  /* The second tear is offset by an animation-delay on its own rule. */
  const tearDelay = parseFloat(css.match(/\.ab-reaction-tears i:nth-child\(2\) \{ animation-delay: (\d*\.?\d+)s/)?.[1] ?? '0');
  assert.ok(tearDelay + 0.65 * 2 <= 1.8, 'the trailing tear must land before the bubble goes');
});

/* ─────────────────────────── D5 + D6: no popups you did not earn ─────────────────────────── */

test('a Settings save cannot re-trigger the unread effect', () => {
  assert.match(bell, /const toastNewRef = useRef\(toastNew\)/, 'the popup helper is reached through a ref');
  assert.match(bell, /const syncFeedRef = useRef\(syncFeed\)/, 'and so is the feed sync');
  const unreadEffect = bell.match(/useEffect\(\(\) => \{[\s\S]{0,1200}?setInterval\(tick, 30000\)[\s\S]{0,200}?\}, \[\]\);/)?.[0] || '';
  assert.ok(unreadEffect.length > 0, 'the unread effect must mount exactly once (empty deps)');
  assert.match(bell, /return onNotification\(\(\) => \{ syncFeedRef\.current\(\); \}\);/,
    'the socket subscription must not re-register when the user object changes');
  assert.match(bell, /\}, \[user\?\.id\]\);/, 'it keys on the id instead');
});

test('pre-existing unread rows never pop after a login', () => {
  assert.match(bell, /const notificationBaselines = new Map\(\)/,
    'a per-user baseline survives a remount / route change');
  assert.match(bell, /createdAtMs\(n\) > baseline/,
    'only rows created after the claimed baseline may pop');
  assert.match(bell, /notificationBaselines\.set\(key, newest\)/, 'the baseline advances with the feed');
});

test('live-game move review uses a replay board and preserves the authoritative game', () => {
  assert.match(board, /const liveReviewGameRef = useRef\(null\)/, 'the historical position has its own engine instance');
  const navigation = board.slice(board.indexOf('function goToMove('), board.indexOf('const handleNavMove'));
  assert.match(navigation, /if \(onlineGame \|\| computerOn\)/, 'live game navigation takes the read-only path');
  const livePath = navigation.slice(navigation.indexOf('if (onlineGame || computerOn)'), navigation.indexOf('gameRef.current = g;'));
  assert.doesNotMatch(livePath, /gameRef\.current\s*=/, 'reviewing a ply never replaces the real game');
  assert.match(board, /const reviewingLive = sameGame && moveIndex < moves\.length/, 'full PGN updates retain the selected historical ply');
  assert.match(board, /if \(\(inOnline \|\| computerOn\) && moveIndex < moves\.length\)/, 'incremental opponent moves retain the review board');
  assert.match(board, /game=\{boardGame\}/, 'the board renders the review instance while a ply is selected');
  assert.match(board, /reviewMode \|\| liveReviewing \? false/, 'review positions cannot accept piece moves');
  assert.match(board, /Reviewing move \{moveIndex\} \/ \{total\}/, 'the selected ply is identified');
  assert.match(board, /Return to Live/, 'the latest actual position can be restored');
  assert.match(board, /className=\{`ab-mv\$\{current \? ' is-current'/, 'the selected move receives a highlight');
});

test('an unanswered online game keeps the board visible without the blocking wait animation', () => {
  assert.doesNotMatch(board, /WaitingOverlay|ab-waiting/, 'the board is never covered by the waiting spinner or message');
  assert.match(board, /const boardLive = boardInteractive && !waitingForOpponent/,
    'the board is still read-only until the opponent joins');
  assert.match(board, /onlineBanner && \(/, 'the match status remains visible above the board');
});
