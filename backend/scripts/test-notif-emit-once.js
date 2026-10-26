/* Live audit: ONE match request must produce exactly ONE socket event per
 * channel per recipient (1x game-invite + 1x notification to the receiver,
 * 1x notification to the sender) — never duplicates.
 *
 * Run: node scripts/test-notif-emit-once.js
 * Boots the real app + connects two real socket.io clients, creates a match
 * request over HTTP, counts what each side receives, then cleans everything up
 * (snapshot/restore like the other suites).
 */
const assert = require('node:assert/strict');
const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { io } = require('../../frontend/node_modules/socket.io-client');
const app = require('../src/app');
const db = require('../src/config/database');

const sign = (id, role) =>
  jwt.sign({ id, role, name: 'tester', email: 't@example.invalid' }, process.env.JWT_SECRET, { expiresIn: '5m' });

async function main() {
  const { rows: stu } = await db.query(
    "SELECT u.id AS user_id, s.id AS student_id FROM users u JOIN students s ON s.user_id = u.id WHERE u.role = 'student' ORDER BY u.id LIMIT 2",
  );
  assert.ok(stu.length === 2, 'need two students');
  const [a, b] = stu;

  /* Same wiring as server.js (auth + user:<id> rooms), on an ephemeral port,
     so controller emits reach real sockets. */
  const httpServer = http.createServer(app);
  const ioServer = new Server(httpServer, { path: '/socket.io' });
  app.set('io', ioServer);
  ioServer.use((socket, next) => {
    try {
      socket.user = jwt.verify(socket.handshake.auth?.token, process.env.JWT_SECRET);
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });
  ioServer.on('connection', (socket) => {
    socket.join(`user:${socket.user.id}`);
  });
  await new Promise((res) => httpServer.listen(0, res));
  const base = `http://127.0.0.1:${httpServer.address().port}`;

  const sockA = io(base, { path: '/socket.io', transports: ['websocket'], auth: { token: sign(a.user_id, 'student') } });
  const sockB = io(base, { path: '/socket.io', transports: ['websocket'], auth: { token: sign(b.user_id, 'student') } });
  await Promise.all([
    new Promise((res, rej) => { sockA.on('connect', res); setTimeout(() => rej(new Error('A no connect')), 8000); }),
    new Promise((res, rej) => { sockB.on('connect', res); setTimeout(() => rej(new Error('B no connect')), 8000); }),
  ]);

  const gotA = { 'game-invite': [], notification: [] };
  const gotB = { 'game-invite': [], notification: [] };
  for (const ev of ['game-invite', 'notification']) {
    sockA.on(ev, (p) => gotA[ev].push(p));
    sockB.on(ev, (p) => gotB[ev].push(p));
  }

  // A challenges B.
  const res = await fetch(`${base}/api/online/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sign(a.user_id, 'student')}` },
    body: JSON.stringify({ studentId: b.user_id, adminColor: 'white', timeControl: { baseMinutes: 5, incrementSeconds: 0 } }),
  });
  assert.equal(res.status, 201, `createGame failed: ${res.status}`);
  const game = await res.json();

  await new Promise((r) => setTimeout(r, 1500));

  let pass = 0;
  let fail = 0;
  const check = (name, fn) => {
    try { fn(); pass += 1; console.log(`  ok   ${name}`); }
    catch (err) { fail += 1; console.log(`  FAIL ${name}\n         ${err.message}`); }
  };

  console.log(`[notif-audit] game ${game.id}: receiver got ${gotB['game-invite'].length}x game-invite, ${gotB.notification.length}x notification; sender got ${gotA.notification.length}x notification`);
  check('receiver gets exactly 1 game-invite', () => assert.equal(gotB['game-invite'].length, 1));
  check('receiver gets exactly 1 notification (match_request row)', () => {
    assert.equal(gotB.notification.length, 1);
    assert.equal(gotB.notification[0]?.type, 'match_request');
  });
  check('sender gets exactly 1 notification (tracking row)', () => assert.equal(gotA.notification.length, 1));
  check('sender gets no game-invite', () => assert.equal(gotA['game-invite'].length, 0));

  // Cleanup: game + notification rows.
  await db.query('DELETE FROM notifications WHERE related_id = $1', [game.id]);
  await db.query('DELETE FROM online_games WHERE id = $1', [game.id]);
  sockA.disconnect();
  sockB.disconnect();
  ioServer.close();
  httpServer.close();
  await db.pool.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((err) => { console.error('audit crashed:', err); process.exitCode = 1; });
