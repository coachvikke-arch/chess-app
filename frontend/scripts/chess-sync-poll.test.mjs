// Tests for the automatic Chess.com game-sync loop.
//   run from frontend/:  node --test scripts/chess-sync-poll.test.mjs
//
// The bug these lock down: a game finished while the profile page sat open never
// appeared until the user reloaded by hand. The page called the sync endpoint
// exactly once, on mount, with an empty dependency array — and did so before auth
// had resolved, so the request could even go out with no token.
//
// The load-bearing logic is extracted into pure functions (triagePoll,
// accountsToPoll, isSyncReady) precisely so the cases below can be asserted
// directly instead of inferred from source text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* pathToFileURL: a bare Windows absolute path ("C:\...") is rejected by the ESM
   loader, which only accepts file:// URLs. Imported from the logic module rather
   than the hook itself so this test needs no React or service imports. */
const {
  triagePoll,
  accountsToPoll,
  isSyncReady,
  POLLED_PLATFORMS,
} = await import(pathToFileURL(join(ROOT, 'src', 'hooks', 'accountSyncLogic.js')).href);

const hookSrc = readFileSync(join(ROOT, 'src', 'hooks', 'useAccountSync.js'), 'utf8');
/* Number(): these are captured as strings from source, and "30000" < "120000"
   is false lexically — the assertion below would fail for the wrong reason. */
const DEFAULT_POLL_MS = Number(/export const DEFAULT_POLL_MS = (\d+)/.exec(hookSrc)[1]);
const MIN_GAP_MS = Number(/const MIN_GAP_MS = (\d+)/.exec(hookSrc)[1]);

const page = readFileSync(join(ROOT, 'src', 'pages', 'ChessProfile.jsx'), 'utf8');
const svc = readFileSync(join(ROOT, 'src', 'services', 'chessProfiles.js'), 'utf8');

/* Scope to GamesTab. The page hosts many tabs and several use `setData(null)` on
   their own error paths (OpeningsTab, for one) — asserting globally would either
   fail on unrelated code or, worse, be loosened until it tested nothing. */
const gamesTabStart = page.indexOf('function GamesTab');
const gamesTabSrc = gamesTabStart === -1 ? '' : page.slice(gamesTabStart, page.indexOf('\nfunction ', gamesTabStart + 10) === -1 ? undefined : page.indexOf('\nfunction ', gamesTabStart + 10));

const ok = (v) => ({ status: 'fulfilled', value: v });
const fail = (message) => ({ status: 'rejected', reason: new Error(message) });

// ── auth gating ────────────────────────────────────────────────────────────

test('nothing syncs until auth has actually resolved', () => {
  const accounts = [{ id: 1, platform: 'chess.com' }];
  assert.equal(isSyncReady({ authLoading: true, user: null, accounts }), false,
    'must not fire while auth is still loading');
  assert.equal(isSyncReady({ authLoading: true, user: { id: 9 }, accounts }), false,
    'a stale user object must not unblock the gate while loading');
  assert.equal(isSyncReady({ authLoading: false, user: null, accounts }), false,
    'must not fire while signed out');
  assert.equal(isSyncReady({ authLoading: false, user: { id: 9 }, accounts }), true);
});

test('the gate stays shut with no accounts or no accounts loaded yet', () => {
  assert.equal(isSyncReady({ user: { id: 1 }, accounts: null }), false);
  assert.equal(isSyncReady({ user: { id: 1 }, accounts: [] }), false);
  assert.equal(isSyncReady({ enabled: false, user: { id: 1 }, accounts: [{ id: 1, platform: 'chess.com' }] }), false);
});

