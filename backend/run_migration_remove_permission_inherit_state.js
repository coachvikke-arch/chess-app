require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

/* Restores NOT NULL on role_permissions.is_enabled, undoing the short-lived
 * tri-state (NULL = "inherit") migration. The third state resolved to the same
 * value as FALSE, so it added a control without adding behaviour.
 *
 * Schema-affecting: it rewrites legacy NULL rows to FALSE and then tightens the
 * constraint. The migration's WHERE clause means rows an admin deliberately set
 * are never touched - only NULL, which had no meaning of its own. */
(async () => {
  try {
    const before = await db.pool.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'role_permissions' AND column_name = 'is_enabled'`
    );
    if (before.rows.length === 0) {
      throw new Error('Missing table/column: role_permissions.is_enabled');
    }
    const nulls = await db.pool.query(
      'SELECT count(*)::int AS n FROM role_permissions WHERE is_enabled IS NULL'
    );
    if (nulls.rows[0].n > 0) {
      console.log(`Converting ${nulls.rows[0].n} legacy NULL row(s) to FALSE.`);
    } else {
      console.log('No legacy NULL rows - nothing to convert.');
    }

    if (before.rows[0].is_nullable === 'YES') {
      await db.pool.query(
        fs.readFileSync(path.join(__dirname, 'migrations', 'remove_permission_inherit_state.sql'), 'utf8')
      );
      console.log('APPLIED - is_enabled is NOT NULL again.');
    } else {
      console.log('SKIP - is_enabled is already NOT NULL.');
    }

    /* Verify rather than assume: the service relies on this being a strict
     * two-state column. */
    const after = await db.pool.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'role_permissions' AND column_name = 'is_enabled'`
    );
    if (after.rows[0].is_nullable !== 'NO') {
      throw new Error('is_enabled still nullable after migration');
    }
    const stray = await db.pool.query(
      'SELECT count(*)::int AS n FROM role_permissions WHERE is_enabled IS NULL'
    );
    if (stray.rows[0].n !== 0) {
      throw new Error(`${stray.rows[0].n} NULL rows survived`);
    }
    const total = await db.pool.query('SELECT count(*)::int AS n FROM role_permissions');
    console.log(`OK - two-state restored. ${total.rows[0].n} rows, no NULLs.`);
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();