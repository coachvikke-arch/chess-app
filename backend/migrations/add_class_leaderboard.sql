-- Classroom leaderboard.
--
-- The classroom leaderboard only counts what happened IN that class, so every
-- point source needs to be attributable to a class:
--
--   * puzzle drills  -> live_class_puzzle_progress, already reachable via
--                       live_class_puzzle_drills.live_class_id
--   * classroom PvP  -> online_games.class_id, added by add_online_class_id.sql
--   * bot games      -> bot_game_results HAD no class column at all, so a bot
--                       game could not be counted toward any class without
--                       this. It is nullable on purpose: a bot game played in
--                       the Bot Arena outside any class stays class-less and is
--                       simply not counted on any classroom board.
--
-- Existing rows keep NULL, which means no classroom board is retroactively
-- changed by this migration.

ALTER TABLE bot_game_results
  ADD COLUMN IF NOT EXISTS class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bot_game_results_class
  ON bot_game_results (class_id, student_user_id);

-- The classroom leaderboard filters members and joins the three pools per
-- student, so a covering index on the member list keeps it cheap as classes grow.
CREATE INDEX IF NOT EXISTS idx_class_students_class
  ON class_students (class_id, student_id);

-- Drill progress is always read as "all progress for the drills of this class",
-- i.e. joined through live_class_puzzle_drills.
CREATE INDEX IF NOT EXISTS idx_live_class_puzzle_progress_drill
  ON live_class_puzzle_progress (drill_id, user_id);