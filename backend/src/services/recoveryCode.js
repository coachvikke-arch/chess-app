const crypto = require('crypto');

/**
 * The one-time recovery code.
 *
 * A student who cannot get in uses this with their username to set a new
 * password. Only the DIGEST is stored (see hashRecoveryCode), so the code
 * cannot be read back out of the database - it is shown to the admin ONCE, at
 * the moment the account is created, and to the student in their welcome mail.
 *
 * Shared by the registration path and the "resend the welcome mail" path, so
 * the two can never disagree about what a code looks like.
 */

/** 10 chars, unambiguous alphabet (no 0/O/1/I/l). */
function generateRecoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(10);
  let code = '';
  for (let i = 0; i < 10; i += 1) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

/** Store only a SHA-256 digest of the recovery code - never the code itself. */
function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

module.exports = { generateRecoveryCode, hashRecoveryCode };
