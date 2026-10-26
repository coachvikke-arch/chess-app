require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionTimeoutMillis: 8000,
});
(async () => {
  try {
    await pool.query(fs.readFileSync('migrations/add_computer_games.sql', 'utf8'));
    console.log('computer_games table ready');
    const t = await pool.query("SELECT to_regclass('public.computer_games') AS t");
    console.log('exists:', t.rows[0].t);
  } catch (e) { console.log('ERR:', e.message); }
  await pool.end(); process.exit(0);
})();
