/**
 * Meeting URLs (Zoom / Meet) as typed by the coach.
 *
 * WHY THIS EXISTS
 *
 * A URL saved without a scheme — "meet.google.com/abc-defg" — is resolved by
 * anything that follows it as a path RELATIVE to its own base, not as an
 * absolute address. The browser therefore navigates to
 * "<app-origin>/meet.google.com/abc-defg" (a 404 inside MATE ZONE CHESS ACADEMY) instead of
 * the meeting, and the same string in an SMS or WhatsApp message is likewise
 * not a link the student can tap. Neither the sender nor the recipient can tell
 * from the string that something is wrong, so it is normalised on the way out
 * rather than trusted on the way in.
 *
 * Already-schemed values ("https:", "http:", "zoommtg:", "tel:") and
 * protocol-relative "//host" are passed through untouched: those are already
 * unambiguous, and guessing at a scheme for them would break them.
 */
function normalizeMeetingUrl(url) {
  const raw = typeof url === 'string' ? url.trim() : '';
  if (!raw) return '';
  if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) return raw;
  return `https://${raw}`;
}

module.exports = { normalizeMeetingUrl };
