/**
 * Single source of truth for the product name in the backend.
 * Mirrors frontend/src/config/brand.js.
 */
const APP_NAME = 'MATE ZONE CHESS ACADEMY';
const APP_NAME_SHORT = 'Mate Zone';
const APP_TAGLINE = 'Where grandmasters are made';
const APP_COPYRIGHT = `© ${new Date().getFullYear()} ${APP_NAME}`;

module.exports = { APP_NAME, APP_NAME_SHORT, APP_TAGLINE, APP_COPYRIGHT };
