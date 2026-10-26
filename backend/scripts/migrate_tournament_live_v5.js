/* Tournament v5: authoritative clock, winner identity and pairing health.
 *
 * Additive only, safe to run more than once. Mirrors
 * migrations/upgrade_tournaments_v5.sql.
 *
 * Run: node scripts/migrate_tournament_live_v5.js */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');

(async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', 'upgrade_tournaments_v5.sql'),
    'utf8'
  );
  await db.query(sql);
  console.log('tournament live v5 migration complete');
  process.exit(0);
})().catch((e) => {
  console.error('migration failed:', e.message);
  process.exit(1);
});
