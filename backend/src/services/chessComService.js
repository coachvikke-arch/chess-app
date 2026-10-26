/*
 * Chess.com public data API service (https://api.chess.com/pub/).
 * Everything here uses the documented public endpoints — no scraping, no
 * credentials, no cookies. See https://www.chess.com/news/view/published-data-api
 */

const { getJson, PlatformHttpError } = require('./platformApi');
const { normalizeTimeClass, parseHeaders, movesFromPgn, resolveOpeningName } = require('./pgnUtils');

const BASE = 'https://api.chess.com/pub';

/** "https://www.chess.com/member/username" or "username" → clean username. */
function normalizeUsername(input = '') {
  let u = String(input).trim();
  u = u.replace(/^https?:\/\/(?:www\.|id\.)?chess\.com\/(?:member|live\/player)\//i, '');
  u = u.split(/[/?#]/).shift();
  return u.toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function buildProfileUrl(username) {
  return `https://www.chess.com/member/${username}`;
}

async function fetchPlayer(username) {
  return getJson({ url: `${BASE}/player/${username}`, platform: 'chess.com', kind: 'profile' });
}

/* `fresh` is used by the manual sync: a rating set cached minutes earlier would
   make "Sync now" answer with the values the user is trying to refresh. */
async function fetchStats(username, { fresh = false } = {}) {
  return getJson({ url: `${BASE}/player/${username}/stats`, platform: 'chess.com', kind: 'stats', fresh });
}

async function fetchArchives(username) {
  return getJson({ url: `${BASE}/player/${username}/games/archives`, platform: 'chess.com', kind: 'archives' });
}

async function fetchMonthGames(archiveUrl) {
  return getJson({ url: archiveUrl, platform: 'chess.com', kind: 'games' });
}

/** Profile + a summary of "member of" the org (name) if needed */
function countryFromUrl(countryUrl) {
  if (!countryUrl) return null;
  return String(countryUrl).replace(/^https:\/\/api\.chess\.com\/pub\/country\//, '').slice(0, 10);
}

/* ── normalized public payload ────────────────────────────────────────────── */

/* Chess.com's `last.date` / `best.date` are epoch SECONDS. The previous parsing
   treated them as `YYYY/MM`, which produced an Invalid Date and a null
   last_updated_at for every pool. Accept seconds and milliseconds defensively
   (a future payload change should not silently zero the date again). */
function epochToMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? Math.round(n) : Math.round(n * 1000);
}

function ratingsFromStats(stats = {}) {
  const map = {
    chess_bullet: 'bullet',
    chess_blitz: 'blitz',
    chess_rapid: 'rapid',
    chess_daily: 'correspondence',
    chess_classical: 'classical',
    tactics: 'puzzle',
    fide: 'fide',
  };
  const out = [];
  for (const [key, category] of Object.entries(map)) {
    const block = stats[key];
    if (!block) continue;
    const last = block.last ? { rating: block.last.rating, date: epochToMs(block.last.date) } : null;
    const best = block.best ? { rating: block.best.rating, date: epochToMs(block.best.date) } : null;
    if (!last && !best) continue;
    out.push({
      category,
      rating: last && last.rating != null ? last.rating : (best && best.rating),
      best: best ? best.rating : null,
      lastUpdated: last ? last.date : (best ? best.date : null),
      record: block.record || null,
    });
  }
  return out;
}

/** Rich profile used by connect/refresh flows. */
async function describeUser(username, { fresh = false } = {}) {
  const raw = await fetchPlayer(username);
  const stats = await fetchStats(username, { fresh });

  let joined = null;
  if (raw.joined) {
    const d = new Date(raw.joined * 1000);
    if (!Number.isNaN(d.getTime())) joined = d.toISOString().slice(0, 10);
  }

  const ratings = ratingsFromStats(stats);
  const gameCounts = {};

  return {
    platform: 'chess.com',
    username: (raw.username || username).toLowerCase(),
    profileUrl: buildProfileUrl(raw.username || username),
    avatar: raw.avatar || null,
    title: raw.title || null,
    countryCode: countryFromUrl(raw.country) || null,
    isVerified: !!raw.verified,
    isStreamer: !!raw.is_streamer,
    followers: raw.followers != null ? raw.followers : null,
    joined,
    lastActivity: raw.last_online ? raw.last_online * 1000 : null,
    ratings,
    stats: stats.chess_rapid || null,
  };
}

/**
 * Normalize one raw Chess.com monthly-archive game object into the importer row
 * shape. Returns null for entries without a PGN (e.g. unrated/casual games the
 * API omits PGN for).
 */
function normalizeGameRow(g, suffix) {
  /* A missing PGN must NOT drop the row. Chess.com occasionally omits it, and
     the old `if (!g || !g.pgn) return null` made that game vanish from the list
     entirely — for a game that finished today, that is precisely the reported
     symptom. The metadata below is enough to list the game; the PGN-dependent
     parts (opening, ply count) degrade to empty and can be filled in by a later
     full sync. */
  if (!g) return null;

  // Chess.com monthly archives don't always include an opening name or an ECO
  // code in the JSON — fall back to PGN headers, and derive the name from the
  // payload's /openings/ URL slug or the ECO code itself.
  const headers = parseHeaders(g.pgn);
  const ecoRaw = headers.eco || g.eco || '';
  const openingName = resolveOpeningName(g.opening || headers.opening || '', ecoRaw);
  const eco = /^[A-E]\d\d$/.test(ecoRaw) ? ecoRaw : '';

  const norm = (v) => String(v || '').toLowerCase();
  const isMeWhite = g.white && norm(g.white.username) === suffix;
  const isMeBlack = g.black && norm(g.black.username) === suffix;
  const me = isMeWhite ? 'white' : 'black';
  const myName = me === 'white'
    ? (g.white && g.white.username) || suffix
    : (g.black && g.black.username) || suffix;

  return {
    platformGameId: g.url || '',
    endTimeMs: g.end_time && Number(g.end_time) ? Number(g.end_time) * 1000 : null,
    whiteName: (g.white && g.white.username) || '',
    blackName: (g.black && g.black.username) || '',
    myName,
    myColor: me,
    whiteRating: g.white && g.white.rating,
    blackRating: g.black && g.black.rating,
    result: g.white && g.white.result === 'win' ? 'white' : (g.black && g.black.result === 'win' ? 'black' : 'draw'),
    timeControl: g.time_control || '',
    timeClass: normalizeTimeClass(g.time_class || ''),
    opening: openingName,
    eco,
    gameUrl: g.url || '',
    gameEvent: (g.white && g.white.username) ? '' : g.time_class || '',
    pgn: g.pgn || '',
    movesCount: g.pgn ? movesFromPgn(g.pgn).length : 0,
    isRated: !!g.rated,
  };
}

const DEFAULT_MONTHS = 6;

/* ── month arithmetic ────────────────────────────────────────────────────────
   Chess.com's monthly archives are keyed by UTC calendar month ('YYYY/MM').

   The current month is computed HERE, from the clock, and fetched DIRECTLY.
   The archive INDEX (/games/archives) is never treated as the authority on
   "which month is current": it is generated on Chess.com's own schedule, so
   trusting it as a source of truth means any month it has not published yet is
   silently skipped, and a game finished today can be missing from the sync
   entirely.

   Honest scope note, from a live probe on 2026-10-02: for the active players
   checked that day, the index DID already advertise the current month, so index
   lag was not confirmed as the cause here. Deriving the month from the clock
   removes that dependency regardless, and costs nothing — the direct endpoint
   is the one we want for the live path in any case.

   Both the current and previous month are requested, so a game played at
   23:59 local on the last day of a month is never missed. */
function monthKeys(now = new Date(), count = 2) {
  const keys = [];
  for (let i = 0; i < count; i++) {
    // Anchor on UTC, the same calendar Chess.com buckets games by.
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

/** Current-month games fetched DIRECTLY, bypassing the archive index. */
async function fetchMonthGamesDirect(username, monthKey, opts = {}) {
  return getJson({
    url: `${BASE}/player/${username}/games/${monthKey}`,
    platform: 'chess.com',
    kind: 'games',
    fresh: !!opts.fresh,
  });
}

/**
 * The incremental sync: the newest games, without re-reading months of history.
 *
 * Requests the current UTC month plus the one before it (the boundary overlap),
 * merges them with anything the caller already has, and dedupes on the Chess.com
 * game URL — the stable identifier, unique per game and reused across months and
 * re-fetches, which is what makes repeated polling safe.
 *
 * `fresh: true` bypasses the 15-minute response cache so a poll actually
 * observes a game finished a moment ago instead of a snapshot from earlier.
 *
 * Returns { games, months, failed, note, newestEndTimeMs }.
 */
async function fetchLatestGames(username, { maxGames = 250, now = new Date(), fresh = true } = {}) {
  const suffix = username.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const months = monthKeys(now, 2);

  // The current month must be reachable even if it has no games yet, so a 404
  // there is a legitimate empty answer, not a failure. Only the PREVIOUS month
  // is expected to exist, and its absence is likewise not an error worth
  // aborting for.
  const settled = await Promise.allSettled(
    months.map((mk) => fetchMonthGamesDirect(suffix, mk, { fresh })),
  );

  const games = [];
  const seen = new Set();
  let failed = 0;
  let firstRealError = null;

  for (const r of settled) {
    if (r.status !== 'fulfilled') {
      // 404 = that month simply has no public games; anything else is a real
      // fault and must be visible rather than swallowed into "0 new games".
      const isEmptyMonth = r.reason instanceof PlatformHttpError && r.reason.status === 404;
      if (!isEmptyMonth) {
        failed++;
        firstRealError = firstRealError || r.reason;
      }
      continue;
    }
    for (const g of (r.value && r.value.games) || []) {
      const row = normalizeGameRow(g, suffix);
      if (!row) continue;
      const key = row.platformGameId;
      if (!key) continue;              // no stable id → cannot dedupe safely
      if (seen.has(key)) continue;     // same game listed in both months
      seen.add(key);
      games.push(row);
    }
  }

  /* If EVERY month faulted we learned nothing about the player's games.
     Returning an empty success here is the worst possible outcome: the caller
     would record a clean sync, clear last_error and report "0 new games" while
     the outage is precisely why the user sees nothing new. Re-throw so the
     failure is logged and the already-stored games are left untouched. */
  if (failed === months.length && firstRealError) throw firstRealError;

  // Only the newest slice is worth sending onward; the DB dedupes the rest.
  games.sort((a, b) => (b.endTimeMs || 0) - (a.endTimeMs || 0));
  const capped = games.slice(0, maxGames);
  const newestEndTimeMs = capped.length ? Math.max(...capped.map((g) => g.endTimeMs || 0)) : null;

  const note = failed
    ? `${failed} of ${months.length} month request(s) failed — Chess.com may be rate-limiting. Showing what loaded.`
    : '';

  return { games: capped, months, failed, note, newestEndTimeMs };
}

/**
 * Pull the last `months` of games from Chess.com and merge them, sorted
 * most-recent-first by end_time. This is the two-step flow Chess.com requires:
 *   1. GET /player/{username}/games/archives (one entry per month with games),
 *   2. GET each of those monthly archive URLs (that month's "games" array).
 *
 * The monthly archives are fetched in parallel (Promise.allSettled) so a slow or
 * erroring month can't hold the rest hostage, while the shared request layer
 * still throttles each individual call within Chess.com's rate limits.
 *
 * This is the BACKFILL path: it reads history in bulk and is what a first
 * connect uses. It deliberately stays on the archive index because a full
 * history genuinely needs every month the account has. Live freshness is
 * `fetchLatestGames` above, which does not depend on the index.
 *
 * Returns { games, months, failed, note }:
 *   games  — normalized rows, capped at `maxGames`, newest end_time first
 *   months — how many monthly archives were selected (the last `months`)
 *   failed — how many of those archives failed to load
 *   note   — human-friendly string for empty/partial results ('' when clean)
 */
async function fetchGamesDetailed(username, { months = DEFAULT_MONTHS, maxGames = 400 } = {}) {
  const suffix = username.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const archivePayload = await fetchArchives(suffix);
  const archives = (archivePayload && archivePayload.archives) || [];

  // A valid Chess.com username with zero archives = new/inactive account.
  if (!archives.length) {
    return { games: [], months: 0, failed: 0, note: 'This account has no public games yet.' };
  }

  // Archives are chronological (oldest first) → take the LAST `months`.
  const recent = archives.slice(-Math.max(1, months));

  // Fetch the selected months in parallel; isolate each failure so one bad
  // month can't abort the whole import.
  const settled = await Promise.allSettled(recent.map((url) => fetchMonthGames(url)));

  const games = [];
  const seen = new Set();
  let failed = 0;
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      for (const g of (r.value && r.value.games) || []) {
        const row = normalizeGameRow(g, suffix);
        /* Dedup on the Chess.com game URL. The archive index can briefly
           advertise the same month twice (and a month can overlap after a
           reindex), so without this one game could be returned twice per
           fetch. The DB also has UNIQUE(account_id, platform_game_id), but
           catching it here avoids pointless upserts on every sync. */
        if (!row || !row.platformGameId || seen.has(row.platformGameId)) continue;
        seen.add(row.platformGameId);
        games.push(row);
      }
    } else {
      failed++;
    }
  }

  // If NOTHING loaded and months errored, surface the underlying error
  // (rate-limit / network / 404) instead of silently reporting "0 games".
  if (games.length === 0 && failed > 0) {
    const firstRejected = settled.find((r) => r.status === 'rejected');
    const reason = firstRejected && firstRejected.reason;
    if (reason instanceof PlatformHttpError) throw reason;
    throw new PlatformHttpError('Could not load any recent games for this account.', {
      status: 502, code: 'network', platform: 'chess.com', url: archives[0],
    });
  }

  // Merge + most-recent-first by end_time (games without a timestamp sink last).
  games.sort((a, b) => (b.endTimeMs || 0) - (a.endTimeMs || 0));
  const capped = games.slice(0, maxGames);

  const note = failed
    ? `${failed} of ${recent.length} month archive${recent.length === 1 ? '' : 's'} could not be loaded — showing the rest.`
    : '';

  return { games: capped, months: recent.length, failed, note };
}

/**
 * Recent games as a flat normalized array (kept so existing callers such as
 * fetchRatingHistory and older consumers stay unchanged).
 */
async function fetchGames(username, options = {}) {
  return (await fetchGamesDetailed(username, options)).games;
}

/** Rating history built from recent game records (date → rating). */
async function fetchRatingHistory(username, { months = 12, maxGames = 400 } = {}) {
  const games = await fetchGames(username, { months, maxGames });
  const points = {};
  for (const g of games) {
    if (!g.endTimeMs) continue;
    const myRating = myRatingOf(g);
    if (myRating == null) continue;
    const category = g.timeClass || 'rapid';
    const d = new Date(g.endTimeMs);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!points[category]) points[category] = {};
    points[category][day] = myRating;
  }
  return Object.entries(points).map(([category, byDate]) => ({
    category,
    points: Object.entries(byDate)
      .map(([point_date, rating]) => ({ point_date, rating }))
      .sort((a, b) => a.point_date.localeCompare(b.point_date)),
  }));
}

function myRatingOf({ whiteName, blackName, whiteRating, blackRating, myName }) {
  if ((myName || '').toLowerCase() === String(whiteName || '').toLowerCase()) return whiteRating || null;
  if ((myName || '').toLowerCase() === String(blackName || '').toLowerCase()) return blackRating || null;
  return whiteRating || blackRating || null;
}

module.exports = {
  normalizeUsername,
  describeUser,
  fetchStats,
  ratingsFromStats,
  fetchGames,
  fetchGamesDetailed,
  fetchLatestGames,
  monthKeys,
  fetchRatingHistory,
};