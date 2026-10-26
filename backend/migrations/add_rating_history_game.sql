-- Link a rating_history row back to the online game that produced it.
--
-- WHY: rated player-vs-player games already update Elo
-- (onlineController.applyOnlineRating -> ratingService.applyGameResult), but the
-- client was never told the new number. applyGameResult returns rating_before /
-- rating_after / rating_change, yet every finish route discarded the return value
-- and answered with the plain game payload.
--
-- Returning it down the existing response was not an option: emitGameUpdate
-- broadcasts {forAdmin, forStudent} to BOTH sockets, so a delta embedded in
-- payload() would hand each player the opponent's rating change as well. The
-- change therefore has to be fetched from a participant-scoped endpoint, and
-- that endpoint needs to find "my row for THIS game" - which was impossible
-- while rating_history had no game reference at all. It stores opponent,
-- result and time control, but two games between the same two students with the
-- same result are indistinguishable.
--
-- So this adds the missing link. Existing rows stay NULL: they predate the
-- column and cannot be attributed, and every read path filters on the game id.
--
-- Run: node run_migration_rating_history_game.js

ALTER TABLE rating_history
  ADD COLUMN IF NOT EXISTS online_game_id INTEGER REFERENCES online_games(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rating_history_game
  ON rating_history (online_game_id, student_id);