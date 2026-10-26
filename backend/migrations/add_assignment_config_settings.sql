-- Migration: per-assignment puzzle configuration
--   · time_limit_seconds — optional countdown shown to the student
--   · points            — points awarded on a correct solve (default 10)
--   · max_attempts      — max scored attempts before the puzzle locks (default 3)
--   · negative_points   — points deducted per wrong attempt (default 0)
-- Backs the "Assign to Students" modal's per-puzzle settings + apply-to-all toggle.
-- Run: node run_assignment_config.js  (or psql -d chess -f migrations/add_assignment_config_settings.sql)

ALTER TABLE student_puzzle_assignments
  ADD COLUMN IF NOT EXISTS time_limit_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS points INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS negative_points INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_spa_max_attempts') THEN
    ALTER TABLE student_puzzle_assignments ADD CONSTRAINT chk_spa_max_attempts CHECK (max_attempts >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_spa_negative_points') THEN
    ALTER TABLE student_puzzle_assignments ADD CONSTRAINT chk_spa_negative_points CHECK (negative_points >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_spa_points_nonneg') THEN
    ALTER TABLE student_puzzle_assignments ADD CONSTRAINT chk_spa_points_nonneg CHECK (points >= 0);
  END IF;
END $$;