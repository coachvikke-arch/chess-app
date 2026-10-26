/* Lichess integration — OPTIONAL, OFF BY DEFAULT, and never used for the local
 * bot games.
 *
 * SCOPE (deliberately narrow):
 *   - Connect a Lichess account via OAuth, using Lichess's documented endpoints.
 *   - Read the public, ALLOWED subset of the user's own profile + recent games.
 *
 * WHAT THIS FILE WILL NOT DO:
 *   - It is NOT a replacement for the local Stockfish bot system. `/play/bots`
 *     and `/play/bot/:id` never touch this module; they are fully offline.
 *   - It holds NO tokens. Lichess OAuth uses a device-style flow where the token
 *     lives server-side only (backend/src/services/lichessService.js). This
 *     module only ever calls our own `/api/lichess/*` routes. There is no
 *     client secret, no access token, and nothing read from a build-time env
 *     var that could leak into the bundle.
 *   - It does not create games on Lichess's servers or act as a bot there.
 *
 * Everything returns `null` / `{ enabled: false }` unless a user has explicitly
 * turned the feature on, so it is inert until then.
 */

import api from './api';

const ENABLED_KEY = 'chess_lichess_enabled';

export function isEnabled() {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setEnabled(on) {
  try {
    if (on) localStorage.setItem(ENABLED_KEY, '1');
    else localStorage.removeItem(ENABLED_KEY);
  } catch { /* ignore */ }
  return Boolean(on);
}

/** Guard used by every call so the feature is inert unless opted into. */
function requireEnabled() {
  if (!isEnabled()) {
    const err = new Error('Lichess integration is turned off.');
    err.code = 'LICHESS_DISABLED';
    throw err;
  }
  if (!localStorage.getItem('token')) {
    const err = new Error('Sign in to connect a Lichess account.');
    err.code = 'UNAUTHENTICATED';
    throw err;
  }
}

/**
 * Begin the OAuth link flow.
 * The backend creates the authorize URL and owns the token exchange, so no
 * client secret is ever present in this bundle.
 */
export async function beginLink() {
  requireEnabled();
  const res = await api.get('/lichess/link', { cache: false });
  return res.data; // { url }
}

/** Finish linking after the backend has stored the token. */
export async function completeLink() {
  requireEnabled();
  const res = await api.get('/lichess/linked', { cache: false });
  return res.data;
}

export async function unlink() {
  requireEnabled();
  const res = await api.post('/lichess/unlink', {}, { cache: false });
  return res.data;
}

/** Public profile fields the backend is permitted to expose to us. */
export async function getAccount() {
  requireEnabled();
  const res = await api.get('/lichess/account', { cache: false });
  return res.data;
}

/** The user's own recent games (their data, via the official API). */
export async function getRecentGames(limit = 10) {
  requireEnabled();
  const res = await api.get('/lichess/games', { params: { limit }, cache: false });
  return res.data;
}

/**
 * Opening explorer lookups (public, no auth, documented endpoints).
 * Used by opening study tools, NOT by bot games.
 */
export async function explore(fen, moves = 8) {
  const res = await api.get('/lichess/explorer', { params: { fen, moves }, cache: false });
  return res.data;
}

export const LichessService = {
  isEnabled,
  setEnabled,
  beginLink,
  completeLink,
  unlink,
  getAccount,
  getRecentGames,
  explore,
};

export default LichessService;