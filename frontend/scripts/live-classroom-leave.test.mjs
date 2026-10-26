/* Leaving a live classroom must land the user on THEIR OWN dashboard.
 *
 * Regression guard. The Leave button used to set a `left` flag that rendered a
 * farewell card whose only action was `<Link to="/">` - and '/' is the public
 * marketing page, not the dashboard. So leaving a class dumped a signed-in
 * student (or coach) out of the app instead of back into it.
 *
 * Run: node --test scripts/live-classroom-leave.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'src/pages/LiveClassroom.jsx'), 'utf8');
const roles = fs.readFileSync(path.join(ROOT, 'src/utils/roles.js'), 'utf8');

test('Leave navigates to the role-correct dashboard', () => {
  assert.match(src, /navigate\(homeForRole\(user\?\.role\)/);
});

test('Leave never navigates to the public root', () => {
  /* The exact bug: '/' is the marketing Home page. */
  assert.doesNotMatch(src, /navigate\(['"]\/['"]/);
  assert.doesNotMatch(src, /to=['"]\/['"]/);
});

test('the ended screen also points at the dashboard, not the marketing page', () => {
  assert.match(src, /to=\{homeForRole\(user\?\.role\)\}/);
  assert.match(src, /Back to my dashboard/);
});

test('leaving replaces the history entry so Back cannot re-enter the class', () => {
  assert.match(src, /navigate\(homeForRole\(user\?\.role\), \{ replace: true \}\)/);
});

test('every Leave path navigates - including the instructor end and its fallback', () => {
  const leave = src.slice(
    src.indexOf('const goHome = '),
    src.indexOf('/* An ending the user did NOT choose')
  );
  /* Three exits must all navigate: instructor end (passed as a reference),
     instructor end failure fallback, and the voluntary leave. The back arrow
     and the leave bar share handleLeave; only the instructor's leave-bar
     button reaches handleEnd. */
  assert.match(leave, /\.then\(goHome\)/, 'instructor end must navigate on success');
  /* `Leave anyway?` sits in a template literal, so the closers are `))`. Kept
     quote-agnostic so restyling the string cannot silently break the guard. */
  assert.match(leave, /Leave anyway\?.{0,6}goHome\(\);/, 'the end-failure fallback must navigate');
  const directCalls = leave.match(/goHome\(\);/g) || [];
  assert.equal(directCalls.length, 2, `expected 2 direct goHome() calls, found ${directCalls.length}`);
});

test('leaving still emits the socket leave before navigating', () => {
  /* Otherwise the session would linger in the room roster until a refresh. */
  assert.match(src, /const goHome = \(\) => \{\s*leaveLiveClass\(classMeta\.id\);/);
});

test('a voluntary Leave no longer strands the user on a farewell card', () => {
  /* The card is now reserved for endings the user did not choose, keyed by
     reason (ended / cancelled / kicked) instead of one boolean. */
  assert.doesNotMatch(src, /setLeft\(/);
  assert.doesNotMatch(src, /const \[left, setLeft\]/);
  assert.match(src, /if \(endReason\) \{/);
  assert.match(src, /const copy = END_COPY\[endReason\]/);
});

test('both roles resolve to a real dashboard route', () => {
  assert.match(roles, /role === 'superadmin' \|\| role === 'admin'\) return '\/admin\/dashboard'/);
  assert.match(roles, /return '\/student\/dashboard'/);
});

test('the dashboard routes the helper returns are actually registered', () => {
  const app = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');
  assert.match(app, /path="\/student\/dashboard"/);
  assert.match(app, /path="\/admin\/dashboard"/);
});