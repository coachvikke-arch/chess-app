/* Applies the feature-permission migration and prints what landed.
   Safe to re-run: every statement is CREATE ... IF NOT EXISTS / ON CONFLICT. */
const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'add_feature_permissions.sql'), 'utf8');
  await db.query(sql);

  const feats = await db.query(
    'SELECT category, count(*)::int AS n FROM features GROUP BY category ORDER BY category',
  );
  console.log('features seeded:');
  feats.rows.forEach((r) => console.log(`  ${r.category}: ${r.n}`));

  const perms = await db.query('SELECT count(*)::int AS n FROM role_permissions');
  console.log('role_permission rows:', perms.rows[0].n);

  const on = await db.query(
    `SELECT role, count(*)::int AS n FROM role_permissions WHERE is_enabled GROUP BY role ORDER BY role`,
  );
  console.log('enabled per role:', JSON.stringify(on.rows));

  await db.pool.end();
}

main().catch(async (err) => {
  console.error('MIGRATION FAILED:', err.message);
  await db.pool.end();
  process.exitCode = 1;
});
