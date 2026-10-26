-- Per-class switch controlling whether students may watch their classmates'
-- live PvP boards after finishing their own game. Instructors can always
-- spectate regardless of this flag. Defaults to TRUE so existing classes keep
-- the historical "everyone may watch" behaviour until a coach turns it off.
-- Additive and re-runnable.
ALTER TABLE classes ADD COLUMN IF NOT EXISTS spectate_enabled BOOLEAN NOT NULL DEFAULT TRUE;
