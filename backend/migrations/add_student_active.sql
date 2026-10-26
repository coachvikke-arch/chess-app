-- Adds active/inactive status to students (defaults to active for existing rows).
ALTER TABLE students ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;