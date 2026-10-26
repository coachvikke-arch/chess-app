/**
 * Run the PDF puzzle import audit-log migration.
 * Usage: node run_migration_pdf_imports.js
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('./src/config/database');

async function run() {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', 'add_pdf_puzzle_imports.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('✅ pdf_puzzle_imports migration applied successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();