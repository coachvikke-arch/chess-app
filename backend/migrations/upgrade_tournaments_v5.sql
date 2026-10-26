-- Tournaments v5 upgrade — authoritative clock, winner identity, pairing health.
-- Additive only; safe to run more than once.
--
--   started_at      official start event (set once, never reset on refresh)
--   finished_at     official completion event (freezes the elapsed timer)
--   paused_at       when the current pause began (NULL = not paused)
--   total_paused_ms accumulated pause duration subtracted from elapsed time
--   pairing_error   last automatic pairing failure, for admin attention
--
--   winner_player   user id of the winner derived server-side from the result
--                   (NULL for draws/pending). Kept alongside result/reason so
--                   the UI never has to infer a winner from board orientation.
--
-- Run: node scripts/migrate_tournament_live_v5.js

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS paused_at TIMESTAMP;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS total_paused_ms BIGINT NOT NULL DEFAULT 0;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS pairing_error TEXT;

ALTER TABLE tournament_pairings ADD COLUMN IF NOT EXISTS winner_player INTEGER;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS winner_player INTEGER;

CREATE INDEX IF NOT EXISTS idx_tournament_pairings_winner
  ON tournament_pairings (tournament_id, winner_player) WHERE winner_player IS NOT NULL;

-- Existing live/finished tournaments predate the clock columns. Recover a
-- sensible start from the first round (falling back to creation time) so their
-- timer does not show 00:00 after deploying.
UPDATE tournaments t
   SET started_at = COALESCE(
     (SELECT MIN(r.started_at) FROM tournament_rounds r WHERE r.tournament_id = t.id),
     t.created_at,
     NOW()
   )
 WHERE t.started_at IS NULL
   AND t.status IN ('active', 'paused', 'completed', 'archived');

UPDATE tournaments
   SET finished_at = COALESCE(updated_at, NOW())
 WHERE finished_at IS NULL AND status IN ('completed', 'archived');

-- Backfill winner ids from already-decided pairings (no-op on a fresh DB).
UPDATE tournament_pairings
   SET winner_player = CASE
     WHEN result = 'white' THEN white_player
     WHEN result = 'black' THEN black_player
     WHEN result = 'bye' THEN white_player
     ELSE NULL
   END
 WHERE winner_player IS NULL AND result IN ('white', 'black', 'bye');
