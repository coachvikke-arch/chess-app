const { Pool } = require('pg');
const pool = new Pool({ port: 5432, database: 'chess_academy', user: 'postgres' });

pool.query("SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'tournament_pairings' ORDER BY ordinal_position", (err, res) => {
  console.log('Columns:', res.rows);
  pool.end();
});