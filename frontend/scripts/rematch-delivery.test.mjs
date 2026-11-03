import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Getting a rematch request to the other player in the DEPLOYED app.
 *
 * The click worked on localhost and did nothing in production. Three separate
 * contracts made that possible, and each one is pinned here:
 *
 *   REACH    the API and the socket of a deployed backend must accept the
 *            deployed frontend's origin. A list that names an old deployment is
 *            a browser-blocked request, and a blocked fallback is invisible when
 *            the WebSocket itself is already open.
 *
 *   DELIVERY the request has to arrive wherever the opponent is standing, not
 *            only on the Play Arena, and a missed push has to be recoverable from
 *            the server — so the socket names on both ends must match exactly.
 *
 *   SIGNAL   a request that never left the device must say so.
 */

const require = createRequire(import.meta.url);
const root = path.resolve(process.cwd());
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const cors = read('../backend/src/config/cors.js');
const app = read('../backend/src/app.js');
const server = read('../backend/server.js');
const controller = read('../backend/src/controllers/onlineController.js');
const routes = read('../backend/src/routes/onlineRoutes.js');

const gate = read('src/components/RematchInviteGate.jsx');
const board = read('src/pages/AnalysisBoard.jsx');
const shell = read('src/App.jsx');
const socketLib = read('src/services/socket.js');
const online = read('src/utils/online.js');

/* ─── reach: one allow-list, used by both HTTP and the socket ─────────────── */

const { isAllowed, configuredOrigins } = require('../../backend/src/config/cors.js');

test('the live deployment and its previews are allowed, by rule not by memory', () => {
  assert.equal(isAllowed('https://mate-zone-chess-academy-chess-app4.vercel.app'), true);
  assert.equal(isAllowed('https://mate-zone-chess-academy-9fp3k2-chess-app4.vercel.app'), true,
    'every Vercel preview gets its own host; a popup that only works on prod is a popup nobody tests');
  assert.equal(isAllowed('http://localhost:5173'), true);
  assert.equal(isAllowed('http://127.0.0.1:5173'), true);
});

test('a request with no Origin header is not refused', () => {
  /* curl, the Railway healthcheck and same-origin server-to-server calls send
     none. Refusing them would take the API down for everything but a browser. */
  assert.equal(isAllowed(undefined), true);
  assert.equal(isAllowed(''), true);
});

test('an unrelated origin is refused, whatever it claims', () => {
  for (const origin of [
    'https://evil.example.com',
    'https://mate-zone-chess-academy-chess-app4.vercel.app.evil.example.com',
    'http://mate-zone-chess-academy-chess-app4.vercel.app',
  ]) {
    assert.equal(isAllowed(origin), false, `${origin} was let through`);
  }
});

