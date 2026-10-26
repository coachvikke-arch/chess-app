-- Migration: per-student puzzle assignment records (due date, notes, status)
-- Backing a future student-facing "My Assigned Puzzles" view.
-- Run: node run_new_migration.js  (or psql -d chess -f migrations/add_student_puzzle_assignments.sql)

CREATE TABLE IF NOT EXISTS student_puzzle_assignments (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  puzzle_id INTEGER NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  assigned_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'assigned', -- assigned | completed | overdue
  notes TEXT,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  time_limit_seconds INTEGER,
  points INTEGER NOT NULL DEFAULT 10,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  negative_points INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, puzzle_id)
);

CREATE INDEX IF NOT EXISTS idx_spa_student ON student_puzzle_assignments (student_id);
CREATE INDEX IF NOT EXISTS idx_spa_puzzle ON student_puzzle_assignments (puzzle_id);
CREATE INDEX IF NOT EXISTS idx_spa_status ON student_puzzle_assignments (status);