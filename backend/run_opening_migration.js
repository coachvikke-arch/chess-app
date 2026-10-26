const fs = require('fs');
const path = require('path');
const { pool } = require('./src/config/database');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', 'add_opening_trainer.sql'), 'utf8');
  await pool.query(sql);
  const t = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name LIKE 'opening%' ORDER BY table_name`
  );
  console.log('opening tables ready:', t.rows.map((r) => r.table_name).join(', '));
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });