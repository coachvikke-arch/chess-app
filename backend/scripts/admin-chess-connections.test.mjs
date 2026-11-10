/* ──────────────────────────────────────────────────────────────────────────
 * Coach-managed Chess.com / Lichess links.
 *
 * The admin page is allowed to add, rename and remove a student's linked
 * usernames. Three things must stay true together:
 *
 *   1. ACCESS. The routes are staff-only, and every handler resolves the
 *      student through the same visibility gate as the read endpoints — an
 *      admin cannot write to a student they are not assigned.
 *   2. ONE STORE. The coach writes to the student's own account row, through
 *      the same validate/import path the student's Connect button uses. There
 *      is no second table for the admin page, so the student sees the link.
 *   3. SAFE EDITS. A duplicate username is refused (409) rather than merged,
 *      and changing the username deletes the old account first so the previous
 *      player's games and ratings cascade away instead of being attributed to
 *      the new person.
 *
 * Run: node --test scripts/admin-chess-connections.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const ROUTES = read('src/routes/adminChessProfileRoutes.js');
const CONTROLLER = read('src/controllers/adminChessProfileController.js');
const SERVICE = read('src/services/adminChessProfileService.js');
const PROFILE = read('src/services/unifiedProfileService.js');
const NOTIFY = read('src/services/notificationService.js');
const VISIBILITY = read('src/services/reviewVisibilityService.js');

/* ── access ───────────────────────────────────────────────────────────────── */

test('the write routes are staff-only and address one student', () => {
  assert.match(ROUTES, /router\.use\(roleMiddleware\('admin'\)\)/,
    'a student token must never reach these handlers');
  assert.match(ROUTES, /router\.post\('\/:studentId\/accounts', ctrl\.connectAccount\)/);
  assert.match(ROUTES, /router\.put\('\/:studentId\/accounts\/:accountId', ctrl\.updateAccount\)/);
  assert.match(ROUTES, /router\.delete\('\/:studentId\/accounts\/:accountId', ctrl\.removeAccount\)/);
});

test('every write resolves the student through the visibility gate', () => {
  assert.match(VISIBILITY, /function canSeeUser/);
  assert.match(SERVICE, /visibility\.getVisibleUserIds\(user\)/);
  assert.match(SERVICE, /visibility\.canSeeUser\(visibleIds, id\)/);

  /* One call per public write: connect, update, remove. */
  const calls = SERVICE.match(/await resolveStudent\(user, studentId\)/g) || [];
  assert.ok(calls.length >= 3, 'connect, update and remove must each check the assignment');

  assert.match(SERVICE, /async function connectStudentAccount\(user, studentId/);
  assert.match(SERVICE, /async function updateStudentAccount\(user, studentId, accountId/);
  assert.match(SERVICE, /async function removeStudentAccount\(user, studentId, accountId\)/);
});

/* ── one store, one import path ───────────────────────────────────────────── */

test('the coach writes to the student\'s own account rows', () => {
  assert.match(PROFILE, /async function upsertAccount\(userId, summary/,
    'the same upsert the student uses');
  assert.match(PROFILE, /ON CONFLICT \(user_id, platform\) DO UPDATE/);
  assert.match(SERVICE, /profile\.connectSummaryAsAdmin\(student\.user_id, summary, user\.id\)/,
    'the link is created under the STUDENT user id');
  assert.match(SERVICE, /profile\.disconnect\(student\.user_id, id\)/,
    'removal is the student disconnect path');
  assert.doesNotMatch(SERVICE, /admin_chess/,
    'no admin-only account table');
});

test('the username is verified before anything is stored', () => {
  const validateAt = SERVICE.indexOf('await profile.validate(platformKey, value)');
  const connectAt = SERVICE.indexOf('await profile.connectSummaryAsAdmin');
  assert.ok(validateAt > -1 && connectAt > -1, 'both calls must exist');
  assert.ok(validateAt < connectAt, 'validation must precede the write');

  /* And the verification is the platform's official API, via the shared
     validate() that calls describeUser. */
  assert.match(PROFILE, /async function validate\(platform, value\)/);
  assert.match(PROFILE, /await svc\(platform\)\.describeUser\(username\)/);
});

/* ── duplicates ───────────────────────────────────────────────────────────── */

test('a username linked to another student is refused, not merged', () => {
  assert.match(PROFILE, /async function ownerOfUsername\(platform, username\)/);
  assert.match(SERVICE, /const owner = await profile\.ownerOfUsername\(platformKey, normalized\)/);
  assert.match(SERVICE, /Number\(owner\.user_id\) !== student\.user_id\) \{\s*throw conflict\(/,
    'a different owner must be a 409');
  assert.match(SERVICE, /already linked to another student/);

  /* Same student + platform + a different username must go through Edit. */
  assert.match(SERVICE, /profile\.accountOnPlatform\(student\.user_id, platformKey\)/);
  assert.match(SERVICE, /Use Edit to change the username/);
});

/* ── safe edit ────────────────────────────────────────────────────────────── */

test('changing the username drops the old person\'s imported data first', () => {
  assert.match(SERVICE, /DELETE FROM connected_chess_accounts WHERE id = \$1 AND user_id = \$2/,
    'the old account row (and its cascading games/ratings) must go');
  assert.match(SERVICE, /const changed = String\(current\.username\)\.toLowerCase\(\) !== normalized\.toLowerCase\(\)/);
  assert.match(SERVICE, /if \(changed\) \{\s*await db\.query\(/);

  /* The schema is what makes the cascade true — pin it. */
  assert.match(read('migrations/add_chess_profiles.sql'),
    /REFERENCES connected_chess_accounts\(id\) ON DELETE CASCADE/);
});

/* ── provenance ───────────────────────────────────────────────────────────── */

test('"Linked by admin" survives a background sync', () => {
  assert.match(PROFILE, /linkedByAdminId/);
  assert.match(PROFILE, /WHEN connected_chess_accounts\.data \? 'linkedByAdminId'/,
    'a sync must carry the existing provenance forward');
  assert.match(PROFILE, /THEN EXCLUDED\.data - 'linkedByAdminId'/,
    'the student re-connecting the account clears the badge');
  assert.match(PROFILE, /a\.data -> 'linkedByAdminId' AS linked_by_admin_id/);
  assert.match(SERVICE, /linkedByAdmin: a\.linked_by_admin_id != null/);
});

/* ── notification ─────────────────────────────────────────────────────────── */

test('the student is told through the existing notification system', () => {
  assert.match(NOTIFY, /async function push\(io, userId, title, message, extra = \{\}\)/);
  assert.match(SERVICE, /notifications\.push\(io, student\.user_id/);
  assert.match(SERVICE, /Your coach linked your \$\{label\} profile \(\$\{username\}\)\./);
  assert.match(SERVICE, /type: 'chess_profile'/);
  assert.match(CONTROLLER, /io: req\.app\.get\('io'\)/,
    'the socket is passed so the bell updates live');
});

/* ── error surface ────────────────────────────────────────────────────────── */

test('errors map to the statuses the page renders', () => {
  assert.match(SERVICE, /status: 400/);
  assert.match(SERVICE, /status: 409/);
  assert.match(CONTROLLER, /if \(err\.status\) return \{ status: err\.status, message: err\.message \}/);
  assert.match(SERVICE, /syncError: result\.syncError \? syncFailureMessage\(/,
    'a failed import must not undo a verified link');
});
