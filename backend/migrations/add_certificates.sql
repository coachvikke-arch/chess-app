-- Certificates (Super Admin module): level-completion + tournament-achievement
-- certificates. Run via:  node run_migration_certificates.js
--
-- Additive and idempotent — safe on a fresh database and safe to re-run against
-- one that already has an earlier version of these tables.
--
-- DESIGN NOTES (why it looks like this)
--
-- * Certificates are AUTOMATIC. Nothing here is hand-authored: level
--   certificates are issued by the rating/level-progression path and tournament
--   certificates by tournament finalisation. These tables only provide storage
--   and the integrity guarantees.
--
-- * Student name and phone are read from `users` via `students.user_id`. An
--   earlier revision of this migration added a separate `students.phone` column;
--   that column may still exist on a database that was migrated by that version,
--   but the module does not read or write it (see the UPGRADE section). A second
--   phone column duplicates the user's value and then silently goes stale
--   whenever the phone is edited on the user record.
--
-- * `file_error` exists because PDF generation can fail (missing artwork, a font
--   that will not load, a full disk). The certificate row must survive that
--   failure so the achievement is never lost, and the reason has to be stored so
--   the Super Admin can see why it is missing and regenerate it from the UI.
--
-- * `rank` is an INTEGER. An earlier revision stored a phrase such as '1st
--   place', which cannot be filtered or sorted; the human phrase lives in
--   `title`, where it belongs. The UPGRADE section converts existing values.
--
-- STRUCTURE
--   Part 1  create what is missing (fresh installs)
--   Part 2  upgrade an earlier revision of these tables (idempotent ALTERs)
--   Part 3  converge constraint + index names, so a fresh database and an
--           upgraded one end up with an identical schema
--   Part 4  ensure the settings row exists

-- ═══════════════════════════════════════════════════════════════════════════
-- Part 1 — create what is missing
-- ═══════════════════════════════════════════════════════════════════════════

-- Certificate numbers are CERT-YYYY-NNNN, allocated per issuing calendar year.
--
-- They come from this table rather than from MAX(certificate_no)+1 over
-- `certificates`: a read-then-write max() races, so two concurrent issuances can
-- be handed the same number. One atomic UPSERT bumps the year counter, and the
-- UNIQUE constraint on certificates.certificate_no is the final backstop.
CREATE TABLE IF NOT EXISTS certificate_number_counters (
  year       INTEGER PRIMARY KEY,
  last_value INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS certificates (
  id             SERIAL PRIMARY KEY,
  student_id     INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,

  -- 'level' | 'tournament'. The type decides which reference below must be
  -- present, which is what makes an invalid pairing (a tournament certificate
  -- with no tournament) impossible to store rather than merely discouraged.
  type           VARCHAR(20) NOT NULL,

  title          VARCHAR(200) NOT NULL,

  -- Finishing position for a tournament certificate, NULL for a level one.
  rank           INTEGER,
  level_no       INTEGER,                       -- completed level, NULL for tournaments
  tournament_id  INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,

  issued_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  certificate_no VARCHAR(30) NOT NULL,

  -- Relative public path, e.g. '/uploads/certificates/CERT-2026-0001.pdf'.
  -- Relative on purpose: it survives a change of domain or port, and the API
  -- turns it into an absolute URL per request for the WhatsApp message.
  file_url       TEXT,

  -- Why the most recent generate attempt failed. Non-NULL means "needs
  -- regenerating"; the admin UI reads it to explain the red state.
  file_error     TEXT,

-- 'pending' | 'sent'. NOTE: 'sent' records only that the WhatsApp share sheet
  -- was used, or the conversation was opened — WhatsApp gives no delivery or read
  -- receipt, so nothing here claims the parent actually received or read anything.
  status         VARCHAR(10) NOT NULL DEFAULT 'pending',
  sent_at        TIMESTAMP,
  sent_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- How many times this certificate has been sent. WhatsApp confirms nothing, so a
  -- certificate may legitimately need sending again — the parent may not have seen
  -- it, or the number may have been wrong. Tracking the attempts makes that visible
  -- ("sent 3 times") instead of leaving the record looking like a single delivery.
  send_count     INTEGER NOT NULL DEFAULT 0,

  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT certificates_certificate_no_key UNIQUE (certificate_no)
);

CREATE TABLE IF NOT EXISTS certificate_settings (
  id               INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  message_template TEXT    NOT NULL,
  institute_name   TEXT    NOT NULL,
  coach_name       TEXT    NOT NULL,
  logo_url         TEXT,
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_by       INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Part 2 — upgrade an earlier revision of these tables
--
-- Every statement here is guarded, so re-running is a no-op. `CREATE TABLE IF
-- NOT EXISTS` above silently skips a table that already exists with an older
-- shape, which is exactly why these ALTERs are needed.
-- ═══════════════════════════════════════════════════════════════════════════

-- Added after the first revision: the failure reason for a failed generation.
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS file_error TEXT;

-- Added after the first revision: how many times the certificate has been sent, so
-- a resend is visible in the record rather than overwriting the first attempt.
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS send_count INTEGER NOT NULL DEFAULT 0;

-- Who last changed the settings (audit trail on an academy-owned document).
ALTER TABLE certificate_settings ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- rank: VARCHAR(60) → INTEGER.
--
-- Handles both shapes an older row might hold: a bare number ('2') and the
-- phrase the first revision wrote ('2nd place', from which the digits are
-- extracted). Values with no digits at all become NULL rather than aborting the
-- migration — an unreadable legacy rank is not worth failing a deploy over, and
-- the phrase is still preserved in `title`.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'certificates'
       AND column_name = 'rank' AND data_type = 'character varying'
  ) THEN
    EXECUTE $alt$
      ALTER TABLE certificates ALTER COLUMN rank TYPE INTEGER
      USING CASE
        WHEN rank IS NULL THEN NULL
        WHEN rank ~ '^[0-9]+$' THEN rank::integer
        ELSE NULLIF(regexp_replace(rank, '[^0-9]', '', 'g'), '')::integer
      END
    $alt$;
  END IF;
END $$;

-- tournament_id: ON DELETE SET NULL → ON DELETE CASCADE.
--
-- SET NULL is incompatible with the type/reference constraint in Part 3: a
-- tournament certificate whose tournament was deleted would be left referencing
-- nothing while still claiming type='tournament'. Cascading removes the
-- certificate with the tournament, matching how a student's certificates go when
-- the student is deleted.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'certificates_tournament_id_fkey'
       AND pg_get_constraintdef(oid) LIKE '%ON DELETE SET NULL%'
  ) THEN
    ALTER TABLE certificates DROP CONSTRAINT certificates_tournament_id_fkey;
    ALTER TABLE certificates ADD CONSTRAINT certificates_tournament_id_fkey
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE;
  END IF;
