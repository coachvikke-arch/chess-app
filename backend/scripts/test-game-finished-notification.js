/* Regression test: a student finishing a classroom game must notify the coach.
 *
 * The bug this exists to catch: `notifyClassGameFinished` looked up the class in
 * a table named `live_classes`, which does not exist (the table is `classes`).
 * The throw was swallowed by the function's own try/catch and downgraded to a
 * console warning, so every completed classroom game silently produced no coach
 * notification — no row, no bell, nothing. Because the failure was silent, only
 * an end-to-end assertion on the delivered notification can catch a regression.
 *
 * Flow: boot the real app + socket wiring, have the class coach start a
 * computer game for a student over HTTP, connect the coach's socket, have the
 * student resign, then assert the coach received a `game_result` notification
 * both over the socket and as a persisted row.
 *
 * Requires the backend deps; socket.io-client is resolved from frontend/.
 *
 * Run: node scripts/test-game-finished-notification.js
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { io: ioClient } = require(path.join(__dirname, '..', '..', 'frontend', 'node_modules', 'socket.io-client'));
const app = require('../src/app');
const db = require('../src/config/database');

let pass = 0;

/* Mirror server.js's wiring exactly — same auth middleware, same attach point,
   and the same `user:<id>` room join that notificationService pushes through. */
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
io.on('connection', (socket) => {
  if (socket.user && socket.user.id != null) socket.join(`user:${socket.user.id}`);
});

const port = httpServer.address().port;
const base = `http://127.0.0.1:${port}`;

const sign = (u) =>
  jwt.sign({ id: u.id, role: u.role, name: u.name, email: u.email }, process.env.JWT_SECRET, { expiresIn: '5m' });

const connect = (token) =>
  new Promise((resolve, reject) => {
    const s = ioClient(base, { path: '/socket.io', transports: ['websocket'], auth: { token } });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(new Error(`connect failed: ${e.message}`)));
  });

const post = (token, url, body) =>
  fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body || {}),
  });

/** Wait for a named event, or resolve null on timeout. */
function once(s, event, ms = 3000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { s.off(event, h); resolve(null); }, ms);
    const h = (payload) => { clearTimeout(t); s.off(event, h); resolve(payload); };
    s.on(event, h);
  });
}

async function main() {
  /* A class the coach actually runs — `notifyClassGameFinished` notifies
     `classes.coach_id`, so the fixture must have one. */
  const { rows: cls } = await db.query(
    `SELECT c.id, c.coach_id, u.role AS coach_role, u.name AS coach_name, u.email AS coach_email
       FROM classes c JOIN users u ON u.id = c.coach_id
      WHERE c.coach_id IS NOT NULL
      ORDER BY (c.status = 'live') DESC, c.id DESC LIMIT 1`,
  );
  assert.ok(cls.length, 'need a class with a coach to test against');
  const klass = cls[0];
  const coach = { id: klass.coach_id, role: klass.coach_role, name: klass.coach_name, email: klass.coach_email };

  /* The student must be a real student account: createClassroomBotGames JOINs
     the `students` table and rejects non-students. */
  const { rows: stus } = await db.query(
    `SELECT u.id, u.name, u.role, u.email
       FROM users u JOIN students st ON st.user_id = u.id
      ORDER BY u.id LIMIT 1`,
  );
  assert.ok(stus.length, 'need a student enrolled in the students table');
  const student = stus[0];

  console.log(`class ${klass.id}, coach ${coach.id} (${coach.role}), student ${student.id}\n`);

  const coachSock = await connect(sign(coach));
  const studentSock = await connect(sign(student));
  let gameId = null;

  try {
    const created = await post(sign(coach), '/api/online/classroom-bot-games', {
      classId: klass.id,
      studentIds: [student.id],
      botColor: 'white',
      botLevel: 3,
      timeControl: { baseMinutes: 5, incrementSeconds: 0 },
    });
    const body = await created.json();
    assert.equal(created.status, 201, `create game (got ${created.status}: ${JSON.stringify(body)})`);
    assert.ok(Array.isArray(body.games) && body.games.length === 1, 'one computer game created');
    /* The endpoint returns spectator payloads, whose id field is `gameId`. */
    gameId = body.games[0].gameId;
    assert.ok(gameId, 'created game has an id');

    /* Register the listeners before the resign so the pushes can't be missed. */
    const gotBell = once(coachSock, 'notification');
    const gotFinished = once(studentSock, 'game-finished-in-class');

    const resigned = await post(sign(student), `/api/online/games/${gameId}/resign`, {});
    const resignedBody = await resigned.json();
    assert.equal(resigned.status, 200, `student resign (got ${resigned.status}: ${JSON.stringify(resignedBody)})`);

    const bell = await gotBell;
    assert.ok(bell, 'the coach received a notification push over the socket');
    assert.equal(bell.type, 'game_result');
    assert.equal(Number(bell.related_id), Number(gameId));
    assert.equal(Number(bell.sender_id), Number(student.id));
    assert.ok(/finished/i.test(bell.title), `notification title names the event (got "${bell.title}")`);

    /* The persisted row is the real contract — the socket push is best effort. */
    const row = await db.query(
      `SELECT id, type, message FROM notifications
        WHERE user_id = $1 AND type = 'game_result' AND related_id = $2`,
      [coach.id, gameId],
    );
    assert.equal(row.rows.length, 1, 'exactly one game_result notification row persisted for the coach');
    assert.ok(row.rows[0].message.length > 0, 'notification carries a message');

    /* The student gets a matching event so their board reflects the class result. */
    const finished = await gotFinished;
    assert.ok(finished, 'the student received the game-finished-in-class event');
    assert.equal(Number(finished.gameId), Number(gameId));
    assert.equal(finished.result, resignedBody.result);

    pass += 2;
    console.log('PASS  a finished classroom game persists a game_result notification for the coach');
    console.log('PASS  the coach is notified live and the student gets the completion event');

    /* Keep the fixture from piling up. */
    await db.query('DELETE FROM online_games WHERE id = $1', [gameId]);
    await db.query("DELETE FROM notifications WHERE type = 'game_result' AND related_id = $1", [gameId]);
    gameId = null;
  } finally {
    if (gameId) {
      await db.query('DELETE FROM online_games WHERE id = $1', [gameId]).catch(() => {});
      await db.query("DELETE FROM notifications WHERE type = 'game_result' AND related_id = $1", [gameId]).catch(() => {});
    }
    coachSock.close();
    studentSock.close();
  }

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