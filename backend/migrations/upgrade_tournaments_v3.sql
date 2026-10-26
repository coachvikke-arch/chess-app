-- Tournaments v3 upgrade — admin-controlled creation & progression.
-- Additive only; safe to run more than once.

-- How participants were chosen.
--   manual     → admin picked the students explicitly
--   automatic  → admin chose an eligibility rule and the system snapshotted matches
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS selection_mode VARCHAR(12) NOT NULL DEFAULT 'manual';

-- Who may start the next round once the current one is fully resolved.
--   automatic → the engine publishes the next round by itself
--   admin     → the engine prepares the round, an admin must publish it
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS progression_mode VARCHAR(12) NOT NULL DEFAULT 'automatic';

-- Eligibility rule snapshot for automatic selection. Empty object = "everyone".
--   { "groupIds": [1,2], "minRating": 800, "maxRating": 1600 }
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS eligibility JSONB;

-- Optional spectator access to live games of this tournament.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS spectator_access BOOLEAN NOT NULL DEFAULT TRUE;

-- When TRUE selected players are INVITED and must accept before they are paired.
-- When FALSE (default) the admin directly enrolls them.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS invitation_required BOOLEAN NOT NULL DEFAULT FALSE;

-- Set the first time the tournament is published (invitations sent). Used to
-- make "send invitations" idempotent so retries never duplicate notifications.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS published_at TIMESTAMP;

-- enrolled  → directly added by the organiser (no acceptance needed)
-- invited   → invitation sent, awaiting the player's reply
-- accepted  → player accepted the invitation
-- declined  → player declined
ALTER TABLE tournament_registrations
  ADD COLUMN IF NOT EXISTS invitation_status VARCHAR(12) NOT NULL DEFAULT 'enrolled';

CREATE INDEX IF NOT EXISTS idx_tournament_reg_invitation ON tournament_registrations (invitation_status);
