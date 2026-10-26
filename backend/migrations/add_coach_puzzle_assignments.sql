-- Migration: coach puzzle assignments built from puzzle sets
-- Extends the EXISTING assignments / assignment_submissions / puzzle_attempts
-- tables rather than creating parallel tables, so existing lesson homework
-- keeps working untouched and puzzle-assignment data lives alongside it.
--
--   assignments            += type | max_attempts | status | puzzle_set_code
--                            | is_template
--   assignment_submissions += status | progress_completed | reviewed_at
--   puzzles                += points_value
--
-- `assignment_puzzles` is the one new table: the ordered link between a puzzle
-- assignment and the puzzles it contains. It supports both "whole puzzle set"
-- (every row copied from sets) and a hand-picked subset, and `order_index`
-- keeps the coach's intended puzzle sequence.
--
-- Attempts reuse `puzzle_attempts` (played_moves already stores the student's
-- move sequence); `puzzle_assignment_id` links an attempt back to its assignment.
--
-- Run: node run_migration_coach_puzzle_assignments.js
--   (or psql -d chess -f migrations/add_coach_puzzle_assignments.sql)

-- ── assignments: identity + lifecycle ──────────────────────────────────
ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'lesson',  -- lesson | puzzle_assignment
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft | active | archived
  ADD COLUMN IF NOT EXISTS puzzle_set_code VARCHAR(32),
  ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_assignment_type') THEN
    ALTER TABLE assignments ADD CONSTRAINT chk_assignment_type
      CHECK (type IN ('lesson', 'puzzle_assignment'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_assignment_status') THEN
    ALTER TABLE assignments ADD CONSTRAINT chk_assignment_status
      CHECK (status IN ('draft', 'active', 'archived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_assignment_max_attempts') THEN
    ALTER TABLE assignments ADD CONSTRAINT chk_assignment_max_attempts
      CHECK (max_attempts >= 1);
  END IF;
END $$;

-- The assignment list filters by type + status constantly.
CREATE INDEX IF NOT EXISTS idx_assignments_type_status ON assignments (type, status);

-- ── assignment_submissions: per-student progress through the assignment ──
ALTER TABLE assignment_submissions
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- pending | in_progress | submitted | reviewed | overdue
  ADD COLUMN IF NOT EXISTS progress_completed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_submission_status') THEN
    ALTER TABLE assignment_submissions ADD CONSTRAINT chk_submission_status
      CHECK (status IN ('pending', 'in_progress', 'submitted', 'reviewed', 'overdue'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_submission_progress') THEN
    ALTER TABLE assignment_submissions ADD CONSTRAINT chk_submission_progress
      CHECK (progress_completed >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_submissions_status ON assignment_submissions (status);

-- ── puzzles: per-puzzle point value used for scoring ────────────────────
ALTER TABLE puzzles
  ADD COLUMN IF NOT EXISTS points_value INTEGER NOT NULL DEFAULT 10;

-- ── assignment_puzzles: ordered assignment composition ──────────────────
CREATE TABLE IF NOT EXISTS assignment_puzzles (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  puzzle_id INTEGER NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (assignment_id, puzzle_id)
);

CREATE INDEX IF NOT EXISTS idx_assignment_puzzles_assignment
  ON assignment_puzzles (assignment_id, order_index);
CREATE INDEX IF NOT EXISTS idx_assignment_puzzles_puzzle
  ON assignment_puzzles (puzzle_id);

-- ── attempts: link a puzzle attempt back to the assignment ──────────────
-- NOTE: `puzzle_attempts.assignment_id` ALREADY EXISTS and references
-- `assignment_groups(id)` (the legacy grouping feature). It must not be reused
-- here, so the link gets its own column name.
ALTER TABLE puzzle_attempts
  ADD COLUMN IF NOT EXISTS puzzle_assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_puzzle_attempts_assignment
  ON puzzle_attempts (puzzle_assignment_id, student_id);
