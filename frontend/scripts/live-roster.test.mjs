/* Live-classroom roster reconciliation.
 *
 * Run: node --test scripts/live-roster.test.mjs
 *
 * The refresh bug was two-fold: the `class:init` roster was never read, and the
 * HTTP snapshot could arrive before the socket joined. These cover the two pure
 * helpers the fix leans on - normalising the server's snake_case roster, and
 * replacing (not patching) the participant list without duplicating anyone.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeRoster, dedupeParticipants } from '../src/utils/liveRoster.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

test('the server roster (snake_case) is mapped to the client shape', () => {
  const out = normalizeRoster([
    { user_id: 7, name: 'Ana', role_in_class: 'student', status: 'active', joined_at: 'T1' },
  ]);
  assert.deepEqual(out, [
    { userId: 7, name: 'Ana', roleInClass: 'student', status: 'active', joinedAt: 'T1' },
  ]);
});

test('an already-camelCase roster passes through unchanged', () => {
  const out = normalizeRoster([{ userId: 3, name: 'Bob', roleInClass: 'host' }]);
  assert.equal(out[0].userId, 3);
  assert.equal(out[0].roleInClass, 'host');
  assert.equal(out[0].status, 'active', 'a missing status defaults to active');
});

test('entries without a userId are dropped rather than rendered as blanks', () => {
  assert.deepEqual(normalizeRoster([{ name: 'ghost' }, { user_id: 1, name: 'real' }]).map((p) => p.userId), [1]);
});

test('a non-array roster yields an empty list, never a crash', () => {
  assert.deepEqual(normalizeRoster(undefined), []);
  assert.deepEqual(normalizeRoster(null), []);
});

test('a refresh landing both the HTTP snapshot and the socket roster does not double the teacher', () => {
  /* This is the exact refresh race: getJoinToken returns [teacher], then the
     socket's class:init returns [teacher] again. Before, the list grew or blipped;
     now it is one row. */
  const out = dedupeParticipants([
    { userId: 5, name: 'Coach', roleInClass: 'host' },
    { userId: 5, name: 'Coach', roleInClass: 'host' },
    { userId: 9, name: 'Sam', roleInClass: 'student' },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((p) => p.userId), [5, 9]);
});

test('string and number ids that mean the same user are treated as one', () => {
  const out = dedupeParticipants([
    { userId: 5, name: 'Coach' },
    { userId: '5', name: 'Coach' },
  ]);
  assert.equal(out.length, 1);
});

test('replacement marks everyone present and keeps order', () => {
  const out = dedupeParticipants([
    { userId: 1, name: 'A', status: 'left' },
    { userId: 2, name: 'B' },
  ]);
  assert.equal(out[0].status, 'active', 'a stale "left" in the authoritative list is reset');
  assert.deepEqual(out.map((p) => p.userId), [1, 2]);
});

/* ------------------------------------------------------------------ *
 * The client actually wires the fix up
 * ------------------------------------------------------------------ */

test('the socket bridge reads class:init and replaces the roster', () => {
  const bridge = read('src', 'components', 'liveclass', 'LiveClassSocketBridge.jsx');
  assert.match(bridge, /on\('class:init'/, 'listens for the authoritative roster');
  assert.match(bridge, /replaceParticipants\(normalizeRoster/, 'replaces, rather than patches, the list');
  assert.match(bridge, /s\.on\('connect'/, 're-joins on every socket connect');
});

test('the bridge registers its listener before emitting the join', () => {
  const bridge = read('src', 'components', 'liveclass', 'LiveClassSocketBridge.jsx');
  const initAt = bridge.indexOf("const offInit = on('class:init'");
  /* The join is emitted from three places (the connect handler, and the
     mount-time call at the end); the last occurrence is that mount-time emit,
     which is the one that must come after the listener is attached. */
  const joinAt = bridge.lastIndexOf('joinLiveClass(classId');
  assert.ok(initAt !== -1 && joinAt !== -1, 'both present');
  assert.ok(initAt < joinAt, 'class:init is attached before the join is emitted');
});

test('the context exposes a wholesale replace, not only deltas', () => {
  const ctx = read('src', 'context', 'LiveClassContext.jsx');
  assert.match(ctx, /const replaceParticipants = useCallback/, 'replaceParticipants exists');
  assert.match(ctx, /dedupeParticipants/, 'and dedupes through the shared helper');
});
