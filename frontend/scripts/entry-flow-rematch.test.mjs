import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * App entry flow + the Play Arena rematch.
 *
 * Two contracts, both born from a concrete failure:
 *
 *   ENTRY     "/" is the front door. A visitor sees the intro and the landing
 *             page; a session never stands on the front step; and signing in
 *             gives you back the page the guard bounced you off.
 *
 *   REMATCH   Accepting a rematch must leave the match it replaces behind for
 *             good. The old row reaching the board again — through a stale
 *             ?game= link, a reload, or a late socket push — is the bug.
 */

const root = path.resolve(process.cwd());
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const app = read('src/App.jsx');
const login = read('src/pages/Login.jsx');
const protectedRoute = read('src/components/ProtectedRoute.jsx');
const board = read('src/pages/AnalysisBoard.jsx');
const controller = read('../backend/src/controllers/onlineController.js');
const manifest = read('public/manifest.webmanifest');
const popup = read('src/components/PostGameResultPopup.jsx');

/* ─── entry flow ─────────────────────────────────────────────────────────── */

test('the root route is the landing page for a visitor, never the login page', () => {
  const route = /<Route path="\/" element=\{<([A-Za-z]+) \/>\} \/>/.exec(app);
  assert.ok(route, 'the "/" route is missing');
  assert.notEqual(route[1], 'Login', '"/" must not render the login page');

  const gateStart = app.indexOf('function LandingRoute()');
  assert.ok(gateStart >= 0, 'LandingRoute is missing from App.jsx');
  const gate = app.slice(gateStart, app.indexOf('\n}', gateStart));
  assert.match(gate, /<Navigate to=\{homeForRole\(user\.role\)\} replace \/>/);
  assert.match(gate, /return <Home \/>/);
  assert.match(gate, /if \(loading\) return <Spinner \/>/);
  /* The gate has to be the element the route renders, not a helper nobody calls. */
  assert.ok(app.includes('<Route path="/" element={<LandingRoute />} />'));
});

test('the PWA entry point is the app root, not a sign-in page', () => {
  const m = JSON.parse(manifest);
  assert.equal(m.start_url, '/');
  assert.equal(m.id, '/');
});

