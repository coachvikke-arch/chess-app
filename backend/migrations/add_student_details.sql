-- Add student biographical/profile details (parent/guardian, nickname, gender, preferred language).
-- Run: node backend/run_migration_student_details.js   (or apply this file via psql — additive, never destructive.)

ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_name        TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS nickname          TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS gender            VARCHAR(30);
ALTER TABLE students ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(50);