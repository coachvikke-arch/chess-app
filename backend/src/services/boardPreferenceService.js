/* The board-preference columns that Settings writes and /auth/me reads.
 *
 * `users.board_light_color` and `users.board_dark_color` come from
 * migrations/add_board_colors.sql, and `users.board_frame` from
 * migrations/add_board_frame.sql. A database that was never handed those files —
 * production, right now — answers `column "board_light_color" does not exist`
 * to every one of them, because they all name the column in a SELECT list or a
 * RETURNING clause:
 *
 *   · GET  /api/auth/me    500  → the app loses the signed-in user on a reload
 *   · PATCH /api/auth/me   500  → theme, piece set AND frame all become
 *                                 unselectable, since a theme save also clears
 *                                 the custom colours and the RETURNING list is
 *                                 read even for a frame-only save.
 *
 * So this module installs what those queries need, the same way the migrations
 * do it: `ADD COLUMN IF NOT EXISTS` with the identical type and default. On an
 * already-migrated database every statement is a no-op, and nothing here can
 * rewrite, truncate or drop a stored preference.
 */

const db = require('../config/database');

/* One entry per column the two queries touch. `present` is what the database
   already has; `sql` is the migration's own DDL, kept verbatim. */
const COLUMNS = [
  { table: 'users', name: 'board_theme', sql: "ALTER TABLE users ADD COLUMN IF NOT EXISTS board_theme VARCHAR(40) NOT NULL DEFAULT 'classic-green'" },
  { table: 'users', name: 'piece_set', sql: "ALTER TABLE users ADD COLUMN IF NOT EXISTS piece_set VARCHAR(40) NOT NULL DEFAULT 'cburnett'" },
  { table: 'users', name: 'board_frame', sql: 'ALTER TABLE users ADD COLUMN IF NOT EXISTS board_frame BOOLEAN NOT NULL DEFAULT TRUE' },
  { table: 'users', name: 'board_light_color', sql: 'ALTER TABLE users ADD COLUMN IF NOT EXISTS board_light_color VARCHAR(7)' },
  { table: 'users', name: 'board_dark_color', sql: 'ALTER TABLE users ADD COLUMN IF NOT EXISTS board_dark_color VARCHAR(7)' },
  { table: 'students', name: 'default_board_theme', sql: 'ALTER TABLE students ADD COLUMN IF NOT EXISTS default_board_theme VARCHAR(40)' },
];

/** The names this module owns, as `users.board_theme` — for logs and tests. */
const label = (column) => `${column.table}.${column.name}`;

async function absentColumns() {
  /* Matched pair by pair rather than `table = ANY(..) AND column = ANY(..)`,
     which would count a column as present when the OTHER table happens to carry
     the same name. */
  const wanted = COLUMNS.map((c) => `('${c.table}', '${c.name}')`).join(', ');
  const found = await db.query(
    `SELECT c.table_name, c.column_name
       FROM information_schema.columns c
       JOIN (VALUES ${wanted}) AS need(table_name, column_name)
         ON need.table_name = c.table_name AND need.column_name = c.column_name`
  );
  const present = new Set(found.rows.map((row) => `${row.table_name}.${row.column_name}`));
  return COLUMNS.filter((c) => !present.has(label(c)));
}

/**
 * Create whatever the board preferences still lack.
 *
 * @returns {Promise<string[]>} the columns added by this call — empty when the
 *   database was already complete, which is the normal case.
 */
async function install() {
  const absent = await absentColumns();
  for (const column of absent) await db.query(column.sql);
  return absent.map(label);
}

let ready = null;

/**
 * Memoised `install()`. A failure resets the memo so the next call retries —
 * a transient DDL error must not leave the app permanently unable to save a
 * theme.
 */
function ensureBoardPreferences() {
  if (!ready) {
    ready = install().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

module.exports = { ensureBoardPreferences, COLUMNS };
