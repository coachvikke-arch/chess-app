/*
 * Pure decision logic for the automatic Chess.com game-sync loop.
 *
 * Kept in its own module — with no React and no service imports — so the
 * interesting cases can be tested directly. The failure that matters most
 * (a partial result being reported as a clean check) is invisible from the
 * source text alone: it only shows up when you feed real inputs through.
 */

/** Accounts this hook polls. */
export const POLLED_PLATFORMS = ['chess.com'];

/**
 * Which accounts a poll pass should touch.
 * Chess.com's monthly archive index can lag the direct endpoint, which is the
 * defect this work set out to fix. Lichess's feed is already incremental, so
 * polling it would spend requests and change behaviour that is working.
 */
export function accountsToPoll(accounts) {
  return Array.isArray(accounts)
    ? accounts.filter((a) => POLLED_PLATFORMS.includes(a.platform))
    : [];
}

/**
 * The auth gate. Falsy while loading, while signed out, or before any account
 * exists — so no request can be attributed to an unresolved identity.
 */
export function isSyncReady({ enabled = true, authLoading = false, user = null, accounts = null } = {}) {
  return Boolean(enabled) && !authLoading && !!user && Array.isArray(accounts) && accounts.length > 0;
}

/**
 * Triage a poll pass. Deliberately the ONLY place that decides what "this poll
 * did" means; the React effect just applies the verdict.
 *
 * @param results  Promise.allSettled output, one entry per polled account
 * @returns {{ newGames: number, checked: number, failures: string[], refresh: boolean, announce: boolean }}
 */
export function triagePoll(results) {
  let newGames = 0;
  const failures = [];

  for (const r of results) {
    if (!r || r.status !== 'fulfilled') {
      failures.push(
        r?.reason?.response?.data?.message || r?.reason?.message || 'sync failed',
      );
      continue;
    }
    /* Number(...) rather than +, so a missing newGames reads as 0 instead of
       turning the total into NaN. */
    newGames += Number(r.value?.newGames || 0);

    /* A fulfilled-but-partial response (some months rate-limited) is a SOFT
       failure: the backend kept the data it loaded and said so in `note`. If a
       fulfilled response were treated as automatically clean, the user would be
       told "up to date" while a whole month of games was never read — the exact
       symptom this work exists to remove. */
    if (r.value?.partial && r.value.note) failures.push(r.value.note);
  }

  return {
    newGames,
    checked: results.length,
    failures,
    /* Re-read the account list when anything landed, and also on a fully clean
       no-op pass. Keying this on newGames alone left last_synced_at stale on the
       cards, and dropped the refresh entirely whenever any account failed. */
    refresh: newGames > 0 || failures.length === 0,
    announce: newGames > 0,
  };
}