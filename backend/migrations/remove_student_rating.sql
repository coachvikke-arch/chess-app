-- Remove student chess rating & level from the students table.
ALTER TABLE students DROP COLUMN IF EXISTS chess_level;
ALTER TABLE students DROP COLUMN IF EXISTS chess_rating;