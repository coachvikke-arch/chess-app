import { useCallback, useEffect, useRef, useState } from 'react';
import { syncAccountLatest } from '../services/chessProfiles';

/*
 * Automatic Chess.com game synchronisation.
 *
 * Why this exists: the profile page previously called the sync endpoint exactly
 * once, on mount, with an empty dependency array. A game finished while the page
 * sat open therefore never appeared until a manual reload — and Chess.com's
 * monthly archive index (which the old backend path used to decide which month
 * is current) is itself regenerated on a delay, so the most recent game could be
 * missing for hours even right after a "sync".
 *
 * This hook owns three concerns the page should not:
 *   1. AUTH GATING — nothing fires until the auth state has resolved. Syncing as
 *      a not-yet-hydrated user would either 401 or, worse, bind another
 *      account's token.
 *   2. POLLING — an interval, paused while the tab is hidden and resumed (with
 *      an immediate check) when it comes back. A poll is one POST per connected
 *      account, and the backend fetches only the current month.
 *   3. FAILURE ISOLATION — one account's rate-limit must not abort the others,
 *      and a failed poll must leave the previously loaded accounts and games
 *      exactly as they were. Nothing is cleared on error.
 */

/* Comfortably longer than Chess.com's archive refresh delay, and cheap: each
   poll is one current-month request per account. */
export const DEFAULT_POLL_MS = 120000;

/** Minimum gap between polls, so a tab that regains focus repeatedly cannot
    turn into a request burst. */
const MIN_GAP_MS = 30000;

function nowMs() {
  return Date.now();
}

/** Default per-account sync call. Overridable so the hook's own logic can be
    tested without a network. */
let syncImpl = (id) => syncAccountLatest(id);
export function __setSyncImpl(fn) { syncImpl = fn; }

import { POLLED_PLATFORMS, accountsToPoll, isSyncReady, triagePoll } from './accountSyncLogic';

export { POLLED_PLATFORMS, accountsToPoll, isSyncReady, triagePoll };

export default function useAccountSync({
  accounts,
  loadAccounts,
  onNewGames,
  onSynced,
  authLoading = false,
  user = null,
  enabled = true,
  pollMs = DEFAULT_POLL_MS,
}) {
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [lastError, setLastError] = useState('');
  const [checking, setChecking] = useState(false);

  /* Refs, not state: the interval callback must always see the latest accounts
     without being torn down and re-created on every render. */
  const accountsRef = useRef(accounts);
  const lastRunRef = useRef(0);
  const runIdRef = useRef(0);
  const onNewGamesRef = useRef(onNewGames);
  const onSyncedRef = useRef(onSynced);
  const loadAccountsRef = useRef(loadAccounts);

  accountsRef.current = accounts;
  onNewGamesRef.current = onNewGames;
  onSyncedRef.current = onSynced;
  loadAccountsRef.current = loadAccounts;

  /* One poll pass over every polled account (Chess.com only — see
     POLLED_PLATFORMS). Never throws. */
  const poll = useCallback(async (sync) => {
    const list = accountsToPoll(accountsRef.current);
    if (!list.length) return { newGames: 0, checked: 0 };

    const myRun = ++runIdRef.current;
    setChecking(true);
    lastRunRef.current = nowMs();

    try {
      // One failing account must not cancel the rest, and a 429 on one platform
      // must not look like "no new games".
      const results = await Promise.allSettled(list.map((a) => sync(a.id)));
      if (myRun !== runIdRef.current) return { newGames: 0, checked: 0 }; // superseded

      const v = triagePoll(results);

      if (v.refresh) {
        try { await loadAccountsRef.current?.(); } catch { /* keep old state */ }
      }
      if (v.announce) onNewGamesRef.current?.(v.newGames);
      /* Every completed check can have refreshed ratings server-side, even
         when no game was new (a re-read of /stats). The page uses this to
         re-pull the current/best cards and the history chart in place. */
      onSyncedRef.current?.({ newGames: v.newGames, checked: v.checked, failures: v.failures });

      setLastError(v.failures.length ? v.failures[0] : '');
      /* "Last checked" is when we last looked, which is true whether or not the
         look succeeded — it is not a claim that everything loaded. The separate
         lastError says which. Conflating the two is what made a stale sync look
         fresh. */
      setLastSyncedAt(new Date().toISOString());
      return { newGames: v.newGames, checked: v.checked };
    } finally {
      if (myRun === runIdRef.current) setChecking(false);
    }
  }, []);

  /* The auth gate. `ready` is false while loading, while signed out, and
     while there are no accounts — so no request can be attributed to an
     unresolved identity. */
  const ready = isSyncReady({ enabled, authLoading, user, accounts });

  useEffect(() => {
    if (!ready) return undefined;

    // Immediate check on becoming ready, so a game finished a minute ago shows
    // up as the page opens rather than after the first interval.
    poll(syncImpl);

    const id = setInterval(() => poll(syncImpl), pollMs);
    return () => clearInterval(id);
    // Re-runs when readiness changes (auth resolves, first account connected).
  }, [ready, pollMs, poll]);

  /* Resume on visibility: a tab left open in the background has an interval
     that the browser throttled, so check as soon as the user comes back —
     rate-limited by MIN_GAP_MS so a rapid tab switch cannot spam the API. */
  useEffect(() => {
    if (!ready) return undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (nowMs() - lastRunRef.current < MIN_GAP_MS) return;
      poll(syncImpl);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [ready, poll]);

  return { poll, checking, lastSyncedAt, lastError, ready };
}
