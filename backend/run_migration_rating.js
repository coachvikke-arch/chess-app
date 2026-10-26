require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionTimeoutMillis: 8000,
});

/**
 * One-time migration for the Student Rating & Level system.
 * Applies migrations/add_rating_system.sql (additive — never destructive):
 *   · rating columns on students (default 1000)
 *   · rating_history table
 *   · student_levels (permanent) table
 * Verifies the columns/tables exist afterwards.
 */
(async () => {
  try {
    await pool.query(fs.readFileSync('migrations/add_rating_system.sql', 'utf8'));

    const st = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'students' AND column_name IN ('current_rating','peak_rating','highest_level','games_played')`
    );
    const hdr = await pool.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables
       WHERE table_name IN ('rating_history','student_levels')`
    );
    const missing = ['current_rating','peak_rating','highest_level','games_played'].filter(
      (c) => !st.rows.some((r) => r.column_name === c)
    );
    if (missing.length > 0) throw new Error(`Missing student columns: ${missing.join(', ')}`);
    if (hdr.rows[0].n < 2) throw new Error('rating_history / student_levels tables missing');
    console.log('RATING MIGRATION OK — students rating columns + rating_history + student_levels present.');
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await pool.end();
  }
  process.exit(0);
})();