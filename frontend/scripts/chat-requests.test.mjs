/* Frontend contracts for coach-approved messaging.
 *
 * The rule being protected: a user must not be able to start a chat without an
 * approved request, and the UI must never promise something the server will
 * refuse. Most of these assert that the button renders the state the BACKEND
 * reported, rather than deciding permission itself.
 *
 * Run: node --test scripts/chat-requests.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const api = read('src/utils/chatRequests.js');
const button = read('src/components/ChatRequestButton.jsx');
const page = read('src/pages/ChatRequestsPage.jsx');
const messages = read('src/pages/MessagesPage.jsx');
const sidebar = read('src/components/Sidebar.jsx');
const app = read('src/App.jsx');
const bell = read('src/components/NotificationBell.jsx');
const profile = read('src/pages/Profile.jsx');

/* ── The API client ── */
test('the client covers every endpoint the flow needs', () => {
  for (const fn of [
    'getEligibility', 'sendChatRequest', 'listMyChatRequests',
    'listChatRequestInbox', 'listAllChatRequests', 'getChatRequest',
    'approveChatRequest', 'rejectChatRequest', 'cancelChatRequest',
  ]) {
    assert.match(api, new RegExp(`export async function ${fn}`), `missing ${fn}`);
  }
});

test('eligibility is never served from the GET cache', () => {
  /* A cached "approved" would show a Message button for a pair whose approval
     had been withdrawn, which is exactly the bug the server gate prevents. */
  assert.match(api, /getEligibility[\s\S]*?cache: false/);
});

/* ── The button is UX, never the authority ── */
test('the button takes its state from the server, it does not decide', () => {
  assert.match(button, /const state = access\?\.state/);
  assert.match(button, /if \(access\?\.canMessage\)/);
});

test('every state the server can return renders a distinct outcome', () => {
  assert.match(button, /not_required|canMessage/, 'approved/not_required offers Message');
  assert.match(button, /Chat request pending/, 'pending is spelled out');
  assert.match(button, /Send Chat Request/, 'none/rejected offers the request');
  assert.match(button, /not approved by the coach/, 'rejection is explained');
});

test('a pending request cannot be submitted twice from the UI', () => {
  const pending = button.slice(
    button.indexOf("state === 'pending'"),
    button.indexOf('const blocked')
  );
  assert.match(pending, /disabled/, 'the pending state must be disabled');
});

