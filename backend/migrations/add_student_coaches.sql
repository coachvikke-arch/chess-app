-- One student can be handled by MULTIPLE coaches/admins. The super admin
-- assigns any number of them through this join table; students.coach_id stays
-- as the PRIMARY coach for existing features (classes, groups, login label).
CREATE TABLE IF NOT EXISTS student_coaches (
  id BIGSERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  coach_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_student_coaches UNIQUE (student_id, coach_id)
);

CREATE INDEX IF NOT EXISTS idx_student_coaches_coach ON student_coaches (coach_id);
CREATE INDEX IF NOT EXISTS idx_student_coaches_student ON student_coaches (student_id);

-- Backfill existing single-coach assignments so every existing student keeps
-- their coach visible through the new join table too.
INSERT INTO student_coaches (student_id, coach_id, assigned_by)
SELECT id, coach_id, NULL FROM students WHERE coach_id IS NOT NULL
ON CONFLICT (student_id, coach_id) DO NOTHING;