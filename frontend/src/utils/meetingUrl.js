/**
 * Meeting URLs (Zoom / Google Meet) as typed by the coach.
 *
 * WHY THIS EXISTS
 *
 * A URL saved without a scheme — "meet.google.com/abc-defg" — is resolved by the
 * browser as a path RELATIVE to the current origin, so an anchor pointing at it
 * navigates to "<app-origin>/meet.google.com/abc-defg": a 404 inside MATE ZONE CHESS ACADEMY
 * rather than the meeting. The link renders fine and the click looks like it
 * does nothing, so neither the coach nor the student can tell from the string
 * that something is wrong. It is therefore normalised on the way OUT — at every
 * render, window.open and notification — instead of trusted on the way in.
 *
 * Kept dependency-free on purpose: it must be importable from a plain node test
 * as well as from a page, so it cannot reach for `api`, the router or the DOM.
 * The backend carries the identical rule in src/utils/meetingUrl.js.
 */
export function normalizeMeetingUrl(url) {
  const raw = typeof url === 'string' ? url.trim() : '';
  if (!raw) return '';
  /* Already carries a scheme (https:, http:, zoommtg:, mailto:, tel:, …) or is
     protocol-relative "//host" — both are unambiguous, and guessing a scheme
     for them would break them. */
  if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) return raw;
  return `https://${raw}`;
}

export default normalizeMeetingUrl;
