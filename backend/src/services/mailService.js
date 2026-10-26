
const nodemailer = require('nodemailer');
const { APP_NAME } = require('../config/brand');

const INSTITUTE_NAME = APP_NAME;
const DEFAULT_SUBJECT = `Welcome to ${APP_NAME} 🎉`;

/* A relay call that hangs must not hold a request or a retry loop forever. */
const RELAY_TIMEOUT_MS = 20000;

let transporter = null;
let transporterChecked = false;

/* Some hosts (Railway Hobby, most PaaS free tiers) block outbound SMTP while
   allowing HTTPS. MAIL_TRANSPORT=relay sends the message to a small HTTPS
   endpoint that owns the SMTP credentials instead of dialling the mail server
   from here. */
function isRelayTransport() {
  return String(process.env.MAIL_TRANSPORT || '').toLowerCase() === 'relay';
}

function isRelayConfigured() {
  return Boolean(process.env.MAIL_RELAY_URL && process.env.MAIL_RELAY_SECRET);
}

/** Is there enough configuration to attempt a send at all? */
function isMailConfigured() {
  if (isRelayTransport()) return isRelayConfigured();
  return Boolean(
    process.env.MAIL_HOST
    && process.env.MAIL_USER
    && process.env.MAIL_PASS
    && process.env.MAIL_FROM,
  );
}

/** The dummy transport: nothing leaves the machine, the mail is logged. */
function isDummyTransport() {
  return String(process.env.MAIL_TRANSPORT || '').toLowerCase() === 'dummy';
}

/**
 * What the mail setup can actually do right now.
 *
 *   'smtp'  a real mail server is configured - messages are sent
 *   'relay' an HTTPS relay is configured - messages are sent through it
 *   'dummy' the dummy transport is on - messages are only printed to the log
 *   'off'   nothing is configured - messages are skipped
 *
 * The caller uses this to tell the truth in the UI: a registration must never
 * claim "email sent" when the message was only printed.
 */
function mailStatus() {
  if (isDummyTransport()) return 'dummy';
  if (isRelayTransport()) return isRelayConfigured() ? 'relay' : 'off';
  return isMailConfigured() ? 'smtp' : 'off';
}

/**
 * A one-time warning about the mail setup.
 *
 * The From address is the one thing that silently breaks delivery on the most
 * common provider: Gmail refuses a message whose From is an address the
 * account does not own ("Sender address not owned"). So the check is here, once,
 * at start-up, where somebody will actually see it.
 */
function checkMailSetup() {
  const status = mailStatus();
  if (status === 'dummy') {
    console.warn('[mail] MAIL_TRANSPORT=dummy - messages are printed to the log, NOT sent. Remove it to send real mail.');
    return status;
  }
  if (status === 'off') {
    console.warn('[mail] SMTP is not configured (MAIL_HOST/MAIL_USER/MAIL_PASS/MAIL_FROM) - no email will be sent.');
    return status;
  }
  if (status === 'relay') {
    console.log(`[mail] HTTPS relay ready: ${process.env.MAIL_RELAY_URL} as ${process.env.MAIL_FROM || process.env.MAIL_USER}`);
    return status;
  }
  const from = String(process.env.MAIL_FROM || '');
  const user = String(process.env.MAIL_USER || '');
  const fromDomain = from.split('@')[1] || '';
  const userDomain = user.split('@')[1] || '';
  if (fromDomain && userDomain && fromDomain !== userDomain) {
    console.warn(`[mail] MAIL_FROM (${from}) and MAIL_USER (${user}) are on different domains - most SMTP servers (Gmail included) will refuse to send it.`);
  }
  if (user.endsWith('@gmail.com') && !String(process.env.MAIL_PASS || '').trim()) {
    console.warn('[mail] MAIL_PASS is empty - a Gmail account needs an App Password, not the account password.');
  }
  console.log(`[mail] SMTP ready: ${process.env.MAIL_HOST}:${process.env.MAIL_PORT || 587} as ${user}`);
  return status;
}

