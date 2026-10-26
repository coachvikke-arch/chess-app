require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionTimeoutMillis: 8000,
});
(async () => {
  try {
    await pool.query(fs.readFileSync('migrations/remove_puzzle_rating.sql', 'utf8'));
    const t = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'puzzles' AND column_name = 'rating'");
    console.log('puzzles.rating column present:', t.rows.length > 0);
  } catch (e) { console.log('ERR:', e.message); process.exit(1); }
  await pool.end(); process.exit(0);
})();