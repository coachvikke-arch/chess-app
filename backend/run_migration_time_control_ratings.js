require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionTimeoutMillis: 8000,
});

/**
 * Migration for per-time-control Elo ratings.
 * Applies migrations/add_time_control_ratings.sql (additive — never destructive):
 *   · student_time_ratings  — one rating pool per student per time class
 *   · time_control_rating_history — per-class game history
 * `students.current_rating` is left alone and keeps tracking the aggregate.
 * Verifies both tables exist afterwards.
 */
(async () => {
  try {
    await pool.query(fs.readFileSync('migrations/add_time_control_ratings.sql', 'utf8'));

    const t = await pool.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables
       WHERE table_name IN ('student_time_ratings','time_control_rating_history')`
    );
    if (t.rows[0].n < 2) throw new Error('time-control rating tables missing');

    const pools = await pool.query(
      `SELECT time_class, COUNT(*)::int AS students FROM student_time_ratings
       GROUP BY time_class ORDER BY time_class`
    );
    console.log('TIME-CONTROL RATING MIGRATION OK — both tables present.');
    console.log(
      pools.rows.length
        ? `existing pools: ${pools.rows.map((r) => `${r.time_class}=${r.students}`).join(', ')}`
        : 'existing pools: none yet (created on a student\'s first rated game in that control)'
    );
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