function getTransporter() {
  if (transporterChecked) return transporter;
  transporterChecked = true;

  if (isDummyTransport()) {
    /* jsonTransport builds the exact message and hands it back instead of
       sending it - the perfect way to try the whole flow with a dummy address. */
    transporter = nodemailer.createTransport({ jsonTransport: true });
    return transporter;
  }

  if (!isMailConfigured()) {
    console.warn('[mail] SMTP is not configured (MAIL_HOST/MAIL_USER/MAIL_PASS/MAIL_FROM) - emails are disabled.');
    transporter = null;
    return transporter;
  }

  const port = Number(process.env.MAIL_PORT || 587);
  const secure = String(process.env.MAIL_SECURE || '').toLowerCase() === 'true' || port === 465;

  transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port,
    secure,
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    pool: true,
    maxConnections: 3,
  });
  return transporter;
}

/** Reset the cached transporter (used by the tests and after a config change). */
function resetMailTransport() {
  transporter = null;
  transporterChecked = false;
}

/**
 * Send one message.
 *
 * @param {object} mail
 * @param {string} mail.to
 * @param {string} mail.subject
 * @param {string} mail.html
 * @param {string} mail.text
 * @param {string} [mail.mask]  a secret that must never appear in a LOG
 *   (the temporary password). The message itself still carries it - that is the
 *   point of the mail - but the DUMMY TRANSPORT prints the message to the log,
 *   so the printed copy is masked.
 * @returns {Promise<{ok: boolean, error?: string, id?: string, skipped?: string, mode?: string}>}
 *   NEVER rejects.
 */
async function sendMail({ to, subject, html, text, mask = null }) {
  if (!to) {
    console.warn('[mail] no recipient - skipped.');
    return { ok: false, skipped: 'no-recipient' };
  }
  if (isDummyTransport()) {
    const t = getTransporter();
    const info = await t.sendMail({
      from: formatFrom(),
      to,
      subject,
      text,
      html,
    });
    /* The dummy transport hands back the rendered message - logging it is how
       you actually SEE what would have been sent. The password is masked in
       that print: a log is not a place for a live credential. */
    const printed = mask ? maskSecret(info.message, mask) : info.message;
    console.log('[mail] DUMMY TRANSPORT - message that would have been sent:\n', printed);
    return { ok: true, id: 'dummy', mode: 'dummy' };
  }
  if (isRelayTransport()) {
    if (!isRelayConfigured()) {
      console.warn('[mail] MAIL_TRANSPORT=relay but MAIL_RELAY_URL/MAIL_RELAY_SECRET are missing - the message was not sent.');
      return { ok: false, skipped: 'not-configured' };
    }
    try {
      const response = await fetch(process.env.MAIL_RELAY_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-mail-relay-secret': process.env.MAIL_RELAY_SECRET,
        },
        body: JSON.stringify({ to, subject, html, text }),
        signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        const reason = data.error || `HTTP ${response.status}`;
        console.error('[mail] relay send failed:', reason);
        return { ok: false, error: reason };
      }
      console.log(`[mail] sent via relay to ${to} (${data.id || 'no id'})`);
      return { ok: true, id: data.id, mode: 'relay' };
    } catch (err) {
      console.error('[mail] relay send failed:', err && err.message);
      return { ok: false, error: (err && err.message) || 'relay send failed' };
    }
  }
  if (!isMailConfigured()) {
    console.warn('[mail] SMTP is not configured - the message was not sent.');
    return { ok: false, skipped: 'not-configured' };
  }
  try {
    const t = getTransporter();
    const info = await t.sendMail({
      from: formatFrom(),
      to,
      subject,
      text,
      html,
    });
    console.log(`[mail] sent to ${to} (${(info && info.messageId) || 'no id'})`);
    return { ok: true, id: info && info.messageId, mode: 'smtp' };
  } catch (err) {
    console.error('[mail] send failed:', err && err.message);
    return { ok: false, error: (err && err.message) || 'send failed' };
  }
}

function formatFrom() {
  const name = process.env.MAIL_FROM_NAME || INSTITUTE_NAME;
  /* The placeholder address is only ever used by the DUMMY transport (a real
     send is refused when MAIL_FROM/MAIL_USER are missing), so it can never
     reach a mail server. */
  const address = process.env.MAIL_FROM || process.env.MAIL_USER || 'no-reply@example.invalid';
  return `"${name}" <${address}>`;
}