test('a failed eligibility check fails CLOSED, not open', () => {
  /* The dangerous bug here is a catch that leaves the button enabled: the user
     would be offered a chat the server refuses. */
  const load = button.slice(button.indexOf('const load ='), button.indexOf('useEffect(() => { load();'));
  assert.match(load, /canMessage: false/, 'the fallback state must not allow messaging');
  assert.match(load, /setAccess\(\{/);
});

test('the cooldown is enforced in the UI as well as the server', () => {
  assert.match(button, /cooldownEndsAt/);
  assert.match(button, /disabled=\{blocked \|\| busy \|\| cooldownActive\}/);
});

test('sending re-reads the state instead of guessing it', () => {
  const send = button.slice(button.indexOf('const doSendRequest'));
  assert.match(send, /await load\(\)/, 'the new state must come from the server');
});

test('the exact wording the spec requires is present', () => {
  assert.match(api, /You need coach approval before you can start chatting with this user\./);
  assert.match(api, /Your chat request was not approved by the coach\./);
  assert.match(api, /Chat request pending/);
  /* Shown to the requester once the POST succeeds. */
  assert.match(button, /Request sent\. Waiting for coach approval\./);
});

test('the confirm dialog is a real modal dialog', () => {
  assert.match(button, /role="dialog"/);
  assert.match(button, /aria-modal="true"/);
  assert.match(button, /Escape/);
});

/* ── The coach / admin page ── */
test('the page shows every field the coach needs to decide', () => {
  for (const field of [
    'requesterName', 'requesterUserId', 'targetName', 'targetUserId',
    'createdAt', 'status',
  ]) {
    assert.match(page, new RegExp(`request\\.${field}`), `missing ${field}`);
  }
});

test('accept and reject both ask for confirmation first', () => {
  assert.match(page, /ConfirmDialog/);
  assert.match(page, /Approve chat request\?/);
  assert.match(page, /Reject chat request\?/);
});

test('the coach gets Accept and Reject only while the request is pending', () => {
  /* The per-row server flag, NOT the viewer's role: a coach can be an observer on
     a request (the target's primary coach) and must not be offered the decision. */
  assert.match(page, /canDecide=\{r\.canDecide === true\}/);
  assert.match(page, /canDecide && request\.status === 'pending'/);
});

test('the coach queue shows the panel and a single queue', () => {
  assert.match(page, /coach_names: request\.coachNames/);
  assert.match(page, /Reviewed by:/);
  assert.match(page, /coachNames\.join\(', '\)/);
  assert.doesNotMatch(page, /Awaiting:/);
  assert.doesNotMatch(page, /Notified:/);
  assert.doesNotMatch(page, /listChatRequestHistory/);
});

test('status can be filtered and, for the superadmin, searched', () => {
  assert.match(page, /'pending', label: 'Pending'/);
  assert.match(page, /'approved', label: 'Approved'/);
  assert.match(page, /'rejected', label: 'Rejected'/);
  assert.match(page, /Search by user or coach/);
});

test('the search box only fetches once per pause in typing', () => {
  assert.match(page, /setTimeout\(load, 300\)/);
});

test('statuses use the app\'s existing badge vocabulary', () => {
  assert.match(page, /chess-chip-green/);
  assert.match(page, /chess-chip-red/);
  assert.match(page, /chess-chip-amber/);
});

test('an empty result says so', () => {
  assert.match(page, /No chat requests/);
});

/* ── The messenger honours the state instead of guessing ── */
test('the People list marks blocked contacts instead of hiding them', () => {
  assert.match(messages, /u\.canMessage !== false/);
  assert.match(messages, /Chat request pending/);
  assert.match(messages, /Approval required to chat/);
});

test('a blocked contact opens the request flow, not a dead thread', () => {
  assert.match(messages, /setRequestTarget/);
  assert.match(messages, /<ChatRequestButton/);
});

test('a stale deep link that 403s lands in the request flow', () => {
  /* This is the direct-URL bypass vector, and the reason the server gate has to
     exist. The client must handle the refusal rather than showing nothing. */
  assert.match(messages, /status === 403/);
});

/* ── Wiring ── */
test('the sidebar entry exists and is not feature-gated', () => {
  const entry = sidebar.slice(
    sidebar.indexOf("/admin/chat-requests"),
    sidebar.indexOf("/admin/chat-requests") + 120
  );
  assert.match(sidebar, /label: 'Chat Requests'/);
  assert.doesNotMatch(entry, /feature:/, 'the queue must stay reachable');
});

test('the route is registered for coaches', () => {
  assert.match(app, /path="\/admin\/chat-requests"/);
  assert.match(app, /ChatRequestsPage/);
});

test('a chat_request notification does NOT try to open a conversation', () => {
  /* related_id is the REQUEST id here. Passing it as openUserId would try to
     open a chat with request #7. */
  const branch = bell.slice(
    bell.indexOf("case 'chat_request'"),
    bell.indexOf('case ', bell.indexOf("case 'chat_request'") + 10)
  );
  assert.match(branch, /chat-requests/);
  assert.doesNotMatch(branch, /openUserId/);
});

/* ── Several coaches per student ──
 * A student can be handled by more than one coach, so nothing may assume a
 * single approver. The Profile page's own shape handling is covered by
 * coach-names.test.mjs against real payloads; what matters here is that the
 * request surfaces agree with it. */
test('the request dialog names every coach who will be asked', () => {
  assert.match(button, /coachNames\.length > 1 \? 'Your coaches' : 'Your coach'/);
  assert.match(button, /coachNames\.join\(', '\)/);
  /* The name list comes from the shared, unit-tested normaliser rather than an
     inline guess at the payload shape (coach-names.test.mjs covers the shapes). */
  assert.match(button, /coachNamesFrom\(\{/);
  assert.match(button, /coach_names: access\?\.coachNames/);
});

test('the coach queue names the decider separately from everyone notified', () => {
  /* One person decides and several people are told, so the card must not blur the
     two: "Awaiting" is the single decider, "Notified" is everyone attached. */
  assert.match(page, /coach_names: request\.coachNames/);
  assert.match(page, /coach_names: request\.deciderNames/);
  assert.match(page, /Target&rsquo;s coach:/);
  assert.match(page, /Notified:/);
  assert.doesNotMatch(page, /Awaiting:/);
  assert.match(page, /deciderNames\.length > 0 \? deciderNames\.join\(', '\)/);
  assert.match(page, /coachNames\.join\(', '\)/);
});

test('Accept and Reject are gated on the server’s per-row canDecide', () => {
  /* Gating on the viewer’s ROLE is what let every coach in a multi-coach academy
     approve. Visibility and authority are different sets: the target’s coach sees
     the request in History and must not be offered a decision. */
  assert.doesNotMatch(page, /canDecide=\{!isSuper\}/);
  assert.match(page, /canDecide=\{r\.canDecide === true\}/);
  /* The inbox is deciders-only, so it is still true for every row it returns -
     which is why the UI can trust the flag instead of the endpoint. */
  assert.match(page, /canDecide=\{r\.canDecide === true\}/);
});

test('coaches get a review queue and a separate observer history', () => {
  assert.doesNotMatch(page, /listChatRequestHistory/);
  assert.match(page, /listChatRequestInbox/);
  assert.match(page, /\{ key: 'review', label: 'To review' \}/);
  assert.match(page, /\{ key: 'history', label: 'History' \}/);
  /* Super Admin already sees everything in one list, so no tabs there. */
  assert.match(page, /\{!isSuper && \(\s*<div role="group" aria-label="Choose view"/);
});

test('the oversight view names which admin decided, with the id', () => {
  /* Super Admin asked to see who accepted or rejected each request. */
  assert.match(page, /request\.approvedBy/);
  assert.match(page, /request\.rejectedBy/);
  assert.match(page, /decidedBySuffix\(request\.approvedByUserId\)/);
  assert.match(page, /decidedBySuffix\(request\.rejectedByUserId\)/);
  assert.match(page, /\(ID \$\{userId\}\)/);
});

test('a pending request shows who it is waiting on', () => {
  assert.match(page, /request\.status === 'pending'/);
  assert.doesNotMatch(page, /Awaiting:/);
});

test('an open queue refreshes when a request arrives', () => {
  /* The reported symptom: a request was sent, both admins were notified, but the
     queue behind the bell never showed it because the page only fetched on
     mount. A request notification reaches every approver, so the socket event
     refreshes all of their queues. */
  assert.match(page, /onNotification\(refresh\)/);
  assert.match(page, /addEventListener\('focus', onFocus\)/);
  assert.match(page, /visibilitychange/);
  /* Poll covers a dropped socket connection. */
  assert.match(page, /setInterval\(refresh, 30000\)/);
  /* And every listener must be torn down, or a remount leaks subscriptions. */
  assert.match(page, /offNotification\(\)/);
  assert.match(page, /clearInterval\(poll\)/);
});

test('no surface still implies there is exactly one coach', () => {
  /* These are the single-coach assumptions the multi-coach change had to remove. */
  assert.doesNotMatch(button, /\$\{access\?\.coachName\}/);
  assert.doesNotMatch(profile, /value=\{user\.coach_name/);
  /* And nothing may render a raw coach object, which React refuses as a child. */
  assert.doesNotMatch(page, /request\.coachNames\.map\(\(c\) => c\.name\)/);
});