import api from './api';
import { unwrapAnalysisEnvelope } from '../utils/analysisEnvelope';

/* Unified Chess.com + Lichess profile integration — API wrapper. */

/* listAccounts must never be served from the 30s GET cache: the page polls it
   to learn `last_synced_at` / `newest_game_ms`, and a cached copy makes a
   fresh sync look like it did nothing. */
export const listAccounts = () =>
  api.get('/chess-profiles', { cache: false }).then((r) => r.data);

export const validateAccount = (platform, username) =>
  api.post('/chess-profiles/validate', { platform, username }).then((r) => r.data);

export const connectAccount = (platform, username) =>
  api.post('/chess-profiles/connect', { platform, username }).then((r) => r.data);

export const disconnectAccount = (id) =>
  api.delete(`/chess-profiles/${id}`).then((r) => r.data);

/* Full sync — backfills months of history from the archive index. Manual action
   only; the page never calls this on a timer. */
export const syncAccount = (id) =>
  api.post(`/chess-profiles/${id}/sync`, undefined, { cache: false }).then((r) => r.data);

/* Incremental poll — current month only, watermark-advanced, deduped on the
   game URL. Cheap enough to repeat on a timer. */
export const syncAccountLatest = (id) =>
  api.post(`/chess-profiles/${id}/sync-latest`, undefined, { cache: false }).then((r) => r.data);

export const accountRatings = (id) =>
  api.get(`/chess-profiles/${id}/ratings`).then((r) => r.data);

export const fetchStatistics = (platform) =>
  api.get('/chess-profiles/statistics', { params: { platform: platform || undefined } }).then((r) => r.data);

export const fetchOpenings = (platform) =>
  api.get('/chess-profiles/openings', { params: { platform: platform || undefined } }).then((r) => r.data);

export const fetchInsights = () =>
  api.get('/chess-profiles/insights').then((r) => r.data);

export const fetchGames = (filters) =>
  api.get('/chess-profiles/games', { params: filters, cache: false }).then((r) => r.data);

export const fetchGame = (id) =>
  api.get(`/chess-profiles/games/${id}`, { cache: false }).then((r) => r.data);

/**
 * The stored analysis of one imported game, as the canonical envelope.
 *
 * The endpoint returns the envelope itself: the game's identity, the analysis
 * version, the schema version and the complete move-by-move review. The
 * canonical layer validates exactly that shape, so it is passed straight
 * through.
 *
 * A server that still wraps the envelope (`{ data: envelope }`) is tolerated
 * here, in ONE place: an envelope-looking object is unwrapped instead of being
 * handed on as an unknown shape, which the validator would (correctly) reject
 * as a miss — silently costing a full re-analysis on every open.
 *
 * @param {number|string} id  the imported game's id
 * @returns {Promise<object|null>} the envelope, or null when nothing is stored
 */
export async function fetchAnalysis(id) {
  const res = await api.get(`/chess-profiles/games/${id}/analysis`, { cache: false });
  return unwrapAnalysisEnvelope(res.data);
}

export const saveAnalysis = (id, data) =>
  api.post(`/chess-profiles/games/${id}/analysis`, data).then((r) => r.data);

export const deleteGame = (id) =>
  api.delete(`/chess-profiles/games/${id}`).then((r) => r.data);