import axios from 'axios';

/*
 * Slim GET cache + in-flight deduplication for the public `api` instance.
 *
 * Why it exists (PuzzleLibrary / Admin fetches were hitting the API 8+ times
 * with identical URLs in a short window):
 *   · React 18 StrictMode double-fires mount effects → duplicate GETs.
 *   · Every route mount re-requests unchanged data (e.g. /puzzles/sets,
 *     /puzzles/sets/:code) because there was no memo layer.
 *   · AuthContext refetches /auth/me on every app load.
 *
 * Behaviour:
 *   · GET only. Identical in-flight GETs share ONE network call; after that,
 *     the response is served from memory for CACHE_TTL_MS (default 30s).
 *   · Opt out per request with `api.get(url, { cache: false })`, tune TTL with
 *     `{ cacheTtl: 5000 }`.
 *   · Any successful non-GET write invalidates cached GETs under the same first
 *     URL segment (e.g. PATCH /puzzles/sets/:code clears /puzzles/*), so admin
 *     edits show up immediately.
 *   · 401 clears the whole cache.
 *   · The cache key carries the caller's id+role, so a signed-in user can never
 *     be served another user's response for the same URL — see cacheIdentity.
 */

const CACHE_TTL_MS = 30 * 1000;
const cache = new Map();     // key -> { expiresAt, response }
const inflight = new Map();  // key -> Promise<AxiosResponse>

/* ── Forced-logout messaging (concurrent-device cap) ────────────────────────
 * When the server rejects a token with code SESSION_REVOKED (the account was
 * used on another device and this one was bumped), we clear the session and
 * send the user to the login screen with this exact message. `AUTH_MESSAGE_KEY`
 * is the sessionStorage slot the Login page reads — shared here so both files
 * can never drift apart. */
export const SESSION_REVOKED_MESSAGE =
  'You were logged out because your account was used on another device.';
export const AUTH_MESSAGE_KEY = 'knightpath-auth-message';

/* ── Who is asking ──────────────────────────────────────────────────────────
 * Several endpoints in this app return per-user data under a URL that does NOT
 * vary by user: GET /game-history/students returns the caller's own members,
 * GET /sigma/moves defaults to the caller's own player. Keying the cache on
 * method+url+params alone meant that after switching accounts inside the 30s TTL
 * the new user could be handed the previous user's list — the wrong coach's
 * students, with their names and stats.
 *
 * clearHttpCache() on login/logout makes that unreachable in the normal flow,
 * but that is an incidental guard in another file. Keying on the identity makes
 * it structurally impossible: two different users get two different cache
 * entries for the same URL, so they can never share a response.
 *
 * The identity is derived from the JWT already in localStorage, memoised per
 * token so the base64 decode happens once per session rather than per request. */
let identityMemo = { token: null, key: '' };

function cacheIdentity() {
  const token = localStorage.getItem('token') || '';
  if (identityMemo.token === token) return identityMemo.key;

  let key = 'anon';
  if (token) {
    try {
      const payload = token.split('.')[1] || '';
      const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const claims = JSON.parse(atob(padded));
      key = `${claims.role || '?'}:${claims.id ?? '?'}`;
    } catch {
      /* Opaque token (or not a JWT at all). Fall back to a prefix of the token
       * itself, which is still per-session and still prevents cross-user hits. */
      key = `tok:${token.slice(0, 24)}`;
    }
  }
  identityMemo = { token, key };
  return key;
}

function cacheKey(config) {
  const method = (config.method || 'get').toLowerCase();
  let params = '';
  if (config.params) {
    const sorted = Object.keys(config.params)
      .sort()
      .reduce((acc, k) => {
        acc[k] = config.params[k];
        return acc;
      }, {});
    params = JSON.stringify(sorted);
  }
  return `${method} ${cacheIdentity()} ${config.url || ''} ${params}`;
}

function firstPathSegment(url = '') {
  const clean = String(url).split('?')[0].split('#')[0];
  return '/' + (clean.split('/').filter(Boolean)[0] || '');
}

