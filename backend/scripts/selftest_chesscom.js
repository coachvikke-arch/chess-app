/*
 * Self-test for the Chess.com recent-games flow WITHOUT network access.
 * Stubs global.fetch to emulate api.chess.com's monthly-archive design and
 * verifies: archives→last-6-months, concurrent fetches, merge+sorted desc,
 * descriptive User-Agent on every request, empty archives, partial failure,
 * all-months-fail surfacing, and a getJson timeout.
 * Run: node scripts/selftest_chesscom.js   (from backend/)
 */
const assert = require('node:assert/strict');

const REAL_UA = 'MateZoneChessAcademyProfileSync/1.0 (MATE ZONE CHESS ACADEMY; chess education app; contact: youremail@example.com)';
let requestLog = [];   // { url, ua }
let maxInFlight = 0;
let active = 0;
let failAll = false;
let failOne = null;

const ARCHIVES = [3, 4, 5, 6, 7, 8, 9].map((m) => `https://api.chess.com/pub/player/hikaru/games/2026/0${m}`);

const PGN = (w, b, result) => `[Event "Rated Rapid Game"]\n[Site "https://chess.com"]\n[White "${w}"]\n[Black "${b}"]\n[Result "${result}"]\n[TimeControl "600+0"]\n\n1. e4 e5 2. Nf3 Nc6 ${result}\n`;

function month(label, secs) {
  return {
    games: [
      { url: `${label}/g1`, pgn: PGN('hikaru', 'opp1', '1-0'), end_time: secs, time_class: 'rapid', rated: true,
        white: { username: 'hikaru', result: 'win', rating: 1800 }, black: { username: 'opp1', rating: 1700 } },
      { url: `${label}/g2`, pgn: PGN('opp2', 'hikaru', '0-1'), end_time: secs - 3600, time_class: 'blitz', rated: true,
        white: { username: 'opp2', rating: 1750 }, black: { username: 'hikaru', result: 'win', rating: 1810 } },
    ],
  };
}
const MONTHS = {
  '2026/03': month('2026/03', 1772629200),
  '2026/04': month('2026/04', 1775307600),
  '2026/05': month('2026/05', 1777986000),
  '2026/06': month('2026/06', 1780578000),
  '2026/07': month('2026/07', 1783256400),
  '2026/08': month('2026/08', 1785934800),
  '2026/09': month('2026/09', 1788613200),
};

function jsonRes(body, status = 200) {
  return {
    status, ok: status < 300, url: '',
    headers: { get: (k) => (k === 'retry-after' ? '60' : null) },
    async text() { return JSON.stringify(body); },
  };
}

async function mockFetch(url, opts = {}) {
  requestLog.push({ url: String(url), ua: String(opts.headers && opts.headers['User-Agent'] || '') });
  active++; maxInFlight = Math.max(maxInFlight, active);
  await new Promise((r) => setTimeout(r, 1200)); // slower than the 800ms throttle → overlap becomes observable
  active--;
  const u = String(url);
  if (u.endsWith('/games/archives')) return jsonRes({ archives: ARCHIVES });
  const m = u.match(/games\/(\d{4}\/\d{2})$/);
  if (m) {
    if (failAll) return jsonRes({ message: 'rate limited' }, 429);
    if (failOne === u) return jsonRes({ message: 'rate limited' }, 429);
    return jsonRes(MONTHS[m[1]] || { games: [] });
  }
  return jsonRes({}, 404);
}

