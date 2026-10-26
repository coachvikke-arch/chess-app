-- Add student_move_side to classes: which side students may move on the
-- shared board when interaction is enabled ('both' | 'white' | 'black').
-- Additive and re-runnable.
ALTER TABLE classes ADD COLUMN IF NOT EXISTS student_move_side VARCHAR(6) NOT NULL DEFAULT 'both';