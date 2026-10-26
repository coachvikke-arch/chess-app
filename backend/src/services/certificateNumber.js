const db = require('../config/database');

/**
 * Certificate numbers: CERT-YYYY-NNNN (e.g. CERT-2026-0001).
 *
 * Uniqueness is guaranteed twice over:
 *   1. the per-year counter row is bumped with a single atomic UPSERT, so two
 *      concurrent issuances cannot be handed the same number;
 *   2. `certificates.certificate_no` carries a UNIQUE constraint, which is the
 *      real guarantee — if (1) were ever bypassed the insert fails loudly
 *      instead of storing a duplicate.
 */

const PATTERN = /^CERT-\d{4}-\d{4,}$/;
const PREFIX = 'CERT';
const PAD = 4;

function formatCertificateNo(year, value) {
  return `${PREFIX}-${year}-${String(value).padStart(PAD, '0')}`;
}

/**
 * Reserve the next certificate number for a year.
 *
 * Two layers of safety, because a certificate number is a permanent public
 * identity — reusing one would hand two students the same number:
 *
 *   1. The per-year counter is bumped by a single atomic UPSERT, so two
 *      concurrent issuances cannot be handed the same number.
 *   2. The FIRST insert for a year seeds itself from the highest number already
 *      in `certificates` rather than from 0. If the counter row is ever missing
 *      — dropped by a bad cleanup, restored from a partial backup — the sequence
 *      resumes past the existing numbers instead of restarting and colliding.
 *
 * @param {Date} [at] date whose year the number is issued under
 * @returns {Promise<string>} e.g. 'CERT-2026-0001'
 */
async function nextCertificateNo(at = new Date()) {
  const year = at.getFullYear();
  const { rows } = await db.query(
    `WITH existing AS (
       /* substring from 11: 'CERT-YYYY-' is exactly ten characters, so position
          10 is the hyphen and would make the cast below fail. */
       SELECT COALESCE(MAX(substring(certificate_no from 11)::integer), 0) AS max_seq
         FROM certificates
        WHERE certificate_no ~ ('^CERT-' || $2::text || '-[0-9]+$')
     )
     INSERT INTO certificate_number_counters (year, last_value)
     SELECT $1::integer, GREATEST(existing.max_seq + 1, 1) FROM existing
     ON CONFLICT (year)
     DO UPDATE SET last_value = certificate_number_counters.last_value + 1,
                   updated_at = NOW()
     RETURNING last_value`,
    [year, String(year)]
  );
  return formatCertificateNo(year, rows[0].last_value);
}

/** True when a string is a well-formed certificate number. */
function isCertificateNo(value) {
  return typeof value === 'string' && PATTERN.test(value);
}

module.exports = {
  PATTERN,
  PAD,
  PREFIX,
  formatCertificateNo,
  nextCertificateNo,
  isCertificateNo,
};