test('the page waits for auth before it even lists accounts', () => {
  /* The original mount effect fired `load()` unconditionally on first paint, so
     the very first request went out with no token, 401'd, and was never retried —
     leaving the account list (and therefore the poll) empty for the session. */
  const gated = /useEffect\(\(\) => \{\s*\n\s*if \(authLoading \|\| !user\) return;[\s\S]{0,400}?load\(\{ quiet: true \}\);/.test(page);
  assert.ok(gated, 'the initial load must be gated on resolved auth');
  assert.ok(!/useEffect\(\(\) => \{ load\(\{ quiet: true \}\)/.test(page),
    'an ungated load-on-mount effect must not survive');
});

// ── platform scope ─────────────────────────────────────────────────────────

test('only Chess.com is polled', () => {
  assert.deepEqual(POLLED_PLATFORMS, ['chess.com']);
  const list = accountsToPoll([
    { id: 1, platform: 'chess.com' },
    { id: 2, platform: 'lichess' },
  ]);
  assert.deepEqual(list.map((a) => a.id), [1],
    'Lichess already serves an incremental feed; polling it spends requests for nothing');
  assert.deepEqual(accountsToPoll(null), []);
  assert.deepEqual(accountsToPoll(undefined), []);
});

test('a Chess.com account is still polled when Lichess accounts are also connected', () => {
  const list = accountsToPoll([
    { id: 2, platform: 'lichess' },
    { id: 7, platform: 'chess.com' },
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 7);
});

// ── triage: the case that hides a failure ──────────────────────────────────

test('a clean no-op pass reports nothing new and no error', () => {
  const v = triagePoll([ok({ newGames: 0 }), ok({ newGames: 0 })]);
  assert.equal(v.newGames, 0);
  assert.deepEqual(v.failures, []);
  assert.equal(v.announce, false);
  assert.equal(v.refresh, true, 'a clean pass should still refresh so last_synced_at moves');
});

test('new games across accounts are summed', () => {
  const v = triagePoll([ok({ newGames: 1 }), ok({ newGames: 2 }), ok({ newGames: 0 })]);
  assert.equal(v.newGames, 3);
  assert.equal(v.announce, true);
});

test('one account failing does not hide the others, and never reads as clean', () => {
  const v = triagePoll([
    ok({ newGames: 1 }),
    fail('Chess.com is rate-limiting requests. Wait a minute, then try again.'),
  ]);
  assert.equal(v.newGames, 1, 'the account that worked must still count');
  assert.equal(v.announce, true, 'stored games must still be shown to the user');
  assert.equal(v.failures.length, 1);
  assert.match(v.failures[0], /rate-limiting/);
});

test('an upstream message reaches the UI instead of a generic string', () => {
  const reason = new Error('Could not reach chess.com (fetch failed)');
  reason.response = { data: { message: 'Profile not found. Check the username.' } };
  const v = triagePoll([{ status: 'rejected', reason }]);
  assert.equal(v.failures[0], 'Profile not found. Check the username.');
});

test('a partial (rate-limited month) result is a visible warning, not a clean check', () => {
  /* The backend keeps the data it loaded and says so in `note`. If the client
     treats a fulfilled response as automatically clean, the user is told "up to
     date" while a month of games was never read. */
  const v = triagePoll([ok({
    newGames: 0,
    partial: true,
    note: '1 of 2 month request(s) failed — Chess.com may be rate-limiting. Showing what loaded.',
  })]);
  assert.equal(v.failures.length, 1);
  assert.match(v.failures[0], /rate-limiting/);
  assert.equal(v.announce, false, 'nothing new arrived, so nothing should be announced');
});

test('a partial result that DID store games still announces them', () => {
  const v = triagePoll([ok({ newGames: 2, partial: true, note: '1 of 2 month request(s) failed' })]);
  assert.equal(v.newGames, 2);
  assert.equal(v.announce, true);
  assert.equal(v.refresh, true);
});

test('an empty response body is treated as zero, not NaN', () => {
  assert.equal(triagePoll([ok(undefined)]).newGames, 0);
  assert.equal(triagePoll([ok({})]).newGames, 0);
});

test('an empty poll set is safe', () => {
  const v = triagePoll([]);
  assert.equal(v.newGames, 0);
  assert.equal(v.checked, 0);
  assert.deepEqual(v.failures, []);
});

// ── cadence ────────────────────────────────────────────────────────────────

test('the poll interval is long enough not to hammer the API', () => {
  assert.ok(DEFAULT_POLL_MS >= 60000,
    `poll interval of ${DEFAULT_POLL_MS}ms is too aggressive for a public API`);
  assert.ok(MIN_GAP_MS >= 15000, 'the focus-resume guard needs a real cooldown');
  assert.ok(MIN_GAP_MS < DEFAULT_POLL_MS);
});

test('polling runs on an interval, not a one-shot mount effect', () => {
  assert.match(page, /useAccountSync\(/, 'the page must use the polling hook');
  /* The old code contained the literal `syncAccount(a.id, true)` — strip block
     comments first, since the replacement is *described* in a comment and must
     not read as a surviving call. */
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/syncAccount\(\s*\w+\.id\s*,\s*true\s*\)/.test(code),
    'the old fire-and-forget one-shot sync must be gone');
  assert.match(code, /<GamesTab gamesVersion=\{gamesVersion\}/,
    'the Games tab must receive the refresh signal');
});

// ── cache busting ──────────────────────────────────────────────────────────

test('live sync reads opt out of the client GET cache', () => {
  assert.match(svc, /listAccounts = \(\) =>\s*\n\s*api\.get\('\/chess-profiles', \{ cache: false \}\)/,
    'listAccounts must bypass the 30s cache or a fresh sync looks like a no-op');
  assert.match(svc, /fetchGames[\s\S]{0,120}cache: false/);
  assert.match(svc, /sync-latest/);
});

test('a failed game fetch no longer blanks the list', () => {
  /* `setData(null)` on error made a transient blip look like every game had been
     deleted. The list must survive a failed refresh. Scoped to GamesTab. */
  assert.notEqual(gamesTabStart, -1, 'GamesTab must exist');
  assert.ok(!/setData\(null\)/.test(gamesTabSrc),
    'setData(null) on error must be gone from GamesTab');
  assert.match(gamesTabSrc, /setData\(\(prev\) => prev\)/,
    'a failed refresh should keep the previously loaded rows');
});

// ── freshness is visible ───────────────────────────────────────────────────

test('the UI shows when data was last checked, with a time not just a date', () => {
  assert.match(page, /newest_game_ms/, 'the newest stored game must be surfaced');
  assert.match(page, /formatDateTime/);
  /* A date-only "synced 2026-10-02" cannot distinguish a sync this morning from
     one 23 hours ago, which is the whole complaint. */
  const helper = /function formatDateTime[\s\S]*?\n}/.exec(page);
  assert.ok(helper, 'formatDateTime must exist');
  assert.match(helper[0], /min ago/);
  assert.match(helper[0], /hour:/);
});

test('a failed sync leaves an error visible on the account card', () => {
  assert.match(page, /last_error/);
  assert.match(page, /lastError/);
});

test('a sync failure never removes stored games', () => {
  assert.ok(!/DELETE FROM chess_games/.test(page));
});

// ── dates on the profile page ──────────────────────────────────────────────

test('last activity renders as a date, not raw epoch digits', () => {
  /* last_activity_at is a BIGINT of epoch ms. The old code sliced the string,
     so "1790070290" was rendered where a date belonged. */
  assert.ok(!/last_activity_at\.slice\(/.test(page),
    'epoch-ms must not be sliced like an ISO date string');
  assert.match(page, /formatEpochMs\(acct\.last_activity_at\)/);
  assert.match(page, /function formatEpochMs\(ms\)/);
});

test('game dates come from a plain calendar value, not a shifted instant', () => {
  /* The backend now sends game_date as 'YYYY-MM-DD' text. If a raw DATE ever
     comes back as an ISO instant again, formatDate would silently render the
     previous day — which is exactly the bug these tests exist to prevent. */
  assert.match(page, /formatDate\(g\.game_date\)/);
  assert.match(page, /formatDate\(game\.game_date\)/);
  const svcSrc = readFileSync(join(ROOT, '..', 'backend', 'src', 'services', 'unifiedProfileService.js'), 'utf8');
  assert.match(svcSrc, /to_char\(g\.game_date, 'YYYY-MM-DD'\)\s+AS game_date/);
});