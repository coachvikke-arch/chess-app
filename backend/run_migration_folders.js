/**
 * Run the set_folders migration.
 * Usage: node run_migration_folders.js
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('./src/config/database');

async function run() {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', 'add_set_folders.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('✅ set_folders migration applied successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
