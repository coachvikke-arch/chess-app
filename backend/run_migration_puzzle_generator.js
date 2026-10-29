require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

/**
 * Puzzle Generator migration runner — applies migrations/add_puzzle_generator.sql
 * and then verifies the columns, indexes and tables the generator depends on.
 *
 * A migration can apply cleanly and still be wrong (a renamed column, a missing
 * index), and without this the failure only shows up later as a slow or broken
 * generation request.
 */
(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'migrations', 'add_puzzle_generator.sql'), 'utf8');
    await db.pool.query(sql);

    const requiredColumns = [
      'puzzles.rating', 'puzzles.source', 'puzzles.pgn_folder_id', 'puzzles.fen_key',
      'puzzles.solution_san',
      'lichess_puzzles.puzzle_id', 'lichess_puzzles.fen', 'lichess_puzzles.moves',
      'lichess_puzzles.rating', 'lichess_puzzles.themes',
    ];
    const requiredIndexes = [
      'puzzles_fen_key_uidx', 'lichess_puzzles_rating_idx', 'lichess_puzzles_themes_idx',
    ];

    const cols = await db.pool.query(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('puzzles', 'lichess_puzzles')
    `);
    const present = new Set(cols.rows.map((r) => `${r.table_name}.${r.column_name}`));
    const missingCols = requiredColumns.filter((c) => !present.has(c));
    if (missingCols.length) throw new Error(`Missing columns: ${missingCols.join(', ')}`);

    const idx = await db.pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`);
    const haveIdx = new Set(idx.rows.map((r) => r.indexname));
    const missingIdx = requiredIndexes.filter((i) => !haveIdx.has(i));
    if (missingIdx.length) throw new Error(`Missing indexes: ${missingIdx.join(', ')}`);

    const counts = await db.pool.query('SELECT COUNT(*)::int AS n FROM lichess_puzzles');
    console.log('✓ add_puzzle_generator applied');
    console.log(`  lichess_puzzles rows: ${counts.rows[0].n}`);
    if (counts.rows[0].n === 0) {
      console.log('  → run: node scripts/importLichessPuzzles.js <lichess_db_puzzle.csv>');
    }
  } catch (err) {
    console.error('✗ puzzle generator migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
