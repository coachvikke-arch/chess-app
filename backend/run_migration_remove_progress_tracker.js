require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionTimeoutMillis: 8000,
});
(async () => {
  try {
    await pool.query(fs.readFileSync('migrations/remove_progress_tracker_feature.sql', 'utf8'));
    const gone = await pool.query("SELECT count(*)::int AS n FROM features WHERE key = 'progress_tracker'");
    const total = await pool.query('SELECT count(*)::int AS n FROM features');
    const audit = await pool.query(
      "SELECT count(*)::int AS n FROM feature_permission_audit WHERE feature_key = 'progress_tracker'",
    );
    console.log('progress_tracker rows left:', gone.rows[0].n);
    console.log('features in registry now:  ', total.rows[0].n);
    console.log('audit rows kept (by key): ', audit.rows[0].n);
  } catch (e) { console.log('ERR:', e.message); process.exit(1); }
  await pool.end(); process.exit(0);
})();