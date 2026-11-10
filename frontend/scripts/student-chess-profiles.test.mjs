/* ──────────────────────────────────────────────────────────────────────────
 * Student Chess Profiles — the coach-side, read-only view.
 *
 * Three things must stay true together, or the feature either exposes data to
 * the wrong role or silently stops working:
 *
 *   1. ACCESS. The page is an admin route, the sidebar entry is not feature
 *      gated away, and the backend router is staff-only (super admin inherits
 *      'admin'). A student token must be refused by the API, not just the UI.
 *   2. SCOPE. Every read is addressed with the selected student's user id, so
 *      the server can check the assignment. Nothing on this page reads the
 *      coach's own accounts by accident.
 *   3. READ-ONLY. The reused Chess Profile components lose their connect,
 *      disconnect and per-account sync controls under a read-only scope.
 *
 * Run: node --test scripts/student-chess-profiles.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const APP = read('src/App.jsx');
const SIDEBAR = read('src/config/sidebarConfigs.js');
const PAGE = read('src/pages/StudentChessProfiles.jsx');
const PROFILE = read('src/pages/ChessProfile.jsx');
const SERVICE = read('src/services/adminChessProfiles.js');
const ROUTES = read('../backend/src/routes/adminChessProfileRoutes.js');
const BACKEND_CTRL = read('../backend/src/controllers/adminChessProfileController.js');
const BACKEND_SVC = read('../backend/src/services/adminChessProfileService.js');
const BACKEND_PROFILE = read('../backend/src/services/unifiedProfileService.js');
const STATS = read('../backend/src/services/statisticsService.js');
const COLOUR = read('src/utils/gameColour.js');

/* ── access ───────────────────────────────────────────────────────────────── */

