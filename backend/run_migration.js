// Apply a single additive migration file against the chess database.
// Usage: node run_migration.js <migrations/file.sql>
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
// Without this the pool falls back to a URL with no credentials and the
// connection is refused, so the documented workflow could not actually run.
require('dotenv').config();

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgres://localhost:5432/chess',
});

async function run() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error('Usage: node run_migration.js <migrations/file.sql>');
    process.exit(1);
  }
  const file = path.resolve(__dirname, fileArg);
  const sql = fs.readFileSync(file, 'utf8');
  try {
    await pool.query(sql);
    console.log(`✔ Applied ${path.basename(file)}`);
  } catch (err) {
    console.error(`✖ Migration failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