END $$;

-- type: drop the old DEFAULT 'level'.
--
-- Issuance always supplies the type explicitly, and a silent default is how a
-- tournament certificate ends up stored as a level one.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'certificates'
       AND column_name = 'type' AND column_default IS NOT NULL
  ) THEN
    ALTER TABLE certificates ALTER COLUMN type DROP DEFAULT;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Part 3 — converge constraints and indexes
--
-- The first revision declared type/status as unnamed inline CHECKs, so Postgres
-- auto-named them certificates_type_check / certificates_status_check. They are
-- replaced with explicitly named ones so that a fresh install and an upgraded
-- database have an identical schema — which is what lets the migration runner
-- verify the result by name.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE certificates DROP CONSTRAINT IF EXISTS certificates_type_check;
ALTER TABLE certificates DROP CONSTRAINT IF EXISTS certificates_status_check;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificates_type_valid') THEN
    ALTER TABLE certificates ADD CONSTRAINT certificates_type_valid
      CHECK (type IN ('level', 'tournament'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificates_status_valid') THEN
    ALTER TABLE certificates ADD CONSTRAINT certificates_status_valid
      CHECK (status IN ('pending', 'sent'));
  END IF;

  -- A row must carry exactly the reference that matches its type.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificates_type_reference_valid') THEN
    ALTER TABLE certificates ADD CONSTRAINT certificates_type_reference_valid CHECK (
      (type = 'level'      AND level_no IS NOT NULL AND tournament_id IS NULL) OR
      (type = 'tournament' AND tournament_id IS NOT NULL AND level_no IS NULL)
    );
  END IF;

  -- level_no must address a real tier. ratingService.LEVELS currently runs 1..7;
  -- widen this if tiers are added rather than letting the app diverge.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificates_level_no_valid') THEN
    ALTER TABLE certificates ADD CONSTRAINT certificates_level_no_valid
      CHECK (level_no IS NULL OR level_no BETWEEN 1 AND 7);
  END IF;

  -- Rank is a 1-based finishing position.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificates_rank_valid') THEN
    ALTER TABLE certificates ADD CONSTRAINT certificates_rank_valid
      CHECK (rank IS NULL OR rank >= 1);
  END IF;

  -- A sent certificate must say when it was sent.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificates_sent_at_required') THEN
    ALTER TABLE certificates ADD CONSTRAINT certificates_sent_at_required
      CHECK (status <> 'sent' OR sent_at IS NOT NULL);
  END IF;
END $$;

-- These two partial unique indexes ARE the duplicate guard, and the reason
-- issuance is idempotent. They are partial (WHERE the discriminator IS NOT NULL)
-- so a level certificate is never blocked by a tournament certificate for the
-- same student, and vice versa. (A plain UNIQUE (student_id, level_no) would also
-- work, since Postgres treats NULLs as distinct — but the partial form states
-- the intent directly and keeps the index small.)
CREATE UNIQUE INDEX IF NOT EXISTS uq_certificates_student_level
  ON certificates (student_id, level_no)
  WHERE level_no IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_certificates_student_tournament
  ON certificates (student_id, tournament_id)
  WHERE tournament_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_certificates_student     ON certificates (student_id);
CREATE INDEX IF NOT EXISTS idx_certificates_status     ON certificates (status);
CREATE INDEX IF NOT EXISTS idx_certificates_issued     ON certificates (issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_certificates_tournament ON certificates (tournament_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Part 4 — settings row
--
-- The app reads id = 1 unconditionally, and issues certificates with whatever
-- institute name is stored there, so a missing row would print the wrong academy
-- on a student's certificate. Seed it if it is not there.
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO certificate_settings (id, message_template, institute_name, coach_name, logo_url)
VALUES (
  1,
  E'Vanakkam {name}! \xF0\x9F\x8E\x89\n{title} - vaazhthukkal! Ungal muyarchikku oru sirappana angeekaram. Certificate inge: {link}\n\n* {institute_name}',
  'MATE ZONE CHESS ACADEMY',
  '',
  NULL
)
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- Part 5 — data fixups
--
-- `send_count` arrived after certificates had already been sent, so those rows
-- read status='sent' with a count of 0. Backfill them to 1 so the invariant holds:
-- a sent certificate has been sent at least once. Idempotent — a row already
-- counted is left alone.
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE certificates SET send_count = 1 WHERE status = 'sent' AND send_count < 1;