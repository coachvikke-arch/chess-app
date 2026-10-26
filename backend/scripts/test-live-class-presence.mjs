import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

const socketFile = read('src', 'socket', 'liveClassSocket.js');

const GRACE_MS = Number(socketFile.match(/PRESENCE_GRACE_MS\s*=\s*(\d+)/)?.[1] ?? '5000');
const ROSTER_WINDOW_MS = Number(
  socketFile.match(/PRESENCE_ANNOUNCE_WINDOW_MS\s*=\s*(\d+)/)?.[1] ?? '2000',
);

/* ------------------------------------------------------------------ *
 * A pure model of the server's presence bookkeeping.
 *
 * The real logic lives in the socket layer; this mirrors its contract so the
 * behaviour can be exercised directly instead of only pattern-matched in the
 * source text. Rules:
 *   - a user is present while at least one of their sockets is in the room;
 *   - losing the last socket does NOT evict immediately - it arms a grace timer;
 *   - a reconnect inside the window cancels the pending eviction.
 * ------------------------------------------------------------------ */
function makePresence(graceMs = GRACE_MS) {
  const rooms = new Map(); // classId -> Map(userId -> { sockets:Set, timer })
  const vacated = []; // { classId, userId }

  const room = (classId) => {
    let m = rooms.get(classId);
    if (!m) {
      m = new Map();
      rooms.set(classId, m);
    }
    return m;
  };

  return {
    connect(classId, userId, socketId, now = 0) {
      const m = room(classId);
      let entry = m.get(userId);
      if (!entry) {
        entry = { sockets: new Set(), at: null };
        m.set(userId, entry);
      }
      const firstConnection = entry.sockets.size === 0;
      entry.sockets.add(socketId);
      entry.at = null; // any pending eviction is cancelled
      return firstConnection;
    },
    disconnect(classId, userId, socketId, now = 0) {
      const m = rooms.get(classId);
      const entry = m && m.get(userId);
      if (!entry) return;
      entry.sockets.delete(socketId);
      if (entry.sockets.size === 0) entry.at = now + graceMs;
    },
    /** Fire any evictions whose grace window has elapsed by `now`. */
    advance(now) {
      for (const [classId, m] of rooms) {
        for (const [userId, entry] of [...m]) {
          if (entry.at != null && entry.sockets.size === 0 && now >= entry.at) {
            m.delete(userId);
            vacated.push({ classId, userId });
          }
        }
      }
    },
    present(classId, userId) {
      const m = rooms.get(classId);
      return !!(m && m.get(userId));
    },
    vacated,
  };
}

/* ------------------------------------------------------------------ *
 * Refresh / reconnect must not evict anyone
 * ------------------------------------------------------------------ */

test('a refresh within the grace window keeps the user present', () => {
  const p = makePresence();
  p.connect(72, 30, 'old', 0);
  p.disconnect(72, 30, 'old', 5); // page unloads, socket drops
  const first = p.connect(72, 30, 'new', 40); // new socket a moment later
  p.advance(10_000);
  assert.equal(p.present(72, 30), true, 'still in the room');
  assert.deepEqual(p.vacated, [], 'the room was never told they left');
});

test('a socket.io reconnect inside the window cancels the eviction', () => {
  const p = makePresence();
  p.connect(72, 30, 's1', 0);
  p.disconnect(72, 30, 's1', 100);
  p.connect(72, 30, 's1', GRACE_MS - 100); // reconnected just in time
  p.advance(GRACE_MS * 4);
  assert.deepEqual(p.vacated, []);
});

test('the returning socket reports a first connection again (announce gating stays server-side)', () => {
  /* Because the old socket is removed from the set at once, the count really
     does hit zero in between - so the reconnect counts as a "first" connection.
     The duplicate announcement is stopped by the separate time window, not by
     this refcount. */
  const p = makePresence();
  p.connect(72, 30, 'old', 0);
  p.disconnect(72, 30, 'old', 5);
  assert.equal(p.connect(72, 30, 'new', 40), true, 'first connection while the entry is empty');
});

/* ------------------------------------------------------------------ *
 * A genuine departure must still be announced
 * ------------------------------------------------------------------ */

test('a user who really leaves and does not return is evicted after the grace', () => {
  const p = makePresence();
  p.connect(72, 30, 's1', 0);
  p.disconnect(72, 30, 's1', 0);
  p.advance(GRACE_MS - 1);
  assert.deepEqual(p.vacated, [], 'not yet - still inside the window');
  p.advance(GRACE_MS);
  assert.deepEqual(p.vacated, [{ classId: 72, userId: 30 }]);
  assert.equal(p.present(72, 30), false);
});

test('a user with a second tab stays present when one tab closes', () => {
  const p = makePresence();
  p.connect(72, 30, 'tabA', 0);
  const again = p.connect(72, 30, 'tabB', 0);
  assert.equal(again, false, 'second socket is not a fresh arrival');
  p.disconnect(72, 30, 'tabA', 10);
  p.advance(GRACE_MS * 2);
  assert.equal(p.present(72, 30), true, 'tab B still holds the room');
  assert.deepEqual(p.vacated, []);
});

