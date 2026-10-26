/* Resets every role switch to OFF — the fail-closed default.
   Run: node scripts/reset-baseline.js                                */
const db = require('../src/config/database');

async function main() {
  await db.query('UPDATE role_permissions SET is_enabled = FALSE');
  /* Also drop per-user overrides, which otherwise survive a role reset and keep
     granting access to whoever they were written for. */
  await db.query('DELETE FROM user_permission_overrides');
  await db.query(
    `INSERT INTO role_permissions (feature_id, role, is_enabled)
     SELECT f.id, r.role, FALSE
       FROM features f
       CROSS JOIN (VALUES ('student'), ('coach')) AS r(role)
     ON CONFLICT (feature_id, role) DO UPDATE SET is_enabled = FALSE`,
  );
  const r = await db.query(
    `SELECT role, count(*)::int AS total,
            count(*) FILTER (WHERE is_enabled)::int AS enabled
       FROM role_permissions GROUP BY role ORDER BY role`,
  );
  const o = await db.query('SELECT count(*)::int AS n FROM user_permission_overrides');
  console.log('all role switches reset to OFF:', JSON.stringify(r.rows));
  console.log('per-user overrides cleared:', o.rows[0].n);
  await db.pool.end();
}

main().catch(async (err) => {
  console.error('RESET FAILED:', err.message);
  await db.pool.end();
  process.exitCode = 1;
});
