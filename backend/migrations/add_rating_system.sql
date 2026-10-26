-- Student Elo Rating & Level/Badge system.
-- Run: psql <db> -f backend/migrations/add_rating_system.sql
-- (or apply via run_migration_rating.js — additive, never destructive.)

-- ── 1. students: rating + level columns ──────────────────────────────
ALTER TABLE students ADD COLUMN IF NOT EXISTS current_rating       INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE students ADD COLUMN IF NOT EXISTS peak_rating          INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE students ADD COLUMN IF NOT EXISTS highest_level        INTEGER NOT NULL DEFAULT 1;
ALTER TABLE students ADD COLUMN IF NOT EXISTS games_played         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE students ADD COLUMN IF NOT EXISTS provisional_games    INTEGER NOT NULL DEFAULT 0; -- games remaining in the first-20 (K=40) band
ALTER TABLE students ADD COLUMN IF NOT EXISTS birthdate            DATE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS last_rating_change_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_students_current_rating ON students (current_rating DESC);

-- ── 2. rating_history: one row per rated match per student ────────────
CREATE TABLE IF NOT EXISTS rating_history (
  id             SERIAL PRIMARY KEY,
  student_id     INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  opponent_id    INTEGER REFERENCES students(id) ON DELETE SET NULL,
  opponent_name  VARCHAR(150),
  result         VARCHAR(10) NOT NULL,          -- win | draw | loss
  rating_before  INTEGER NOT NULL,
  rating_after   INTEGER NOT NULL,
  rating_change  INTEGER NOT NULL,              -- rating_after - rating_before
  time_control   VARCHAR(30),                   -- e.g. 'Bullet' | 'Blitz' | 'Rapid' | 'Classical' (flexible for future per-TC split)
  game_type      VARCHAR(30) NOT NULL DEFAULT 'official', -- official | online
  rated          BOOLEAN NOT NULL DEFAULT TRUE,
  played_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rating_history_student ON rating_history (student_id, played_at DESC);

-- ── 3. student_levels: permanent (never-downgraded) level achievements ──
CREATE TABLE IF NOT EXISTS student_levels (
  id           SERIAL PRIMARY KEY,
  student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  level        INTEGER NOT NULL,
  badge_name   VARCHAR(40) NOT NULL,
  achieved_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE (student_id, level)
);

CREATE INDEX IF NOT EXISTS idx_student_levels_student ON student_levels (student_id);