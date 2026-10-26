require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

/**
 * must_change_password migration runner.
 *
 * Adds the flag that tells the app "this account still uses the password the
 * academy issued", so a newly registered student is sent to a change-password
 * screen at their first sign-in. The verification step is the point: a column
 * that was added under a different name would fail here rather than quietly
 * leaving every student on a temporary password for ever.
 */
(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'migrations', 'add_must_change_password.sql'), 'utf8');
    await db.pool.query(sql);

    const cols = await db.pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
        AND column_name = 'must_change_password'
    `);
    if (cols.rows.length !== 1) {
      throw new Error('users.must_change_password is missing');
    }
    const col = cols.rows[0];
    if (col.data_type !== 'boolean') throw new Error(`must_change_password must be boolean, got ${col.data_type}`);
    if (col.is_nullable !== 'NO') throw new Error('must_change_password must be NOT NULL');
    if (!/false/i.test(String(col.column_default))) {
      throw new Error(`must_change_password must default to false, got ${col.column_default}`);
    }

    /* Every existing account must be unaffected: the flag is false for all of
       them, so nobody is locked out of a password they already chose. */
    const flagged = await db.pool.query(
      'SELECT count(*)::int AS n FROM users WHERE must_change_password = true',
    );
    if (flagged.rows[0].n !== 0) {
      throw new Error(`${flagged.rows[0].n} existing accounts were flagged - the default must be false`);
    }

    console.log('MUST_CHANGE_PASSWORD MIGRATION OK — users.must_change_password added (boolean, NOT NULL, default false).');
    process.exit(0);
  } catch (error) {
    console.error('MUST_CHANGE_PASSWORD MIGRATION FAILED:', error.message);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();
