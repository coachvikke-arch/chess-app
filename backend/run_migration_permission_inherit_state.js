require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

/* Makes role_permissions.is_enabled nullable so the admin grid can store three
 * states per role: TRUE (on), FALSE (off), NULL (inherit from the category).
 *
 * This is schema-affecting but non-destructive: it only relaxes a constraint, it
 * does not rewrite any rows. The SQL deliberately leaves existing FALSE values
 * alone — see the header comment in the migration for why.
 */
(async () => {
  try {
    const before = await db.pool.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'role_permissions' AND column_name = 'is_enabled'`
    );
    if (before.rows.length === 0) {
      throw new Error('Missing table/column: role_permissions.is_enabled');
    }
    const already = before.rows[0].is_nullable === 'YES';
    if (already) {
      console.log('SKIP - role_permissions.is_enabled already allows NULL (Inherit supported).');
    } else {
      await db.pool.query(
        fs.readFileSync(path.join(__dirname, 'migrations', 'add_permission_inherit_state.sql'), 'utf8')
      );
      console.log('APPLIED - role_permissions.is_enabled is now nullable.');
    }

    /* Verify, don't assume: the whole tri-state feature silently degrades to
     * two states if this is wrong, with no error anywhere. */
    const after = await db.pool.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'role_permissions' AND column_name = 'is_enabled'`
    );
    if (after.rows[0].is_nullable !== 'YES') {
      throw new Error('is_enabled still NOT NULL after migration');
    }
    const nulls = await db.pool.query(
      'SELECT count(*)::int AS n FROM role_permissions WHERE is_enabled IS NULL'
    );
    const total = await db.pool.query('SELECT count(*)::int AS n FROM role_permissions');
    console.log(`OK - tri-state supported. ${nulls.rows[0].n}/${total.rows[0].n} rows set to Inherit.`);
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();