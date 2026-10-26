-- Roll the role switches back to a strict two-state column.
--
-- A tri-state (NULL = "inherit") column was introduced briefly and is being
-- removed: the third state resolved to the same thing as FALSE, so it only
-- added a control that looked meaningful and granted nothing.
--
-- DATA CHANGE, but a no-op in practice: the WHERE clause only matches rows
-- left NULL by that era, and there are none (verified 0 before running). The
-- guard is kept so this stays safe if the script is re-run later, when NULL
-- would otherwise mean "an admin deliberately chose nothing" and silently
-- become Off.

UPDATE role_permissions SET is_enabled = FALSE WHERE is_enabled IS NULL;

ALTER TABLE role_permissions ALTER COLUMN is_enabled SET NOT NULL;

COMMENT ON COLUMN role_permissions.is_enabled IS
  'TRUE = on for this role, FALSE = off for this role.';