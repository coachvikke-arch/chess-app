/**
 * WhatsApp click-to-chat links for certificates.
 *
 * There is deliberately NO WhatsApp Business API here and nothing is ever sent
 * automatically. The backend only validates the number and builds a
 * `wa.me` deep link; the Super Admin still has to press Send inside WhatsApp.
 * The certificate status records that the compose screen was opened — never
 * that delivery happened.
 */

const WA_BASE = 'https://wa.me/';

/** Placeholders a message template may use. */
const PLACEHOLDERS = ['{name}', '{title}', '{link}', '{institute_name}'];

/** Message template used before a Super Admin customises it. */
const DEFAULT_MESSAGE_TEMPLATE =
  'Vanakkam {name}! \u{1F389}\n{title} - vaazhthukkal! Ungal muyarchikku oru sirappana angeekaram. Certificate inge: {link}\n\n* {institute_name}';

/**
 * A stored phone number must carry its country code. The app stores it as
 * E.164 ("+91984100001"), while older rows may hold "91 98410 00001", so
 * formatting characters are stripped before the digits are checked. Leading
 * zero is rejected: no country code begins with 0.
 */
const PHONE_PATTERN = /^[1-9]\d{7,14}$/;

const PHONE_RULE_MESSAGE =
  'Phone must include the country code (e.g. +91 98410 00001)';

/** Strip the presentation characters a stored number may carry. */
function whatsAppDigits(raw) {
  return String(raw).trim().replace(/[\s\-().]/g, '').replace(/^\+/, '');
}

/** C0 control characters, minus the newline/tab we want to keep. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Validate a stored phone number for WhatsApp.
 *
 * @returns {{ valid: boolean, phone?: string, reason?: string }}
 */
function validatePhone(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { valid: false, reason: 'No phone number saved for this student' };
  }
  const phone = whatsAppDigits(raw);
  if (!/^\d+$/.test(phone)) {
    return { valid: false, reason: PHONE_RULE_MESSAGE };
  }
  if (!PHONE_PATTERN.test(phone)) {
    return { valid: false, reason: PHONE_RULE_MESSAGE };
  }
  return { valid: true, phone };
}

/** True when the stored number can be used for a wa.me link. */
function canSendToPhone(raw) {
  return validatePhone(raw).valid;
}

/** The student's first name, for the {name} placeholder. */
function firstName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return 'there';
  return trimmed.split(/\s+/)[0];
}

/**
 * Strip anything that could be interpreted as markup.
 *
 * The template is plain text that ends up in a WhatsApp composer and in a
 * live-preview panel. WhatsApp's own formatting is `*bold*`, not HTML, so any
 * tag-shaped input is simply removed rather than escaped — a template should
 * never be able to smuggle markup into a preview surface.
 */
function sanitizeTemplate(template) {
  return String(template || '')
    .replace(/<[^>]*>/g, '')
    .replace(CONTROL_CHARS, '')
    .trim();
}

/**
 * Render a message template.
 *
 * Only the four supported placeholders are substituted; every other
 * brace-wrapped token is left untouched so a typo is visible rather than silently
 * blanked.
 */
function renderMessage(template, values) {
  const base = sanitizeTemplate(template) || DEFAULT_MESSAGE_TEMPLATE;
  const safe = {
    name: firstName(values.name),
    title: String(values.title == null ? '' : values.title),
    link: String(values.link == null ? '' : values.link),
    institute_name: String(values.institute_name == null ? '' : values.institute_name),
  };
  return PLACEHOLDERS.reduce(
    (out, token) => out.split(token).join(safe[token.slice(1, -1)]),
    base
  );
}

/**
 * Build the wa.me URL for a certificate.
 *
 * @returns {string} the full wa.me deep link
 * @throws  { Error } when the phone number is not a valid wa.me number
 */
function buildWhatsAppUrl({ phone, message }) {
  const check = validatePhone(phone);
  if (!check.valid) throw new Error(check.reason);
  /* encodeURIComponent gives UTF-8 percent-escapes, which is what wa.me expects
     and which keeps emoji and Tamil text intact. */
  return `${WA_BASE}${check.phone}?text=${encodeURIComponent(message)}`;
}

/** Validate + build in one step, never throwing. */
function buildCertificateWhatsAppLink({ phone, template, values }) {
  const check = validatePhone(phone);
  if (!check.valid) return { valid: false, reason: check.reason };
  const message = renderMessage(template || DEFAULT_MESSAGE_TEMPLATE, values);
  return { valid: true, url: buildWhatsAppUrl({ phone, message }), message };
}

module.exports = {
  WA_BASE,
  PLACEHOLDERS,
  DEFAULT_MESSAGE_TEMPLATE,
  PHONE_PATTERN,
  PHONE_RULE_MESSAGE,
  CONTROL_CHARS,
  whatsAppDigits,
  validatePhone,
  canSendToPhone,
  firstName,
  sanitizeTemplate,
  renderMessage,
  buildWhatsAppUrl,
  buildCertificateWhatsAppLink,
};