test('CLIENT_URL still adds an origin, so a new deployment needs no code change', () => {
  const previous = process.env.CLIENT_URL;
  process.env.CLIENT_URL = 'https://chess.school, https://other.church';
  try {
    assert.deepEqual(configuredOrigins(), ['https://chess.school', 'https://other.church']);
    assert.equal(isAllowed('https://chess.school'), true);
  } finally {
    if (previous === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = previous;
  }
});

test('the predicate is shared, so REST and the socket can never drift apart', () => {
  assert.match(cors, /module\.exports = \{ corsOrigin, isAllowed, configuredOrigins \}/);
  assert.match(app, /require\('\.\/config\/cors'\)/);
  assert.match(app, /app\.use\(cors\(\{ origin: corsOrigin, credentials: true \}\)\)/);
  assert.match(server, /require\('\.\/src\/config\/cors'\)/);
  assert.match(server, /origin: corsOrigin/, 'the Socket.IO server still has its own allow-list');
  /* The bug this replaced: a hand-kept list naming a deployment that no longer
     exists, while the live one was blocked. */
  assert.doesNotMatch(app, /clientOrigins/);
  assert.doesNotMatch(server, /CLIENT_URL.*split|localhost:5173/, 'server.js keeps a second copy of the list');
});

/* ─── reach: the deployed socket ─────────────────────────────────────────── */

test('the client socket targets the deployed backend, websocket first with polling under it', () => {
  assert.match(socketLib, /import\.meta\.env\.VITE_SOCKET_URL \|\| window\.location\.origin/);
  assert.doesNotMatch(socketLib, /http:\/\/localhost/, 'a hardcoded dev host in the socket client');
  assert.match(socketLib, /transports: \['websocket', 'polling'\]/);
  assert.match(socketLib, /tryAllTransports: true/,
    'without this a socket whose WebSocket dies never falls back to polling');
  assert.match(socketLib, /path: '\/socket\.io'/);
});

/* ─── delivery: the server holds the request, so it can be re-read ───────── */

test('a pending request can be read back from the server', () => {
  assert.match(online, /export async function fetchPendingRematches\(\)/);
  assert.match(online, /api\.get\('\/online\/rematch-pending', \{ cache: false \}\)/,
    'a cached answer is a request that arrived and was thrown away');
  assert.match(routes, /router\.get\('\/rematch-pending', roleMiddleware\('admin', 'student'\), ctrl\.listPendingRematches\)/);
});

test('the read returns only requests this player can actually answer', () => {
  const fn = controller.slice(
    controller.indexOf('exports.listPendingRematches'),
    controller.indexOf('exports.requestRematch'),
  );
  assert.ok(fn.length > 100, 'listPendingRematches is missing from the controller');
  assert.match(fn, /g\.rematch_requested_by IS NOT NULL/);
  /* Not mine — an answer to my own request is not something I am being asked. */
  assert.match(fn, /g\.rematch_requested_by <> \$1/);
  /* Mine to answer — one of my two seats. */
  assert.match(fn, /\(g\.admin_id = \$1 OR g\.student_id = \$1\)/);
  assert.match(fn, /g\.status = 'finished'/);
  assert.match(fn, /g\.result IS NULL OR g\.result <> 'aborted'/);
  assert.match(fn, /g\.is_bot IS NOT TRUE/);
  assert.match(fn, /g\.class_id IS NULL/);
  /* Inside the window the answering endpoint still honours, so nothing here can
     be tapped into a game the other side already gave up on. */
  assert.match(fn, /g\.rematch_requested_at > \$2/);
  assert.match(fn, /REMATCH_WINDOW_MS \+ REMATCH_GRACE_MS/);
  assert.match(fn, /payload\(row, req\.user\.role, req\.user\.id\)/,
    'a neutral payload shows one player the other side\u2019s colour');
});

/* ─── delivery: the opponent is told, wherever they are ──────────────────── */

test('the gate is mounted in the app shell, so every route is covered', () => {
  assert.match(shell, /import RematchInviteGate from '\.\/components\/RematchInviteGate'/);
  assert.match(shell, /<RematchInviteGate \/>/);
  /* Beside the accept navigator, which it mirrors: shell-mounted, once per game. */
  assert.ok(shell.indexOf('<MatchAcceptNavigator />') < shell.indexOf('<RematchInviteGate />'));
});

test('the event names the gate listens for are the names the server emits', () => {
  const listened = [...gate.matchAll(/\bon\('([a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(listened.length >= 5, `expected the whole rematch protocol, heard ${listened.join(', ')}`);
  const emitted = new Set([
    ...controller.matchAll(/emitToUser\(io, [^,]+, '([a-z-]+)'/g),
    /* `dropPendingRematchesFor` emits the event named by its argument — a
       withdrawal the server makes for itself when a player moves on. */
    ...controller.matchAll(/event = '([a-z-]+)'/g),
  ].map((m) => m[1]));
  for (const event of listened) {
    assert.ok(emitted.has(event), `the gate listens for ${event}, which nothing sends`);
  }
  for (const event of ['rematch-request', 'rematch-started', 'rematch-declined', 'rematch-cancelled', 'rematch-expired']) {
    assert.ok(listened.includes(event), `the gate ignores ${event}`);
  }
});

test('the invite card answers with the same endpoints the arena uses', () => {
  assert.match(gate, /const row = await respondRematch\(current\.gameId, accept\)/);
  assert.match(online, /api\.post\(`\/online\/games\/\$\{id\}\/rematch-respond`/);
  /* Accepting opens the board; declining only tells the other player. */
  assert.match(gate, /if \(accept\) \{\n\s+openNewGame\(row\)/);
  assert.match(gate, /navigate\(`\$\{boardBase\(\)\}\/analysis\?game=\$\{encodeURIComponent\(key\)\}`\)/);
  assert.match(gate, /window\.dispatchEvent\(new CustomEvent\('chess-close-panels'\)\)/);
  /* One navigation per new game, whichever of the two channels got there first. */
  assert.match(gate, /openedRef\.current\.has\(key\)/);
  assert.match(gate, /if \(Number\(row\.meId\) !== Number\(userRef\.current\?\.id\)\) return/);
});

test('the arena keeps its own card, and the gate stands down while it is open', () => {
  assert.match(gate, /const onArena = \/\\\/analysis\$\/\.test\(location\.pathname\)/);
  assert.match(gate, /if \(!invite \|\| onArena\) return null/);
  assert.match(gate, /if \(onArenaRoute\(\)\) return;/);
  /* The arena never stops being the place a game is entered in place. */
  assert.match(board, /onSocketEvent\('rematch-request', \(p\) => handleRematchInvite\(p\)\)/);
  assert.match(board, /onSocketEvent\('rematch-started', \(p\) => handleRematchStarted\(p\)\)/);
});

test('a missed push is recovered from the server, not from memory', () => {
  assert.match(gate, /const live = games\.find\(\(g\) => g\?\.rematchRequest && !g\.rematchRequest\.mine\)/);
  /* Mount, every poll, every reconnect, and every return to the foreground. */
  assert.match(gate, /const poll = window\.setInterval\(sync, POLL_MS\)/);
  assert.match(gate, /onSocketConnect\(\(\) => \{ sync\(\); \}\)/);
  assert.match(gate, /document\.addEventListener\('visibilitychange', onVisible\)/);
  assert.match(gate, /sync\(\);/);
  /* And the card comes back down when the request no longer exists anywhere. */
  assert.match(gate, /if \(inviteRef\.current\) closeInvite\(\)/);
  /* The request must not outlive its window on a screen nobody is watching. */
  assert.match(gate, /const left = REMATCH_WINDOW_MS - Math\.max\(0, Date\.now\(\) - \(Number\(at\) \|\| Date\.now\(\)\)\)/);
});

test('both ends agree on how long a request is worth waiting for', () => {
  const serverMs = /const REMATCH_WINDOW_MS = (\d+)/.exec(controller);
  assert.ok(serverMs, 'the server window is missing');
  for (const [file, src] of [['the gate', gate], ['the arena', board]]) {
    const clientMs = /const REMATCH_WINDOW_MS = (\d+)/.exec(src);
    assert.ok(clientMs, `${file} has no rematch window`);
    assert.equal(clientMs[1], serverMs[1], `${file} counts down a different window than the server enforces`);
  }
});

/* ─── signal: a failure says so ──────────────────────────────────────────── */

test('a request that never left the device is reported, not swallowed', () => {
  const ask = board.slice(
    board.indexOf('async function askRematchOnline()'),
    board.indexOf('/* Withdraw my own request'),
  );
  assert.match(ask, /setOnlineError\(why\)/);
  assert.match(ask, /showToast\(why, \{\n\s+tone: 'danger'/, 'a failed send must be a visible error');
  assert.match(ask, /source: 'AnalysisBoard:rematch_send_failed'/);

  const answer = gate.slice(gate.indexOf('async function answer(accept)'));
  assert.match(answer, /showToast\(e\.response\?\.data\?\.message \|\| 'Could not answer the rematch request\.'/);
  assert.match(answer, /tone: 'danger'/);
  /* A background poll is not a player action: silence there is correct, and a
     toast once per poll would bury the message that matters. */
  assert.match(gate, /catch \{\n\s+\/\* A background read/);
});
