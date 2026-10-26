const db = require('../config/database');
const {
  validatePhone, renderMessage, DEFAULT_MESSAGE_TEMPLATE, PHONE_RULE_MESSAGE,
} = require('./certificateWhatsApp');
const { buildCertificateContent, levelTitle, tournamentTitle, ordinal } = require('./certificateContent');
const { saveCertificatePdf } = require('./certificatePdf');
const { nextCertificateNo } = require('./certificateNumber');
const { LEVELS } = require('./ratingService');
const { APP_NAME } = require('../config/brand');

/**
 * Certificates service (Super Admin module).
 *
 * Responsibilities, in the order they matter:
 *   1. ISSUANCE  — one `certificates` row per achievement, idempotently.
 *   2. GENERATION — the PDF, built from the MATE ZONE CHESS ACADEMY artwork.
 *   3. SETTINGS  — the single-row certificate_settings configuration.
 *
 * ISSUANCE IS IDEMPOTENT, and it has to be: it is reached from the rating path
 * (two games finishing together can cross a level band twice), from tournament
 * finalisation (a status flip can be replayed), and from the backfill script. The
 * database settles every race, via the partial unique indexes on `certificates`
 * (one level per student, one tournament per student). A lost race is not an
 * error — it is reported as "already issued" and nothing is rendered.
 *
 * A NOTE ON THE IMPORT GRAPH
 * certificateContent imports LEVELS from ratingService. If ratingService imported
 * this file at the top level, that would be a cycle and `LEVELS` would be
 * destructured as undefined. So the rating path lazy-requires this module inside
 * the function that issues certificates instead of at the top — see
 * ratingService.updateSingleStudent.
 */

const CERT_TYPES = { level: 'level', tournament: 'tournament' };

/** Valid level tiers, from ratingService. Mirrors the DB CHECK constraint. */
const MAX_LEVEL = LEVELS.length;

/** Defaults used only if the settings row is somehow absent. */
const FALLBACK_SETTINGS = {
  message_template: DEFAULT_MESSAGE_TEMPLATE,
  institute_name: APP_NAME,
  coach_name: '',
  logo_url: null,
};

/* ── Students ─────────────────────────────────────────────────────────────
   `students` has no `name` or `phone` column: both live on `users`, reached via
   students.user_id. Reading them from the user row also means editing a phone
   number in one place updates the certificate flow immediately, instead of
   leaving a duplicated column to drift. Students with no linked user row (the
   FK is nullable) fall back to a labelled placeholder rather than failing.
*/
async function getStudent(studentId) {
  const { rows } = await db.query(
    `SELECT s.id,
            COALESCE(u.name, 'Student #' || s.id) AS name,
            u.phone AS phone,
            s.parent_name
       FROM students s
       LEFT JOIN users u ON u.id = s.user_id
      WHERE s.id = $1`,
    [studentId]
  );
  return rows[0] || null;
}

/* ── Settings ─────────────────────────────────────────────────────────────*/

/**
 * The single settings row.
 *
 * The database guarantees row id=1 exists (the migration seeds it), so a missing
 * row means the migration has not been run — that is reported rather than papered
 * over, because silently issuing certificates with a default institute name would
 * print the wrong academy on a student's certificate.
 */
async function getSettings() {
  const { rows } = await db.query(`SELECT * FROM certificate_settings WHERE id = 1`);
  if (!rows.length) {
    throw new Error(
      'certificate_settings is empty — run `node run_migration_certificates.js` before issuing certificates'
    );
  }
  const row = rows[0];
  return {
    message_template: row.message_template,
    institute_name: row.institute_name,
    coach_name: row.coach_name || '',
    logo_url: row.logo_url || null,
    updated_at: row.updated_at,
  };
}

/**
 * Update the settings row. Partial: only the keys present in `patch` change, so
 * the admin form can save one field without having to send the whole object back.
 */
