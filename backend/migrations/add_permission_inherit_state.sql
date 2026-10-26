-- Tri-state role access: On / Off / Inherit.
--
-- Until now `role_permissions.is_enabled` was NOT NULL, so a role switch had only
-- two possible values. "Inherit" needs a third, distinct from Off — otherwise a
-- section could never go back to the platform default once it had been pinned.
--
-- Representation: is_enabled IS NULL means INHERIT ("no decision recorded
-- here, defer to the platform"). The platform default is currently OFF for
-- everything (permissionService.INHERIT_DEFAULT_SQL = FALSE), so NULL denies
-- today. It is kept distinct from FALSE so that a future platform default can
-- apply to undecided rows without re-opening sections a Super Admin deliberately
-- switched off.
--
-- An earlier draft resolved NULL to TRUE for a role's own category. That failed
-- OPEN: a feature shipped without a row, or a row deleted by mistake, granted
-- access instead of denying it. The NULL default here is deliberate.
--
-- DELIBERATELY NO DATA CHANGE. Existing FALSE rows stay FALSE; converting them
-- to NULL would erase every deliberate "off" an admin has set. An admin opts a
-- section into "Inherit" deliberately, one switch at a time.

ALTER TABLE role_permissions ALTER COLUMN is_enabled DROP NOT NULL;

COMMENT ON COLUMN role_permissions.is_enabled IS
  'TRUE = explicitly on, FALSE = explicitly off, NULL = inherit (platform default, currently FALSE).';