test('the page is an admin route and the API refuses non-staff', () => {
  assert.match(
    APP,
    /<Route path="\/admin\/chess-profiles" element=\{<ProtectedRoute role="admin">/,
    'the route must be admin/super-admin only',
  );
  assert.match(SIDEBAR, /to: '\/admin\/chess-profiles', label: 'Student Chess Profiles'/,
    'the sidebar must offer the page');
  assert.match(ROUTES, /router\.use\(roleMiddleware\('admin'\)\)/,
    'the backend router must be staff-only');
});

test('the assignment check is the shared visibility gate, not a new rule', () => {
  assert.match(BACKEND_SVC, /require\('\.\/reviewVisibilityService'\)/,
    'visibility must come from reviewVisibilityService');
  assert.match(BACKEND_SVC, /visibility\.getVisibleUserIds\(user\)/,
    'the caller scope must be resolved from the JWT user');
  assert.match(BACKEND_SVC, /visibility\.canSeeUser\(visibleIds, id\)/,
    'an unassigned student must be refused');
  assert.match(BACKEND_SVC, /FROM students s/, 'only real students are listed');
  assert.match(BACKEND_SVC, /JOIN users u ON u\.id = s\.user_id/,
    'the roster row must name the student user');
  assert.match(BACKEND_SVC, /WHERE s\.user_id = \$1/,
    'a non-student user is not a valid target');
});

/* ── selection ────────────────────────────────────────────────────────────── */

test('the selected student is read reactively from the URL', () => {
  /* The regression: a row click called navigate() while selection state came
     from useUrlView, which only re-reads the URL on popstate. The URL changed,
     the state did not, and the detail panel stayed on "Select a student". */
  assert.match(PAGE, /const \[searchParams, setSearchParams\] = useSearchParams\(\)/,
    'selection must subscribe to the router location');
  assert.match(PAGE, /searchParams\.get\('student'\)/,
    'the selected id must come from the URL');
  assert.match(PAGE, /setSearchParams\(sp\)/,
    'selection must go through one navigation that updates the read state');
  assert.doesNotMatch(PAGE, /useUrlView\('student'\)/,
    'useUrlView does not re-read the URL on pushState');
  assert.doesNotMatch(PAGE, /navigate\(\{ search:/,
    'a bare navigate() would leave the selected state behind');
  assert.match(PAGE, /onBack=\{\(\) => setStudentParam\(null\)\}/,
    'mobile needs an explicit way back to the picker');
});

/* ── scope ────────────────────────────────────────────────────────────────── */

test('every read is addressed with the selected student id', () => {
  assert.match(SERVICE, /\/admin\/chess-profiles\/\$\{studentId\}/,
    'the account read must target the student');
  assert.match(PAGE, /listAccountsForStudent\(studentId\)/,
    'the profile must load through the student-scoped read');
  assert.match(PAGE, /syncStudentProfile\(studentId\)/,
    'Sync now must target the student, never the signed-in coach');
  assert.match(
    PAGE,
    /const scope = \{ studentId, readOnly: true \}/,
    'the reused components must receive a read-only student scope',
  );
});

test('games, statistics, openings and insights all carry the scope', () => {
  assert.match(PAGE, /<GamesTab gamesVersion=\{gamesVersion\} scope=\{scope\} \/>/);
  assert.match(PAGE, /<StatsTab scope=\{scope\} \/>/);
  assert.match(PAGE, /<OpeningsTab scope=\{scope\} \/>/);
  assert.match(PAGE, /<InsightsTab scope=\{scope\} \/>/);
  assert.match(PROFILE, /fetchGames\(params, scope\?\.studentId\)/);
  assert.match(PROFILE, /fetchStatistics\(p \|\| undefined, scope\?\.studentId\)/);
  assert.match(PROFILE, /fetchOpenings\(p \|\| undefined, scope\?\.studentId\)/);
  assert.match(PROFILE, /fetchInsights\(scope\?\.studentId\)/);
});

/* ── read-only ────────────────────────────────────────────────────────────── */

test('the coach view offers no connect, disconnect or per-account sync', () => {
  assert.match(PROFILE, /\{!scope\?\.readOnly && <ConnectPanel/,
    'connect must be hidden in a read-only view');
  assert.match(PROFILE, /\{!scope\?\.readOnly && \(\s*<>/,
    'the per-account Sync and Disconnect buttons must be hidden');
  assert.match(PAGE, /Student has not connected Chess\.com yet\./);
  assert.match(PAGE, /Student has not connected Lichess yet\./);
});

test('the comparison drops the Mate Zone column it has no data for', () => {
  assert.match(PROFILE, /\{!scope\?\.readOnly && <th className="cp-col-app">/);
});

/* ── stale data on failure ────────────────────────────────────────────────── */

test('a failed sync keeps the cached profile on screen', () => {
  assert.match(BACKEND_SVC, /failures\.push\(\{ platform: acct\.platform, message: syncFailureMessage/,
    'each account failure must be collected, not thrown');
  assert.match(BACKEND_SVC, /const refreshed = await profile\.accountsForUser\(student\.user_id\)/,
    'the response must still carry the cached accounts');
  assert.match(PAGE, /setAccounts\(r\.accounts \|\| \[\]\)/,
    'the page must render the cached accounts returned by a partial sync');
  assert.match(BACKEND_CTRL, /await profile\.getGameForUsers\(\[student\.user_id\], req\.params\.gameId\)/,
    'a stored analysis must belong to the selected student');
});

/* ── result logic ─────────────────────────────────────────────────────────── */

test('the score text is board-relative and Win/Loss is owner-relative', () => {
  /* The bug: the displayed score was owner-relative, so a Black player's 0-1
     win read "1–0" and a 1-0 loss read "0–1". */
  assert.match(PROFILE, /resultMeta\(g\.result\)/,
    'the score text must come from the board result alone');
  assert.doesNotMatch(PROFILE, /resultMeta\(g\.result, myColor\)/,
    'the score must never depend on the reader\'s colour');
  assert.match(PROFILE, /const t = ur === 'win' \? 'win' : ur === 'loss' \? 'loss' : 'draw'/,
    'the colour tone must come from the owner-relative result');
  assert.match(COLOUR, /if \(winner === colour\) return 'win'/,
    'the owner result must compare the winner with their own colour');
});

test('the owner colour is my_color first, then a case-insensitive name match', () => {
  assert.match(COLOUR, /if \(stored === 'white' \|\| stored === 'black'\) return stored/);
  assert.match(COLOUR, /const white = normName\(g\.white_name\)/);
  assert.match(STATS, /if \(game\.my_color === 'white' \|\| game\.my_color === 'black'\) return game\.my_color/);
  assert.match(STATS, /if \(game\.result === 'draw'\) return \{ side, userWon: null, outcome: 'draw' \}/,
    'a draw must be its own outcome, never a loss');
});

test('the games filter is owner-relative Win/Loss/Draw and the pager is numbered', () => {
  assert.match(PROFILE, /outcome: 'all'/);
  assert.match(PROFILE, /pageSize: 10/, 'ten games per page');
  assert.match(PROFILE, /<option value="win">Win<\/option>/);
  assert.match(PROFILE, /<option value="loss">Loss<\/option>/);
  assert.match(BACKEND_PROFILE, /WHEN g\.result = \$\{ownerSide\} THEN 'win'/,
    'the server must resolve the owner result from their colour');
  assert.match(PROFILE, /pagerWindow\(data\.page, pageCount\)/,
    'numbered pages, not just Prev/Next');
  assert.match(PAGE, /cp-ink-all scp-profile-ink/,
    'the reused components need the ink treatment on this white surface');
});
