/**
 * Single source of truth for the product name.
 *
 * Anything user-visible that names the app imports from here. The full name is
 * for headers, titles and formal copy; APP_NAME_SHORT is for places where the
 * full name does not fit (mobile header, sentence-level references).
 */
export const APP_NAME = 'MATE ZONE CHESS ACADEMY';
export const APP_NAME_SHORT = 'Mate Zone';
export const APP_TAGLINE = 'Where grandmasters are made';

export const APP_COPYRIGHT = `© ${new Date().getFullYear()} ${APP_NAME}`;

/** "<Page> | MATE ZONE CHESS ACADEMY" — the document.title format. */
export const appTitle = (page) => (page ? `${page} | ${APP_NAME}` : APP_NAME);

export default APP_NAME;
