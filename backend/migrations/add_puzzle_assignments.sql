-- Migration: puzzle assignment to students (specific or all) for visibility control
-- Run: psql -d chess -f migrations/add_puzzle_assignments.sql

-- A student_id of NULL means the puzzle is assigned to ALL students.
CREATE TABLE IF NOT EXISTS puzzle_assignments (
  id SERIAL PRIMARY KEY,
  puzzle_id INTEGER NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, -- NULL = all students
  assigned_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (puzzle_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_puzzle_assignments_puzzle ON puzzle_assignments (puzzle_id);
CREATE INDEX IF NOT EXISTS idx_puzzle_assignments_student ON puzzle_assignments (student_id);
