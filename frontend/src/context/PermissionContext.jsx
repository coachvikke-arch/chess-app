import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { useAuth } from './AuthContext';

const PermissionContext = createContext(null);

/** How often to re-check permissions while the app is open, so a Super Admin's
 *  change applies without forcing a re-login. */
const POLL_MS = 60_000;

/**
 * Holds the signed-in user's enabled feature keys.
 *
 * `ungated` short-circuits everything: a Super Admin is never gated, so the
 * client can skip per-key checks entirely. While loading we fail CLOSED —
 * `can()` returns false — so gated UI never flashes into view before the real
 * answer arrives.
 */
export function PermissionProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const [features, setFeatures] = useState(null); // null = not resolved yet
  const [ungated, setUngated] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      setFeatures([]);
      setUngated(false);
      return;
    }
    try {
      /* `cache: false` is load-bearing. `api` memoises GETs for 30s, so a plain
         get here could hand back the permission list captured BEFORE a Super
         Admin flipped a switch — the poll would succeed, return the old answer,
         and the change would look like it had not saved. Permissions are small
         and read on every focus change, so they are never worth memoising. */
      const res = await api.get('/permissions/me', { cache: false });
      const list = Array.isArray(res.data?.features) ? res.data.features : [];
      setFeatures(list);
      setUngated(Boolean(res.data?.ungated) || list.includes('*'));
    } catch {
      /* Fail closed: an unreachable permissions endpoint must not silently
         unlock the whole app. */
      setFeatures([]);
      setUngated(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return undefined;
    load();
  }, [authLoading, load]);

  /* Live refresh: poll while signed in, and refresh when the tab regains focus
     so a change made in another tab is picked up promptly. */
  useEffect(() => {
    if (!user) return undefined;
    const id = setInterval(load, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user, load]);

  const can = useCallback(
    (key) => {
      if (ungated) return true;
      if (!features) return false; // still resolving -> deny
      return features.includes(key);
    },
    [features, ungated],
  );

  const value = useMemo(
    () => ({
      features: features ?? [],
      ungated,
      loading: !features,
      can,
      refresh: load,
    }),
    [features, ungated, can, load],
  );

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export const usePermissions = () => useContext(PermissionContext) ?? {
  features: [],
  ungated: false,
  loading: true,
  can: () => false,
  refresh: () => {},
};
