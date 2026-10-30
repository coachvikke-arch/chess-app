-- Offline attendance markers.
--
-- The register used to store only (class_id, student_id, status): the date lived
-- on classes.class_date and nothing recorded WHO marked the row. The student
-- portal now has to show "marked by <admin> on <date>", so those facts live on
-- the record itself.
--
-- Additive and re-runnable. Rows that predate this change are backfilled from
-- their class; they keep marked_by_* NULL, which the UI renders as "Unknown".
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS attendance_date DATE;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'offline';
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS marked_by INTEGER;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS marked_by_name VARCHAR(150);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS marked_by_role VARCHAR(20);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS marked_at TIMESTAMP;

-- Backfill only the rows that have no date yet, so re-running changes nothing.
UPDATE attendance a
   SET attendance_date = cl.class_date,
       type = CASE WHEN cl.is_online THEN 'online' ELSE 'offline' END
  FROM classes cl
 WHERE cl.id = a.class_id
   AND a.attendance_date IS NULL;

-- Rows whose class is long gone have no class date to copy, and the student's
-- list is sorted and filtered by date, so every row needs one.
UPDATE attendance
   SET attendance_date = COALESCE(created_at, NOW())::date
 WHERE attendance_date IS NULL;

-- The student's list is always "my records, newest month first", filtered by
-- month and type, so both key columns are in the index.
CREATE INDEX IF NOT EXISTS idx_attendance_student_date
    ON attendance (student_id, attendance_date DESC);

-- Standalone offline days have no class id. The original (class_id, student_id)
-- constraint cannot deduplicate those rows because PostgreSQL treats NULLs as
-- distinct, so this partial index is the upsert target for one mark per day.
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_offline_student_date
    ON attendance (student_id, attendance_date)
    WHERE class_id IS NULL AND type = 'offline';
