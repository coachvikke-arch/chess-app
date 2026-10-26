require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const ctrl = require('./src/controllers/puzzleController');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionTimeoutMillis: 8000,
});

/**
 * One-time migration:
 *   1. Apply the DDL from migrations/add_sets_merge.sql (sets table,
 *      puzzles.set_code, index) — additive, never destructive.
 *   2. Merge every former "<Type> (<Level>)" variant into a single combined
 *      set per theme type and backfill set_code on all puzzles.
 *   3. Verify: nothing lost, nothing duplicated, codes unique.
 */
(async () => {
  let client = null;
  try {
    await pool.query(fs.readFileSync('migrations/add_sets_merge.sql', 'utf8'));

    const before = await pool.query('SELECT COUNT(*)::int AS c FROM puzzles');
    await ctrl.syncPuzzleSets(pool);

    const after = await pool.query('SELECT COUNT(*)::int AS c FROM puzzles');
    const unassigned = await pool.query('SELECT COUNT(*)::int AS c FROM puzzles WHERE set_code IS NULL');
    const dupCodes = await pool.query('SELECT code FROM sets GROUP BY code HAVING COUNT(*) > 1');
    const setRows = await pool.query(
      `SELECT s.code, s.name, s.type_tag AS tag, COUNT(p.id)::int AS count
       FROM sets s LEFT JOIN puzzles p ON p.set_code = s.code
       GROUP BY s.code, s.name, s.type_tag ORDER BY s.name ASC`
    );

    const sumCounts = setRows.rows.reduce((a, r) => a + r.count, 0);

    console.log(`puzzles before: ${before.rows[0].c}  |  after: ${after.rows[0].c}`);
    console.log(`unassigned (NULL set_code): ${unassigned.rows[0].c}`);
    console.log(`sets created: ${setRows.rows.length}  |  sum of per-set counts: ${sumCounts}`);
    console.table(setRows.rows);

    if (after.rows[0].c !== before.rows[0].c) throw new Error('PUZZLE COUNT CHANGED — migration must not lose or add puzzles');
    if (unassigned.rows[0].c !== 0) throw new Error(`${unassigned.rows[0].c} puzzles still have no set_code`);
    if (dupCodes.rows.length > 0) throw new Error('Duplicate set codes detected');
    if (sumCounts !== before.rows[0].c) throw new Error(`Set counts (${sumCounts}) do not match puzzle total (${before.rows[0].c})`);
    console.log('MIGRATION OK — all puzzles assigned, counts preserved, codes unique.');
  } catch (e) {
    console.error('ERR:', e.message || e);
    process.exit(1);
  } finally {
    if (client) { try { await client.end(); } catch {} }
    await pool.end();
  }
  process.exit(0);
})();