-- Add the rematch-request columns to online_games: which player asked for a
-- rematch on a FINISHED match, and when. Both NULL means nobody has asked.
-- Answering does not touch this row's result, PGN or rating delta — it inserts a
-- brand new game and clears these two columns.
-- Additive and re-runnable. No foreign key on rematch_requested_by: the draw-offer
-- and reaction columns use the same bare-INTEGER convention, so a stale request can
-- never block a row from being deleted.
ALTER TABLE online_games ADD COLUMN IF NOT EXISTS rematch_requested_by INTEGER;
ALTER TABLE online_games ADD COLUMN IF NOT EXISTS rematch_requested_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_online_games_rematch_request
  ON online_games (id) WHERE rematch_requested_by IS NOT NULL;
