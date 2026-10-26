-- Migration: per-student Computer-vs-Student classroom games.
-- Each selected student gets their OWN separate online_games row where the
-- bot (driven live by the instructor's browser engine) is the admin side.
-- Additive only; is_bot=false keeps every existing PvP match untouched.

ALTER TABLE online_games ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE online_games ADD COLUMN IF NOT EXISTS bot_level INTEGER;
ALTER TABLE online_games ADD COLUMN IF NOT EXISTS bot_color VARCHAR(5);
