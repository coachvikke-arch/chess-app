/**
 * React bridge over the tactics progress store — the only place React and the
 * store meet, exactly as the AI Coach Academy does with its own store.
 *
 * Two things it adds over calling the store directly:
 *   1. A single source of truth. The whole persisted state is read once and held
 *      in `state`, so the list header and the card can never disagree about how
 *      many tactics are solved.
 *   2. Cross-tab consistency. The `storage` event fires in OTHER tabs only,
 *      which is precisely the case worth reacting to.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { TACTIC_COUNT } from '../data';
import {
  emptyState,
  isSolved as solvedIn,
  isViewed as viewedIn,
  loadState,
  markSolvedAndViewed,
  markViewed as viewedState,
  percent as pct,
  resetAll as resetStore,
  solvedCount,
  viewedCount,
} from '../services/tacticsStore';

export default function useTacticsProgress() {
  const { user } = useAuth();
  const [state, setState] = useState(() => loadState(user));

  /* Progress is per user, so switching accounts must not show the previous
     person's ticks. */
  useEffect(() => { setState(loadState(user)); }, [user?.id, user?.userId, user?.name]);

  useEffect(() => {
    function onStorage(e) {
      if (!e.key || !e.key.startsWith('tactics.v1')) return;
      setState(loadState(user));
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [user?.id, user?.userId, user?.name]);

  const markViewed = useCallback((slug) => {
    setState((current) => viewedState(user, current, slug));
  }, [user]);

  const markSolved = useCallback((slug) => {
    setState((current) => markSolvedAndViewed(user, current, slug));
  }, [user]);

  const reset = useCallback(() => {
    setState(resetStore(user));
  }, [user]);

  const view = useMemo(() => ({
    total: TACTIC_COUNT,
    solved: solvedCount(state),
    viewed: viewedCount(state),
    percent: pct(state, TACTIC_COUNT),
    isSolved: (slug) => solvedIn(state, slug),
    isViewed: (slug) => viewedIn(state, slug),
  }), [state]);

  return { ...view, markViewed, markSolved, reset, state };
}

export { emptyState };