/*
 * Concurrent-device session cap ("max 2 devices per user").
 *
 * Exercises the real controller + middleware + database:
 *   · two logins create two active sessions
 *   · a third device is REFUSED (409 DEVICE_LIMIT_REACHED); nothing is evicted
 *   · re-login on the SAME device still works at the cap
 *   · revoking a session makes its token 401 SESSION_REVOKED
 *   · logout / logout-all / password change free the slots
 *
 * Run: node --test scripts/test-user-sessions.js   (npm run test:user-sessions)
 */
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../src/config/database');
const authController = require('../src/controllers/authController');
const authMiddleware = require('../src/middleware/authMiddleware');
const sessionService = require('../src/services/sessionService');

const USERNAME = `sess_test_${Date.now()}`;
const EMAIL = `${USERNAME}@example.invalid`;
const PASSWORD = 'Passw0rd!123';

let userId = null;
const state = {}; // tokens/refresh tokens shared across subtests

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}

function fakeReq({ body = {}, token = null } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  return { body, headers, app: { get: () => null } };
}

async function login(deviceId, deviceName = 'Test device', platform = 'web') {
  const res = mockRes();
  await authController.login(
    fakeReq({ body: { username: USERNAME, password: PASSWORD, device_id: deviceId, device_name: deviceName, platform } }),
    res
  );
  return res;
}

