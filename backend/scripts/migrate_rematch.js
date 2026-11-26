/* Rematch-request columns for online matches.

 * A rematch is an OFFER made on a FINISHED match, answered by the other player —
 * exactly the shape the draw offer already uses, so it reuses the same pattern:
 *
 *   rematch_requested_by  the user id of the player who asked (NULL = nobody asked)
 *   rematch_requested_at  when they asked, so the server can expire the request
 *
 * One row per game means "only one pending request per match" is a database
 * property, not a client rule: the second player to ask gets a conflict instead
 * of a second competing request.
 *
 * Accepting does NOT touch this row. It inserts a brand new game and clears these
 * two columns, so the finished match keeps its own result, PGN and rating delta.
 *
 * No foreign key on rematch_requested_by: it points at users.id, and the draw
 * offer and reaction columns above use the same bare-INTEGER convention so a
 * stale request can never block a row from being deleted.
 *
 * Run: node scripts/migrate_rematch.js */
require('dotenv').config();
const db = require('../src/config/database');

const S = [
  'ALTER TABLE online_games ADD COLUMN IF NOT EXISTS rematch_requested_by INTEGER',
  'ALTER TABLE online_games ADD COLUMN IF NOT EXISTS rematch_requested_at TIMESTAMP',
  'CREATE INDEX IF NOT EXISTS idx_online_games_rematch_request ON online_games (id) WHERE rematch_requested_by IS NOT NULL',
];

(async () => {
  for (const s of S) {
    await db.query(s);
    console.log('ok:', s.slice(0, 78));
  }
  console.log('rematch migration complete');
  process.exit(0);
})().catch((e) => {
  console.error('migration failed:', e.message);
  process.exit(1);
});
