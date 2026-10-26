/* Apply migrations/add_tournament_rating.sql (additive — safe to re-run).
 *
 * Run: node run_migration_tournament_rating.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const file = path.join(__dirname, 'migrations', 'add_tournament_rating.sql');
  await pool.query(fs.readFileSync(file, 'utf8'));
  console.log('Tournament rating migration applied.');
  await pool.end();
})().catch(async (err) => {
  console.error('Tournament rating migration failed:', err.message);
  try { await pool.end(); } catch (_) { /* ignore */ }
  process.exit(1);
});
