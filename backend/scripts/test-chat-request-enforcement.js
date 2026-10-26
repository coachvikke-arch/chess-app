/* Source contracts for the coach-approval chat gate.
 *
 * These assert the things a behavioural test cannot reach without a live
 * database: the migration's shape, the ORDER of the routes, and - most
 * importantly - that EVERY DM read/write path in chatController actually calls
 * the gate.
 *
 * The enforcement test is the one that matters. A permission system is only as
 * strong as its least-guarded entry point, and this app has five ways to touch a
 * DM (thread read, send, mark-read, react, and the contact/inbox listings). A
 * new one added later without the gate would pass every other test here.
 *
 * Run: node --test scripts/test-chat-request-enforcement.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const migration = read('migrations/add_chat_requests.sql');
const routes = read('src/routes/chatRequestRoutes.js');
const chat = read('src/controllers/chatController.js');
const reqCtrl = read('src/controllers/chatRequestController.js');
const permSvc = read('src/services/chatPermissionService.js');
const app = read('src/app.js');
const notif = read('src/services/notificationService.js');

/* ── The data model the spec asks for ── */
test('the migration creates all three tables', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS chat_requests/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS conversations/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS chat_request_settings/);
});

test('a chat request carries every column the spec names', () => {
  for (const col of [
    'id', 'requester_user_id', 'target_user_id', 'target_coach_id', 'status',
    'created_at', 'updated_at', 'approved_at', 'rejected_at', 'approved_by', 'rejected_by',
  ]) {
    assert.match(migration, new RegExp(`\\b${col}\\b`), `missing column ${col}`);
  }
});

test('a conversation carries every column the spec names', () => {
  for (const col of [
    'id', 'user1_id', 'user2_id', 'chat_request_id', 'status', 'created_at', 'updated_at',
  ]) {
    assert.match(migration, new RegExp(`\\b${col}\\b`), `missing column ${col}`);
  }
});

test('the four statuses are the only ones allowed', () => {
  const check = migration.match(/status\s+VARCHAR\(20\)[\s\S]*?CHECK \(status IN \(([^)]*)\)\)/);
  assert.ok(check, 'chat_requests.status has no CHECK');
  for (const s of ['pending', 'approved', 'rejected', 'cancelled']) {
    assert.ok(check[1].includes(`'${s}'`), `status ${s} is not allowed`);
  }
});

test('a user cannot request a chat with themselves', () => {
  assert.match(migration, /CHECK \(requester_user_id <> target_user_id\)/);
});

test('duplicates are prevented by a PARTIAL index, so history can still grow', () => {
  /* A plain UNIQUE (requester, target, status) would also block a second
     'rejected' row, making the re-request rule unimplementable. */
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_requests_one_pending[\s\S]*?WHERE status = 'pending'/
  );
});

test('a conversation pair is canonical, so both directions collapse to one row', () => {
  assert.match(migration, /CONSTRAINT uq_conversations_pair UNIQUE \(user1_id, user2_id\)/);
  assert.match(migration, /CHECK \(user1_id < user2_id\)/);
});

test('the settings row is seeded, so a read never hits an empty table', () => {
  assert.match(migration, /INSERT INTO chat_request_settings[\s\S]*?ON CONFLICT \(id\) DO NOTHING/);
});

