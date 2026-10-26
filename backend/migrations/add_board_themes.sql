-- Board theme & piece-set preferences.
-- Additive, never destructive. Run via backend/run_migration.js add_board_themes.sql
--   · users.board_theme  — chessboard square-color theme id (default 'classic-green')
--   · users.piece_set    — piece set id (default 'cburnett')
--   · students.default_board_theme — coach/admin recommended default for that student

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS board_theme VARCHAR(40) NOT NULL DEFAULT 'classic-green',
  ADD COLUMN IF NOT EXISTS piece_set   VARCHAR(40) NOT NULL DEFAULT 'cburnett';

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS default_board_theme VARCHAR(40);