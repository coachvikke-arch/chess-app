-- Add per-student class membership so a class can be assigned directly to
-- individual students (the "Schedule Class" form replaces the group dropdown
-- with a multi-select student picker). Additive and re-runnable.
CREATE TABLE IF NOT EXISTS class_students (
  id SERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (class_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_class_students_class ON class_students (class_id);
CREATE INDEX IF NOT EXISTS idx_class_students_student ON class_students (student_id);
