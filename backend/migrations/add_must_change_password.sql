-- Add the "must change password" flag to a user.
--
-- A student registered by an admin signs in with the password that was set for
-- them (or with the temporary one that was mailed to them). The flag says
-- "this password was chosen by the academy, not by the student", so the app
-- can send them to a change-password screen before anything else.
--
-- The default is false: every existing account keeps working, and only a
-- freshly registered student starts with the flag set.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- A partial index is not needed for the flag itself, but the login path reads
-- it for every sign-in, so the column stays indexed with the rest of the row.
COMMENT ON COLUMN users.must_change_password IS
  'True while the account still uses the password the academy issued; cleared on the first password change.';
