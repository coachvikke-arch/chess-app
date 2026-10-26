/* Bot catalogue service — read-side queries over `data/bots`.
 *
 * The roster itself is static product data, so it ships in the bundle and needs
 * no network round-trip. This service exists to give the UI ONE place to ask
 * catalogue questions, and — more importantly — to VALIDATE anything that
 * arrives from a URL.
 *
 * `/play/bot/:botId` takes its bot id straight from the address bar, so every
 * id that reaches the game page is treated as untrusted input and resolved
 * through `getBot()` before the game screen will mount. An unknown id renders a
 * "bot not found" state; it never falls back to an arbitrary bot.
 */

import {
  BOTS,
  BOT_CATALOG_VERSION,
  BOT_GROUPS,
  DIFFICULTY_BANDS,
  NEWCOMER_BOT_IDS,
  getBand,
  getBotById,
  getBotsByDifficulty,
  getBotsByGroup,
  getNextBot,
  getUnlockSource,
  rankForRating,
} from '../data/bots';

/* Ids are lower-case slugs. Anything else can never match a roster entry, so
 * this is both a cheap reject and a guard against pathological input. */
const BOT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function isValidBotId(id) {
  return typeof id === 'string' && BOT_ID_RE.test(id);
}

/** Resolve an untrusted id to a bot, or null. Never throws. */
export function getBot(id) {
  if (!isValidBotId(id)) return null;
  return getBotById(id);
}

/** Roster grouped by tier, in ladder order. */
export function getCatalog() {
  return DIFFICULTY_BANDS.map((band) => ({
    band,
    source: getUnlockSource(band.id),
    bots: getBotsByDifficulty(band.id),
  }));
}

/** The "New to Chess" shelf: the gentlest bots, in rating order. */
export function getNewcomerBots() {
  return NEWCOMER_BOT_IDS.map((id) => getBotById(id)).filter(Boolean);
}

/** Next challenge after beating `botId`, or null at the top of the ladder. */
export function getNextChallenge(botId) {
  return getNextBot(botId);
}

/** Engine ladder row matching a bot's rating — used for the tooltip copy. */
export function getDifficultyRank(bot) {
  return rankForRating(bot?.rating ?? 0);
}

/** Time controls offered on the match setup panel. */
export const TIME_CONTROLS = Object.freeze([
  { id: '1min', label: '1 min', sub: 'Blitz', seconds: 60, icon: '⚡' },
  { id: '3min', label: '3 min', sub: 'Blitz', seconds: 180, icon: '⚡' },
  { id: '5min', label: '5 min', sub: 'Rapid', seconds: 300, icon: '⚡' },
  { id: '10min', label: '10 min', sub: 'Rapid', seconds: 600, icon: '🕐' },
  { id: 'unlimited', label: 'Unlimited', sub: 'No clock', seconds: 0, icon: '♾' },
]);

export const DEFAULT_TIME_CONTROL = '5min';

/** Resolve an untrusted `tc` query param to a known time control. */
export function getTimeControl(id) {
  const key = typeof id === 'string' ? id.toLowerCase() : '';
  return TIME_CONTROLS.find((t) => t.id === key) || null;
}

/** Seconds per side for a time control id (0 = no clock). */
export function timeControlSeconds(id) {
  const tc = getTimeControl(id);
  return tc ? tc.seconds : 0;
}

export const COLOR_CHOICES = Object.freeze([
  { id: 'white', label: 'White', glyph: '♔' },
  { id: 'random', label: 'Random', glyph: '⚄' },
  { id: 'black', label: 'Black', glyph: '♚' },
]);

export const DEFAULT_COLOR = 'white';

/** Resolve an untrusted `color` query param to 'white' | 'black' | 'random'. */
export function getColorChoice(id) {
  const key = typeof id === 'string' ? id.toLowerCase() : '';
  return COLOR_CHOICES.some((c) => c.id === key) ? key : DEFAULT_COLOR;
}

/** Turn 'random' into an actual colour. */
export function resolveColor(choice, rng = Math.random) {
  if (choice === 'random') return rng() < 0.5 ? 'white' : 'black';
  return choice === 'black' ? 'black' : 'white';
}

export { BOTS, BOT_GROUPS, DIFFICULTY_BANDS, getBand, getBotsByGroup, getBotById, BOT_CATALOG_VERSION };

export const BotService = {
  getBot,
  isValidBotId,
  getCatalog,
  getNewcomerBots,
  getNextChallenge,
  getDifficultyRank,
  getTimeControl,
  timeControlSeconds,
  getColorChoice,
  resolveColor,
  TIME_CONTROLS,
  COLOR_CHOICES,
  DEFAULT_TIME_CONTROL,
  DEFAULT_COLOR,
  CATALOG_VERSION: BOT_CATALOG_VERSION,
};

export default BotService;