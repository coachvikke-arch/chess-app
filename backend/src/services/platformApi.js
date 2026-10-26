/*
 * Shared HTTP layer for external chess platforms (Chess.com / Lichess).
 *
 * Provides:
 *   - A small in-memory response cache (TTL per endpoint) so the same data is
 *     never fetched twice in a short window.
 *   - Per-platform serialisation + a minimum interval between outbound calls,
 *     so we stay comfortably inside Chess.com / Lichess rate limits.
 *   - Friendly, typed errors for 404 / 429 / 403 / network failures.
 *
 * No credentials are ever kept here — both platforms are public APIs.
 */

const { APP_NAME } = require('../config/brand');

const CACHE_TTL = {
  profile: 5 * 60 * 1000,
  stats: 5 * 60 * 1000,
  archives: 15 * 60 * 1000,
  games: 15 * 60 * 1000,
  ratingHistory: 60 * 60 * 1000,
};

/* ── request profile ────────────────────────────────────────────────────────
 * Chess.com's published-data API requires a descriptive User-Agent (with a way
 * to contact the operator) on EVERY request; generic UAs get blocked or
 * rate-limited. The value is overridable via CHESSCOM_USER_AGENT so each
 * deployment can use its real contact address.
 */
const REQUEST_TIMEOUT_MS = Number(process.env.PLATFORM_API_TIMEOUT_MS || 30000);
const USER_AGENT =
  process.env.CHESSCOM_USER_AGENT ||
  `MateZoneChessAcademyProfileSync/1.0 (${APP_NAME}; chess education app; contact: youremail@example.com)`;

const cache = new Map();          // url -> { expiresAt, value }
const lastCall = {};              // platform -> timestamp ms (start-time spacing)

/* ── retry policy ──────────────────────────────────────────────────────────
   Only TRANSIENT failures are retried: a 429 (rate limit), a 5xx, and network
   errors. A 404 or 403 is a fact about the profile, not a hiccup, so retrying
   only wastes Chess.com's rate-limit budget and delays the real error.

   The delay honours `Retry-After` when the platform sends it, otherwise it
   backs off exponentially. Jitter is applied so concurrent syncs (several
   accounts, or a polling loop overlapping a manual sync) do not all wake at
   the same instant and immediately re-trigger the limit. */
const MAX_ATTEMPTS = Number(process.env.PLATFORM_API_ATTEMPTS || 3);
const RETRY_BASE_MS = Number(process.env.PLATFORM_API_RETRY_MS || 800);
const RETRY_MAX_MS = 20000;

/** Statuses worth a second attempt. */
function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

function isRetryableError(err) {
  if (!err) return false;
  /* Check the code as well as the status. Transport-level faults are transient
     by nature even if some code path reports them under a non-5xx status, and
     keying on the status alone would silently drop them out of the retry. */
  if (err.code === 'network' || err.code === 'timeout') return true;
  if (err instanceof PlatformHttpError) return isRetryableStatus(err.status);
  return false;
}

/** Retry-After is either seconds or an HTTP date; Chess.com sends seconds. */
function retryAfterMs(err) {
  const raw = err && err.retryAfter != null ? err.retryAfter : null;
  if (raw == null) return 0;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.min(n * 1000, RETRY_MAX_MS);
  const when = Date.parse(String(raw));
  if (!Number.isNaN(when)) return Math.min(Math.max(when - Date.now(), 0), RETRY_MAX_MS);
  return 0;
}

function backoffMs(attempt, err) {
  const hinted = retryAfterMs(err);
  if (hinted) return hinted;
  const base = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS);
  return base + Math.floor(Math.random() * Math.min(base, 500));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class PlatformHttpError extends Error {
  /* `code` deliberately has no 'network' default. The retry gate checks
     `code === 'network'` before the status, so defaulting to it would make
     every error that forgot to name its code — including a plain 404 — look
     transient and get retried. Every call site passes `code` explicitly. */
  constructor(message, { status = 500, code = null, platform = null, url = null, retryAfter = null } = {}) {
    super(message);
    this.name = 'PlatformHttpError';
    this.status = status;
    this.code = code;
    this.platform = platform;
    this.url = url;
    /* Kept so the retry loop can honour the platform's own pacing hint rather
       than guessing a backoff. */
    this.retryAfter = retryAfter;
  }
}

function cacheGet(url) {
  const hit = cache.get(url);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  cache.delete(url);
  return undefined;
}

function cacheSet(url, value, ttlMs) {
  cache.set(url, { expiresAt: Date.now() + ttlMs, value });
}

/**
 * Fetch JSON from a public platform API endpoint using the shared cache +
 * per-platform throttle. Returns parsed JSON or throws PlatformHttpError.
 *
 * `fresh: true` bypasses the response cache (and repopulates it) for callers
 * that MUST see the newest upstream state — the incremental game sync. Without
 * it a "sync" could be answered from a response cached up to 15 minutes ago,
 * which is exactly the staleness this app is trying to eliminate.
 */
