// One-time bootstrap: create the academy's first super admin account.
// Super admins own the account-registration console at /super (the existing
// POST /auth/register endpoint is restricted to the superadmin role).
//
// Usage (from backend/):
//   node scripts/create-super-admin.js --email owner@academy.com --password 's3cret!' --name "Academy Owner"
//
// Uses the existing users table + bcrypt — no new auth system.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../src/config/database');

async function main() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    const value = argv[i + 1];
    if (!key || key === value) continue;
    args[key] = value;
    i += 1;
  }

  const email = (args.email || '').trim().toLowerCase();
  const password = args.password || '';
  const name = (args.name || 'Super Admin').trim();

  if (!email || !password) {
    console.error('Usage: node scripts/create-super-admin.js --email yours@academy.com --password yourpass [--name "Your Name"]');
    process.exit(1);
  }

  const existing = await db.pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    console.error(`A user already exists with email ${email}. If it should become a super admin, update its role via SQL.`);
    await db.pool.end();
    process.exit(1);
  }

  const hashed = await bcrypt.hash(password, 10);
  const created = await db.pool.query(
    `INSERT INTO users (name, email, password, role, board_theme, piece_set)
     VALUES ($1, $2, $3, 'superadmin', 'classic-green', 'cburnett')
     RETURNING id, name, email, role`,
    [name, email, hashed]
  );
  console.log('Super admin created:', created.rows[0]);
  console.log('Sign in at /login and you will land on /super where you can register students and admins.');
  await db.pool.end();
}

main().catch((err) => {
  console.error('Failed to create super admin:', err.message);
  process.exit(1);
});