-- Tournaments v4 upgrade — draw offers on tournament games.
-- Additive only; safe to run more than once.
--
-- A draw is an OFFER the opponent accepts or declines, never a one-click
-- finish. These two columns hold the pending offer on a live tournament
-- game, mirroring the online_games draw-offer columns:
--
--   draw_offered_by  user id of the player who offered (NULL = no offer)
--   draw_offered_at  when they offered it
--
-- Both NULL means "no pending offer". No foreign key on draw_offered_by
-- (bare INTEGER, same convention as online_games) so a stale offer can
-- never block a row from being deleted.
--
-- IMPORTANT: the tournament clock is derived from tournament_games.updated_at
-- (elapsed = now - updated_at while a side is to move). Draw-offer writes
-- must therefore NEVER touch updated_at.
--
-- Run: node scripts/migrate_tournament_draw_offer.js

ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS draw_offered_by INTEGER;
ALTER TABLE tournament_games ADD COLUMN IF NOT EXISTS draw_offered_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_tournament_games_draw_offer
  ON tournament_games (id) WHERE draw_offered_by IS NOT NULL;
