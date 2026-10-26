// Tests for incremental Chess.com game synchronisation.
//   run from backend/:  node --test scripts/test-chess-sync.js
//
// These cover the exact failures that made current-date games go missing:
//
//  1. MONTH DISCOVERY — the old code trusted Chess.com's /games/archives index
//     for "which month is current". That index is regenerated on Chess.com's
//     schedule and lags the real /games/YYYY/MM endpoint by hours or days, so a
//     game finished today was in no month the index advertised. monthKeys now
//     derives the month from the clock, and fetchLatestGames fetches it directly.
//  2. CACHING — platformApi cached 'games'/'archives' responses for 15 minutes
//     with NO way to bypass, so a "sync" could be answered from a pre-sync
//     snapshot. `fresh` must genuinely skip the cache.
//  3. DEDUPLICATION — persistGames' fallback id used Math.random(), defeating
//     the UNIQUE constraint so every re-sync inserted duplicate rows.
//  4. FAILURE — a transient error must never delete or blank stored games.
//
// The HTTP layer and the DB are stubbed, so these run offline and assert real
// behaviour rather than mocks agreeing with mocks.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = require('node:path').join(__dirname, '..');

/* Load the REAL platformApi first, before the stub replaces it in the module
   cache, so the retry/backoff tests exercise the shipping code rather than the
   double. */
const realApi = require(ROOT + '/src/services/platformApi.js');

// ── stub platformApi BEFORE loading the service under test ────────────────
const httpCalls = [];
let nextResponses = {};          // url-substring -> payload | Error
let throwAlways = null;          // when set, every request rejects with this
let cacheSeed = new Map();       // stands in for the module-level cache

const platformApiStub = {
  PlatformHttpError: class PlatformHttpError extends Error {
    constructor(message, { status = 500, code = 'network', platform = null, url = null, retryAfter = null } = {}) {
      super(message);
      this.name = 'PlatformHttpError';
      this.status = status; this.code = code; this.platform = platform; this.url = url;
      this.retryAfter = retryAfter;
    }
  },
  getJson: async ({ url, fresh }) => {
    httpCalls.push({ url, fresh: !!fresh });
    if (throwAlways) throw throwAlways;
    const hit = [...cacheSeed.entries()].find(([k]) => url.includes(k));
    if (hit && !fresh) return hit[1];
    for (const [key, val] of Object.entries(nextResponses)) {
      if (url.includes(key)) {
        if (val instanceof Error) throw val;
        if (!fresh) cacheSeed.set(key, val);
        return typeof val === 'function' ? val() : val;
      }
    }
    throw new platformApiStub.PlatformHttpError(`no stub for ${url}`, { status: 404, code: 'not_found', url });
  },
  clearCache: () => cacheSeed.clear(),
  invalidate: () => {},
  __testing: {},
};

require.cache[require.resolve(ROOT + '/src/services/platformApi.js')] = {
  id: require.resolve(ROOT + '/src/services/platformApi.js'),
  filename: require.resolve(ROOT + '/src/services/platformApi.js'),
  loaded: true,
  exports: platformApiStub,
};

const chessCom = require(ROOT + '/src/services/chessComService.js');

function reset() {
  httpCalls.length = 0;
  nextResponses = {};
  throwAlways = null;
  cacheSeed = new Map();
}

/* A game shaped like a real Chess.com monthly-archive entry. */
function rawGame({ url, end, white = 'kiranrd1898', black = 'someone' }) {
  return {
    url,
    pgn: `[Event "Live"]\n[White "${white}"]\n[Black "${black}"]\n\n1. e4 e5 *`,
    end_time: Math.floor(end / 1000),
    time_control: '180+2',
    time_class: 'blitz',
    rated: true,
    white: { username: white, rating: 1500, result: 'win' },
    black: { username: black, rating: 1480, result: 'checkmate' },
  };
}

