/* Match-request popup + accept-navigation, on every page.
 *
 * Run: node --test scripts/match-request-flow.test.mjs
 *
 * THE TWO BUGS
 * ------------
 * 1. NO POPUP. A match request surfaced as a popup only from AnalysisBoard's own
 *    `game-invite` listener, so it appeared solely when the student happened to
 *    already be on the Play Arena page. Everywhere else the request existed only
 *    as an unread badge on the bell - no message, no sender, no Accept button.
 *    NotificationBell, which is mounted in every app shell, only called
 *    syncFeed() on a new notification and raised nothing.
 *
 * 2. ACCEPT DID NOT NAVIGATE. `actOnRequest` posted /accept, showed a toast and
 *    stopped. The game went live but the user stayed exactly where they were, so
 *    accepting looked like it had done nothing. Navigation now goes to
 *    `<role>/analysis?game=<id>`, and AnalysisBoard reads that param so the board
 *    opens THAT game rather than an empty one. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bell = readFileSync(join(root, 'src', 'components', 'NotificationBell.jsx'), 'utf8');
const board = readFileSync(join(root, 'src', 'pages', 'AnalysisBoard.jsx'), 'utf8');

/* Comments carry code samples of the OLD bug, so assertions run against the
   executable code with comments removed. */
const bellCode = bell.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
const boardCode = board.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');

test('a live match request raises a popup from the bell, on every page', () => {
  /* The bell is mounted by every app shell, so a listener here covers the whole
     app rather than only Play Arena. */
  assert.match(bellCode, /onNotification\(/,
    'the bell must subscribe to incoming notifications');
  assert.match(bellCode, /n\?\.type\s*!==\s*'match_request'/,
    'the popup must be raised for match_request rows');
  assert.match(bellCode, /showToast\(/,
    'the popup must be a toast carrying the message');
});

test('the popup names the sender and offers Accept and Decline', () => {
  assert.match(bellCode, /sender_name/,
    'the popup must show who invited you');
  assert.match(bellCode, /Accept/);
  assert.match(bellCode, /Decline/);
  /* Both actions must route through the shared accept/decline handler rather
     than re-implementing the POST. */
  const actions = bellCode.slice(bellCode.indexOf("n?.type !== 'match_request'"));
  assert.match(actions, /actOnRequest\(\s*n\s*,\s*'accept'\s*\)/,
    'Accept must call the shared handler');
  assert.match(actions, /actOnRequest\(\s*n\s*,\s*'decline'\s*\)/,
    'Decline must call the shared handler');
});

test('the sender is never prompted to accept their own challenge', () => {
  /* The sender also gets a match_request row for their own sent request, so
     without this guard they would be invited to accept themselves. */
  assert.match(bellCode, /isSender/);
  assert.match(bellCode, /if\s*\(isSender\)\s*return/,
    'the popup must be skipped for the sender');
});

test('ACCEPTING navigates to the board with the game id', () => {
  /* The regression: accept used to raise a toast and stop. */
  const act = bellCode.slice(
    bellCode.indexOf('const actOnRequest'),
    bellCode.indexOf('const actOnRequest') + 1400,
  );
  assert.match(act, /action === 'accept'/);
  assert.match(act, /navigate\(/,
    'accept must navigate somewhere - it previously never did');
  assert.match(act, /analysis\?game=\$\{n\.related_id\}/,
    'accept must navigate to the board carrying the accepted game id');
  /* Declining must NOT navigate: there is nothing to play. Asserted as a COUNT
     rather than by slicing around the guard - the guard's own body contains the
     navigation, so a substring test around it proves nothing. Exactly one
     navigate() in the whole handler means only the accept branch has one. */
  const navCount = (act.match(/navigate\(/g) || []).length;
  assert.equal(navCount, 1,
    `only the accept branch may navigate, but actOnRequest calls navigate() ${navCount} times`);
  const guardAt = act.indexOf("if (action === 'accept')");
  const navAt = act.indexOf('navigate(');
  assert.ok(navAt > guardAt,
    'the single navigation must sit inside the accept branch, not on the decline path');
});

test('the board opens the game named by ?game=', () => {
  assert.match(boardCode, /get\('game'\)/,
    'the board must read the game id from the URL');
  assert.match(boardCode, /fetchGame\(\s*gameId\s*\)/,
    'and fetch that game');
  /* The row is re-scoped to this viewer, so a link cannot drive someone else's
     board - the same guard the polling path uses. */
  assert.match(boardCode, /row\.meId === user\?\.id \? row : null/,
    'the deep-linked game must be re-scoped to the signed-in viewer');
  assert.match(boardCode, /applyOnlineRow\(\s*mine\s*\)/,
    'and actually applied to the board');
  /* Only a real participant game may be opened. */
  assert.match(boardCode, /\['active',\s*'finished'\]\.includes\(mine\.status\)/,
    'only an active or finished game may be opened via the link');
});

test('a stale or foreign ?game= link cannot break the board', () => {
  assert.match(boardCode, /\.catch\(/,
    'the deep-link load must swallow errors so a stale link is harmless');
});

test('the board path matches the role, as notifTarget already does', () => {
  /* Accept must land on the board that EXISTS for this role: a student and an
     admin have different shells and different routes. */
  assert.match(bellCode, /boardBase\s*=\s*user\?\.role === 'admin' \|\| user\?\.role === 'superadmin'\s*\?\s*'\/admin'\s*:\s*'\/student'/,
    'the accept target must be role-aware');
  assert.match(bell, /const base = isAdmin \? '\/admin' : '\/student';/,
    'and must agree with the existing notifTarget base');
});