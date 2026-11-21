/* eslint-disable no-console */
/* Fresh-database bootstrap for managed hosts (Render + Neon).
 *
 * schema.sql creates the base tables; the files in migrations/ add the
 * feature tables and columns the app queries. Every migration SQL file is
 * written to be re-runnable (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT
 * EXISTS / DO $$ ... END $$ guards), so applying them all at once is safe on a
 * brand-new Neon database and on a database that already has some migrations.
 *
 * A migration that fails is logged and skipped rather than aborting the build:
 * several of the older files assume columns from even older, already-applied
 * migrations, and failing the whole deploy for those would leave the site down
 * over a migration for a feature that is not in use. The summary at the end
 * lists every failed file so it can be investigated from the Render logs.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('[bootstrap-db] DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const schemaPath = path.join(__dirname, '..', 'src', 'db', 'schema.sql');
  const migrationsDir = path.join(__dirname, '..', 'migrations');

  console.log('[bootstrap-db] applying base schema');
  await pool.query(fs.readFileSync(schemaPath, 'utf8'));

  const files = fs.readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const failed = [];
  for (const name of files) {
    try {
      await pool.query(fs.readFileSync(path.join(migrationsDir, name), 'utf8'));
    } catch (err) {
      failed.push(name);
      console.warn(`[bootstrap-db] skipped ${name}: ${err.message.split('\n')[0]}`);
    }
  }

  console.log(
    `[bootstrap-db] done: ${files.length - failed.length}/${files.length} migrations applied`,
  );
  if (failed.length) console.warn(`[bootstrap-db] failed files: ${failed.join(', ')}`);
}

main()
  .catch((err) => {
    console.error('[bootstrap-db] base schema failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