async function saveSettings(patch, userId) {
  const current = await getSettings();
  const next = {
    message_template:
      patch.message_template !== undefined && String(patch.message_template).trim()
        ? String(patch.message_template)
        : current.message_template,
    institute_name:
      patch.institute_name !== undefined && String(patch.institute_name).trim()
        ? String(patch.institute_name).trim()
        : current.institute_name,
    coach_name:
      patch.coach_name !== undefined ? String(patch.coach_name) : current.coach_name,
    logo_url:
      patch.logo_url !== undefined ? (patch.logo_url ? String(patch.logo_url) : null) : current.logo_url,
  };

  const { rows } = await db.query(
    `UPDATE certificate_settings
        SET message_template = $1, institute_name = $2, coach_name = $3, logo_url = $4,
            updated_at = NOW(), updated_by = $5
      WHERE id = 1
      RETURNING *`,
    [next.message_template, next.institute_name, next.coach_name, next.logo_url, userId || null]
  );
  return {
    message_template: rows[0].message_template,
    institute_name: rows[0].institute_name,
    coach_name: rows[0].coach_name || '',
    logo_url: rows[0].logo_url || null,
    updated_at: rows[0].updated_at,
  };
}

/* ── Issuance ────────────────────────────────────────────────────────────*/

/**
 * Insert one certificate row, or return null when this achievement already has
 * one.
 *
 * null is the normal, expected outcome of a duplicate — it is how the rating
 * path, tournament finalisation and the backfill script all stay re-runnable. The
 * UNIQUE violation is caught here and reported as "already issued" rather than
 * logged as a failure, because a duplicate is not a fault.
 *
 * The certificate number is allocated first and is never reused: if the insert
 * then loses the duplicate race, that number is simply skipped. Gaps are the
 * right trade — reusing a number risks handing two students the same certificate
 * identity, which is far worse than a hole in the sequence.
 */
async function insertCertificate(payload) {
  const issuedAt = payload.issued_at ? new Date(payload.issued_at) : new Date();
  const certificateNo = await nextCertificateNo(issuedAt);
  try {
    const { rows } = await db.query(
      `INSERT INTO certificates
         (student_id, type, title, rank, level_no, tournament_id, issued_at, certificate_no, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
       RETURNING *`,
      [
        payload.student_id,
        payload.type,
        payload.title,
        payload.rank ?? null,
        payload.level_no ?? null,
        payload.tournament_id ?? null,
        issuedAt,
        certificateNo,
      ]
    );
    return rows[0];
  } catch (err) {
    if (err && err.code === '23505') return null; // unique_violation → already issued
    throw err;
  }
}

/**
 * Render the PDF and record the outcome.
 *
 * The certificate ROW always survives a generation failure — the achievement
 * itself is the valuable part, and losing it because a font or a disk failed
 * would be the worst possible outcome. Instead the failure reason is written to
 * `file_error`, the row stays `pending` with no `file_url`, and the Super Admin
 * can see why and regenerate from the UI. On success `file_error` is cleared.
 *
 * @returns {Promise<{ok: boolean, fileUrl: string|null, error: string|null, certificate: object}>}
 */
async function generateFile(cert, { student, settings }) {
  try {
    const content = buildCertificateContent({ certificate: cert, student, settings });
    const fileUrl = await saveCertificatePdf(cert, { content });
    const { rows } = await db.query(
      `UPDATE certificates SET file_url = $2, file_error = NULL, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [cert.id, fileUrl]
    );
    return { ok: true, fileUrl, error: null, certificate: rows[0] };
  } catch (err) {
    const message = err && err.message ? err.message : 'Unknown PDF generation error';
    const { rows } = await db.query(
      `UPDATE certificates SET file_error = $2, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [cert.id, message]
    );
    return { ok: false, fileUrl: null, error: message, certificate: rows[0] };
  }
}

/**
 * Issue level certificates for the given tiers, if the student has not earned
 * them yet.
 *
 * A certificate marks the tier a student has REACHED — reaching Beginner (tier
 * 1) earns the Pawn certificate exactly like every tier above it, so
 * certificates mirror the `student_levels` rows one-for-one. `levels` is a list
 * because a backfill or a re-run may resolve several gaps at once, and because
 * an imported rating can land a student above a tier they have no record for.
 *
 * @returns {Promise<object[]>} the rows created; empty when all already existed
 */
async function issueLevelCertificates({ studentId, levels, issuedAt }) {
  const student = await getStudent(studentId);
  if (!student) return [];

  const wanted = [...new Set((levels || []).map(Number))]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_LEVEL)
    .sort((a, b) => a - b);
  if (!wanted.length) return [];

  const settings = await getSettings();
  const created = [];
  for (const level of wanted) {
    const cert = await insertCertificate({
      student_id: studentId,
      type: CERT_TYPES.level,
      title: levelTitle(level),
      level_no: level,
      issued_at: issuedAt,
    });
    /* A null here is a duplicate: already issued by an earlier game or by the
       backfill. Nothing to render. */
    if (!cert) continue;
    /* Return the row as it stands AFTER generation, so the caller sees the real
       file_url / file_error rather than a pre-generation snapshot that would
       look like nothing had happened yet. */
    const generated = await generateFile(cert, { student, settings });
    created.push(generated.certificate);
  }
  return created;
}