async function getJson({
  url,
  platform,
  kind = 'profile',
  headers = {},
  asText = false,
  fresh = false,
  retries = MAX_ATTEMPTS,
}) {
  const key = `${platform}|${url}`;
  if (!fresh) {
    const hit = cacheGet(key);
    if (hit !== undefined) return hit;
  }

  let lastErr = null;
  for (let attempt = 1; attempt <= Math.max(1, retries); attempt++) {
    try {
      const value = await getJsonOnce({ url, platform, kind, headers, asText });
      // A fresh fetch refreshes the cache so a later non-fresh caller also sees
      // the newer payload rather than the one it was about to overwrite.
      cacheSet(key, value, CACHE_TTL[kind] || 5 * 60 * 1000);
      return value;
    } catch (err) {
      lastErr = err;
      if (attempt >= retries || !isRetryableError(err)) throw err;
      const wait = backoffMs(attempt, err);
      console.warn(
        `[platform-api] ${platform} ${url} failed (${err.code || 'http'} ${err.status || ''}); `
        + `retry ${attempt}/${retries - 1} in ${wait}ms`,
      );
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function getJsonOnce({ url, platform, kind, headers, asText }) {
  const since = lastCall[platform] || 0;
  const wait = Math.max(0, platformMinInterval(platform) - (Date.now() - since));
  if (wait) await sleep(wait);
  // Stamp the start-time slot BEFORE the fetch: parallel batches (e.g. the six
  // monthly Chess.com archives) keep a best-effort minimum spacing but are no
  // longer forced to wait for each other's response to complete.
  lastCall[platform] = Date.now();

  let res = null;
  try {
    res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        // One descriptive User-Agent (with contact info) on EVERY request.
        'User-Agent': USER_AGENT,
        ...headers,
      },
      signal: timeoutSignal(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const kind = String(err && err.name || '').toLowerCase();
    if (kind.includes('timeout') || kind.includes('abort')) {
      throw new PlatformHttpError(`${platform} took too long to respond. Try again shortly.`, {
        status: 504, code: 'timeout', platform, url,
      });
    }
    throw new PlatformHttpError(`Could not reach ${platform} (${err.message})`, {
      status: 502, code: 'network', platform, url,
    });
  }

  if (res.status === 404) {
      throw new PlatformHttpError(
        res.url && /\/games\/\d{4}\/\d{2}$/.test(String(res.url))
          ? 'That month has no public games for this profile.'
          : 'Profile not found. Check the username and try again.',
        { status: 404, code: 'not_found', platform, url }
      );
    }
    if (res.status === 429) {
      const retryAfter = res.headers ? res.headers.get('retry-after') : null;
      const hint = retryAfter ? ` Try again in ${retryAfter}s.` : ' Wait a minute, then try again.';
      throw new PlatformHttpError(`${platform} is rate-limiting requests.${hint}`, {
        status: 429, code: 'rate_limit', platform, url, retryAfter,
      });
    }
    if (res.status === 403) {
      throw new PlatformHttpError('This profile is not publicly available.', {
        status: 403, code: 'forbidden', platform, url,
      });
    }
    if (!res.ok) {
      throw new PlatformHttpError(`${platform} responded with status ${res.status}.`, {
        status: res.status, code: 'http', platform, url,
      });
    }

  try {
    const raw = await res.text();
    if (!raw || !raw.trim()) {
      throw new PlatformHttpError(`${platform} returned an empty response.`, {
        status: 502, code: 'empty', platform, url,
      });
    }
    return asText ? raw : JSON.parse(raw);
  } catch (err) {
    if (err instanceof PlatformHttpError) throw err;
    throw new PlatformHttpError(`Could not parse ${platform} response.`, {
      status: 502, code: 'parse', platform, url,
    });
  }
}

function platformMinInterval(platform) {
  if (platform === 'lichess') return 1200; // lichess asks for ≤ 1 req/s per IP
  if (platform === 'chess.com') return 800; // chess.com is also rate-limited
  return 1000;
}

/** Timeout signal for fetch — AbortSignal.timeout on Node ≥ 18. Falls back to
    no hard timeout on ancient runtimes rather than shipping a broken signal.
    Keeps a hung upstream request from spinning the UI forever. */
function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  return undefined;
}

function clearCache() {
  cache.clear();
}

/** Drop one cached response — used after a sync writes, so the next read is
    never answered from the snapshot taken before it. */
function invalidate(url, platform) {
  cache.delete(`${platform}|${url}`);
}

/** Exposed for tests: how a platform's retry/backoff behaves. */
const __testing = { isRetryableStatus, isRetryableError, backoffMs, retryAfterMs };

module.exports = { getJson, PlatformHttpError, clearCache, invalidate, __testing };