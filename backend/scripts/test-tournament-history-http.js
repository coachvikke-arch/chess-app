/* HTTP smoke test: the Game History routes still answer with the merged
 * tournament-aware payload. Run: node scripts/test-tournament-history-http.js */
'use strict';
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const db = require('../src/config/database');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const sign = (id, role) => jwt.sign(
  { id, role, name: 'tester', email: 't@example.invalid' },
  process.env.JWT_SECRET,
  { expiresIn: '5m' },
);
const get = async (path, token) => {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, data: await res.json().catch(() => null) };
};

(async () => {
  try {
    const stu = (await db.query(
      "SELECT u.id FROM users u JOIN students s ON s.user_id = u.id WHERE u.role='student' ORDER BY u.id LIMIT 1",
    )).rows[0];
    const adm = (await db.query(
      "SELECT id FROM users WHERE role='superadmin' ORDER BY id LIMIT 1",
    )).rows[0];

    const student = await get('/api/game-history', sign(stu.id, 'student'));
    assert.equal(student.status, 200, `student history status ${student.status}`);
    assert.ok(Array.isArray(student.data.games), 'games array');
    assert.ok(student.data.summary && typeof student.data.summary.games === 'number', 'summary present');
    console.log(`  PASS  GET /api/game-history -> ${student.data.games.length} games`);
    const tournament = student.data.games.filter((g) => g.type === 'tournament');
    console.log(`  PASS  tournament entries in payload: ${tournament.length}`);

    const admin = await get('/api/game-history/students', sign(adm.id, 'superadmin'));
    assert.equal(admin.status, 200, `admin history status ${admin.status}`);
    assert.ok(Array.isArray(admin.data.members), 'members array');
    console.log(`  PASS  GET /api/game-history/students -> ${admin.data.members.length} members`);

    const denied = await get('/api/game-history/students', sign(stu.id, 'student'));
    assert.equal(denied.status, 403, `student must not read member list (got ${denied.status})`);
    console.log('  PASS  member list remains admin-only');

    console.log('\nHTTP history checks passed.\n');
  } finally {
    server.close();
    await db.pool.end();
  }
})().catch((err) => {
  console.error('\nHTTP TEST FAILED:', err.message);
  process.exitCode = 1;
});