test('login is reached by a link on the landing page or by the guard, nothing else', () => {
  /* No blanket redirect: the only route to /login is a link/button, plus the
     guard's bounce for a visitor with no session. The one allowance is the
     self-registration road, which is invite-only and redirects to /login. */
  const forced = [...app.matchAll(/<Navigate to="\/login"[^>]*\/>/g)]
    .map((m) => m[0])
    .filter((jump) => !app.slice(Math.max(0, app.indexOf(jump) - 120), app.indexOf(jump)).includes('path="/register"'));
  assert.deepEqual(forced, [], 'App.jsx force-opens the login page');
  assert.doesNotMatch(app, /navigate\(['"]\/login['"]\)/);
  const home = read('src/pages/Home.jsx');
  assert.match(home, /<Button to="\/login"/, 'the landing page must offer Login');
  assert.match(login, /if \(!authLoading && user\) navigate\(homeForRole\(user\.role\), \{ replace: true \}\)/);
});

test('every portal route keeps its guard', () => {
  const routes = [...app.matchAll(/<Route path="(\/[^"]*)" element=\{([^}]*)\} \/>/g)];
  assert.ok(routes.length > 70, `expected the whole route table, found ${routes.length}`);
  const unguarded = routes.filter(([, p, el]) => {
    const isPortal = p.startsWith('/student') || p.startsWith('/admin') || p.startsWith('/super')
      || p.startsWith('/live-class') || p.startsWith('/classroom') || p.startsWith('/students/')
      || p.startsWith('/change-password') || p.startsWith('/quizzes');
    return isPortal && !el.includes('ProtectedRoute');
  }).map(([, p]) => p);
  assert.deepEqual(unguarded, [], 'portal routes without a route guard');
});

test('a bounced visitor is sent to login and gets their page back after signing in', () => {
  assert.match(protectedRoute, /<Navigate to="\/login" replace state=\{\{ from: location \}\} \/>/);
  /* The return trip has to read that state, or the whole `from` is decoration. */
  assert.match(login, /useLocation/, 'Login never reads the parked location');
  assert.match(login, /destinationFrom\(location\.state\)/);
  const helperStart = login.indexOf('function destinationFrom(');
  assert.ok(helperStart >= 0, 'destinationFrom is missing');
  const helper = login.slice(helperStart, login.indexOf('\n}', helperStart));
  assert.match(helper, /state\?\.from\?\.pathname/);
  assert.match(helper, /path\.startsWith\('\/'\)/, 'must accept only an absolute in-app path');
  assert.match(helper, /\|\| path\.startsWith\('\/\/'\)/, 'must refuse a protocol-relative host');
  assert.match(helper, /SIGN_IN_PAGES\.has\(path\)/, 'must refuse to land back on a sign-in page');
  /* The destination itself must not be able to carry an off-app URL. */
  assert.doesNotMatch(helper, /state\.from\.href|from\.origin|from\.host/);
});

test('logout clears the session and lands on the landing page', () => {
  const auth = read('src/context/AuthContext.jsx');
  const clearStart = auth.indexOf('const clearSession = useCallback');
  const clear = auth.slice(clearStart, auth.indexOf('}, []', clearStart));
  for (const key of ["localStorage.removeItem('token')", "localStorage.removeItem('user')", "localStorage.removeItem('refresh_token')"]) {
    assert.ok(clear.includes(key), `clearSession leaves ${key} behind`);
  }
  const sites = ['src/components/ProfileMenu.jsx', 'src/pages/Profile.jsx', 'src/pages/AdminProfile.jsx']
    .map((f) => [f, read(f)]);
  for (const [file, src] of sites) {
    const call = src.slice(src.indexOf('logout();'), src.indexOf('logout();') + 120);
    assert.ok(call.includes("navigate('/')"), `${file}: logout does not return to the landing page`);
    assert.ok(!call.includes("navigate('/login')"), `${file}: logout must not open the login page`);
  }
});

/* ─── rematch: the previous match must not come back ──────────────────────── */

/** The body of `fn`, from its declaration to the line that closes it. */
function body(source, declaration) {
  const start = source.indexOf(declaration);
  assert.ok(start >= 0, `${declaration} is missing`);
  const lines = source.slice(start).split('\n');
  let depth = 0;
  const out = [];
  for (const line of lines) {
    out.push(line);
    depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    if (out.length > 1 && depth === 0) break;
  }
  return out.join('\n');
}

test('entering the new game retires the match it replaces', () => {
  const fn = body(board, 'const enterRematchGame = useStableCallback');
  /* Read the old id BEFORE clearOnline() nulls the refs it hangs off. */
  assert.match(fn, /const replacedId = onlineGameRef\.current\?\.id \?\? activeGameIdRef\.current;/);
  assert.ok(fn.indexOf('const replacedId') < fn.indexOf('clearOnline(true)'),
    'the retired id is read after the board was cleared — it would always be null');
  assert.match(fn, /ignoredGameIdsRef\.current\.add\(String\(replacedId\)\)/);
  assert.match(fn, /markCurrentResultSeen\(replacedId\)/);

  /* The durable half: the ref dies with the page, so the stale link must go too. */
  assert.match(fn, /if \(location\.search\) navigate\(location\.pathname, \{ replace: true \}\)/);

  /* Spec: draw/resign offers and the old popups die with the old game. */
  for (const line of ['setDrawOffer(null)', 'setPendingConfirm(null)', 'setActivePopup(null)',
    'setResultPopup(null)', 'setReviewMode(false)', 'setClockOver(null)']) {
    assert.ok(fn.includes(line), `enterRematchGame leaves ${line} behind`);
  }
  assert.match(fn, /stopRematchTimers\(\)/);
  assert.match(fn, /applyOnline\(row\)/, 'the new row never reaches the board');
});

test('the mount loader obeys the ignore list it is handed', () => {
  /* enterRematchGame only retires the old match if every inbound path checks the
     same set — the ?game= loader included. */
  const loaderStart = board.indexOf("const gameId = new URLSearchParams(location.search).get('game')");
  const loader = board.slice(loaderStart, loaderStart + 1200);
  assert.match(loader, /ignoredGameIdsRef\.current\.has\(String\(mine\.id\)\)/);
  assert.match(loader, /applyOnlineRow\(mine\)/);
});

test('the review panel cannot restart a finished online match as a practice board', () => {
  const fn = body(board, 'function rematch()');
  assert.match(fn, /if \(onlineRematchTarget\(onlineGame\)\) \{ askRematchOnline\(\); return; \}/);
  assert.match(fn, /if \(computerOn \|\| clockOver\) rematchComputer\(\)/);
  /* The old shape: reset the board under an attached opponent row, then watch
     that row's next push redraw the game that just ended. */
  assert.doesNotMatch(fn, /startNewGame\(\)/);
  assert.doesNotMatch(fn, /startComputerGame\(computerColor\)/);

  const wiring = /canRematch=\{([^}]*)\}/.exec(board);
  assert.ok(wiring, 'the review panel wiring is missing');
  assert.doesNotMatch(wiring[1], /!inOnline/, 'a finished online match still gets the wrong handler');
  assert.match(wiring[1], /onlineRematchTarget\(onlineGame\)/);
  assert.match(wiring[1], /computerOn/);
});

test('a rematch button exists in the two modes only, and cannot be double-tapped', () => {
  const actionsStart = board.indexOf('const secondary = [];');
  const actionsEnd = board.indexOf("secondary.push({ label: 'New game'", actionsStart);
  const actions = board.slice(actionsStart, actionsEnd);
  assert.match(actions, /if \(onlineRematchTarget\(onlineGame\) && moves\.length > 0\) \{/);
  assert.match(actions, /onClick: askRematchOnline/);
  assert.match(actions, /else if \(vsComputer && !onlineGame && moves\.length > 0\) \{/);
  assert.match(actions, /onClick: rematchComputer/);
  assert.equal((actions.match(/label: 'Rematch'/g) || []).length, 2, 'expected exactly two Rematch buttons');

  const ask = body(board, 'async function askRematchOnline()');
  assert.match(ask, /if \(!game \|\| rematchBusy\) return/);
  assert.match(ask, /const game = onlineRematchTarget\(onlineGame\)/);
  /* While a request is live the result card is put aside, so its one-tap lock
     cannot be re-armed by tapping the same button twice. */
  assert.match(board, /const rematchLive = Boolean\(rematchAsk \|\| rematchInvite\)/);
  assert.match(board, /open=\{!resultDismiss && !resultRevealPending && !rematchLive\}/);
  assert.match(popup, /const \[pending, setPending\] = useState\(null\)/);
});

test('versus the computer needs no consent and flips the colour', () => {
  const fn = body(board, 'function rematchComputer()');
  assert.match(fn, /computerColorChoice === 'random'/);
  assert.match(fn, /computerColor === 'white' \? 'black' : 'white'/);
  assert.match(fn, /startComputerGame\(nextColor\)/);
  /* Same settings: the clock and the level are read, never rewritten. */
  assert.doesNotMatch(fn, /setTimeSel\(|setComputerLevel\(/);
  /* requestRematch is never called on this path. */
  assert.doesNotMatch(fn, /requestRematch|respondRematch/);
});

test('the server creates a new row with the sides swapped and never reopens the old one', () => {
  const accept = controller.slice(controller.indexOf('/* Accept: the same two players'));
  const insert = /INSERT INTO online_games \(([^)]*)\)[\s\S]*?VALUES \(([^)]*)\)/.exec(accept);
  assert.ok(insert, 'the accept path no longer inserts a row');
  /* The id comes from the database, never from the match being rematched. */
  assert.ok(!/(^|[,\s])id([,\s]|$)/.test(insert[1].replace(/admin_id|student_id/g, '')),
    'the accept path supplies its own game id');
  assert.match(accept, /row\.admin_color === 'white' \? 'black' : 'white'/);
  assert.match(accept, /START_FEN/);
  assert.match(accept, /VALUES \(\$1, \$2, \$3, \$4, '', 'active', \$5, \$6, \$7, \$7\)/);
  assert.match(accept, /const next = await getGameRow\(inserted\.rows\[0\]\.id\)/);
  /* Both players get their OWN view, or one of them sees the wrong colour. */
  assert.match(accept, /emitToUser\(io, next\.admin_id, 'rematch-started', \{[\s\S]*?payload\(next, 'admin', next\.admin_id\)/);
  assert.match(accept, /emitToUser\(io, next\.student_id, 'rematch-started', \{[\s\S]*?payload\(next, 'student', next\.student_id\)/);
  assert.match(accept, /res\.status\(201\)\.json\(payload\(next, req\.user\.role, req\.user\.id\)\)/);

  /* The match being rematched is written down and left alone: only the two
     request columns are cleared, so its result stays in the history. */
  const clear = body(controller, 'async function clearRematchRequest');
  assert.match(clear, /UPDATE online_games SET rematch_requested_by = NULL, rematch_requested_at = NULL WHERE id = \$1/);
  assert.doesNotMatch(clear, /pgn|fen|status|white_ms/, 'clearing a request must not touch the finished game');
});

test('reject and timeout close the request without touching the board', () => {
  const resolve = body(board, 'const resolveRematchCards = useStableCallback');
  assert.match(resolve, /setRematchAsk\(null\)/);
  assert.match(resolve, /setRematchInvite\(null\)/);
  assert.match(resolve, /stopRematchTimers\(\)/);
  /* No board work on an ending — the game on screen stays exactly as it was. */
  assert.doesNotMatch(resolve, /applyOnline|loadFen|setMoves|startNewGame/);

  const sub = board.slice(board.indexOf("onSocketEvent('rematch-request'"), board.indexOf("onSocketEvent('rematch-started'"));
  for (const event of ['rematch-declined', 'rematch-cancelled', 'rematch-expired']) {
    assert.ok(sub.includes(`onSocketEvent('${event}'`), `no handler for ${event}`);
  }
  assert.ok(board.includes("dedupeKey: `rematch-end-${kind || 'end'}-${id}`"));

  const decline = controller.slice(
    controller.indexOf('if (req.body?.accept !== true) {'),
    controller.indexOf('/* Accept: the same two players'),
  );
  assert.match(decline, /await clearRematchRequest\(row\.id\)/);
  assert.match(decline, /emitToUser\(io, requesterId, 'rematch-declined'/);
  assert.doesNotMatch(decline, /INSERT INTO online_games/, 'a decline must not open a game');
});

test('the rematch events are subscribed once for the page and disposed on unmount', () => {
  const subStart = board.indexOf("const offs = [\n      onSocketEvent('rematch-request'");
  assert.ok(subStart >= 0, 'the rematch subscription changed shape');
  const sub = board.slice(subStart, board.indexOf('}, []', subStart));
  assert.match(sub, /return \(\) => offs\.forEach\(\(off\) => off\(\)\)/);
  assert.match(board, /useEffect\(\(\) => \(\) => \{\n    \/\* Leaving the arena must not leave the other player waiting/);
  /* Handlers read live state through refs, so a per-render re-subscribe — which
     is how listeners used to stack — is not needed anywhere here. */
  assert.match(board, /rematchAskRef\.current = rematchAsk/);
  assert.match(board, /rematchInviteRef\.current = rematchInvite/);
});
