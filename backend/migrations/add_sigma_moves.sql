-- ════════════════════════════════════════════════════════════════════════════
-- Σ Sigma Moves — persistent record of the brilliant moves found in a review.
--
-- WHY A NEW TABLE rather than a column on the game tables:
--   Sigma moves are read ACROSS games (the 7D/30D/90D/1Y/ALL screen lists them
--   from every source at once), while chess_games / online_games /
--   computer_games / tournament_games each own their own row and their own id
--   space. The four id sequences overlap, so a bare game_id is ambiguous.
--   Storing the pair (game_source, game_id) plus the OWNER is what makes one
--   query across all four sources possible.
--
-- game_source values are a closed set (see the CHECK) so a typo cannot create a
-- fifth, unreachable source that silently drops out of every read.
--
-- There is deliberately NO foreign key to the game tables. A single FK cannot
-- point at four different parents, and polymorphic references are the one case
-- where the constraint is not worth the schema gymnastics: these rows are
-- derived data that can always be recomputed by re-reviewing the game, and
-- losing an orphan is harmless where losing a FK violation on a real reference
-- would not be. game_source + game_id is indexed and is what callers join on.
--
-- owner_user_id IS a real foreign key: it is the one column that always means
-- the same thing, it decides whose Sigma list a row belongs to, and it must
-- cascade when the account is deleted.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sigma_moves (
  id SERIAL PRIMARY KEY,

  -- who played the game this move came from
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- which game, disambiguated by source (the four id sequences collide)
  game_source VARCHAR(20) NOT NULL
    CHECK (game_source IN ('chess_profile', 'online', 'computer', 'tournament')),
  game_id INTEGER NOT NULL,

  -- where in the game. ply is 0-based and matches the review rows / SAN index
  -- used across the review UI, so a Sigma can be replayed with no translation.
  ply INTEGER NOT NULL CHECK (ply >= 0),

  -- which kind of sacrifice it was; the five values the UI offers as filters.
  -- 'sigma' (NULL type) is NOT allowed here: an unclassifiable move is stored
  -- with its best-known type or skipped, because a filter chip that can be
  -- empty is worse than one that is never offered.
  sigma_type VARCHAR(30) NOT NULL CHECK (sigma_type IN (
    'queen_sacrifice', 'rook_sacrifice', 'bishop_sacrifice',
    'knight_sacrifice', 'underpromotion'
  )),

  move_san VARCHAR(20),
  from_square VARCHAR(2),
  to_square VARCHAR(2),

  -- the position BEFORE the move, so a card can render the exact board the
  -- move was played in without re-fetching and replaying the game.
  fen_before VARCHAR(120),

  -- when the GAME was played (not when it was reviewed). The date filters on
  -- the Sigma screen bucket by this, so reviewing an old game today must not
  -- make it show up in "last 7 days".
  played_at TIMESTAMP,

  -- denormalised from the source row at review time so the list does not need a
  -- four-way join on every read. Kept as plain text/int, never as a reference.
  white_name VARCHAR(120),
  black_name VARCHAR(120),
  white_rating INTEGER,
  black_rating INTEGER,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- One row per move per game. Re-reviewing the same game (a fix to the
  -- detector, an engine upgrade) must update in place rather than pile up
  -- duplicates, which is what makes the screen's counts trustworthy.
  UNIQUE (game_source, game_id, ply)
);

-- the primary read: one user's Sigmas, newest game first, for the date filter
CREATE INDEX IF NOT EXISTS idx_sigma_moves_owner_played
  ON sigma_moves (owner_user_id, played_at DESC NULLS LAST);

-- the type filter, and the per-type count chips
CREATE INDEX IF NOT EXISTS idx_sigma_moves_owner_type
  ON sigma_moves (owner_user_id, sigma_type);

-- joining a game back to its Sigmas
CREATE INDEX IF NOT EXISTS idx_sigma_moves_game
  ON sigma_moves (game_source, game_id);