const OCT = Date.UTC(2026, 9, 2, 12, 0, 0);       // 2026-10-02 12:00 UTC
const GAME_URL = 'https://www.chess.com/game/live/998877';

// ── 1. month discovery ────────────────────────────────────────────────────

test('monthKeys derives months from the clock, never from the archive index', () => {
  assert.deepEqual(chessCom.monthKeys(new Date(OCT), 2), ['2026/10', '2026/09']);
});

test('monthKeys rolls back over a year boundary', () => {
  assert.deepEqual(chessCom.monthKeys(new Date(Date.UTC(2027, 0, 3)), 2), ['2027/01', '2026/12']);
});

test('monthKeys handles December -> January and a leap February', () => {
  assert.deepEqual(chessCom.monthKeys(new Date(Date.UTC(2026, 11, 31, 23, 59)), 2), ['2026/12', '2026/11']);
  assert.deepEqual(chessCom.monthKeys(new Date(Date.UTC(2028, 1, 29)), 2), ['2028/02', '2028/01']);
});

test('monthKeys always asks for two months, so a midnight game is never missed', () => {
  /* A game finishing 23:59 on the last day of the month can land in either
     bucket depending on the player's timezone. Requesting the previous month as
     well makes that boundary non-lossy. */
  assert.equal(chessCom.monthKeys(new Date(OCT)).length, 2);
});

test('monthKeys is UTC-anchored, not server-local', () => {
  /* Chess.com buckets archives by UTC month. A server running in UTC+5:30 that
     computed months locally would request the wrong month for the first five and
     a half hours of each UTC day. */
  const src = require('node:fs').readFileSync(ROOT + '/src/services/chessComService.js', 'utf8');
  const block = /function monthKeys[\s\S]*?\n}/.exec(src)[0];
  assert.match(block, /getUTCFullYear\(\)/, 'must use UTC year');
  assert.match(block, /getUTCMonth\(\)/, 'must use UTC month');
  assert.doesNotMatch(block, /[^C]getFullYear\(\)/, 'must not use local getFullYear');
});

// ── 2. the incremental fetch actually asks for the current month ───────────

test('fetchLatestGames requests the current month directly, ignoring the index', async () => {
  reset();
  nextResponses = { 'games/2026/10': { games: [rawGame({ url: GAME_URL, end: OCT })] } };

  const res = await chessCom.fetchLatestGames('kiranrd1898', { now: new Date(OCT) });

  const urls = httpCalls.map((c) => c.url);
  assert.ok(urls.some((u) => u.endsWith('/games/2026/10')),
    `current month must be fetched directly, got ${JSON.stringify(urls)}`);
  /* The whole bug in one assertion: this path must not consult /archives at all. */
  assert.ok(!urls.some((u) => u.includes('/games/archives')),
    'the lagging archive index must not be consulted for the live path');
  assert.equal(res.games.length, 1);
});

test('fetchLatestGames bypasses the response cache so a poll sees a new game', async () => {
  reset();
  let n = 0;
  nextResponses = {
    'games/2026/10': () => {
      n += 1;
      return n === 1
        ? { games: [rawGame({ url: GAME_URL, end: OCT })] }
        : { games: [rawGame({ url: GAME_URL, end: OCT }), rawGame({ url: 'https://www.chess.com/game/live/2', end: OCT + 60000 })] };
    },
  };

  await chessCom.fetchLatestGames('kiranrd1898', { now: new Date(OCT) });
  const second = await chessCom.fetchLatestGames('kiranrd1898', { now: new Date(OCT) });

  assert.ok(httpCalls.every((c) => c.fresh === true),
    'every request in the live path must be marked fresh, or the 15-minute cache answers instead');
  assert.equal(second.games.length, 2, 'the second poll must see the newly finished game');
});

