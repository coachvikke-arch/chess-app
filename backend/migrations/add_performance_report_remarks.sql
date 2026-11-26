-- Coach remarks attached to a Performance Report date range.
-- One remark per (student, period). The period is stored as a plain ISO date so
-- a report re-opened with the same filters always shows the same note.
CREATE TABLE IF NOT EXISTS performance_report_remarks (
  id            SERIAL PRIMARY KEY,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  text          TEXT NOT NULL DEFAULT '',
  updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_performance_report_remarks_period
    UNIQUE (student_id, period_start, period_end)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_performance_report_remarks_period
  ON performance_report_remarks (student_id, period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_performance_report_remarks_student
  ON performance_report_remarks (student_id, period_start, period_end);
