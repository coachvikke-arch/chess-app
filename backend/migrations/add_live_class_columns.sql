-- Add live class lifecycle and configuration columns to the classes table.
-- Additive and re-runnable (IF NOT EXISTS guards).

ALTER TABLE classes ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'scheduled';
ALTER TABLE classes ADD COLUMN IF NOT EXISTS started_at TIMESTAMP NULL;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS ended_at TIMESTAMP NULL;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS class_type VARCHAR(20) NOT NULL DEFAULT 'external';
ALTER TABLE classes ADD COLUMN IF NOT EXISTS thumbnail TEXT NULL;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS chat_mode VARCHAR(20) NOT NULL DEFAULT 'open';
ALTER TABLE classes ADD COLUMN IF NOT EXISTS student_interaction_enabled BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_classes_status'
  ) THEN
    ALTER TABLE classes ADD CONSTRAINT chk_classes_status
      CHECK (status IN ('scheduled', 'live', 'completed', 'cancelled'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_classes_class_type'
  ) THEN
    ALTER TABLE classes ADD CONSTRAINT chk_classes_class_type
      CHECK (class_type IN ('external', 'integrated'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_classes_chat_mode'
  ) THEN
    ALTER TABLE classes ADD CONSTRAINT chk_classes_chat_mode
      CHECK (chat_mode IN ('open', 'instructor-only'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_classes_status ON classes (status);