/* ── sending the same mail twice ────────────────────────────────────────────
   A double-click (or a client that retries) must not produce two
   confirmations. The guard is per student and short-lived - long enough to
   swallow an accidental second click, short enough that a deliberate resend
   still works. */
const MAIL_COOLDOWN_MS = 60 * 1000;
const recentlyMailed = new Map();

function isRecentlyMailed(key) {
  if (key == null) return false;
  const at = recentlyMailed.get(String(key));
  if (!at) return false;
  if (Date.now() - at > MAIL_COOLDOWN_MS) {
    recentlyMailed.delete(String(key));
    return false;
  }
  return true;
}

function markMailed(key) {
  if (key == null) return;
  recentlyMailed.set(String(key), Date.now());
  if (recentlyMailed.size > 200) {
    /* Keep the map from growing for ever. */
    const oldest = recentlyMailed.keys().next().value;
    recentlyMailed.delete(oldest);
  }
}

/* Where the student signs in.
 *
 * FRONTEND_URL is the address the app is served from. CLIENT_URL is kept as a
 * fallback because the backend already uses it for CORS, and the final default
 * is the local dev server. */
function buildLoginUrl() {
  const base = String(process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:5173')
    .replace(/\/+$/, '');
  return `${base}/login`;
}

/* Where a student who cannot get in asks for help. */
function buildForgotPasswordUrl() {
  const base = String(process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:5173')
    .replace(/\/+$/, '');
  return `${base}/reset-password`;
}

/* ── a temporary password ─────────────────────────────────────────────────────
   Used when the admin registers a student WITHOUT choosing a password: one is
   generated, mailed to the student and flagged so they must change it at their
   first sign-in. The database only ever holds the HASH; this string lives in
   memory for the length of the request and is never written down.
   crypto.randomBytes, never Math.random. */
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const PASSWORD_LENGTH = 12;

function generateTemporaryPassword(length = PASSWORD_LENGTH) {
  const bytes = require('crypto').randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  }
  /* Always at least one letter and one digit, whatever the roll - and the
     length never changes (the last character is REPLACED, not appended). */
  if (/[0-9]/.test(out) && /[A-Za-z]/.test(out)) return out;
  return `${out.slice(0, -1)}${/\d/.test(out) ? 'a' : '7'}`;
}

/* ── email validation ─────────────────────────────────────────────────────── */

/* Mask one or more secrets in a printed copy of the message: the first two
   characters and a row of stars, so a developer can still see WHICH secret was
   in the mail without the log holding a working credential. Multiple secrets
   are passed as a '|'-separated string. */
function maskSecret(text, secret) {
  const value = String(text == null ? '' : text);
  const s = String(secret || '');
  if (!s) return value;
  const parts = s.split('|');
  let result = value;
  for (const part of parts) {
    if (!part) continue;
    const head = part.slice(0, 2);
    result = result.split(part).join(`${head}${'*'.repeat(Math.max(4, Math.min(8, part.length - head.length)))}`);
  }
  return result;
}

/* Deliberately conservative: one @, a dot in the domain, no spaces. It is the
   same rule the registration form uses, so the two agree. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  const value = String(email || '').trim();
  if (!value || value.length > 254) return false;
  return EMAIL_RE.test(value);
}

/* ── the registration email ───────────────────────────────────────────────── */

/* Escape everything that comes from the database before it goes into HTML. */
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The welcome mail sent to a student who has just been registered.
 *
 * It carries the LOGIN DETAILS, because that is what the student needs: the
 * student id, the username, the password they start with and the link to sign
 * in. The password is the one the academy set (or the temporary one it
 * generated); the account is flagged so the app makes them change it at their
 * first sign-in. The database only ever holds the HASH.
 *
 * Everything that comes from the database is escaped before it goes into the
 * HTML.
 *
 * @param {object} student
 * @param {string} student.name
 * @param {string} student.email
 * @param {number} [student.studentId]  the id in the students table
 * @param {string} [student.username]
 * @param {string} [student.password]   the password the student starts with
 * @param {string} [student.batch]      the group / batch name
 * @param {string} [student.branch]     the branch (coach) name
 * @param {string} [student.loginUrl]   where to sign in
 * @returns {Promise<{ok: boolean, error?: string, skipped?: string, mode?: string}>}
 */
/**
 * Build the welcome mail (no transport involved).
 *
 * Split out from sendRegistrationEmail so the CONTENT can be checked on its
 * own - the dummy transport deliberately MASKS the password in what it prints,
 * so the printed copy can never be used to assert what the real mail carries.
 *
 * @param {object} student  see sendRegistrationEmail
 * @returns {{subject: string, html: string, text: string, to: string}|null}
 */
function buildRegistrationEmail(student = {}) {
  const email = String(student.email || '').trim();
  if (!email || !isValidEmail(email)) return null;

  const name = String(student.name || 'there').trim() || 'there';
  const password = String(student.password || '');
  const recoveryCode = String(student.recoveryCode || '').trim();
  const loginUrl = student.loginUrl || buildLoginUrl();
  const forgotUrl = buildForgotPasswordUrl();

  /* The login details box. Only the rows that are known are shown. */
  const details = [];
  if (student.studentId) details.push(['Student ID', String(student.studentId)]);
  if (student.username) details.push(['Username', String(student.username)]);
  if (password) details.push(['Password', password]);
  if (recoveryCode) details.push(['Recovery Code', recoveryCode]);
  if (student.batch) details.push(['Batch', String(student.batch)]);
  if (student.branch) details.push(['Branch', String(student.branch)]);

  const rowsHtml = details.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;border-collapse:collapse">${details
      .map(([k, v]) => `<tr>
            <td style="padding:7px 14px 7px 0;color:#64748b;font-size:13px;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td>
            <td style="padding:7px 0;color:#0f172a;font-size:14px;font-weight:600;word-break:break-word">${k === 'Recovery Code' ? `<code style="font-family:monospace;letter-spacing:0.15em;background:#f1f5f9;padding:2px 6px;border-radius:4px">${escapeHtml(v)}</code>` : escapeHtml(v)}</td>
          </tr>`)
      .join('')}</table>`
    : '';

  const rowsText = details.length
    ? details.map(([k, v]) => `${k}: ${v}`).join('\n')
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(DEFAULT_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">Your account at ${escapeHtml(INSTITUTE_NAME)} is ready. Username: ${escapeHtml(student.username || '')}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:24px 12px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 8px 30px rgba(15,23,42,.08)">
          <tr>
            <td style="background:#0f172a;padding:22px 26px;color:#ffffff">
              <div style="font-size:19px;font-weight:800;letter-spacing:.02em">${escapeHtml(INSTITUTE_NAME)}</div>
              <div style="font-size:12px;color:#94a3b8;margin-top:4px">Chess coaching &amp; learning platform</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 26px 26px">
              <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3">Welcome to ${escapeHtml(INSTITUTE_NAME)} 🎉</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.6">Hello ${escapeHtml(name)}, welcome to ${escapeHtml(INSTITUTE_NAME)}! 🎉</p>
              <p style="margin:0 0 18px;font-size:15px;line-height:1.6">
                Your registration is complete and your student account is now active.
                We're excited to have you with us and look forward to seeing you in class.
              </p>

              <!-- login details -->
              <div style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:12px;padding:16px 18px">
                <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:700;margin-bottom:6px">Your login details</div>
                ${rowsHtml}
                ${recoveryCode ? `<div style="margin:10px 0 0;font-size:12px;color:#64748b;line-height:1.5">Keep your recovery code safe. You will need it to reset your password if you forget it. Please do not share it with anyone.</div>` : ''}
                <div style="margin:16px 0 0">
                  <a href="${escapeHtml(loginUrl)}"
                     style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;font-size:15px">
                    Login now
                  </a>
                </div>
                <div style="margin:12px 0 0;font-size:12px;color:#64748b;line-height:1.6">
                  If the button does not open, copy this address into your browser:<br>
                  ${escapeHtml(loginUrl)}
                </div>
              </div>

              <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#334155">
                <strong>For your security, please change this password after your first login.</strong>
              </p>
              <p style="margin:10px 0 0;font-size:13px;line-height:1.6;color:#64748b">
                Forgot your password? Use the recovery code shown above at
                <a href="${escapeHtml(forgotUrl)}" style="color:#1d4ed8">${escapeHtml(forgotUrl)}</a>
              </p>

              <p style="margin:24px 0 0;font-size:15px;line-height:1.6">
                If you have any questions, just reply to this mail and we will help.
              </p>
              <p style="margin:8px 0 0;font-size:13px;line-height:1.7;color:#475569">
                <br>— The team at ${escapeHtml(INSTITUTE_NAME)}
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 26px;font-size:12px;color:#64748b">
              ${escapeHtml(INSTITUTE_NAME)} · Your student account details.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

const text = `Welcome to ${INSTITUTE_NAME} 🎉

 Hello ${name}, welcome to ${INSTITUTE_NAME}! 🎉

 Your registration is complete and your student account is now active. We're excited to have you with us and look forward to seeing you in class.

 Your login details
 ${rowsText}
 ${recoveryCode ? '\nKeep your recovery code safe. You will need it to reset your password if you forget it. Please do not share it with anyone.' : ''}

 Login now: ${loginUrl}

 For your security, please change this password after your first login.

 Forgot your password? Use the recovery code shown above at ${forgotUrl}

 If you have any questions, just reply to this mail and we will help.
 — The team at ${INSTITUTE_NAME}`;

  return { to: email, subject: DEFAULT_SUBJECT, html, text };
}

/**
 * Send the welcome mail to a student who has just been registered.
 *
 * It carries the LOGIN DETAILS, because that is what the student needs: the
 * student id, the username, the password they start with and the link to sign
 * in. The password is the one the academy set (or the temporary one it
 * generated); the account is flagged so the app makes them change it at their
 * first sign-in. The database only ever holds the HASH.
 *
 * Everything that comes from the database is escaped before it goes into the
 * HTML.
 *
 * @param {object} student
 * @param {string} student.name
 * @param {string} student.email
 * @param {number} [student.studentId]  the id in the students table
 * @param {string} [student.username]
 * @param {string} [student.password]   the password the student starts with
 * @param {string} [student.batch]      the group / batch name
 * @param {string} [student.branch]     the branch (coach) name
 * @param {string} [student.loginUrl]   where to sign in
 * @returns {Promise<{ok: boolean, error?: string, skipped?: string, mode?: string}>}
 */
async function sendRegistrationEmail(student = {}) {
  const email = String(student.email || '').trim();

  if (!email) {
    console.warn('[mail] registration email skipped - the student has no email address.');
    return { ok: false, skipped: 'no-email' };
  }
  if (!isValidEmail(email)) {
    console.warn(`[mail] registration email skipped - "${email}" is not a valid address.`);
    return { ok: false, skipped: 'invalid-email' };
  }

  const built = buildRegistrationEmail(student);
  if (!built) return { ok: false, skipped: 'invalid-email' };

  /* Mask BOTH the password and the recovery code in the dummy transport log. */
  const maskParts = [String(student.password || ''), String(student.recoveryCode || '')].filter(Boolean);
  const combinedMask = maskParts.join('|');

  return sendMail({
    to: built.to,
    subject: built.subject,
    html: built.html,
    text: built.text,
    /* The plain password and recovery code are masked in the log, so the dummy
       transport (and any other log) can never print them. */
    mask: combinedMask || undefined,
  });
}

module.exports = {
  INSTITUTE_NAME,
  DEFAULT_SUBJECT,
  isMailConfigured,
  isDummyTransport,
  mailStatus,
  checkMailSetup,
  isValidEmail,
  sendMail,
  buildRegistrationEmail,
  sendRegistrationEmail,
  generateTemporaryPassword,
  isRecentlyMailed,
  markMailed,
  buildLoginUrl,
  buildForgotPasswordUrl,
  maskSecret,
  resetMailTransport,
};
