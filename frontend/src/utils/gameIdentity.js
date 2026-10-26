/* Canonical game-identity resolution for a stored Brilliant (Sigma) move.
 *
 * A sigma row carries an ANALYSIS identity — (game_source, game_id) — which is
 * the key it was filed under, and for a profile game that `game_id` IS the local
 * `chess_games.id`. Turning that into something a board can show means loading
 * the ORIGINAL game record through the app's existing loaders:
 *
 *   chess_profile → fetchGame(id)                    (chess_profiles service)
 *   online / computer / tournament → /game-history by its "<type>_<id>" key
 *
 * WHY THIS EXISTS AS ITS OWN MODULE
 * ---------------------------------
 * Two id-shaped traps sat on this path and both produced "That game could not be
 * found":
 *
 *  1. DOUBLE UNWRAPPING. `fetchGame` (services/chessProfiles.js) already returns
 *     `r.data`, i.e. the game ROW. Bare `api.get` returns the axios RESPONSE.
 *     Reading `.data` from a `fetchGame` result therefore unwraps twice, yields
 *     `undefined`, and a perfectly valid game reads as missing. `profileGameRow`
 *     below is explicit about which shape each call returns.
 *
 *  2. ANALYSIS ID vs GAME ID. The sigma row's own `id` is the sigma record, never
 *     the game. Only `game_id`, qualified by `game_source`, identifies a game.
 *
 * It resolves identity and nothing else: no classification, no verdict, no new
 * game-loading endpoint. Chess Profile's own game click goes through the same
 * `fetchGame` call.
 *
 * This module deliberately imports NO service. The loaders are injected, which
 * keeps the identity rules pure (and unit-testable without a server), and leaves
 * the choice of loader at the composition root where the app's services live.
 */

/** Sources that live in the game-history tables rather than the profile tables. */
export const HISTORY_SOURCES = ['online', 'computer', 'tournament'];

/**
 * The `(gameSource, gameId)` pair from a sigma row — the canonical game
 * identity. Deliberately NOT the row's own `id` (that is the sigma record) and
 * never a player name, date, SAN, move number or opening.
 */
export function sigmaGameRef(row) {
  if (!row || row.gameSource == null || row.gameId == null) return null;
  return { gameSource: String(row.gameSource), gameId: row.gameId };
}

/**
 * `fetchGame` returns the ROW (it already unwraps `.data`). Normalised here so a
 * future change to the service cannot silently reintroduce the double unwrap.
 */
export function profileGameRow(result) {
  if (!result) return null;
  /* An axios-shaped value would mean the service changed its contract; unwrap it
     once rather than returning an object with no `pgn` and reporting "missing". */
  const row = result.pgn ? result : (result.data && result.data.pgn ? result.data : null);
  return row && row.pgn ? row : null;
}

/** A history row → the field shape the game card reads. */
export function toCardGame(row) {
  if (!row || !row.pgn) return null;
  return {
    id: row.id,
    pgn: row.pgn,
    white_name: row.whiteName ?? row.white_name ?? '',
    black_name: row.blackName ?? row.black_name ?? '',
    platform: row.platform ?? 'chess.com',
    time_class: row.timeClass ?? row.time_class ?? '',
    time_control: row.timeControl ?? row.time_control ?? '',
    game_date: row.date ?? row.game_date ?? null,
    opening: row.opening ?? '',
    game_url: row.url ?? row.game_url ?? '',
  };
}

/**
 * Find a history row by its canonical "<type>_<id>" key.
 *
 * Exact key first. A substring match can select the wrong game (id 7 inside
 * 170), so it is a last resort and only for a unique numeric suffix.
 */
export function findHistoryGame(games, gameSource, gameId) {
  if (!Array.isArray(games) || gameId == null) return null;
  const key = `${gameSource}_${gameId}`;
  const exact = games.find((g) => String(g.id) === key);
  if (exact) return exact;
  const suffix = `_${gameId}`;
  const matches = games.filter((g) => String(g.id).endsWith(suffix));
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Resolve a sigma row to the original game record the card can open.
 *
 * @param {{gameSource:string, gameId:number|string}} ref
 * @param {object} deps
 * @param {(id:any)=>Promise<object>} deps.fetchProfileGame  the chess_profiles
 *   `fetchGame` — resolves to the ROW (it unwraps `.data` itself).
 * @param {()=>Promise<object>} deps.fetchHistory  bare `api.get('/game-history')`
 *   — resolves to the RESPONSE, hence `.data.games`.
 * @returns {Promise<object|null>} the game, or null when it genuinely is missing.
 */
export async function resolveSigmaGame(ref, { fetchProfileGame, fetchHistory }) {
  if (!ref) return null;
  if (!fetchProfileGame || !fetchHistory) {
    throw new Error('resolveSigmaGame needs fetchProfileGame and fetchHistory');
  }

  if (ref.gameSource === 'chess_profile') {
    /* fetchGame → the row itself (it unwraps `.data` internally). */
    return profileGameRow(await fetchProfileGame(ref.gameId));
  }

  const res = await fetchHistory();
  /* bare api.get → the RESPONSE, so .data.games is correct here. */
  const games = res?.data?.games || [];
  return toCardGame(findHistoryGame(games, ref.gameSource, ref.gameId));
}