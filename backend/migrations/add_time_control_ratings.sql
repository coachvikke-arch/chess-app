-- Per-time-control Elo rating tables.
--
-- The deployment skips migrations whose prerequisites are absent, and this
-- file was referenced by run_migration_time_control_ratings.js but never
-- committed. That left report endpoints querying tables that did not exist.
-- Additive and idempotent: safe to run against a database that already has
-- either table, and it never rewrites existing ratings or history.

CREATE TABLE IF NOT EXISTS student_time_ratings (
  id                SERIAL PRIMARY KEY,
  student_id        INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  time_class        VARCHAR(16) NOT NULL,
  rating            INTEGER NOT NULL DEFAULT 1000,
  peak_rating       INTEGER NOT NULL DEFAULT 1000,
  highest_level     INTEGER NOT NULL DEFAULT 1,
  games_played      INTEGER NOT NULL DEFAULT 0,
  provisional_games INTEGER NOT NULL DEFAULT 0,
  last_changed_at   TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT NOW(),
  UNIQUE (student_id, time_class)
);

CREATE INDEX IF NOT EXISTS idx_student_time_ratings_student
  ON student_time_ratings (student_id, time_class);

CREATE TABLE IF NOT EXISTS time_control_rating_history (
  id                  SERIAL PRIMARY KEY,
  student_id          INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  time_class          VARCHAR(16) NOT NULL,
  opponent_id         INTEGER REFERENCES students(id) ON DELETE SET NULL,
  opponent_name       VARCHAR(150),
  result              VARCHAR(10) NOT NULL,
  rating_before       INTEGER NOT NULL,
  rating_after        INTEGER NOT NULL,
  rating_change       INTEGER NOT NULL,
  time_control        VARCHAR(30),
  game_type           VARCHAR(30) NOT NULL DEFAULT 'official',
  played_at           TIMESTAMP DEFAULT NOW(),
  online_game_id      INTEGER,
  tournament_game_id  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tc_rating_history_student
  ON time_control_rating_history (student_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_tc_rating_history_student_class
  ON time_control_rating_history (student_id, time_class, played_at DESC);

-- Older databases have the aggregate rating_history but not the per-control
-- columns added later. These are additive so both read and write paths agree.
ALTER TABLE rating_history ADD COLUMN IF NOT EXISTS time_class VARCHAR(16);
ALTER TABLE rating_history ADD COLUMN IF NOT EXISTS time_control VARCHAR(30);
ALTER TABLE rating_history ADD COLUMN IF NOT EXISTS online_game_id INTEGER;
ALTER TABLE rating_history ADD COLUMN IF NOT EXISTS tournament_game_id INTEGER;