test('fetchLatestGames reports the newest end time as a watermark', async () => {
  reset();
  nextResponses = {
    'games/2026/10': {
      games: [
        rawGame({ url: 'a', end: OCT - 7200000 }),
        rawGame({ url: 'b', end: OCT }),
      ],
    },
  };
  const res = await chessCom.fetchLatestGames('kiranrd1898', { now: new Date(OCT) });
  assert.equal(res.newestEndTimeMs, OCT);
});

// ── 3. deduplication ──────────────────────────────────────────────────────

test('the same game listed in both months is returned once', async () => {
  reset();
  nextResponses = {
    'games/2026/10': { games: [rawGame({ url: GAME_URL, end: OCT })] },
    'games/2026/09': { games: [rawGame({ url: GAME_URL, end: OCT })] },
  };
  const res = await chessCom.fetchLatestGames('kiranrd1898', { now: new Date(OCT) });
  assert.equal(res.games.length, 1, 'a game present in two months must dedupe on its URL');
});

test('a re-fetched month returns each game once (polling is idempotent)', async () => {
  reset();
  nextResponses = {
    'games/2026/10': {
      games: [
        rawGame({ url: GAME_URL, end: OCT }),
        rawGame({ url: 'https://www.chess.com/game/live/2', end: OCT - 60000 }),
      ],
    },
  };
  const a = await chessCom.fetchLatestGames('kiranrd1898', { now: new Date(OCT) });
  const b = await chessCom.fetchLatestGames('kiranrd1898', { now: new Date(OCT) });
  assert.deepEqual(a.games.map((g) => g.platformGameId), b.games.map((g) => g.platformGameId));
  assert.equal(new Set(b.games.map((g) => g.platformGameId)).size, b.games.length);
});

test('a game with no URL is dropped rather than imported un-deduplicatable', async () => {
  reset();
  const noUrl = rawGame({ url: '', end: OCT });
  nextResponses = { 'games/2026/10': { games: [noUrl] } };
  const res = await chessCom.fetchLatestGames('kiranrd1898', { now: new Date(OCT) });
  assert.equal(res.games.length, 0, 'without a stable id it cannot be deduped safely');
});

// ── 4. failure handling ───────────────────────────────────────────────────

test('a month with no games (404) is not treated as a failure', async () => {
  reset();
  nextResponses = {
    'games/2026/10': { games: [rawGame({ url: GAME_URL, end: OCT })] },
    'games/2026/09': new platformApiStub.PlatformHttpError('no games', { status: 404, code: 'not_found' }),
  };
  const res = await chessCom.fetchLatestGames('kiranrd1898', { now: new Date(OCT) });
  assert.equal(res.failed, 0, 'an empty previous month is normal, not an error');
  assert.equal(res.note, '');
});

test('a rate-limited month is reported, not silently counted as zero new games', async () => {
  reset();
  nextResponses = {
    'games/2026/10': new platformApiStub.PlatformHttpError('rate limited', { status: 429, code: 'rate_limit' }),
    'games/2026/09': { games: [rawGame({ url: GAME_URL, end: OCT })] },
  };
  const res = await chessCom.fetchLatestGames('kiranrd1898', { now: new Date(OCT) });
  assert.equal(res.failed, 1);
  assert.match(res.note, /rate-limiting/i, 'the reason must reach the caller');
  /* The month that did load is still returned — a partial failure must not
     discard good data. */
  assert.equal(res.games.length, 1);
});

test('an upstream outage surfaces instead of reporting "0 new games"', async () => {
  reset();
  nextResponses = {
    'games/2026/10': new platformApiStub.PlatformHttpError('down', { status: 500, code: 'http' }),
    'games/2026/09': new platformApiStub.PlatformHttpError('down', { status: 500, code: 'http' }),
  };
  await assert.rejects(
    () => chessCom.fetchLatestGames('kiranrd1898', { now: new Date(OCT) }),
    /down/,
    'when EVERY month fails the caller must see the error, not an empty success',
  );
});

