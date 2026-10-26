-- Tournament feature schema. Idempotent: safe to run on a fresh database AND on
-- one that already contains older tournament tables (every column is added with
-- ADD COLUMN IF NOT EXISTS). Applied automatically at server start by
-- services/tournamentSchema.js.

CREATE TABLE IF NOT EXISTS tournaments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL
);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS format VARCHAR(16) NOT NULL DEFAULT 'swiss';
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'upcoming';
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS time_minutes INTEGER NOT NULL DEFAULT 10;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS increment_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS rounds INTEGER;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS current_round INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS max_players INTEGER;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS allow_berserk BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS allow_draw_offers BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS auto_advance BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS self_register BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS auto_start BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS no_show_seconds INTEGER;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS pairing_mode VARCHAR(8) NOT NULL DEFAULT 'auto';
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS transition_seconds INTEGER;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS created_by INTEGER;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner_id INTEGER;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments (status);

CREATE TABLE IF NOT EXISTS tournament_registrations (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE tournament_registrations ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'active';
ALTER TABLE tournament_registrations ADD COLUMN IF NOT EXISTS seed INTEGER;
ALTER TABLE tournament_registrations ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tournament_registrations ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_registration ON tournament_registrations (tournament_id, student_id);
CREATE INDEX IF NOT EXISTS idx_tournament_registrations_student ON tournament_registrations (student_id);

CREATE TABLE IF NOT EXISTS tournament_pairings (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_no INTEGER NOT NULL DEFAULT 1
);
ALTER TABLE tournament_pairings ADD COLUMN IF NOT EXISTS board_no INTEGER;
ALTER TABLE tournament_pairings ADD COLUMN IF NOT EXISTS white_player INTEGER;
ALTER TABLE tournament_pairings ADD COLUMN IF NOT EXISTS black_player INTEGER;
ALTER TABLE tournament_pairings ADD COLUMN IF NOT EXISTS bye BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tournament_pairings ADD COLUMN IF NOT EXISTS result VARCHAR(16);
ALTER TABLE tournament_pairings ADD COLUMN IF NOT EXISTS reason VARCHAR(32);
ALTER TABLE tournament_pairings ADD COLUMN IF NOT EXISTS winner_player INTEGER;
ALTER TABLE tournament_pairings ADD COLUMN IF NOT EXISTS white_points NUMERIC(6,2);
ALTER TABLE tournament_pairings ADD COLUMN IF NOT EXISTS black_points NUMERIC(6,2);
ALTER TABLE tournament_pairings ADD COLUMN IF NOT EXISTS white_berserk BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tournament_pairings ADD COLUMN IF NOT EXISTS black_berserk BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tournament_pairings ADD COLUMN IF NOT EXISTS game_id INTEGER;
ALTER TABLE tournament_pairings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE tournament_pairings ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_tournament_pairings_t ON tournament_pairings (tournament_id, round_no);
CREATE INDEX IF NOT EXISTS idx_tournament_pairings_white ON tournament_pairings (white_player);
CREATE INDEX IF NOT EXISTS idx_tournament_pairings_black ON tournament_pairings (black_player);

CREATE TABLE IF NOT EXISTS tournament_games (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE
);
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS pairing_id INTEGER;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS white_player INTEGER;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS black_player INTEGER;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS fen TEXT;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS pgn TEXT NOT NULL DEFAULT '';
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS moves_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'pending';
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS result VARCHAR(16);
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS reason VARCHAR(32);
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS winner_player INTEGER;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS turn CHAR(1) NOT NULL DEFAULT 'w';
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS white_ms BIGINT;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS black_ms BIGINT;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS white_inc_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS black_inc_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS last_move_at BIGINT;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS no_show_deadline BIGINT;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS first_move_deadline BIGINT;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS draw_offer_by INTEGER;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS white_berserk BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS black_berserk BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS armageddon BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS offer_meta JSONB;
-- Rating settlement state (see migrations/add_tournament_rating.sql).
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS rating_status VARCHAR(16) NOT NULL DEFAULT 'pending';
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS rating_result VARCHAR(16);
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS rated_at TIMESTAMPTZ;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS rating_note TEXT;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_tournament_games_t ON tournament_games (tournament_id, status);
CREATE INDEX IF NOT EXISTS idx_tournament_games_pairing ON tournament_games (pairing_id);
CREATE INDEX IF NOT EXISTS idx_tournament_games_white ON tournament_games (white_player);
CREATE INDEX IF NOT EXISTS idx_tournament_games_black ON tournament_games (black_player);
CREATE INDEX IF NOT EXISTS idx_tournament_games_rating_status ON tournament_games (rating_status);

-- Audit trail for every administrative action (start, pause, result overrides, manual pairings ...).
CREATE TABLE IF NOT EXISTS tournament_audit (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE
);
ALTER TABLE tournament_audit ADD COLUMN IF NOT EXISTS actor_id INTEGER;
ALTER TABLE tournament_audit ADD COLUMN IF NOT EXISTS action VARCHAR(48);
ALTER TABLE tournament_audit ADD COLUMN IF NOT EXISTS details JSONB;
ALTER TABLE tournament_audit ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_tournament_audit_t ON tournament_audit (tournament_id, id);

-- A board number can exist only once per round: a second process can never create the same pairing twice.
-- (Optional: skipped with a warning if old data already violates it.)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_pairing_board ON tournament_pairings (tournament_id, round_no, board_no);
