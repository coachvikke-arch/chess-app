/*
 * Lichess public API service (https://lichess.org/api).
 * Public endpoints only — no OAuth tokens, no password. We use:
 *   /api/user/{username}                profile + perfs
 *   /api/user/{username}/rating-history historical rating points
 *   /api/games/user/{username}          recent games (NDJSON, pgnInJson)
 */

const { getJson } = require('./platformApi');
const { normalizeTimeClass, movesFromPgn } = require('./pgnUtils');

const BASE = 'https://lichess.org';

/** "https://lichess.org/@/username" or "username" → clean username. */
function normalizeUsername(input = '') {
  let u = String(input).trim();
  u = u.replace(/^https?:\/\/(?:[a-z0-9-]+\.)?lichess\.org\/(?:@\/|user\/)/i, '');
  u = u.split(/[/?#]/).shift();
  return u.replace(/^[=+-]/, '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function buildProfileUrl(username) {
  return `https://lichess.org/@/${username}`;
}

async function fetchUser(username) {
  return getJson({ url: `${BASE}/api/user/${username}`, platform: 'lichess', kind: 'profile' });
}

async function fetchRatingHistory(username) {
  return getJson({ url: `${BASE}/api/user/${username}/rating-history`, platform: 'lichess', kind: 'ratingHistory' });
}

/**
 * Fetch recent games as NDJSON ("pgnInJson" makes each line a JSON object
 * that also embeds the PGN). Not /export, but a compact safe subset.
 */
async function fetchGames(username, { max = 300 } = {}) {
  const q = new URLSearchParams({
    max: String(Math.max(1, Math.min(500, max))),
    pgnInJson: 'true',
    opening: 'true',
    clocks: 'false',
    evals: 'false',
  });
  const url = `${BASE}/api/games/user/${username}?${q.toString()}`;
  const text = await getJson({
    url,
    platform: 'lichess',
    kind: 'games',
    asText: true,
    headers: { Accept: 'application/x-ndjson' },
  });
  return text.split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function perfsToRatings(user = {}) {
  const map = {
    bullet: 'bullet',
    blitz: 'blitz',
    rapid: 'rapid',
    classical: 'classical',
    correspondence: 'correspondence',
    puzzle: 'puzzle',
  };
  const out = [];
  for (const [key, category] of Object.entries(map)) {
    const perf = user.perfs && user.perfs[key];
    if (!perf || perf.rating == null) continue;
    out.push({
      category,
      rating: perf.rating,
      best: null,
      lastUpdated: null,
      games: perf.games != null ? perf.games : null,
      prog: perf.prog != null ? perf.prog : null,
    });
  }
  return out;
}

/** Rich profile used by connect/refresh flows. */
async function describeUser(username) {
  const raw = await fetchUser(username);

  if (raw.disabled) {
    const err = new Error('This Lichess account is closed.');
    err.status = 403;
    throw err;
  }

  let joined = null;
  if (raw.createdAt) {
    const d = new Date(raw.createdAt);
    if (!Number.isNaN(d.getTime())) joined = d.toISOString().slice(0, 10);
  }

  return {
    platform: 'lichess',
    username: (raw.id || raw.username || username).toLowerCase(),
    profileUrl: raw.url || buildProfileUrl(raw.id || username),
    avatar: raw.avatar || null,
    title: raw.title || null,
    countryCode: raw.country || null,
    isVerified: !!raw.verified,
    isStreamer: !!raw.isStreamer,
    followers: null,
    following: null,
    joined,
    lastActivity: raw.seenAt != null ? raw.seenAt : null,
    ratings: perfsToRatings(raw),
    counts: raw.counts || null,
    perfs: raw.perfs || null,
  };
}

function parsePgnClock(pgn = '') {
  const m = pgn.match(/\[TimeControl\s+"([^"]+)"\]/);
  return m ? m[1] : '';
}

/**
 * Recent games as normalized rows (matches pgnUtils.normalizeGame contract).
 */
async function fetchGamesNormalized(username, { max = 300 } = {}) {
  const rows = await fetchGames(username, { max });
  const games = [];
  for (const g of rows) {
    if (!g.pgn) continue;
    const white = g.players && g.players.white;
    const black = g.players && g.players.black;
    const whiteName = white && white.user ? (white.user.name || white.user.id || '') : '';
    const blackName = black && black.user ? (black.user.name || black.user.id || '') : '';

    let myColor = 'black';
    const myId = username.toLowerCase();
    if ((whiteName).toLowerCase() === myId) myColor = 'white';
    else if (white && white.user && String(white.user.id || '').toLowerCase() === myId) myColor = 'white';

    const opening = g.opening ? (g.opening.name || '') : '';
    games.push({
      platformGameId: g.id || '',
      endTimeMs: g.lastMoveAt || g.created_at || null,
      whiteName,
      blackName,
      myName: myColor === 'white' ? whiteName : blackName,
      myColor,
      whiteRating: white && white.rating,
      blackRating: black && black.rating,
      result: g.winner === 'white' ? 'white' : g.winner === 'black' ? 'black' : 'draw',
      timeControl: parsePgnClock(g.pgn),
      timeClass: normalizeTimeClass((g.perf || g.speed || '').toString()),
      opening,
      eco: (g.opening && g.opening.eco) || '',
      gameUrl: g.url || `https://lichess.org/${g.id}`,
      gameEvent: (g.tournament && `Tournament ${g.tournament}`) || (g.rated ? 'Rated' : 'Casual') || '',
      pgn: g.pgn,
      movesCount: movesFromPgn(g.pgn).length,
      isRated: !!g.rated,
    });
  }
  return games;
}

/** Rating history → [{ category, points:[{point_date, rating}] }]. */
async function fetchGamesRatingHistory(username) {
  const raw = await fetchRatingHistory(username);
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => ({
    category: (entry.name || '').toLowerCase(),
    points: (entry.points || [])
      .filter((p) => Array.isArray(p) && p.length >= 4)
      .map((p) => {
        const [y, m, d, rating] = p;
        const date = new Date(Date.UTC(y, m - 1, d));
        const point_date = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
        return { point_date, rating };
      })
      .sort((a, b) => a.point_date.localeCompare(b.point_date)),
  })).filter((e) => e.points.length);
}

module.exports = {
  normalizeUsername,
  describeUser,
  fetchGamesNormalized,
  fetchGamesRatingHistory,
};