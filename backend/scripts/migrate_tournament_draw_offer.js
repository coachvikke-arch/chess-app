/* Draw-offer columns for tournament games.
 *
 * Mirrors scripts/migrate_draw_offer.js (online matches): a draw is an OFFER
 * the opponent accepts or declines, never a one-click finish.
 *
 *   draw_offered_by  user id of the player who offered (NULL = no offer)
 *   draw_offered_at  when they offered it
 *
 * Run: node scripts/migrate_tournament_draw_offer.js */
require('dotenv').config();
const db = require('../src/config/database');

const S = [
  'ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS draw_offered_by INTEGER',
  'ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS draw_offered_at TIMESTAMP',
  'CREATE INDEX IF NOT EXISTS idx_tournament_games_draw_offer ON tournament_games (id) WHERE draw_offered_by IS NOT NULL',
];

(async () => {
  for (const s of S) {
    await db.query(s);
    console.log('ok:', s.slice(0, 78));
  }
  console.log('tournament draw-offer migration complete');
  process.exit(0);
})().catch((e) => {
  console.error('migration failed:', e.message);
  process.exit(1);
});
