-- Puzzle Generator (Admin → Courses → Create Puzzles).
-- Additive, never destructive. Run via: node run_migration_puzzle_generator.js
--
--   · puzzles.rating          — numeric difficulty shown to students
--   · puzzles.source          — 'lichess' | 'engine' (how the position was found)
--   · puzzles.pgn_folder_id   — the PGN-library folder a generated puzzle was saved into
--   · puzzles.fen_key         — 'placement side' fingerprint used for de-duplication
--   · puzzles.solution_san    — the solution as SAN, alongside the UCI `solution`
--   · lichess_puzzles         — local copy of lichess_db_puzzle.csv, queried by theme + rating

ALTER TABLE puzzles
  ADD COLUMN IF NOT EXISTS rating        INTEGER,
  ADD COLUMN IF NOT EXISTS source        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS pgn_folder_id INTEGER REFERENCES library_folders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fen_key       VARCHAR(80),
  ADD COLUMN IF NOT EXISTS solution_san  JSONB;

-- De-duplication: same piece placement + side to move is the same puzzle.
-- Partial so existing rows (NULL fen_key) never collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS puzzles_fen_key_uidx
  ON puzzles (fen_key) WHERE fen_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS puzzles_source_idx ON puzzles (source);

-- Lichess puzzle database, imported once from lichess_db_puzzle.csv.
-- `themes` stays a TEXT[] so a GIN index answers "has theme X" directly.
CREATE TABLE IF NOT EXISTS lichess_puzzles (
  puzzle_id        VARCHAR(20) PRIMARY KEY,
  fen              VARCHAR(120) NOT NULL,
  moves            TEXT NOT NULL,
  rating           INTEGER,
  rating_deviation INTEGER,
  popularity       INTEGER,
  nb_plays         INTEGER,
  themes           TEXT[] NOT NULL DEFAULT '{}',
  game_url         TEXT,
  opening_tags     TEXT[] NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS lichess_puzzles_rating_idx ON lichess_puzzles (rating);
CREATE INDEX IF NOT EXISTS lichess_puzzles_themes_idx ON lichess_puzzles USING GIN (themes);
