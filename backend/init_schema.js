const { pool } = require('./src/config/database');

async function init() {
  try {
    const fs = require('fs');
    const path = require('path');
    const schema = fs.readFileSync(path.join(__dirname, 'tournament_schema.sql'), 'utf8');
    const statements = schema.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      if (stmt.trim()) {
        try {
          await pool.query(stmt);
          console.log('OK:', stmt.substring(0, 80));
        } catch (err) {
          console.error('Error:', err.message.substring(0, 100));
        }
      }
    }
    console.log('Schema initialization complete');
  } catch (err) {
    console.error('Failed to read schema:', err.message);
  } finally {
    await pool.end();
  }
}

init();