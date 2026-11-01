import api from './api';

/* "✔ Reviewed" marks — the browser half of backend/src/controllers/
 * reviewedGamesController.js.
 *
 * The server keys a mark as `platform:game_id`, with the owner taken from the
 * token. `reviewedKey` below is the ONE place that builds that string here; the
 * imported-game rows spell the platform "chess.com" exactly like the API's
 * allowed set, so the Set read and the Set written can never disagree.
 *
 * Both calls are `cache: false`: the GET is per-user, and the app's 30s URL
 * cache must never serve one viewer's marks to another. */

export const reviewedKey = (platform, gameId) => `${platform}:${gameId}`;

export const fetchReviewed = () =>
  api.get('/reviewed-games', { cache: false }).then((r) => r.data.reviewed || []);

export const markReviewed = (platform, gameId) =>
  api.post('/reviewed-games', { platform, gameId }).then((r) => r.data);
