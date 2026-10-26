/* Colour-aware game helpers for the "Game history" section of Chess Profile.
 *
 * These sit ALONGSIDE the existing `effectiveColor` / `toneOf` helpers in
 * ChessProfile.jsx — nothing existing was changed. The difference: these never
 * guess. When the profile owner's username matches neither player, the colour
 * is 'unknown' (never a defaulted 'white').
 *
 * Supported `game` shapes (both occur in this codebase):
 *   - imported profile games: { white_name, black_name, account_username, result }
 *     where result is 'white' | 'black' | 'draw'
 *   - PGN-style results: '1-0' | '0-1' | '1/2-1/2' | '½-½' | '*'
 */

/* Result strings that mean "white won / black won / draw", covering both the
   backend enum ('white' | 'black' | 'draw') and PGN score spellings. */
const WHITE_WON = new Set(['white', '1-0', '1–0', '1—0', '1 - 0']);
const BLACK_WON = new Set(['black', '0-1', '0–1', '0—1', '0 - 1']);
const DRAWN = new Set(['draw', 'drawn', '1/2-1/2', '½-½', '½–½', '1/2', '0.5-0.5']);

function normName(v) {
  return String(v || '').trim().toLowerCase();
}

function normResult(v) {
  // Normalise en/em dashes and slashes so '1–0' and '1-0' agree.
  return String(v || '').trim().toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
}

/**
 * Which colour did `username` play in `game`?
 * Case-insensitive compare against both player names. Falls back to the
 * row's own `account_username` when no explicit username is passed (each
 * imported row carries the owner it was synced for, and one page can mix
 * several linked accounts). Returns 'white' | 'black' | 'unknown'.
 */
export function getUserColour(game, username) {
  const g = game || {};
  const candidates = [username, g.account_username, g.username].map(normName).filter(Boolean);
  if (candidates.length === 0) return 'unknown';
  const white = normName(g.white_name);
  const black = normName(g.black_name);
  for (const u of candidates) {
    if (white && u === white) return 'white';
    if (black && u === black) return 'black';
  }
  return 'unknown';
}

/**
 * Result from the OWNER's point of view: 'win' | 'loss' | 'draw' | 'unknown'.
 *   White + 1-0 = win, White + 0-1 = loss
 *   Black + 0-1 = win, Black + 1-0 = loss
 *   draw score = draw (either colour)
 * Unknown colour or unrecognised result ('*', missing, …) => 'unknown'.
 */
export function getUserResult(game, username) {
  const colour = getUserColour(game, username);
  if (colour === 'unknown') return 'unknown';
  const r = normResult((game || {}).result);
  if (!r || r === '*') return 'unknown';
  let winner = null;
  if (WHITE_WON.has(r)) winner = 'white';
  else if (BLACK_WON.has(r)) winner = 'black';
  else if (DRAWN.has(r)) return 'draw';
  else return 'unknown';
  if (winner === colour) return 'win';
  return 'loss';
}

function emptyBucket() {
  return { games: 0, wins: 0, losses: 0, draws: 0, winRate: 0 };
}

/**
 * Per-colour W/L/D tallies over an already-filtered game list.
 * Unknown-colour rows are ignored (never guessed into a bucket).
 * winRate = round(wins / games * 100), 0 when the bucket is empty.
 */
export function getColourStats(games, username) {
  const stats = { white: emptyBucket(), black: emptyBucket() };
  for (const g of games || []) {
    const colour = getUserColour(g, username);
    if (colour !== 'white' && colour !== 'black') continue;
    const res = getUserResult(g, username);
    const b = stats[colour];
    b.games += 1;
    if (res === 'win') b.wins += 1;
    else if (res === 'loss') b.losses += 1;
    else if (res === 'draw') b.draws += 1;
  }
  for (const b of Object.values(stats)) {
    b.winRate = b.games > 0 ? Math.round((b.wins / b.games) * 100) : 0;
  }
  return stats;
}