/**
 * Issue a tournament-achievement certificate for a finishing position.
 *
 * @returns {Promise<object|null>} the row created, or null when already issued
 */
async function issueTournamentCertificate({ studentId, tournamentId, tournamentName, rank, issuedAt }) {
  const student = await getStudent(studentId);
  if (!student) return null;

  const place = Number(rank);
  if (!Number.isInteger(place) || place < 1) {
    throw new Error(`Tournament certificate needs a finishing position of 1 or more, got ${rank}`);
  }

  const cert = await insertCertificate({
    student_id: studentId,
    type: CERT_TYPES.tournament,
    title: tournamentTitle({ tournamentName, rank: place }),
    rank: place,
    tournament_id: tournamentId,
    issued_at: issuedAt,
  });
  if (!cert) return null;

  const settings = await getSettings();
  /* As above: hand back the post-generation row, so a caller that immediately
     reports "certificate issued" is not describing a row whose PDF failed. */
  const generated = await generateFile(cert, { student, settings });
  return generated.certificate;
}

/**
 * Regenerate a certificate's PDF on demand.
 *
 * The filename is derived from certificate_no, so the file is replaced in place:
 * a link already sent to a parent keeps working and now shows the corrected
 * certificate.
 */
async function regenerate(id) {
  const { rows } = await db.query(`SELECT * FROM certificates WHERE id = $1`, [id]);
  const cert = rows[0];
  if (!cert) return null;

  const student = await getStudent(cert.student_id);
  const settings = await getSettings();
  return generateFile(cert, { student, settings });
}

/* ── Delivery ────────────────────────────────────────────────────────────*/

/**
 * Record that a certificate has just been sent, and return the updated row.
 *
 * Same endpoint for the first send and for every resend: WhatsApp confirms
 * nothing, so a parent who says they never received it can only be dealt with by
 * sending again. `send_count` accumulates so the number of attempts is visible in
 * the record rather than the resend silently overwriting the original, and `sent_at`
 * moves to the most recent attempt — the certificate's own issue date is untouched,
 * so this never rewrites history about when it was earned.
 *
 * Returns null when the certificate does not exist.
 */
async function markSent(id, userId) {
  const { rows } = await db.query(
    `UPDATE certificates
        SET status = 'sent',
            sent_at = NOW(),
            sent_by = $2,
            send_count = send_count + 1,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, userId || null]
  );
  return rows[0] || null;
}

/**
 * Everything the send flow needs for one certificate, or the reason it cannot
 * be sent.
 *
 * A certificate is sendable only when a PDF actually exists AND the student's
 * stored number passes the wa.me rules. An invalid number is reported with the
 * specific rule it breaks, so the UI can disable Send and say why rather than
 * opening WhatsApp with a broken link.
 */
function deliveryFor(cert, student, settings, absoluteUrl) {
  const phone = validatePhone(student && student.phone);
  const link = absoluteUrl || null;
  const message = link
    ? renderMessage(settings.message_template, {
      name: (student && student.name) || '',
      title: cert.title,
      link,
      institute_name: settings.institute_name,
    })
    : null;

  const blockers = [];
  if (!cert.file_url) {
    blockers.push(
      cert.file_error
        ? `Certificate PDF could not be generated: ${cert.file_error}`
        : 'Certificate PDF has not been generated yet'
    );
  }
  if (!phone.valid) blockers.push(phone.reason);

  return {
    canSend: blockers.length === 0,
    blockers,
    phone: phone.valid ? phone.phone : null,
    phoneError: phone.valid ? null : phone.reason,
    message,
    waUrl:
      blockers.length === 0
        ? `https://wa.me/${phone.phone}?text=${encodeURIComponent(message)}`
        : null,
  };
}

module.exports = {
  CERT_TYPES,
  MAX_LEVEL,
  PHONE_RULE_MESSAGE,
  getStudent,
  getSettings,
  saveSettings,
  insertCertificate,
  generateFile,
  issueLevelCertificates,
  issueTournamentCertificate,
  regenerate,
  markSent,
  deliveryFor,
  /* re-exported for tests and the settings screen */
  levelTitle,
  tournamentTitle,
  ordinal,
};