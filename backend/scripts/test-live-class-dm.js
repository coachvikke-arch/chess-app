/* End-to-end check of the live-class student -> coach DM over real sockets.
 *
 * The bug this exists to catch: the handler routed DMs to classes.coach_id only,
 * while liveClassAccess lets ANY admin/superadmin host a class. A Super Admin
 * hosting the room never received the student's message. Recipients are now the
 * class coach plus every admin/superadmin present in the room.
 *
 * Requires the backend deps; socket.io-client is resolved from frontend/.
 *
 * Run: node scripts/test-live-class-dm.js
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { io: ioClient } = require(path.join(__dirname, '..', '..', 'frontend', 'node_modules', 'socket.io-client'));
const app = require('../src/app');
const db = require('../src/config/database');

let pass = 0;

/* Mirror server.js's wiring exactly — same auth middleware, same attach point —
   because the bug under test is in the recipient set, and a divergent harness
   would test a server that does not exist. */
const httpServer = app.listen(0);
const io = new Server(httpServer, { path: '/socket.io' });
app.set('io', io);
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('No token provided'));
  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});
require('../src/socket/liveClassSocket')(io);

/* server.js joins every authenticated socket to `user:<id>`; the DM delivers
   through that room, so the harness must create it too. */
io.on('connection', (socket) => {
  if (socket.user && socket.user.id != null) socket.join(`user:${socket.user.id}`);
});

const port = httpServer.address().port;
const base = `http://127.0.0.1:${port}`;

const sign = (id, role, name) =>
  jwt.sign({ id, role, name, email: `${id}@example.invalid` }, process.env.JWT_SECRET, { expiresIn: '5m' });

const connect = (token) =>
  new Promise((resolve, reject) => {
    const s = ioClient(base, { path: '/socket.io', transports: ['websocket'], auth: { token } });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(new Error(`connect failed: ${e.message}`)));
  });

const joinClass = (s, classId) =>
  new Promise((resolve, reject) => {
    s.emit('join-live-class', classId, (res) => (res?.ok ? resolve(res) : reject(new Error(res?.error || 'join failed'))));
  });

const sendDm = (s, classId, text) =>
  new Promise((resolve, reject) => {
    s.emit('chat_dm', { classId, text }, (res) => resolve(res));
    setTimeout(() => reject(new Error('ack timeout')), 5000);
  });

/** Wait for a named event, or resolve null on timeout. */
function once(s, event, ms = 1200) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { s.off(event, h); resolve(null); }, ms);
    const h = (payload) => { clearTimeout(t); s.off(event, h); resolve(payload); };
    s.on(event, h);
  });
}

