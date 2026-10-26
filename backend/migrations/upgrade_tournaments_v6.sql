-- Tournaments v6 upgrade — authoritative clock, colour assignment, result fields.
-- Additive only; safe to run more than once.
--
-- Adds:
--   - colour_white_player_id / colour_black_player_id on tournament_games
--   - winner_player on tournament_games and tournament_pairings
--   - started_at / finished_at / paused_at / total_paused_ms on tournaments
--   - result_reason on tournaments and tournament_pairings
--
-- Run: psql <db> -f backend/migrations/upgrade_tournaments_v6.sql

ALTER TABLE tournament_games
  ADD COLUMN IF NOT EXISTS colour_white_player_id INTEGER,
  ADD COLUMN IF NOT EXISTS colour_black_player_id INTEGER,
  ADD COLUMN IF NOT EXISTS winner_player INTEGER;

ALTER TABLE tournament_pairings
  ADD COLUMN IF NOT EXISTS winner_player INTEGER;

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS total_paused_ms BIGINT NOT NULL DEFAULT 0;

ALTER TABLE tournament_games
  ADD COLUMN IF NOT EXISTS result_reason VARCHAR(30);

CREATE INDEX IF NOT EXISTS idx_tournament_games_winner
  ON tournament_games (tournament_id, winner_player)
  WHERE winner_player IS NOT NULL;

-- Seed winner ids for existing decided pairings.
UPDATE tournament_pairings
   SET winner_player = CASE
     WHEN result = 'white' THEN white_player
     WHEN result = 'black' THEN black_player
     WHEN result = 'bye' THEN white_player
     ELSE NULL
   END
 WHERE winner_player IS NULL AND result IN ('white', 'black', 'bye');

