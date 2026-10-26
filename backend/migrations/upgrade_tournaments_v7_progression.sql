-- Durable tournament progression outbox.
-- A game finalization (or a manual admin action) enqueues a row here; a worker
-- claims rows with SKIP LOCKED and runs the idempotent round progression.
-- Run: psql <db> -f backend/migrations/upgrade_tournaments_v7_progression.sql

CREATE TABLE IF NOT EXISTS tournament_progression (
  id BIGSERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  reason VARCHAR(64) NOT NULL DEFAULT 'game_finalized',
  status VARCHAR(16) NOT NULL DEFAULT 'pending',   -- pending | processing | done | failed
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournament_progression_pending
  ON tournament_progression (status, available_at, id);

CREATE INDEX IF NOT EXISTS idx_tournament_progression_tournament
  ON tournament_progression (tournament_id, created_at DESC);
