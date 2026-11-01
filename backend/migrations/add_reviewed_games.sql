-- Games the viewer has finished a Stockfish review of.
-- Additive, never destructive. Run via backend/run_migration.js add_reviewed_games.sql
--
-- WHY A SEPARATE TABLE RATHER THAN "does an analysis row exist":
-- `imported_game_analysis` stores the last saved review envelope, which can be a
-- partial or older-schema payload, and it has no notion of the reviewer having
-- SEEN the finished result. This row is a deliberate, permanent mark: written once
-- when a review genuinely completes, never cleared by a re-analysis or a re-sync.
--
-- WHY platform IS PART OF THE KEY:
-- Chess.com and Lichess ids are independent number spaces, and the app's own
-- games are a third. `game_id` alone would let `chess.com:123` and `lichess:123`
-- overwrite each other. The pair is stored exactly as the browser builds its
-- lookup key (`platform + ':' + game_id`), so the two sides cannot drift.
--
-- `game_id` is TEXT rather than INTEGER because the platform's own identifiers
-- (Lichess's 8-char ids, Chess.com's game URLs) are strings — matching
-- `chess_games.platform_game_id VARCHAR(160)`. Anything numeric still fits.

CREATE TABLE IF NOT EXISTS reviewed_games (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform    VARCHAR(20) NOT NULL
                CHECK (platform IN ('matezone', 'chess.com', 'lichess')),
  game_id     VARCHAR(160) NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, platform, game_id)
);

-- The list read is always "every mark for this one user", which the UNIQUE
-- constraint's index already serves; this explicit index keeps that read cheap
-- if the constraint is ever reordered or relaxed.
CREATE INDEX IF NOT EXISTS idx_reviewed_games_user ON reviewed_games (user_id);
