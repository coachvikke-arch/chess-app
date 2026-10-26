/* Live-classroom "participant:joined" toast notification.
 *
 * Run: node --test scripts/test-live-class-join-toast.mjs
 *
 * The event is emitted once per genuine arrival, to the whole room, with the
 * 30s per-person window that keeps a refresh/reconnect from flashing the popup
 * again. The window logic lives in the socket layer; it is re-implemented here
 * from the same constant the server reads, so this simulation stays an honest
 * description of the intended behaviour.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const socketFile = readFileSync(join(root, 'src', 'socket', 'liveClassSocket.js'), 'utf8');

const WINDOW_MS = Number(
  socketFile.match(/JOIN_NOTIFY_WINDOW_MS\s*=\s*(\d+)/)?.[1] ?? '0',
);

function makeClaimer() {
  const map = new Map();
  return (classId, userId, now) => {
    const key = `${classId}:${userId}`;
    const last = map.get(key);
    if (last != null && now - last < WINDOW_MS) return false;
    map.set(key, now);
    return true;
  };
}

function audible(events) {
  const claim = makeClaimer();
  return events.filter(([, at]) => claim(72, 30, at)).map(([ev]) => ev);
}

/* ------------------------------------------------------------------ *
 * The window itself
 * ------------------------------------------------------------------ */

test('the window is 30 seconds', () => {
  assert.equal(WINDOW_MS, 30000);
});

test('one arrival is announced exactly once', () => {
  assert.deepEqual(audible([['join', 0], ['join', 900]]), ['join'], 'page refresh');
  assert.deepEqual(audible([['join', 0], ['join', 29_000]]), ['join'], 'reconnect just inside the window');
});

test('a return after the window is announced again', () => {
  assert.deepEqual(audible([['join', 0], ['join', 30_001]]), ['join', 'join']);
});

test('the window is keyed per person and per class', () => {
  const claim = makeClaimer();
  assert.equal(claim(72, 30, 0), true, 'first student');
  assert.equal(claim(72, 31, 0), true, 'a different student the same instant');
  assert.equal(claim(72, 30, 0), false, 'the same student is suppressed');
  assert.equal(claim(73, 30, 0), true, 'the same student in another class is a new room');
});

/* ------------------------------------------------------------------ *
 * The server actually wires it up
 * ------------------------------------------------------------------ */

test('exactly one participant:joined emit, to the whole class room', () => {
  const emits = socketFile.match(/emit\('participant:joined'/g) || [];
  assert.equal(emits.length, 1, 'a single broadcast event');
  assert.match(
    socketFile,
    /io\.to\(`live-class:\$\{classId\}`\)\.emit\('participant:joined', \{[\s\S]*?userId,[\s\S]*?name: userName,[\s\S]*?role: access\.roleInClass,[\s\S]*?classId,[\s\S]*?joinedAt:/,
    'broadcast with the full { userId, name, role, classId, joinedAt } payload',
  );
});

test('the emit is gated by the 30s join-notify claim, not the 2s roster claim', () => {
  assert.match(
    socketFile,
    /if \(firstConnection && claimJoinNotify\(classId, userId\)\) \{\s*\n\s*io\.to\(`live-class:\$\{classId\}`\)\.emit\('participant:joined'/,
    'the toast notice is claimed',
  );
  assert.match(socketFile, /function claimJoinNotify/, 'the guard lives in the socket layer');
  assert.match(socketFile, /const lastJoinNotify = new Map\(\)/, 'and keeps its own registry');
});

test('the roster sync event is left on its own short window', () => {
  /* participant_joined drives the roster and must keep collapsing the
     StrictMode flap; it must NOT be moved onto the 30s toast window. */
  const joins = socketFile.match(/emit\('participant_joined'/g) || [];
  assert.equal(joins.length, 1);
  assert.match(
    socketFile,
    /if \(firstConnection && claimPresenceBroadcast\(classId, userId\)\) \{\s*\n\s*io\.to\(`live-class:\$\{classId\}`\)\.emit\('participant_joined'/,
    'the roster notice still uses claimPresenceBroadcast',
  );
});

test('the dedupe map is pruned so it cannot grow forever', () => {
  assert.match(socketFile, /setInterval\([\s\S]{0,400}?lastJoinNotify\.delete\(key\)/, 'old entries are swept');
  assert.match(socketFile, /\.unref\(\)/, 'and the timer does not hold the process open');
});
