import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { useAuth } from './AuthContext';
import { applyNavOrder } from '../utils/navOrder';

const SidebarOrderContext = createContext(null);

/** How often to re-read the order while the app is open, so a Super Admin's
 *  change reaches everyone else without a re-login. Matches PermissionContext. */
const POLL_MS = 60_000;

const EMPTY = { admin: {}, student: {} };
const MENUS = ['admin', 'student'];

/**
 * Merge the rank tables in an API response into the current state.
 *
 * A WRITE only echoes the menu it changed (`orders: { admin: … }`), so this
 * overwrites just the menus present in the response. Rebuilding both menus from
 * scratch instead would silently reset the other menu's order — saving the admin
 * menu would wipe the student menu on the Super Admin's own client.
 */
function mergeRanks(previous, data) {
  const orders = data?.orders;
  if (!orders || typeof orders !== 'object') return previous;
  const next = { ...previous };
  let touched = false;
  for (const menu of MENUS) {
    const table = orders[menu];
    if (table && typeof table === 'object' && !Array.isArray(table)) {
      next[menu] = table;
      touched = true;
    }
  }
  return touched ? next : previous;
}

/**
 * Holds the nav order chosen by the Super Admin.
 *
 * The order is global, so it is fetched once for the whole app and every nav —
 * the desktop rail, the phone menu, and the student's menu — sorts itself from
 * the same value. That is what keeps a Super Admin's change consistent across
 * all four render sites instead of drifting between them.
 *
 * A failed read deliberately keeps the last known order (or the code order): a
 * nav that renders in the wrong sequence is a nuisance, but throwing away a
 * working menu because one poll failed would be worse.
 */
export function SidebarOrderProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const [ranks, setRanks] = useState(EMPTY);

  const load = useCallback(async () => {
    if (!user) {
      setRanks(EMPTY);
      return;
    }
    try {
      /* cache: false — the 30s GET cache would otherwise hold a stale order for
         a user who has just been reordered by someone else. */
      const res = await api.get('/sidebar', { cache: false });
      setRanks((prev) => mergeRanks(prev, res.data));
    } catch {
      /* keep the current order */
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return undefined;
    load();
  }, [authLoading, load]);

  /* Live refresh: poll while signed in, and re-read when the tab regains focus
     so a change made in another tab appears promptly. */
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

  /** The given nav list, sorted into the order every user now sees. */
  const orderFor = useCallback((menu, links) => applyNavOrder(links, ranks[menu]), [ranks]);

  /* The write side. Both update local state from the server's response rather
     than from the optimistic value, so a rejected write cannot leave the Super
     Admin looking at an order that was never saved. */
  const saveOrder = useCallback(async (menu, keys) => {
    const res = await api.put('/sidebar/order', { menu, keys });
    setRanks((prev) => mergeRanks(prev, res.data));
  }, []);

  const resetOrder = useCallback(async (menu) => {
    const res = await api.post('/sidebar/order/reset', { menu });
    setRanks((prev) => mergeRanks(prev, res.data));
  }, []);

  const value = useMemo(
    () => ({ ranks, orderFor, saveOrder, resetOrder, refresh: load }),
    [ranks, orderFor, saveOrder, resetOrder, load],
  );

  return <SidebarOrderContext.Provider value={value}>{children}</SidebarOrderContext.Provider>;
}

export const useSidebarOrder = () => useContext(SidebarOrderContext) ?? {
  ranks: EMPTY,
  orderFor: (_menu, links) => (Array.isArray(links) ? links : []),
  saveOrder: async () => {},
  resetOrder: async () => {},
  refresh: () => {},
};
