-- Add classroom_enabled to classes: external classes may also use the
-- integrated classroom (shared board + chat) with video opening via the
-- class's external meeting link. Additive and re-runnable.
ALTER TABLE classes ADD COLUMN IF NOT EXISTS classroom_enabled BOOLEAN NOT NULL DEFAULT TRUE;