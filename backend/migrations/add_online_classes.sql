-- Add "online class / live meeting" support to the classes table.
-- Additive and re-runnable (IF NOT EXISTS / IF EXISTS guards).
ALTER TABLE classes ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_classes_is_online ON classes (is_online);
CREATE INDEX IF NOT EXISTS idx_classes_group_date ON classes (group_id, class_date);
