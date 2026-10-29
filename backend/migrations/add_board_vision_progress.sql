-- Board Vision progress, one JSON document per user.
-- localStorage stays as an offline backup in the browser; this table is the
-- cross-device source of truth.
CREATE TABLE IF NOT EXISTS board_vision_progress (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  progress   JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_board_vision_progress_updated
  ON board_vision_progress (updated_at DESC);
