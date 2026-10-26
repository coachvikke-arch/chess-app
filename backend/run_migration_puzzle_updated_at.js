require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionTimeoutMillis: 8000,
});

/**
 * One-time migration: add puzzles.updated_at + auto-bump trigger + the
 * (set_code, updated_at) index used by the /api/puzzles/sets/:code ETag
 * preflight. Additive only — never destroys data.
 */
(async () => {
  try {
    await pool.query(fs.readFileSync('migrations/add_puzzle_updated_at.sql', 'utf8'));

    const trigger = await pool.query(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = 'puzzles'::regclass AND tgname = 'trg_puzzles_touch_updated_at'`
    );
    const index = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'puzzles' AND indexname = 'idx_puzzles_set_code_updated_at'`
    );
    const col = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'puzzles' AND column_name = 'updated_at'`
    );
    if (col.rows.length === 0) throw new Error('puzzles.updated_at column missing');
    if (trigger.rows.length === 0) throw new Error('update trigger missing');
    if (index.rows.length === 0) throw new Error('idx_puzzles_set_code_updated_at missing');
    console.log('MIGRATION OK — puzzles.updated_at, auto-bump trigger, and (set_code, updated_at) index in place.');
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    await pool.end();
  }
  process.exit(0);
})();