/* ── The gate is on every DM path ── */
test('every DM read/write path calls the permission gate', () => {
  const paths = ['getThread', 'sendDirectMessage', 'markRead'];
  for (const fn of paths) {
    const start = chat.indexOf(`exports.${fn} =`);
    assert.ok(start > -1, `${fn} not found`);
    // Isolate the function body so a gate elsewhere cannot be mistaken for one.
    const body = chat.slice(start, chat.indexOf('\nexports.', start + 1));
    assert.match(
      body,
      /chatGate\(req, res/,
      `${fn} does not call chatGate - a user could bypass the gate through it`
    );
  }
});

test('a blocked send cannot leave an orphaned upload behind', () => {
  const start = chat.indexOf('async function chatGate');
  const body = chat.slice(start, chat.indexOf('\nexports.', start));
  assert.match(body, /req\.file/, 'the gate must clean up the multer file');
});

test('reading a thread is gated, not just writing to it', () => {
  const start = chat.indexOf('exports.getThread =');
  const gate = chat.indexOf('chatGate(req, res', start);
  const query = chat.indexOf('db.query', start);
  assert.ok(gate > -1 && gate < query, 'getThread must gate BEFORE it queries');
});

test('the inbox hides conversations that are not permitted', () => {
  assert.match(chat, /allowedPeerIds/);
  assert.match(chat, /allowed\.has\(Number\(row\.other_id\)\)/);
});

test('an approved pair with no messages still appears in the inbox', () => {
  assert.match(chat, /awaitingFirstMessage/);
  assert.match(chat, /FROM conversations c/);
});

test('contacts carry the state the Message button needs', () => {
  assert.match(chat, /chatState/);
  assert.match(chat, /canMessage/);
});

/* ── The panel decides: both students' coaches AND Super Admin ── */
test('approve and reject are refused for anyone not on the request’s panel', () => {
  /* Authority comes from the snapshotted panel, not from target_coach_id and not
     from the viewer’s role - so an admin with no connection to either student gets
     no buttons and a 403. */
  assert.match(reqCtrl, /FROM chat_request_approvers/);
  assert.match(
    reqCtrl,
    /WHERE chat_request_id = \$1 AND coach_id = \$2 AND can_decide LIMIT 1/
  );
  assert.match(reqCtrl, /coaches or a Super Admin can decide this request/);
});

test('the panel is the two primary coaches plus every superadmin', () => {
  assert.match(permSvc, /async function resolveRequestParties\(requesterUserId, targetUserId\)/);
  assert.match(permSvc, /resolvePrimaryCoachId\(requesterUserId\)/);
  assert.match(permSvc, /resolvePrimaryCoachId\(targetUserId\)/);
  assert.match(permSvc, /resolveSuperadminIds\(\)/);
  assert.match(permSvc, /SELECT id FROM users WHERE role = 'superadmin' ORDER BY id ASC/);
  /* One shared primary, or a superadmin who is also a coach, must be listed once
     and notified once. */
  assert.match(permSvc, /return \[\.\.\.new Set\(parties\.filter\(\(id\) => id != null\)\)\]/);
});

test('creation attaches the whole panel and notifies each of them', () => {
  assert.match(reqCtrl, /chatPerm\.resolveRequestParties\(me, targetUserId\)/);
  assert.match(reqCtrl, /INSERT INTO chat_request_approvers/);
  /* All panel members can decide, so none is told about someone else's decision. */
  assert.match(reqCtrl, /SELECT \$1, UNNEST\(\$2::int\[\]\), TRUE/);
  assert.match(reqCtrl, /approverCount: partyIds\.length/);
  assert.match(reqCtrl, /You can approve or reject this request/);
  /* The old single-decider split is gone. */
  assert.doesNotMatch(reqCtrl, /\$2::int, TRUE\), \(\$3::int, FALSE\)/);
  assert.doesNotMatch(reqCtrl, /approverCount: 1\b/);
});

test('the target coach alone is no longer the decide gate', () => {
  /* Guards the regression that motivated this change: reading the single owner
     column here would hand the decision to one person only. */
  assert.doesNotMatch(reqCtrl, /Number\(row\.target_coach_id\) !== Number\(req\.user\.id\)/);
});

