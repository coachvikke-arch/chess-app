/* Lichess Opening Explorer client — a PROGRESSIVE ENHANCEMENT, never a hard
   dependency.

   The curated library in openingsLibrary.json is the source of truth; this module
   only layers live statistics on top when Lichess answers. Every failure mode
   (offline, 401, 429 rate limit, 5xx, bad JSON, timeout) resolves to `null`, and
   the UI simply keeps showing the curated numbers. Nothing here can break the
   opening module.

   Two transports, in order of preference:
     1. our own backend proxy  GET /api/openings/explorer?fen=…
        (the app already ships it — see backend openingController.explorerProxy).
        The proxy can supply a User-Agent / token, which a browser cannot.
     2. direct to explorer.lichess.ovh, used only if the proxy yields nothing.

   Responses are memoised in localStorage because position stats barely change
   and we do not want to re-hit Lichess on every board step. `clearExplorerCache`
   exists for tests and the Settings screen.
*/

import api from '../services/api';

/* Master games — big, clean, theory-heavy. The `lichess` DB is bigger but much
   noisier, which is wrong for teaching. */
export const EXPLORER_DB = 'masters';

const CACHE_KEY = 'np:openings:explorer:v1';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // a week is plenty for this data
const REQUEST_TIMEOUT_MS = 6000;

/* ─────────────────────────── in-memory cache ─────────────────────────── */

const memo = new Map();

/* ───────────────────────── persistent cache ─────────────────────────── */

function readStore() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeEntry(fen, payload) {
  if (typeof localStorage === 'undefined') return;
  try {
    const store = readStore();
    store[fen] = { at: Date.now(), payload };
    // Keep the cache small — drop the oldest entries beyond ~400 positions.
    const keys = Object.keys(store).sort((a, b) => store[a].at - store[b].at);
    for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete store[k];
    localStorage.setItem(CACHE_KEY, JSON.stringify(store));
  } catch {
    /* quota or private mode — the in-memory cache still works */
  }
}

function readEntry(fen) {
  const store = readStore();
  const hit = store[fen];
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) return null;
  return hit.payload;
}

export function clearExplorerCache() {
  memo.clear();
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
      /* ignore */
    }
  }
}

/* ─────────────────────────── fetch helpers ─────────────────────────── */

const DIRECT_BASE = `https://explorer.lichess.ovh/${EXPLORER_DB}`;

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchViaApi(fen) {
  try {
    // `cache: false` bypasses the app's 30s GET cache — we own caching here.
    const res = await api.get('/openings/explorer', { params: { fen }, cache: false });
    return res.data || null;
  } catch {
    return null;
  }
}

/* ─────────────────────────── shaping ─────────────────────────── */

/** Turn a raw explorer payload into the shape the UI consumes. */
function normalise(data) {
  if (!data) return null;
  const white = Number(data.white) || 0;
  const draws = Number(data.draws) || 0;
  const black = Number(data.black) || 0;
  const moves = Array.isArray(data.moves) ? data.moves : [];
  if (white + draws + black === 0) return null; // "no live data" is a valid answer

  return {
    white,
    draws,
    black,
    total: white + draws + black,
    /* Win rate from White's point of view. */
    whiteWinRate: white / (white + draws + black),
    moves: moves.map((m) => ({
      uci: m.uci,
      san: m.san,
      white: Number(m.white) || 0,
      draws: Number(m.draws) || 0,
      black: Number(m.black) || 0,
      games: (Number(m.white) || 0) + (Number(m.draws) || 0) + (Number(m.black) || 0),
      rating: m.averageRating ?? null,
    })),
  };
}

/**
 * Live stats for a position.
 * @param {string} fen
 * @returns {Promise<object|null>} null when there is no live data available.
 */
export async function fetchExplorer(fen) {
  if (!fen) return null;

  const memoised = memo.get(fen);
  if (memoised) return memoised;

  const stored = readEntry(fen);
  if (stored) {
    const shaped = normalise(stored);
    if (shaped) {
      memo.set(fen, shaped);
      return shaped;
    }
  }

  let raw = await fetchViaApi(fen);
  if (!raw) {
    // Proxy unavailable (or empty) — try Lichess directly as a fallback.
    raw = await fetchWithTimeout(`${DIRECT_BASE}?fen=${encodeURIComponent(fen)}`);
  }

  const shaped = normalise(raw);
  if (!shaped) return null;

  memo.set(fen, shaped);
  writeEntry(fen, raw);
  return shaped;
}

/** The explorer row for one specific SAN/uci, or null if it isn't a popular move. */
export function findMoveStats(explorer, uci) {
  if (!explorer?.moves?.length || !uci) return null;
  return explorer.moves.find((m) => m.uci === uci) || null;
}

/**
 * Share of games (0-100) in which `uci` was played at this position — used to
 * label the curated line with a real popularity figure when Lichess answers.
 */
export function moveShare(explorer, uci) {
  const row = findMoveStats(explorer, uci);
  if (!row || !explorer.total) return null;
  return (row.games / explorer.total) * 100;
}