async function callProtected(token) {
  const res = mockRes();
  let nextCalled = false;
  const req = fakeReq({ token });
  await authMiddleware(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

async function activeSessions() {
  const { rows } = await db.query(
    `SELECT id, device_id, revoked_at FROM user_sessions
      WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at ASC`,
    [userId]
  );
  return rows;
}

async function allSessions() {
  const { rows } = await db.query(
    `SELECT id, device_id, revoked_at FROM user_sessions
      WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId]
  );
  return rows;
}

test('concurrent-device session cap (max 2)', async (t) => {
  const hashed = await bcrypt.hash(PASSWORD, 10);
  const ins = await db.query(
    `INSERT INTO users (name, email, password, username, role)
     VALUES ($1, $2, $3, $4, 'student') RETURNING id`,
    ['Session Tester', EMAIL, hashed, USERNAME]
  );
  userId = ins.rows[0].id;

  try {
    await t.test('two logins create two active sessions', async () => {
      const a = await login('device-A', 'Laptop');
      assert.equal(a.statusCode, 200, `login A failed: ${a.body && a.body.message}`);
      const b = await login('device-B', 'Phone');
      assert.equal(b.statusCode, 200, `login B failed: ${b.body && b.body.message}`);

      state.tokenA = a.body.token;
      state.refreshA = a.body.refresh_token;
      state.tokenB = b.body.token;
      state.refreshB = b.body.refresh_token;

      const active = await activeSessions();
      assert.equal(active.length, 2, 'exactly two active sessions');
      assert.deepEqual(active.map((s) => s.device_id), ['device-A', 'device-B']);

      // The JWT is bound to the session row.
      const claims = jwt.verify(a.body.token, process.env.JWT_SECRET);
      assert.ok(claims.session_id, 'token carries session_id');
      assert.equal(claims.session_id, a.body.session.id);
    });

    await t.test('third device is refused at the cap (no eviction)', async () => {
      const c = await login('device-C', 'Tablet');
      assert.equal(c.statusCode, 409, `expected cap refusal, got ${c.statusCode}`);
      assert.equal(c.body.code, 'DEVICE_LIMIT_REACHED');
      assert.match(c.body.message, /already logged in on two devices/i);
      assert.equal(c.body.token, undefined, 'no token is issued');

      const active = await activeSessions();
      assert.equal(active.length, 2, 'still exactly two active sessions');
      assert.deepEqual(active.map((s) => s.device_id), ['device-A', 'device-B']);

      const all = await allSessions();
      assert.equal(all.length, 2, 'no third session row was created');
      assert.ok(all.every((s) => !s.revoked_at), 'neither existing device was revoked');
    });

    await t.test('same-device re-login does NOT add a session', async () => {
      const before = await allSessions();
      const again = await login('device-B', 'Phone');
      assert.equal(again.statusCode, 200);
      const after = await allSessions();

      assert.equal(after.length, before.length, 'no new session row');
      assert.equal((await activeSessions()).length, 2, 'still two active');
      assert.equal(again.body.session.reused, true, 'session was reused');
      state.tokenB = again.body.token;
      state.refreshB = again.body.refresh_token;
    });

    await t.test('active token passes the middleware', async () => {
      const { res, nextCalled } = await callProtected(state.tokenB);
      assert.equal(nextCalled, true, 'active session must pass');
      assert.equal(res.statusCode, 200);
    });

    await t.test('refresh token issues a new access token for the same session', async () => {
      const res = mockRes();
      await authController.refresh(fakeReq({ body: { refresh_token: state.refreshB } }), res);
      assert.equal(res.statusCode, 200);
      const claims = jwt.verify(res.body.token, process.env.JWT_SECRET);
      assert.ok(claims.session_id, 'refreshed token still session-bound');
      state.tokenB = res.body.token;
    });

    await t.test('revoking a session makes its token 401 SESSION_REVOKED', async () => {
      const active = await activeSessions();
      const a = active.find((s) => s.device_id === 'device-A');
      assert.ok(a, 'device-A session exists');
      assert.equal(await sessionService.revokeSession(a.id), 1);

      const { res, nextCalled } = await callProtected(state.tokenA);
      assert.equal(nextCalled, false, 'middleware must not continue');
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.code, 'SESSION_REVOKED');
      assert.match(res.body.message, /used on another device/i);
    });

    await t.test('a freed slot lets a new device sign in', async () => {
      const c = await login('device-C', 'Tablet');
      assert.equal(c.statusCode, 200, `login C failed: ${c.body && c.body.message}`);
      state.tokenC = c.body.token;
      state.refreshC = c.body.refresh_token;

      const active = await activeSessions();
      assert.equal(active.length, 2, 'device-C took the slot freed by device-A');
      assert.deepEqual(active.map((s) => s.device_id), ['device-B', 'device-C']);
    });

    await t.test('logout revokes the current session and frees the slot', async () => {
      const req = fakeReq({ token: state.tokenB });
      const res = mockRes();
      await authMiddleware(req, res, () => {});
      await authController.logout(req, res);
      assert.equal(res.statusCode, 200);

      const active = await activeSessions();
      assert.equal(active.length, 1, 'one session left after logout');
      assert.equal(active[0].device_id, 'device-C');

      // The logged-out device's token is now rejected too.
      const after = await callProtected(state.tokenB);
      assert.equal(after.res.statusCode, 401);
      assert.equal(after.res.body.code, 'SESSION_REVOKED');
    });

    await t.test('logout-all revokes every remaining session', async () => {
      const req = fakeReq({ token: state.tokenC });
      const res = mockRes();
      await authMiddleware(req, res, () => {});
      await authController.logoutAll(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal((await activeSessions()).length, 0, 'no active sessions left');
      const after = await callProtected(state.tokenC);
      assert.equal(after.res.statusCode, 401);
    });

    await t.test('password change revokes all sessions', async () => {
      await login('device-D', 'Desktop');
      await login('device-E', 'Phone 2');
      assert.equal((await activeSessions()).length, 2);

      const revoked = await sessionService.revokeAllSessions(userId);
      assert.equal(revoked.length, 2);
      assert.equal((await activeSessions()).length, 0);
    });
  } finally {
    await db.query('DELETE FROM notifications WHERE user_id = $1', [userId]).catch(() => {});
    await db.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]).catch(() => {});
    await db.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
    await db.pool.end();
  }
});