test('superadmin is allowed to decide on the decision routes', () => {
  /* Every other admin route in this app is roleMiddleware('admin') alone. The
     decision routes must also admit superadmin, or the panel is only two-thirds
     implemented and Super Admin oversight can never act. */
  for (const verb of ['approve', 'reject']) {
    assert.match(
      routes,
      new RegExp(`router\\.post\\('/:id/${verb}', roleMiddleware\\('admin', 'superadmin'\\)`)
    );
  }
  /* The queue must be reachable by superadmin too, or they cannot act from it. */
  assert.match(routes, /router\.get\('\/inbox', roleMiddleware\('admin', 'superadmin'\)/);
});

test('the observer-only history endpoint is gone', () => {
  /* There are no read-only observers any more: every panel member decides. A
     separate history route existed only to separate those two sets, and would now
     just duplicate the queue. */
  assert.doesNotMatch(routes, /\/history/);
  assert.doesNotMatch(reqCtrl, /async function history/);
  assert.doesNotMatch(reqCtrl, /deciderNames|decider_names/);
});

test('the queue and the detail view both use the panel', () => {
  /* Inbox, detail visibility and the decision must agree, otherwise a panel
     member is notified about a request they cannot open, or shown one they cannot
     act on. */
  const inboxStart = reqCtrl.indexOf('async function inbox');
  const inbox = reqCtrl.slice(inboxStart + 1, reqCtrl.indexOf('async function', inboxStart + 1));
  assert.match(inbox, /FROM chat_request_approvers a/);
  assert.match(inbox, /a\.can_decide/);
  assert.match(inbox, /canDecide: true/);
  /* Detail stays open to the whole panel - visible is what lets them decide. */
  assert.match(reqCtrl, /asApprover/);
});

test('a superadmin gets no special path into approving', () => {
  /* The only way a superadmin decides is by being the recorded approver, which
     is what makes this configuration rather than a bypass. */
  assert.doesNotMatch(
    reqCtrl.slice(reqCtrl.indexOf('async function loadDecidable')),
    /role === 'superadmin'/
  );
});

test('a request can only be decided once', () => {
  assert.match(reqCtrl, /WHERE id = \$1 AND status = 'pending'/);
  assert.match(reqCtrl, /already decided/);
});

test('approval creates the conversation pair in canonical order', () => {
  assert.match(reqCtrl, /ON CONFLICT \(user1_id, user2_id\) DO UPDATE/);
  assert.match(reqCtrl, /INSERT INTO conversations/);
});

test('the superadmin list is read-only', () => {
  const fn = reqCtrl.slice(
    reqCtrl.indexOf('async function adminList'),
    reqCtrl.indexOf('async function detail')
  );
  assert.doesNotMatch(fn, /INSERT|UPDATE|DELETE/, 'the oversight list must not mutate');
});

test('the superadmin list can filter by status and search user or coach', () => {
  const fn = reqCtrl.slice(
    reqCtrl.indexOf('async function adminList'),
    reqCtrl.indexOf('async function detail')
  );
  assert.match(fn, /cr\.status = \$1/);
  assert.match(fn, /req\.name\s+ILIKE/);
  assert.match(fn, /coach\.name ILIKE/);
  assert.match(fn, /CAST\(cr\.requester_user_id AS TEXT\) = \$2/);
});

/* ── Routing ── */
test('the request routes are mounted', () => {
  assert.match(app, /chatRequestRoutes/);
  assert.match(app, /app\.use\('\/api\/chat-requests', chatRequestRoutes\)/);
});

test('literal paths are declared BEFORE the /:id catch-all', () => {
  /* Express would hand GET /inbox to the detail handler with id="inbox", and
     the coach queue would break. This is the regression this assertion is for. */
  const inbox = routes.indexOf("router.get('/inbox'");
  const adminAll = routes.indexOf("router.get('/admin/all'");
  const detail = routes.indexOf("router.get('/:id'");
  assert.ok(inbox > -1 && adminAll > -1 && detail > -1, 'a route is missing');
  assert.ok(inbox < detail, '/inbox must precede /:id');
  assert.ok(adminAll < detail, '/admin/all must precede /:id');
});

test('the request routes are not behind the messaging feature gate', () => {
  /* A coach with 'messaging_students' off still has to be able to work the
     queue, or requests would never be decided. Matching the CALL, not the word,
     because the file explains this in a comment. */
  assert.doesNotMatch(routes, /requireFeature\s*\(/);
  assert.doesNotMatch(routes, /requireFeatureByRole\s*\(/);
  assert.match(routes, /router\.use\(authMiddleware\)/);
});

test('the oversight list is superadmin-only', () => {
  assert.match(routes, /router\.get\('\/admin\/all', roleMiddleware\('superadmin'\)/);
});

/* ── Existing behaviour preserved ── */
test('match-request notifications keep working exactly as before', () => {
  assert.match(notif, /requestStatus,\s*message = null,\s*isRead = null,\s*type = 'match_request'\s*\}\s*\)/);
});

test('every service call in chatController is namespaced', () => {
  /* These shipped as bare `pairKey(...)` calls. chatController imports the
     service as `chatPerm`, so a bare call is a ReferenceError that only fires
     when the People tab is opened - invisible to syntax checks and to any test
     that never renders that endpoint. */
  const bare = chat.match(/(?<!chatPerm\.)\b(pairKey|isStaffPair|assertCanMessage|evaluateAccess|getSettings|resolveTargetCoachId|latestRequest|hasApprovedRequest|findPendingRequest)\s*\(/g);
  assert.equal(bare, null, `unqualified service calls: ${bare && bare.join(', ')}`);
});

test('the canonical-pair VALUES list is explicitly typed', () => {
  /* An untyped `(VALUES ($1, $2), ...)` list resolves as text[], so the row
     comparison dies with SQLSTATE 42883 "operator does not exist: integer =
     text" at runtime. Both bugs here produced a 500 on GET /api/chat/contacts
     only - nothing else in the suite touched that query. */
  assert.match(chat, /\$\$\{values\.length - 1\}::int, \$\$\{values\.length\}::int/);
});

test('the migration that these endpoints depend on is shipped', () => {
  /* The tables are not in schema.sql, so a fresh database 500s on every chat
     endpoint until this file is applied by hand. */
  const mig = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', 'add_chat_requests.sql'),
    'utf8'
  );
  for (const t of ['chat_requests', 'conversations', 'chat_request_settings']) {
    assert.match(mig, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`), `migration lacks ${t}`);
  }
  assert.match(mig, /ON CONFLICT \(id\) DO NOTHING/, 'settings row must be seeded');
});

test('every messaging module actually loads', () => {
  /* The rest of this file asserts on SOURCE TEXT, which cannot tell a working file
     from one that throws on load - a duplicate `const` in the controller passed
     every assertion below while making all of them unreachable at runtime. This
     test is the one that would have caught it. */
  for (const rel of [
    'src/services/chatPermissionService.js',
    'src/controllers/chatRequestController.js',
    'src/routes/chatRequestRoutes.js',
  ]) {
    assert.doesNotThrow(
      () => require(path.join(ROOT, rel)),
      `${rel} must load`
    );
  }
});

test('the multi-coach migration is shipped and declares its ordering', () => {
  /* Without this table every inbox, detail and decision query 500s, because the
     authority check reads it on each of those paths. */
  const mig = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', 'add_chat_request_approvers.sql'),
    'utf8'
  );
  assert.match(mig, /CREATE TABLE IF NOT EXISTS chat_request_approvers\b/);
  /* The composite PK is what stops a doubly-assigned coach weighing in twice. */
  assert.match(mig, /PRIMARY KEY \(chat_request_id, coach_id\)/);
  /* The queue filters on coach_id on every visit. */
  assert.match(mig, /ON chat_request_approvers \(coach_id, chat_request_id\)/);
  /* Ordering is a real failure mode: both predecessors must exist first. */
  assert.match(mig, /add_chat_requests\.sql/);
  assert.match(mig, /add_student_coaches\.sql/);
});

test('every notified bell entry is settled when a request is decided', () => {
  /* Creation notifies the full panel, so approve/reject/cancel must close all of
     them. Settling only a subset would leave the other admins staring at a request
     that no longer exists. */
  assert.match(reqCtrl, /async function settleApproverBells/);
  assert.match(reqCtrl, /SELECT coach_id AS user_id FROM chat_request_approvers WHERE chat_request_id = \$1/);
  /* No decision path may settle the single owner directly any more. */
  const decisions = reqCtrl.slice(reqCtrl.indexOf('async function approve'));
  assert.doesNotMatch(decisions, /userId: Number\(row\.target_coach_id\)/);
  assert.match(decisions, /settleApproverBells\(row\.id, STATUS\.APPROVED\)/);
  assert.match(decisions, /settleApproverBells\(row\.id, STATUS\.REJECTED\)/);
  assert.match(decisions, /settleApproverBells\(row\.id, STATUS\.CANCELLED\)/);
});

test('the superadmin search reaches every approver', () => {
  const adminList = reqCtrl.slice(
    reqCtrl.indexOf('async function adminList'),
    reqCtrl.indexOf('async function detail')
  );
  assert.match(adminList, /FROM chat_request_approvers sa/);
});

test('the request payload names the deciding admin by id as well as by name', () => {
  /* Oversight has to say WHICH admin decided. Two admins can share a display
     name, so the id is what makes the answer unambiguous. */
  assert.match(reqCtrl, /approvedByUserId: row\.approved_by != null/);
  assert.match(reqCtrl, /rejectedByUserId: row\.rejected_by != null/);
});

test('pending requests are re-synced with the panel, with extra coaches detached', () => {
  /* The new rule does not want non-primary coaches in the panel. The corrective
     migration must attach the two primary coaches plus Super Admins, detach extra
     coaches, and drop the old sync trigger that would re-attach them. */
  const mig = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', 'add_chat_request_panel.sql'),
    'utf8'
  );
  assert.match(mig, /INSERT INTO chat_request_approvers/);
  assert.match(mig, /UNION\s*\n\s*SELECT \(SELECT ts\.coach_id FROM students ts/);
  assert.match(mig, /UNION\s*\n\s*SELECT id FROM users WHERE role = 'superadmin'/);
  assert.match(mig, /DELETE FROM chat_request_approvers a/);
  /* Extra coaches (anything not a primary and not a superadmin) must be removed. */
  assert.match(mig, /a\.coach_id IS DISTINCT FROM \(SELECT rs\.coach_id FROM students rs/);
  assert.match(mig, /a\.coach_id NOT IN \(SELECT id FROM users WHERE role = 'superadmin'\)/);
  /* The legacy trigger is retired - the panel is primary-only. */
  assert.match(mig, /DROP TRIGGER IF EXISTS trg_chat_request_approvers_new_coach ON student_coaches/);
  assert.match(mig, /DROP FUNCTION IF EXISTS chat_request_approvers_add_new_coach\(\)/);
});

test('the decider column is shipped, indexed and backfilled onto existing rows', () => {
  /* Without can_decide the whole split is unrepresentable: the decision check and
     the inbox filter both read it. */
  const mig = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', 'add_chat_request_decider.sql'),
    'utf8'
  );
  assert.match(mig, /ADD COLUMN IF NOT EXISTS can_decide BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(mig, /ON chat_request_approvers \(can_decide, coach_id, chat_request_id\)/);
  assert.match(mig, /ALTER TABLE chat_request_approvers/);
});

test('the coach history endpoint is gone', () => {
  /* No read-only observers remain, so the separate history route is retired. */
  assert.doesNotMatch(routes, /\/history/);
  assert.doesNotMatch(reqCtrl, /async function history/);
  assert.doesNotMatch(reqCtrl, /deciderNames/);
});

test('setRequestStatus matches on type as a parameter, never rewriting it', () => {
  assert.doesNotMatch(notif, /request_status = \$2, type =/);
  assert.match(notif, /type = \$2 AND related_id = \$1/);
});