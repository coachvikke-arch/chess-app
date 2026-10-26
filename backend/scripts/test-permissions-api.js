/* End-to-end check of the permission system over real HTTP with real JWTs:
 * the gate, the superadmin bypass, the control-panel API and its guard.

   Run: node scripts/test-permissions-api.js                        */
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const db = require('../src/config/database');
const svc = require('../src/services/permissionService');

let pass = 0;
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function api(path, token, opts = {}) {
  const res = await fetch(`${base}${path}`, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
}

const sign = (id, role) =>
  jwt.sign({ id, role, name: 'tester', email: 't@example.invalid' }, process.env.JWT_SECRET, {
    expiresIn: '5m',
  });

const check = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS  ${name}`);
    pass += 1;
  } catch (err) {
    console.log(`FAIL  ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
};

async function main() {
  /* Real user ids: role_permissions.updated_by is a real FK, so a synthetic id
     would fail the write with a 500 and mask the behaviour under test. */
  const { rows: su } = await db.query("SELECT id FROM users WHERE role = 'superadmin' ORDER BY id LIMIT 1");
  const { rows: co } = await db.query("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  const { rows: stu } = await db.query("SELECT id FROM users WHERE role = 'student' ORDER BY id LIMIT 1");
  assert.ok(su.length && co.length && stu.length, 'need a superadmin, coach and student to exist');

  const superId = su[0].id;
  const studentId = stu[0].id;

  /* The role switches below are set explicitly for determinism, but a REAL
   * per-user override outranks them (COALESCE(override, role) in
   * getEnabledFeaturesForUser). A live override on this user — e.g. leaderboard
   * granted, puzzle_trainer revoked — made the /permissions/me assertions fail
   * for a reason unrelated to the code under test. Snapshot and clear this
   * user's overrides so the baseline is the role defaults, then restore them. */
  const savedOverrides = (
    await db.query('SELECT * FROM user_permission_overrides WHERE user_id = $1', [studentId])
  ).rows;
  await db.query('DELETE FROM user_permission_overrides WHERE user_id = $1', [studentId]);

  /* Same reasoning for the role switch table itself. The role defaults are live
   * Super Admin configuration, so they get snapshotted and put back exactly -
   * a blanket "reset to the shipped all-OFF default" wiped every feature the
   * Super Admin had enabled, which is why switches appeared to turn themselves
   * off on the next refresh or re-login. */
  const savedRolePerms = (
    await db.query('SELECT feature_id, role, is_enabled, updated_by, updated_at FROM role_permissions')
  ).rows;
  const { rows: [auditMark] } = await db.query(
    'SELECT COALESCE(MAX(id), 0) AS id FROM feature_permission_audit',
  );

  const studentToken = sign(stu[0].id, 'student');
  const adminToken = sign(co[0].id, 'admin');
  const superToken = sign(superId, 'superadmin');

  /* Make the starting state explicit and identical for every assertion. */
  await svc.setRolePermission('puzzle_trainer', 'student', true, null);
  await svc.setRolePermission('leaderboard', 'student', false, null);

  /* ── the gate ── */
  await check('an enabled feature is not blocked by the gate', async () => {
    const r = await api('/api/puzzles/assigned', studentToken);
    assert.notEqual(r.status, 403, 'expected the gate to allow this');
  });

  await check('a gated request with no token is 401, not 403', async () => {
    const r = await api('/api/puzzles/assigned');
    assert.equal(r.status, 401);
  });

  await check('superadmin is never blocked by the gate', async () => {
    assert.equal(await svc.canAccess({ id: superId, role: 'superadmin' }, 'leaderboard'), true);
  });

  /* ── self-service ── */
  await check('GET /permissions/me returns the caller feature list', async () => {
    const r = await api('/api/permissions/me', studentToken);
    assert.equal(r.status, 200);
    assert.ok(r.data.features.includes('puzzle_trainer'), 'expected puzzle_trainer');
    assert.ok(!r.data.features.includes('leaderboard'), 'leaderboard should be absent');
    assert.equal(r.data.ungated, false);
  });

  await check('GET /permissions/me marks superadmin ungated', async () => {
    const r = await api('/api/permissions/me', superToken);
    assert.equal(r.status, 200);
    assert.equal(r.data.ungated, true);
    assert.deepEqual(r.data.features, ['*']);
  });

  await check('GET /permissions/me works for a coach too', async () => {
    const r = await api('/api/permissions/me', adminToken);
    assert.equal(r.status, 200, 'a coach must be able to read their own list');
  });

  /* ── control panel is superadmin only ── */
  await check('a student cannot read the registry', async () => {
    assert.equal((await api('/api/permissions/features', studentToken)).status, 403);
  });

  await check('a coach cannot read the registry', async () => {
    assert.equal((await api('/api/permissions/features', adminToken)).status, 403);
  });

  await check('superadmin can read the registry', async () => {
    const r = await api('/api/permissions/features', superToken);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data) && r.data.length >= 18);
  });

  /* -- writing a switch --------------------------------------------------- */
  await check('superadmin can flip a switch and it takes effect at once', async () => {
    const on = await api('/api/permissions/features/leaderboard', superToken, {
      method: 'PATCH', body: { role: 'student', isEnabled: true },
    });
    assert.equal(on.status, 200);
    assert.equal(on.data.changed, true);

    const me = await api('/api/permissions/me', studentToken);
    assert.ok(me.data.features.includes('leaderboard'), 'the flip should reach the user');

    const back = await api('/api/permissions/features/leaderboard', superToken, {
      method: 'PATCH', body: { role: 'student', isEnabled: false },
    });
    assert.equal(back.status, 200);
  });

  await check('a coach cannot flip a switch', async () => {
    const r = await api('/api/permissions/features/leaderboard', adminToken, {
      method: 'PATCH', body: { role: 'student', isEnabled: true },
    });
    assert.equal(r.status, 403);
  });

  await check('a bad role is rejected with 400', async () => {
    const r = await api('/api/permissions/features/leaderboard', superToken, {
      method: 'PATCH', body: { role: 'superadmin', isEnabled: true },
    });
    assert.equal(r.status, 400);
  });

  await check('a non-boolean value is rejected with 400', async () => {
    const r = await api('/api/permissions/features/leaderboard', superToken, {
      method: 'PATCH', body: { role: 'student', isEnabled: 'yes' },
    });
    assert.equal(r.status, 400);
  });

  /* -- bulk --------------------------------------------------------------- */
  await check('bulk enable then disable round-trips', async () => {
    const on = await api('/api/permissions/bulk', superToken, {
      method: 'POST', body: { role: 'student', isEnabled: true, category: 'Student Tools' },
    });
    assert.equal(on.status, 200);
    assert.ok(on.data.total > 0);
    const off = await api('/api/permissions/bulk', superToken, {
      method: 'POST', body: { role: 'student', isEnabled: false, category: 'Student Tools' },
    });
    assert.equal(off.status, 200);
  });

  /* -- user overrides ----------------------------------------------------- */
  await check('a per-user override is readable and rejects bad input', async () => {
    const missing = await api('/api/permissions/users/99999999', superToken);
    assert.equal(missing.status, 404);
    const bad = await api(`/api/permissions/users/${studentId}/puzzle_trainer`, superToken, {
      method: 'PUT', body: { isEnabled: 'nope' },
    });
    assert.equal(bad.status, 400);
  });

  /* -- audit -------------------------------------------------------------- */
  await check('the audit log records the switch we just made', async () => {
    const r = await api('/api/permissions/audit?limit=200', superToken);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data) && r.data.length > 0);
    assert.ok(r.data.some((a) => a.feature_key === 'leaderboard'));
  });

  await check('a student cannot read the audit log', async () => {
    assert.equal((await api('/api/permissions/audit', studentToken)).status, 403);
  });

  /* Restore the operator's real switch values byte for byte. */
  await db.query('DELETE FROM role_permissions');
  for (const r of savedRolePerms) {
    await db.query(
      `INSERT INTO role_permissions (feature_id, role, is_enabled, updated_by, updated_at)
            VALUES ($1, $2, $3, $4, $5)`,
      [r.feature_id, r.role, r.is_enabled, r.updated_by, r.updated_at],
    );
  }
  /* Remove the role-scope audit entries this run appended, so the admin audit
     log is not filled with system changes nobody made. */
  await db.query('DELETE FROM feature_permission_audit WHERE id > $1', [auditMark.id]);

  /* Put the user's real overrides back exactly as they were. */
  await db.query('DELETE FROM user_permission_overrides WHERE user_id = $1', [studentId]);
  for (const o of savedOverrides) {
    await db.query(
      `INSERT INTO user_permission_overrides (user_id, feature_id, is_enabled, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [o.user_id, o.feature_id, o.is_enabled, o.updated_by, o.updated_at],
    );
  }

  console.log('\n' + pass + ' checks passed');
  server.close();
  await db.pool.end();
}

main().catch(async (err) => {
  console.error('TEST ERROR:', err.stack);
  server.close();
  await db.pool.end();
  process.exitCode = 1;
});
