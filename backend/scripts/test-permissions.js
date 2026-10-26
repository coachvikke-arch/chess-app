/* Verifies the permission resolution rules against the real database:
   fail-closed defaults, override precedence, role mapping and the
   superadmin bypass. Uses a scratch user, cleaned up at the end.

   Run: node scripts/test-permissions.js                            */
const db = require('../src/config/database');
const svc = require('../src/services/permissionService');

let pass = 0;
/* `async` because most rules need the database; a rejected promise is a fail. */
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

const assert = require('node:assert/strict');

async function main() {
  /* Bind the generated email as a parameter: interpolating JS into the SQL
     string would make Postgres try to parse `Date` as a table. */
  const scratchEmail = `perm-test-${Date.now()}@example.invalid`;
  const { rows: created } = await db.query(
    `INSERT INTO users (name, email, password, role)
          VALUES ($1, $2, $3, 'student')
      RETURNING id, role`,
    ['__perm_test__', scratchEmail, 'x'],
  );
  const testUser = created[0];

  /* Snapshot the real switch table before touching it. These switches are live
     Super Admin configuration, not fixtures: a blanket "reset to the shipped
     all-OFF default" in the finally block used to wipe every feature the
     Super Admin had actually turned on, so the panel showed them all Off again
     after the next refresh or re-login. Restore the exact snapshot instead. */
  const { rows: permSnapshot } = await db.query(
    'SELECT feature_id, role, is_enabled, updated_by, updated_at FROM role_permissions',
  );
  const { rows: [auditMark] } = await db.query(
    'SELECT COALESCE(MAX(id), 0) AS id FROM feature_permission_audit',
  );

  try {
    /* ── starting state, made explicit ──
       Every switch this suite reads must be pinned here. The operator's real
       Feature Access configuration is restored on exit, so the baseline can no
       longer be assumed to be "everything OFF" - any feature a later check
       reads without pinning it inherits whatever the Super Admin had set. */
    await svc.setRolePermission('puzzle_trainer', 'student', true, null);
    await svc.setRolePermission('leaderboard', 'student', false, null);
    /* live_game is read by the "disabled feature resolves false" and "one audit
       row per change" checks, so it has to start OFF for them to mean anything. */
    await svc.setRolePermission('live_game', 'student', false, null);

    /* ── pure mapping helpers ── */
    await check('admin maps to the coach permission role', () => {
      assert.equal(svc.toPermissionRole('admin'), 'coach');
      assert.equal(svc.toPermissionRole('student'), 'student');
      assert.equal(svc.toPermissionRole('superadmin'), 'superadmin');
    });

    await check('only superadmin is ungated', () => {
      assert.equal(svc.isUngatedRole('superadmin'), true);
      assert.equal(svc.isUngatedRole('admin'), false);
      assert.equal(svc.isUngatedRole('student'), false);
    });

    /* ── superadmin bypass (the anti-lockout rule) ── */
    await check('superadmin gets every feature and passes any single check', async () => {
      assert.deepEqual(await svc.getEnabledFeaturesForUser({ id: 1, role: 'superadmin' }), ['*']);
      /* even a key that does not exist resolves true */
      assert.equal(await svc.canAccess({ id: 1, role: 'superadmin' }, 'nope_not_real'), true);
    });

    /* ── fail-closed ── */
    await check('an unregistered feature is denied for a student', async () => {
      assert.equal(await svc.canAccess(testUser, 'no_such_feature_key'), false);
    });

    await check('a feature whose switch row is deleted is denied', async () => {
      await db.query(
        'DELETE FROM role_permissions WHERE feature_id = (SELECT id FROM features WHERE key = $1)',
        ['leaderboard'],
      );
      assert.equal(await svc.canAccess(testUser, 'leaderboard'), false);
    });

    await check('an enabled feature resolves true', async () => {
      assert.equal(await svc.canAccess(testUser, 'puzzle_trainer'), true);
    });

    await check('a disabled feature resolves false', async () => {
      assert.equal(await svc.canAccess(testUser, 'live_game'), false);
    });

    /* ── unknown identities ── */
    await check('an unknown role is denied entirely', async () => {
      assert.deepEqual(await svc.getEnabledFeaturesForUser({ id: 1, role: 'parent' }), []);
      assert.equal(await svc.canAccess({ id: 1, role: 'parent' }, 'puzzle_trainer'), false);
    });

    await check('a missing user is denied entirely', async () => {
      assert.deepEqual(await svc.getEnabledFeaturesForUser(null), []);
      assert.equal(await svc.canAccess(null, 'puzzle_trainer'), false);
    });

    /* ── writes + audit trail ── */
    await check('a role switch change writes exactly one audit row', async () => {
      const before = await db.query('SELECT count(*)::int AS n FROM feature_permission_audit');
      const changed = await svc.setRolePermission('live_game', 'student', true, null);
      assert.equal(changed, true);
      const after = await db.query('SELECT count(*)::int AS n FROM feature_permission_audit');
      assert.equal(after.rows[0].n, before.rows[0].n + 1);
      await svc.setRolePermission('live_game', 'student', false, null);
    });

    await check('writing the same value again is a no-op with no audit row', async () => {
      const before = await db.query('SELECT count(*)::int AS n FROM feature_permission_audit');
      assert.equal(await svc.setRolePermission('puzzle_trainer', 'student', true, null), false);
      const after = await db.query('SELECT count(*)::int AS n FROM feature_permission_audit');
      assert.equal(after.rows[0].n, before.rows[0].n);
    });

    await check('the audit row records the old and new value', async () => {
      await svc.setRolePermission('live_game', 'student', true, null);
      const { rows } = await db.query(
        "SELECT old_value, new_value FROM feature_permission_audit WHERE feature_key = 'live_game' ORDER BY id DESC LIMIT 1",
      );
      assert.equal(rows[0].old_value, false);
      assert.equal(rows[0].new_value, true);
      await svc.setRolePermission('live_game', 'student', false, null);
    });

    /* ── bulk ── */
    await check('bulk enable switches on a whole category', async () => {
      const res = await svc.bulkSetRolePermission('student', true, null, { category: 'Student Tools' });
      assert.ok(res.total > 0);
      const rows = await db.query(
        "SELECT count(*)::int AS n FROM features f JOIN role_permissions rp ON rp.feature_id = f.id WHERE rp.role = 'student' AND rp.is_enabled AND f.category = 'Student Tools'",
      );
      assert.equal(rows.rows[0].n, res.total);
    });

    await check('bulk disable switches the category back off', async () => {
      await svc.bulkSetRolePermission('student', false, null, { category: 'Student Tools' });
      const rows = await db.query(
        "SELECT count(*)::int AS n FROM features f JOIN role_permissions rp ON rp.feature_id = f.id WHERE rp.role = 'student' AND rp.is_enabled AND f.category = 'Student Tools'",
      );
      assert.equal(rows.rows[0].n, 0);
    });

    /* ── per-user overrides ── */
    await check('a deny override beats the role default', async () => {
      await svc.setRolePermission('puzzle_trainer', 'student', true, null);
      assert.equal(await svc.canAccess(testUser, 'puzzle_trainer'), true);
      await svc.setUserOverride(testUser.id, 'puzzle_trainer', false, null);
      assert.equal(await svc.canAccess(testUser, 'puzzle_trainer'), false);
    });

    await check('clearing the override restores the role default', async () => {
      await svc.setUserOverride(testUser.id, 'puzzle_trainer', null, null);
      assert.equal(await svc.canAccess(testUser, 'puzzle_trainer'), true);
    });

    await check('an override can grant a feature the role has disabled', async () => {
      await svc.setRolePermission('leaderboard', 'student', false, null);
      assert.equal(await svc.canAccess(testUser, 'leaderboard'), false);
      await svc.setUserOverride(testUser.id, 'leaderboard', true, null);
      assert.equal(await svc.canAccess(testUser, 'leaderboard'), true);
      await svc.setUserOverride(testUser.id, 'leaderboard', null, null);
    });

    await check('the enabled list reflects the override', async () => {
      await svc.setUserOverride(testUser.id, 'leaderboard', true, null);
      const list = await svc.getEnabledFeaturesForUser(testUser);
      assert.ok(list.includes('leaderboard'));
      await svc.setUserOverride(testUser.id, 'leaderboard', null, null);
    });

    await check('effective permissions expose role default vs override', async () => {
      await svc.setUserOverride(testUser.id, 'puzzle_trainer', false, null);
      const data = await svc.getUserEffectivePermissions(testUser.id);
      const row = data.features.find((f) => f.key === 'puzzle_trainer');
      assert.equal(row.role_default, true);
      assert.equal(row.override_value, false);
      assert.equal(row.effective, false);
      await svc.setUserOverride(testUser.id, 'puzzle_trainer', null, null);
    });

    await check('a user with no overrides matches their role defaults', async () => {
      const data = await svc.getUserEffectivePermissions(testUser.id);
      const mismatch = data.features.filter((f) => f.override_value !== null || f.effective !== f.role_default);
      assert.equal(mismatch.length, 0);
    });

    await check('an unknown user id returns null instead of throwing', async () => {
      assert.equal(await svc.getUserEffectivePermissions(99999999), null);
    });

    /* ── empty-state edge case ── */
    await check('a role with zero enabled features gets an empty list, not everything', async () => {
      await svc.bulkSetRolePermission('student', false, null);
      assert.deepEqual(await svc.getEnabledFeaturesForUser(testUser), []);
      assert.equal(await svc.canAccess(testUser, 'puzzle_trainer'), false);
    });

    /* ── admin grid shape ── */
    await check('the admin grid returns both role columns as strict booleans', async () => {
      const rows = await svc.listFeaturesWithPermissions();
      assert.ok(rows.length >= 18);
      for (const r of rows) {
        /* Exactly two states. A null here would mean the grid can offer a third
           option the API refuses to store, or that a legacy row is still
           leaking through COALESCE. */
        assert.equal(typeof r.student_enabled, 'boolean',
          r.key + ' student_enabled should be a boolean, got ' + r.student_enabled);
        assert.equal(typeof r.coach_enabled, 'boolean',
          r.key + ' coach_enabled should be a boolean, got ' + r.coach_enabled);
      }
    });

    /* The tri-state column is gone, so the third value must be refused at the
       service boundary rather than coerced into Off. Coercing it would mean a
       client bug silently disabling a section for a whole role. */
    await check('a null role switch is rejected, not coerced to off', async () => {
      const row = (await svc.listFeaturesWithPermissions()).find((r) => r.category === 'Student Tools');
      await assert.rejects(
        () => svc.setRolePermission(row.key, 'student', null),
        /boolean/,
        'null is not a valid role switch',
      );
      /* The rejection must leave the stored value alone. */
      const after = (await svc.listFeaturesWithPermissions()).find((r) => r.key === row.key);
      assert.equal(after.student_enabled, row.student_enabled, 'the rejected write changed nothing');
    });

    /* A feature that ships without a row, or a row deleted by mistake, must
       deny. This was the reason the tri-state draft was removed: its inherit
       branch failed OPEN for a role's own category. */
    await check('a missing row denies rather than falling back to on', async () => {
      const row = (await svc.listFeaturesWithPermissions()).find((r) => r.category === 'Student Tools');
      await db.query('DELETE FROM role_permissions WHERE feature_id = (SELECT id FROM features WHERE key = $1)', [row.key]);

      const asStudent = await svc.getEnabledFeaturesForUser({ id: testUser.id, role: 'student' });
      assert.ok(!asStudent.includes(row.key), 'a deleted row must not grant access');
      assert.equal(await svc.canAccess({ id: testUser.id, role: 'student' }, row.key), false);
    });

    /* The two columns are independent: writing one role must not disturb the
       other role's switch for the same feature. */
    await check('student and coach switches are independent columns', async () => {
      const row = (await svc.listFeaturesWithPermissions()).find((r) => r.category === 'Student Tools');
      await svc.setRolePermission(row.key, 'student', true);
      await svc.setRolePermission(row.key, 'coach', false);

      const asStudent = await svc.getEnabledFeaturesForUser({ id: testUser.id, role: 'student' });
      const asCoach = await svc.getEnabledFeaturesForUser({ id: testUser.id, role: 'admin' });
      assert.ok(asStudent.includes(row.key), 'student column grants to students');
      assert.ok(!asCoach.includes(row.key), 'coach column independently denies to coaches');

      /* Both the same, too: one role on must not imply the other. */
      await svc.setRolePermission(row.key, 'coach', true);
      const asCoachBoth = await svc.getEnabledFeaturesForUser({ id: testUser.id, role: 'admin' });
      assert.ok(asCoachBoth.includes(row.key), 'coach column grants once set');

      await svc.setRolePermission(row.key, 'student', false);
      const asStudentOff = await svc.getEnabledFeaturesForUser({ id: testUser.id, role: 'student' });
      assert.ok(!asStudentOff.includes(row.key), 'student column denies once cleared');
      assert.ok(asCoachBoth.includes(row.key), 'clearing student left coach alone');
    });

    /* The bug this feature exists to prevent: an explicit Off must survive a
       later read. With a nullable column an off could be re-read as null and
       flip back on. */
    await check('an explicit off survives a later read', async () => {
      const row = (await svc.listFeaturesWithPermissions()).find((r) => r.category === 'Coach Tools');
      await svc.setRolePermission(row.key, 'coach', true);
      await svc.setRolePermission(row.key, 'coach', false);

      const reread = (await svc.listFeaturesWithPermissions()).find((r) => r.key === row.key);
      assert.equal(reread.coach_enabled, false, 'still a strict false in the grid');
      const asCoach = await svc.getEnabledFeaturesForUser({ id: testUser.id, role: 'admin' });
      assert.ok(!asCoach.includes(row.key), 'explicitly off stays off');
    });
  } finally {
    /* Put the operator's real switch values back byte for byte. Nothing here
       may assume an all-OFF baseline: whoever runs this has usually already
       configured access in the Feature Access panel. */
    await db.query('DELETE FROM role_permissions');
    for (const r of permSnapshot) {
      await db.query(
        `INSERT INTO role_permissions (feature_id, role, is_enabled, updated_by, updated_at)
              VALUES ($1, $2, $3, $4, $5)`,
        [r.feature_id, r.role, r.is_enabled, r.updated_by, r.updated_at],
      );
    }
    /* Drop the role-scope audit noise this run appended, so the admin audit log
       does not fill with system entries that no one actually changed. */
    await db.query('DELETE FROM feature_permission_audit WHERE id > $1', [auditMark.id]);
    await db.query('DELETE FROM user_permission_overrides WHERE user_id = $1', [testUser.id]);
    await db.query('DELETE FROM feature_permission_audit WHERE target_user_id = $1', [testUser.id]);
    await db.query('DELETE FROM users WHERE id = $1', [testUser.id]);
  }

  console.log('\n' + pass + ' checks passed');
  await db.pool.end();
}

main().catch(async (err) => {
  console.error('TEST ERROR:', err.stack);
  await db.pool.end();
  process.exitCode = 1;
});

