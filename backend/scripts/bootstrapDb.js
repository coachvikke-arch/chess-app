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

/* schema.sql is not in dependency order (some early constraints reference
 * tables created later), so sending the whole file as one multi-statement query
 * aborts the entire transaction on the first ordering error. Apply statements
 * one by one instead; a statement that cannot apply is logged and skipped. */
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (lineComment) {
      current += ch;
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      current += ch;
      if (ch === '*' && next === '/') { current += next; i += 1; blockComment = false; }
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) {
        if (next === quote) { current += next; i += 1; } else quote = null;
      }
      continue;
    }
    if (ch === '-' && next === '-') { current += ch; current += next; i += 1; lineComment = true; continue; }
    if (ch === '/' && next === '*') { current += ch; current += next; i += 1; blockComment = true; continue; }
    if (ch === "'" || ch === '"') { quote = ch; current += ch; continue; }
    if (ch === ';') {
      statements.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) statements.push(current.trim());
  return statements.filter((s) => s && !/^--/.test(s));
}

async function main() {
  const schemaPath = path.join(__dirname, '..', 'src', 'db', 'schema.sql');
  const migrationsDir = path.join(__dirname, '..', 'migrations');

  console.log('[bootstrap-db] applying base schema statement by statement');
  let schemaApplied = 0;
  for (const statement of splitStatements(fs.readFileSync(schemaPath, 'utf8'))) {
    try {
      await pool.query(statement);
      schemaApplied += 1;
    } catch (err) {
      console.warn(`[bootstrap-db] schema statement skipped: ${err.message.split('\n')[0]}`);
    }
  }
  console.log(`[bootstrap-db] base schema: ${schemaApplied} statements applied`);

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

  const required = ['users', 'students', 'online_games', 'game_stockfish_analysis'];
  const found = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [required],
  );
  const present = new Set(found.rows.map((r) => r.table_name));
  const missing = required.filter((name) => !present.has(name));
  if (missing.length) throw new Error(`missing required tables: ${missing.join(', ')}`);
  console.log('[bootstrap-db] required tables verified');
}

main()
  .catch((err) => {
    console.error('[bootstrap-db] base schema failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
