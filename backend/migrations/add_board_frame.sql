-- Board frame (plinth/ornament) visibility preference.
-- Additive, never destructive. Run via backend/run_migration.js add_board_frame.sql
--   - users.board_frame - TRUE  = decorative plinth/ornate frame shown (default)
--                          FALSE = bare board, no frame
--
-- Separate from users.board_theme: the theme decides the board's COLOURS, this
-- only decides whether the decorative frame around it is drawn. A user may well
-- want "Pearl Lagoon" with the frame, and "Pearl Lagoon" without it.
--
-- DEFAULT TRUE keeps every existing account looking exactly as it did before
-- this column existed.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS board_frame BOOLEAN NOT NULL DEFAULT TRUE;