test('the same user leaving one class does not disturb another', () => {
  const p = makePresence();
  p.connect(72, 30, 'a', 0);
  p.connect(73, 30, 'b', 0);
  p.disconnect(72, 30, 'a', 0);
  p.advance(GRACE_MS);
  assert.deepEqual(p.vacated, [{ classId: 72, userId: 30 }]);
  assert.equal(p.present(73, 30), true, 'the other classroom is untouched');
});

/* ------------------------------------------------------------------ *
 * The server actually wires the fix up
 * ------------------------------------------------------------------ */

test('presence is a per-class, per-user, per-socket refcount', () => {
  assert.match(socketFile, /const presenceByClass = new Map\(\)/, 'the store exists');
  assert.match(socketFile, /function trackPresence\(classId, userId, socketId\)/, 'trackPresence exists');
  assert.match(socketFile, /const firstConnection = entry\.sockets\.size === 0/, 'first connection is when the set was empty');
  assert.match(socketFile, /return firstConnection/, 'and it is reported to the caller');
});

test('leaving or disconnecting defers removal behind the grace window', () => {
  assert.match(socketFile, /function untrackPresence\(classId, userId, socketId, onVacated\)/, 'untrackPresence exists');
  assert.match(socketFile, /\}, PRESENCE_GRACE_MS\);/, 'the removal is scheduled with the grace constant');

  const leave = socketFile.match(/socket\.on\('leave-live-class'[\s\S]*?\n {4}\}\);/)?.[0] ?? '';
  assert.match(leave, /untrackPresence\(/, 'leave defers through presence');
  assert.ok(
    leave.indexOf('untrackPresence(') < leave.indexOf("emit('participant_left'"),
    'leave announces the departure only from inside the deferred handler',
  );

  const disconnect = socketFile.match(/socket\.on\('disconnect'[\s\S]*?\n {4}\}\);/)?.[0] ?? '';
  assert.match(disconnect, /untrackPresence\(/, 'disconnect defers through presence');
  assert.match(disconnect, /socket\.data\.liveClasses/, 'disconnect reads the rooms joined via socket.data (socket.rooms is already cleared)');
});

test('a deliberate kick skips the grace and evicts at once', () => {
  assert.match(socketFile, /function forceVacate\(classId, userId\)/, 'forceVacate exists');
  const kick = socketFile.match(/socket\.on\('admin:remove_participant'[\s\S]*?\n {4}\}\);/)?.[0] ?? '';
  assert.match(kick, /forceVacate\(classId, targetUserId\)/, 'the kick evicts immediately');
  assert.match(kick, /emit\('participant_left', \{ userId: targetUserId \}\)/, 'and announces the removal');
});

test('the fresh-arrival notices are gated on a first connection', () => {
  assert.match(
    socketFile,
    /if \(firstConnection && claimPresenceBroadcast\(classId, userId\)\) \{\s*\n\s*io\.to\(`live-class:\$\{classId\}`\)\.emit\('participant_joined'/,
    'the roster notification is a first connection only',
  );
  assert.match(
    socketFile,
    /if \(firstConnection && claimJoinNotify\(classId, userId\)\) \{\s*\n\s*io\.to\(`live-class:\$\{classId\}`\)\.emit\('participant:joined'/,
    'the join popup is a first connection only',
  );
  const joins = socketFile.match(/emit\('participant_joined'/g) || [];
  assert.equal(joins.length, 1, 'exactly one participant_joined emit');
});

test('class:init is still sent unconditionally on every join', () => {
  /* The dedupe must only cover the room-wide notices. The joining socket needs
     the board/roster snapshot on every join, including a re-join - that is the
     fix for "0 in class" after a refresh. */
  assert.match(socketFile, /socket\.emit\('class:init'/, 'class:init is still emitted to the socket');
  assert.ok(
    socketFile.indexOf("socket.emit('class:init'") < socketFile.indexOf('firstConnection && claimPresenceBroadcast'),
    'and it is emitted outside the first-connection guard',
  );
});

test('the participant row is still upserted on every join', () => {
  /* Presence bookkeeping must not skip the attendance write - that is what marks
     the student present. */
  assert.match(
    socketFile,
    /INSERT INTO live_class_participants[\s\S]{0,300}?ON CONFLICT \(live_class_id, user_id\) DO UPDATE/,
    'the upsert is untouched',
  );
});

test('the announce windows are pruned so they cannot grow forever', () => {
  assert.match(socketFile, /setInterval\([\s\S]{0,400}?lastPresenceBroadcast\.delete\(key\)/, 'join window swept');
  assert.match(socketFile, /setInterval\([\s\S]{0,400}?lastJoinNotify\.delete\(key\)/, 'popup window swept');
  assert.match(socketFile, /\.unref\(\)/, 'and the timers do not hold the process open');
});

test('the roster the socket reports is the room, not a per-client guess', () => {
  /* The HTTP snapshot and class:init both derive the roster server-side; the
     client only mirrors it. Keeping the derivation in one place is what stops the
     chip count and the list from disagreeing. */
  const controller = read('src', 'controllers', 'liveClassController.js');
  assert.match(controller, /io\.in\(roomName\)\.fetchSockets\(\)/, 'join-token derives the roster from the live room');
  assert.match(controller, /true role/, 'and guarantees the requester is listed even before their socket joins');
});
