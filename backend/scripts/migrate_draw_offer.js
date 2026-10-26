/* Draw-offer columns for online matches.
 *
 * A draw used to be a single button that ended the game immediately — one click
 * and the match was over, with the opponent never asked. That is not how a draw
 * works: it is an OFFER the other player accepts or declines. These two columns
 * hold the pending offer:
 *
 *   draw_offered_by  the user id of the player who offered (NULL = no offer)
 *   draw_offered_at  when they offered it
 *
 * Both NULL means "no pending offer". A `draw_offered_by` equal to the viewer is
 * "I offered, still waiting"; equal to the opponent is "they offered, I must
 * answer" — which is why the payload carries the `mine` flag rather than the UI
 * inferring it.
 *
 * No foreign key on draw_offered_by: it points at users.id, and the reaction
 * columns above use the same bare-INTEGER convention so a stale offer can never
 * block a row from being deleted.
 *
 * Run: node scripts/migrate_draw_offer.js */
require('dotenv').config();
const db = require('../src/config/database');

const S = [
  'ALTER TABLE online_games ADD COLUMN IF NOT EXISTS draw_offered_by INTEGER',
  'ALTER TABLE online_games ADD COLUMN IF NOT EXISTS draw_offered_at TIMESTAMP',
  'CREATE INDEX IF NOT EXISTS idx_online_games_draw_offer ON online_games (id) WHERE draw_offered_by IS NOT NULL',
];

(async () => {
  for (const s of S) {
    await db.query(s);
    console.log('ok:', s.slice(0, 78));
  }
  console.log('draw-offer migration complete');
  process.exit(0);
})().catch((e) => {
  console.error('migration failed:', e.message);
  process.exit(1);
});