async function main() {
  global.fetch = mockFetch;
  process.env.PLATFORM_API_TIMEOUT_MS = '1500';
  delete process.env.CHESSCOM_USER_AGENT;
  const chessCom = require('../src/services/chessComService');
  const { clearCache } = require('../src/services/platformApi');

  // ── 1) archives → last 6 months, concurrent, merged + sorted ──
  const res = await chessCom.fetchGamesDetailed('hikaru', { months: 6, maxGames: 400 });
  const got = requestLog.filter((r) => /games\/\d{4}\/\d{2}$/.test(r.url)).map((r) => r.url);
  const want = ARCHIVES.slice(-6);
  assert.deepEqual(got, want, 'must fetch the LAST 6 (slice tail), not the first 6');
  assert.ok(maxInFlight >= 2, `expected concurrent month fetches, saw max ${maxInFlight}`);
  assert.equal(res.games.length, 12, '6 months × 2 games');
  assert.equal(res.failed, 0);
  assert.equal(res.note, '');
  for (let i = 1; i < res.games.length; i++) assert.ok(res.games[i - 1].endTimeMs >= res.games[i].endTimeMs, 'sorted newest first');
  assert.equal(res.games[0].endTimeMs, 1788613200 * 1000, 'September (newest) first');
  assert.equal(res.games[0].myColor, 'white');
  assert.equal(res.games.find((g) => g.blackName === 'hikaru').myColor, 'black');

  // ── 2) descriptive UA on every request ──
  assert.equal(requestLog.length, 7, 'archives + 6 months');
  assert.ok(requestLog.every((r) => r.ua === REAL_UA), `UA wrong somewhere: ${JSON.stringify(requestLog.map((r) => r.ua))}`);

  // ── 3) zero archives (new/inactive account) ──
  const orig = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).endsWith('/archives')) return jsonRes({ archives: [] });
    return jsonRes({}, 404);
  };
  const empty = await chessCom.fetchGamesDetailed('brandnew', { months: 6 });
  assert.equal(empty.games.length, 0);
  assert.ok(/no public games yet/.test(empty.note), `note: ${empty.note}`);
  global.fetch = orig;

  // ── 4) one month fails → partial note + surviving games ──
  clearCache();
  failOne = ARCHIVES[4]; // 2026/07
  const partial = await chessCom.fetchGamesDetailed('hikaru', { months: 6 });
  assert.equal(partial.failed, 1);
  assert.equal(partial.games.length, 10, '5 surviving months × 2');
  assert.ok(/1 of 6 month archive/.test(partial.note), `note: ${partial.note}`);
  failOne = null;

  // ── 5) all months fail → underlying error surfaces ──
  clearCache();
  failAll = true;
  let err = null;
  try { await chessCom.fetchGamesDetailed('hikaru', { months: 6 }); } catch (e) { err = e; }
  assert.ok(err, 'expected throw when all months fail');
  assert.equal(err.code, 'rate_limit', `code: ${err.code}`);
  failAll = false;

  // ── 6) getJson timeout → typed error, not infinite hang ──
  const { getJson } = require('../src/services/platformApi');
  const orig2 = global.fetch;
  global.fetch = () => new Promise(() => {});
  const start = Date.now();
  let terr = null;
  try { await getJson({ url: 'https://api.chess.com/pub/player/t/t', platform: 'chess.com', kind: 'archives' }); } catch (e) { terr = e; }
  const elapsed = Date.now() - start;
  global.fetch = orig2;
  assert.ok(terr, 'timeout should throw');
  assert.equal(terr.code, 'timeout', `code: ${terr.code}`);
  assert.ok(elapsed < 3000, `must not hang forever (took ${elapsed}ms)`);

  console.log(`\n✓ All chess.com recent-games flow tests passed (max ${maxInFlight} concurrent month fetches).`);
}

(async () => {
  try {
    await main();
    const msg = `✓ All chess.com recent-games flow tests passed (max ${maxInFlight} concurrent month fetches).`;
    require('node:fs').writeFileSync(require('node:path').join(__dirname, 'selftest-result.txt'), msg, 'utf8');
    console.log('\n' + msg);
    process.exit(0);
  } catch (e) {
    const msg = `✗ TEST FAILED: ${e.message || e}\n${e.stack || ''}`;
    require('node:fs').writeFileSync(require('node:path').join(__dirname, 'selftest-result.txt'), msg, 'utf8');
    console.error('\n' + msg);
    process.exit(1);
  }
})();