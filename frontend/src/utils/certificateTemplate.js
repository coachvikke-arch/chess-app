/*
 * Client-side mirror of the certificate message/phone rules.
 *
 * WHY THIS EXISTS ALONGSIDE backend/src/services/certificateWhatsApp.js
 * The server is authoritative: every certificate it returns already carries a
 * rendered `message`, a `waUrl`, a `canSend` flag and the specific `blockers`
 * explaining why not. Nothing is ever sent from here.
 *
 * This module is only for INSTANT feedback while an admin is still typing — the
 * live message preview on the settings screen, and warning on a student row
 * before they open a detail page. If the two ever disagree, the server wins and
 * the send button stays disabled.
 */

/** Placeholders a template may use. */
export const PLACEHOLDERS = ['{name}', '{title}', '{link}', '{institute_name}'];

/**
 * Same rule as the backend: the number must carry its country code. Stored
 * values may be E.164 ("+91984100001") or older spaced forms, so formatting
 * characters are stripped first. A leading zero is rejected because no country
 * code begins with 0.
 */
export const PHONE_PATTERN = /^[1-9]\d{7,14}$/;

export const PHONE_RULE_MESSAGE =
  'Phone must include the country code (e.g. +91 98410 00001)';

/** @returns {{ valid: boolean, reason?: string, phone?: string }} */
export function validatePhone(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { valid: false, reason: 'No phone number saved for this student' };
  }
  const phone = String(raw).trim().replace(/[\s\-().]/g, '').replace(/^\+/, '');
  if (!/^\d+$/.test(phone)) {
    return { valid: false, reason: PHONE_RULE_MESSAGE };
  }
  if (!PHONE_PATTERN.test(phone)) {
    return { valid: false, reason: PHONE_RULE_MESSAGE };
  }
  return { valid: true, phone };
}

/** First name only — the greeting should not read "Hi Arun Kumar". */
export function firstName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts[0] || 'there';
}

/** Strip markup so a template can never inject HTML into the preview. */
export function sanitizeTemplate(template) {
  return String(template || '').replace(/<[^>]*>/g, '').trim();
}

/**
 * Fill the greeting template.
 *
 * Only the four supported placeholders are substituted. An unknown {token} is
 * left as written on purpose: a typo should be visible in the live preview
 * rather than silently disappearing from the message a parent receives.
 */
export function renderMessage(template, values) {
  const base = sanitizeTemplate(template);
  if (!base) return '';
  const safe = {
    name: firstName(values.name),
    title: String(values.title ?? ''),
    link: String(values.link ?? ''),
    institute_name: String(values.institute_name ?? ''),
  };
  return PLACEHOLDERS.reduce(
    (out, token) => out.split(token).join(safe[token.slice(1, -1)]),
    base
  );
}

/** wa.me deep link. Mirrors the backend builder. */
export function buildWhatsAppUrl(phone, message) {
  const check = validatePhone(phone);
  if (!check.valid) throw new Error(check.reason);
  return `https://wa.me/${check.phone}?text=${encodeURIComponent(message)}`;
}

/** Any {token} in the template that is not one of the four supported ones. */
export function unknownPlaceholders(template) {
  const found = String(template || '').match(/\{[a-z_]+\}/gi) || [];
  return [...new Set(found)].filter((t) => !PLACEHOLDERS.includes(t));
}