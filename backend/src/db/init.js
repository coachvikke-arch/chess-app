// Run with: npm run db:init
// Creates all tables from schema.sql against the "chess" database.
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function init() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try {
    await pool.query(schema);
    console.log('Database schema created successfully on database "chess".');
  } catch (err) {
    console.error('Failed to initialize database:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

init();
