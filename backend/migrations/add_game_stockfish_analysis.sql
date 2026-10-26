-- ════════════════════════════════════════════════════════════════════════════
-- Automatic background Stockfish analysis.
--
-- WHY A NEW TABLE NAMED game_stockfish_analysis and NOT `game_analysis`:
--   `game_analysis` already exists (backend/src/db/schema.sql) and holds
--   something completely different: a coach-feedback queue keyed by
--   (student_id, pgn, fen, coach_feedback, coach_id), served by
--   POST/GET/PUT /api/game-analysis. Two unrelated features cannot share one
--   table, and the coach page must keep working untouched, so the automated
--   engine verdicts get their own names. Every write here goes through
--   src/services/analysis/*, which is the only thing that knows these tables.
--
-- WHY POLYMORPHIC (game_source, game_id) AND NOT A FK TO ONE games TABLE:
--   There is no single `games` table in this schema. Games live in four tables
--   with four independent SERIAL sequences — online_games, computer_games,
--   chess_games, tournament_games — and the sequences OVERLAP (each starts at
--   1). A bare game_id would therefore name four different games depending on
--   the source. Storing the pair is what makes one read across all four
--   sources possible, and it is exactly the shape sigma_moves already uses
--   (see add_sigma_moves.sql) so the two features join together.
--
-- NO FOREIGN KEY TO THE GAME TABLES, deliberately, for the same reason
--   sigma_moves has none: a single FK cannot point at four parents, and these
--   rows are DERIVED data — re-running the analysis regenerates them, so
--   losing an orphan is harmless where an FK violation on a real reference
--   would not be. (game_source, game_id) is indexed and is the join key.
--
-- owner_user_id IS a real foreign key: it is the one column that always means
--   the same thing, it decides whose game list a row belongs to, it decides
--   who may read the result, and it must cascade when the account is deleted.
-- ════════════════════════════════════════════════════════════════════════════

-- ── the job AND its result: one row per game ────────────────────────────────
CREATE TABLE IF NOT EXISTS game_stockfish_analysis (
  id SERIAL PRIMARY KEY,

  -- whose game this is (the account that played it)
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- which game, disambiguated by source (the four id sequences collide)
  game_source VARCHAR(20) NOT NULL
    CHECK (game_source IN ('chess_profile', 'online', 'computer', 'tournament')),
  game_id INTEGER NOT NULL,

  -- ── eligibility ──────────────────────────────────────────────────────────
  -- Why this game was picked up. Only these two tiers are analysed
  -- automatically; anything else is never enqueued (see
  -- src/services/analysis/eligibility.js). Doubles as the queue PRIORITY:
  -- a game the student just finished in the app outranks a backfilled
  -- library import, so a bulk sync can never starve the live experience.
  eligibility VARCHAR(20) NOT NULL
    CHECK (eligibility IN ('app_played', 'profile_import')),

  -- ── job state ────────────────────────────────────────────────────────────
  -- pending    — queued, waiting for a worker
  -- processing — claimed by a worker and running
  -- done       — every ply has a verdict row (the only state the UI renders)
  -- failed     — gave up after MAX_ATTEMPTS; error_message says why
  -- A game with no row is simply not queued yet, which is how the API tells
  -- "not analysed" from "analysis broken".
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed')),

  -- how many times this job has been attempted, so a permanently broken game
  -- cannot spin the worker forever
  attempts INTEGER NOT NULL DEFAULT 0,

  -- lease: a worker stamps claim_token + lease_expires_at while it works. A
  -- worker killed mid-analysis leaves an expired lease, and the next claim
  -- re-runs the job instead of stranding it in 'processing' forever.
  claim_token VARCHAR(64),
  lease_expires_at TIMESTAMPTZ,

  -- ── results ──────────────────────────────────────────────────────────────
  -- chess.com-compatible accuracy per side, 0-100, two decimals.
  -- NULL until status='done': a half-finished review has no accuracy, and
  -- storing 0 here would read as "analysed and both players scored nothing".
  accuracy_white NUMERIC(5,2),
  accuracy_black NUMERIC(5,2),

  -- opening name + ECO, derived from the opening book resolver the review
  -- already runs (frontend/src/utils/openings.js openingTag).
  opening_name VARCHAR(120),
  eco_code VARCHAR(10),

  -- the game-level badge the review's own classifier produced ('brilliant',
  -- 'excellent', 'great', …). NULL when no verdict dominates.
  game_classification VARCHAR(30),

  -- the fixed search depth these verdicts were produced at, so a later reader
  -- can tell a depth-14 result from a re-run at a different depth instead of
  -- silently mixing two search qualities in one list.
  analysis_depth INTEGER,

  -- which engine build produced the rows. Bumped when the review logic
  -- changes; a mismatch is what makes a full re-analysis offerable.
  engine_version VARCHAR(40),

  -- whole-game payload the frontend needs to render without re-deriving it
  -- (initial FEN, per-side aggregates, perf counters). Kept as JSONB so a new
  -- field does not need a migration.
  result JSONB,

  -- why the job failed, when it did. Short and human-readable: this is
  -- surfaced to a student, not only to a log.
  error_message TEXT,

  -- when the player asked for this analysis, and when it finished. requested_at
  -- (not created_at) is the SLA clock: a bulk backfill enqueued hours ago
  -- must not look like a fresh game that has been stuck.
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  analyzed_at TIMESTAMPTZ,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- One row per game, ever. Enqueueing an already-analysed game is a no-op
  -- (ON CONFLICT DO NOTHING), so a duplicate finish event, a re-sync and a
  -- manual retry can never queue the same game twice.
  UNIQUE (game_source, game_id)
);

-- the worker's claim query: pending work, most important first
CREATE INDEX IF NOT EXISTS idx_game_sf_pending
  ON game_stockfish_analysis (status, eligibility, requested_at)
  WHERE status IN ('pending', 'processing');

-- reclaiming jobs whose worker died: processing rows with an expired lease
CREATE INDEX IF NOT EXISTS idx_game_sf_lease
  ON game_stockfish_analysis (lease_expires_at)
  WHERE status = 'processing';

-- "has my game been analysed yet" — the API's hot read
CREATE INDEX IF NOT EXISTS idx_game_sf_owner
  ON game_stockfish_analysis (owner_user_id, game_source, game_id);

-- ── per-move verdicts ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS move_stockfish_analysis (
  id SERIAL PRIMARY KEY,

  -- same polymorphic reference as the parent, kept denormalised so a move can
  -- be read (or deleted) without joining the parent row
  game_source VARCHAR(20) NOT NULL
    CHECK (game_source IN ('chess_profile', 'online', 'computer', 'tournament')),
  game_id INTEGER NOT NULL,

  -- 0-based ply, matching the SAN index and the review rows used across the
  -- review UI, so a verdict can be replayed with no translation.
  ply INTEGER NOT NULL CHECK (ply >= 0),

  player VARCHAR(1) NOT NULL CHECK (player IN ('w', 'b')),

  -- the closed verdict set from reviewClassify.js / REVIEW_META
  verdict VARCHAR(20) NOT NULL CHECK (verdict IN (
    'brilliant', 'great', 'best', 'excellent', 'good',
    'book', 'inaccuracy', 'mistake', 'miss', 'blunder'
  )),

  move_san VARCHAR(20),
  move_uci VARCHAR(10),

  -- the position the move was played in, so a card can render the exact board
  -- without replaying the game
  fen_before VARCHAR(120),

  -- centipawns, MOVER-perspective (not white-perspective): + is good for the
  -- player who made the move. Storing it this way makes the "eval before"
  -- column mean the same thing for both colours.
  eval_best INTEGER,
  eval_played INTEGER,

  -- centipawns lost against the engine's best, capped like the review does
  cpl INTEGER,
  -- win percent lost, the number the verdict is actually decided by
  wpd NUMERIC(6,2),

  best_uci VARCHAR(10),
  -- depth the search that produced this row reached; 0 = no usable eval
  depth INTEGER,

  book_line VARCHAR(120),
  -- which kind of sacrifice, when the verdict is 'brilliant' (the Sigma types)
  sigma_type VARCHAR(30) CHECK (sigma_type IS NULL OR sigma_type IN (
    'queen_sacrifice', 'rook_sacrifice', 'bishop_sacrifice',
    'knight_sacrifice', 'underpromotion'
  )),

  created_at TIMESTAMP DEFAULT NOW(),

  -- One row per move per game. A re-analysis REPLACES the game's rows rather
  -- than appending, which is what keeps the verdict list and the accuracy
  -- figures agreeing with each other.
  UNIQUE (game_source, game_id, ply)
);

-- reading a game's moves back in order (the whole point of the table)
CREATE INDEX IF NOT EXISTS idx_move_sf_game
  ON move_stockfish_analysis (game_source, game_id, ply);

-- "every blunder this student played", for a future quality screen
CREATE INDEX IF NOT EXISTS idx_move_sf_verdict
  ON move_stockfish_analysis (verdict);