async function main() {
  const { rows: cls } = await db.query(
    `SELECT id, coach_id FROM classes WHERE status = 'live' ORDER BY id DESC LIMIT 1`,
  );
  assert.ok(cls.length, 'need a live class to test against');
  const classId = cls[0].id;

  const { rows: stus } = await db.query(`SELECT id, name FROM users WHERE role = 'student' ORDER BY id LIMIT 1`);
  assert.ok(stus.length, 'need a student');
  const student = stus[0];

  const { rows: su } = await db.query(`SELECT id, name FROM users WHERE role = 'superadmin' ORDER BY id LIMIT 1`);
  assert.ok(su.length, 'need a superadmin');
  const superAdmin = su[0];

  console.log(`class ${classId}, coach_id=${cls[0].coach_id}, student ${student.id}, superadmin ${superAdmin.id}\n`);

  const studentSock = await connect(sign(student.id, 'student', student.name));
  const superSock = await connect(sign(superAdmin.id, 'superadmin', superAdmin.name));
  await joinClass(studentSock, classId);
  await joinClass(superSock, classId);

  const marker = `dm-test-${Date.now()}`;

  /* A previous run that failed before cleanup leaves an unread bell row for this
   * student, and the handler dedupes per conversation — which would make the bell
   * assertions fail for a reason unrelated to what is being tested. Clear stale
   * rows first so the test starts from a known state. */
  await db.query(`DELETE FROM notifications WHERE message LIKE 'dm-test-%'`);
  await db.query(`DELETE FROM chat_messages WHERE message LIKE 'dm-test-%'`);

  /* A REAL unread DM (not one of ours) trips the same per-conversation dedupe
   * and would suppress the bell push the assertions below expect. Neutralise any
   * such row by marking it read for the run, then restore its exact is_read
   * afterwards — never delete a user's bell to make a test pass. */
  const staleUnread = await db.query(
    `SELECT id FROM notifications
      WHERE user_id = $1 AND type = 'message' AND related_id = $2 AND is_read = FALSE`,
    [superAdmin.id, student.id],
  );
  const staleIds = staleUnread.rows.map((r) => r.id);
  if (staleIds.length) {
    await db.query(`UPDATE notifications SET is_read = TRUE WHERE id = ANY($1::int[])`, [staleIds]);
  }

  try {
  const before = await db.query(
    `SELECT COUNT(*)::int AS n FROM notifications
      WHERE user_id = $1 AND type = 'message' AND related_id = $2 AND is_read = FALSE`,
    [superAdmin.id, student.id],
  );

  const gotSocket = once(superSock, 'chat_dm');
  const gotBell = once(superSock, 'notification');
  const ack = await sendDm(studentSock, classId, marker);

  assert.equal(ack?.ok, true, `ack ok (got ${JSON.stringify(ack)})`);

  const dm = await gotSocket;
  assert.ok(dm, 'the hosting superadmin received chat_dm over the socket');
  assert.equal(dm.message, marker);
  assert.equal(dm.userId, student.id, 'the DM identifies the student as author');
  assert.equal(dm.senderId, student.id, 'sender_id is set so the Messages page can resolve the author');

  const bell = await gotBell;
  assert.ok(bell, 'the hosting superadmin received a live bell push');
  assert.equal(bell.type, 'message');
  assert.equal(bell.sender_id, student.id);

  const row = await db.query(
    `SELECT id, sender_id, recipient_id FROM chat_messages
      WHERE is_private IS TRUE AND message = $1 AND recipient_id = $2`,
    [marker, superAdmin.id],
  );
  assert.equal(row.rows.length, 1, 'exactly one row for this recipient');
  assert.equal(row.rows[0].sender_id, student.id, 'sender_id written (this was NULL before the fix)');

  const notif = await db.query(
    `SELECT id FROM notifications
      WHERE user_id = $1 AND type = 'message' AND related_id = $2 AND message = $3`,
    [superAdmin.id, student.id, marker],
  );
  assert.ok(notif.rows.length >= 1, 'a notification row was persisted');

  const after = await db.query(
    `SELECT COUNT(*)::int AS n FROM notifications
      WHERE user_id = $1 AND type = 'message' AND related_id = $2 AND is_read = FALSE`,
    [superAdmin.id, student.id],
  );
  assert.ok(after.rows[0].n <= before.rows[0].n + 1, 'one unread bell entry per conversation, not per message');

  /* The Messages-page read path must resolve the author, or the DM stays
   * invisible outside the classroom. */
  const thread = await db.query(
    `SELECT cm.id, u.name FROM chat_messages cm
       JOIN users u ON u.id = cm.sender_id
      WHERE cm.is_private IS TRUE AND cm.id = $1`,
    [row.rows[0].id],
  );
  assert.equal(thread.rows.length, 1, 'getThread-style JOIN on sender_id resolves');
  assert.equal(thread.rows[0].name, student.name);

  /* An instructor must not be able to DM as if they were a student. */
  const rejectAck = await sendDm(superSock, classId, 'should not work');
  assert.equal(rejectAck?.ok, false, 'an instructor cannot use the student DM path');

  /* Clean up the rows this test created so repeated runs stay idempotent. */
  await db.query(`DELETE FROM chat_messages WHERE message = $1`, [marker]);
  await db.query(`DELETE FROM notifications WHERE message = $1`, [marker]);
  } finally {
    /* Put the real bells back exactly as they were, even if an assertion threw. */
    if (staleIds.length) {
      await db
        .query(`UPDATE notifications SET is_read = FALSE WHERE id = ANY($1::int[])`, [staleIds])
        .catch(() => {});
    }
  }

  console.log('PASS  the hosting superadmin receives the DM and a bell entry');
  console.log('PASS  sender_id is persisted and the Messages-page JOIN resolves');
  console.log('PASS  bell entries stay deduped per conversation');
  console.log('PASS  an instructor is still refused the student DM path');
  pass += 4;

  studentSock.close();
  superSock.close();

  console.log(`\n${pass} checks passed`);
  io.close();
  httpServer.close();
  await db.pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(`FAIL  ${err.message}`);
  try { io.close(); httpServer.close(); await db.pool.end(); } catch { /* teardown */ }
  process.exit(1);
});