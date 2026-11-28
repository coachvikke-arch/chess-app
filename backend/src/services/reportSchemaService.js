const fs = require('fs');
const path = require('path');
const db = require('../config/database');

/**
 * The per-time-control rating tables are installed by a migration that a fresh
 * Neon database never received. Report endpoints read them on every request,
 * so waiting for a manual migration to be pasted into the production database
 * is not acceptable — the API installs them lazily, once, and then every
 * request shares the same resolved promise.
 *
 * The SQL is read from the migration file, which stays the single source of
 * truth for the schema: run_migration_time_control_ratings.js can apply the
 * same file by hand and can never drift from what the server creates.
 */
const DDL = fs.readFileSync(
  path.join(__dirname, '..', '..', 'migrations', 'add_time_control_ratings.sql'),
  'utf8'
);

let ready = null;

async function run() {
  await db.query(DDL);
}

async function ensureReportSchema() {
  if (!ready) {
    ready = run().catch((err) => {
      ready = null; // allow the next request to retry after a transient outage
      throw err;
    });
  }
  return ready;
}

module.exports = { ensureReportSchema, DDL };