test('one month failing does not discard the month that worked', async () => {
  reset();
  nextResponses = {
    'games/2026/10': new platformApiStub.PlatformHttpError('boom', { status: 500, code: 'http' }),
    'games/2026/09': { games: [rawGame({ url: GAME_URL, end: OCT })] },
  };
  const res = await chessCom.fetchLatestGames('kiranrd1898', { now: new Date(OCT) });
  assert.equal(res.games.length, 1, 'a partial outage must not throw away good data');
  assert.equal(res.failed, 1);
  assert.match(res.note, /failed/i);
});

// ── 5. normalization is unchanged (game review must keep working) ─────────

test('normalized rows keep every field the review, classification and badges need', async () => {
  reset();
  nextResponses = { 'games/2026/10': { games: [rawGame({ url: GAME_URL, end: OCT })] } };
  const { games } = await chessCom.fetchLatestGames('kiranrd1898', { now: new Date(OCT) });
  const g = games[0];
  for (const field of ['platformGameId', 'endTimeMs', 'whiteName', 'blackName', 'myColor',
    'whiteRating', 'blackRating', 'result', 'timeControl', 'timeClass', 'pgn', 'movesCount', 'isRated']) {
    assert.ok(field in g, `missing ${field}`);
  }
  assert.equal(g.myColor, 'white');
  assert.equal(g.result, 'white');
  assert.ok(g.pgn.includes('e4'), 'the PGN must survive for the game-review engine');
});

// ── 6. the retry/timeout layer ────────────────────────────────────────────

test('only transient statuses are retried; a 404 is a fact, not a hiccup', () => {
  const { isRetryableStatus } = realApi.__testing;
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(404), false, 'retrying a 404 wastes the rate-limit budget');
  assert.equal(isRetryableStatus(403), false);
  assert.equal(isRetryableStatus(200), false);
});

test('backoff honours Retry-After rather than guessing', () => {
  const { backoffMs, isRetryableError } = realApi.__testing;
  /* Must be the REAL error class: isRetryableError gates on
     `instanceof PlatformHttpError`, so a look-alike from the stub would fall
     through to the `err.code === 'network'` branch and pass for the wrong
     reason. */
  const err = new realApi.PlatformHttpError('rate limited', { status: 429, retryAfter: 7 });
  assert.equal(backoffMs(1, err), 7000, 'a Retry-After of 7s must mean 7000ms, not a random guess');
  assert.ok(isRetryableError(err));
  /* backoffMs always produces a delay; isRetryableError is what decides
     whether the loop is allowed to use it. A 404 must be rejected by the
     gate, so its computed backoff is never spent on the rate-limit budget. */
  assert.equal(isRetryableError(new realApi.PlatformHttpError('nf', { status: 404 })), false);
  assert.equal(isRetryableError(new realApi.PlatformHttpError('net', { status: 0, code: 'network' })), true);
});

test('a 5xx is retried and then succeeds, without the caller seeing an error', async () => {
  let n = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    n += 1;
    if (n < 3) return { status: 503, ok: false, url: 'x', headers: { get: () => null } };
    return { status: 200, ok: true, url: 'x', headers: { get: () => null }, text: async () => '{"ok":true}' };
  };
  try {
    const out = await realApi.getJson({ url: 'https://example.test/x', platform: 'test', kind: 'games', fresh: true, retries: 3 });
    assert.deepEqual(out, { ok: true });
    assert.equal(n, 3, 'it should have taken two retries to get there');
  } finally {
    global.fetch = originalFetch;
  }
});

test('a 404 is not retried — exactly one upstream request', async () => {
  let n = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    n += 1;
    return { status: 404, ok: false, url: 'https://example.test/player/x', headers: { get: () => null } };
  };
  try {
    await assert.rejects(() => realApi.getJson({ url: 'https://example.test/player/x', platform: 'test', fresh: true, retries: 3 }));
    assert.equal(n, 1, 'a 404 must not be retried');
  } finally {
    global.fetch = originalFetch;
  }
});