function copyHeaders(headers) {
  if (!headers) return {};
  if (typeof headers.forEach === 'function') {
    const out = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  return { ...headers };
}

function cloneResponse(res) {
  return {
    data: res.data && typeof res.data === 'object' ? JSON.parse(JSON.stringify(res.data)) : res.data,
    status: res.status,
    statusText: res.statusText,
    headers: copyHeaders(res.headers),
    config: { ...res.config },
    request: res.request,
  };
}

export function clearHttpCache() {
  cache.clear();
  inflight.clear();
  /* Drop the memoised identity too, so a token swapped without a reload cannot
   * reuse a key computed for the previous session. */
  identityMemo = { token: null, key: '' };
}

function invalidateScope(scope) {
  if (scope === '/') return clearHttpCache();
  const needle = ` ${scope}`;
  for (const key of [...cache.keys()]) {
    if (key.includes(needle)) cache.delete(key);
  }
}

const api = axios.create({
  baseURL: '/api',
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;

    const method = (config.method || 'get').toLowerCase();
    if (method !== 'get' || config.cache === false) return config;

    const key = cacheKey(config);

    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      config.adapter = () => Promise.resolve(cloneResponse(hit.response));
      return config;
    }

    const pending = inflight.get(key);
    if (pending) {
      config.adapter = () => pending;
      return config;
    }

    // First caller for this key: register an in-flight promise so StrictMode
    // siblings and simultaneous components share exactly one network call.
    const deferred = {};
    deferred.promise = new Promise((resolve, reject) => {
      deferred.resolve = resolve;
      deferred.reject = reject;
    });
    inflight.set(key, deferred.promise);
    config.__cacheKey = key;
    config.__deferred = deferred;
    config.__cacheTtl = Number.isFinite(config.cacheTtl) ? config.cacheTtl : CACHE_TTL_MS;
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (res) => {
    const c = res.config || {};
    if (c.__cacheKey) {
      const deferred = c.__deferred;
      if (deferred) deferred.resolve(res);
      inflight.delete(c.__cacheKey);
      cache.set(c.__cacheKey, { expiresAt: Date.now() + c.__cacheTtl, response: res });
    } else if ((c.method || 'get').toLowerCase() !== 'get') {
      invalidateScope(firstPathSegment(c.url));
    }
    return res;
  },
  (err) => {
    const c = err.config || {};
    if (c.__cacheKey) {
      inflight.delete(c.__cacheKey);
      if (c.__deferred) c.__deferred.reject(err);
    }
    /* Only treat a 401 as a forced logout when the token itself is the
       problem (bad/expired/missing). Credential 401s from /auth/login and
       role/permission 401s must NOT wipe an existing session. */
    if (err.response?.status === 401 && localStorage.getItem('token')) {
      const url = String(c.url || '');
      const data = err.response.data || {};
      const msg = typeof data.message === 'string' ? data.message : '';
      const isCredentialError = url.endsWith('/auth/login') || url.endsWith('/auth/refresh');

      if (data.code === 'SESSION_REVOKED' && !isCredentialError) {
        /* The account was used on another device; this session was revoked.
           Clear everything and bounce to login with the explanation. */
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('refresh_token');
        clearHttpCache();
        const message = msg || SESSION_REVOKED_MESSAGE;
        try { sessionStorage.setItem(AUTH_MESSAGE_KEY, message); } catch { /* ignore */ }
        /* AuthContext listens for this and performs the in-SPA redirect (it has
           the router); the event keeps this transport layer router-agnostic. */
        try {
          window.dispatchEvent(new CustomEvent('auth:session-revoked', { detail: { message } }));
        } catch { /* ignore */ }
      } else {
        const tokenInvalid = /\b(token|expired|session)\b/i.test(msg);
        if (tokenInvalid && !isCredentialError) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          clearHttpCache();
          /* Clearing storage alone leaves React's cached `user` set, so
             ProtectedRoute keeps rendering the signed-in page and every poll
             then fires WITHOUT an Authorization header → an endless stream of
             "No token provided" 401s. Signal AuthContext so it clears its state
             and navigates to /login, exactly like the SESSION_REVOKED path. */
          const message = 'Your session has expired. Please log in again.';
          try { sessionStorage.setItem(AUTH_MESSAGE_KEY, message); } catch { /* ignore */ }
          try {
            window.dispatchEvent(new CustomEvent('auth:session-revoked', { detail: { message } }));
          } catch { /* ignore */ }
        }
      }
    }
    return Promise.reject(err);
  }
);

export default api;