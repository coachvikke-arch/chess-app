/* useBotProgress — reactive view of bot progression + Bot Coins.
 *
 * `BotProgressService` is the storage layer and has no React knowledge. This
 * hook is the bridge: it loads a snapshot, exposes it as state, and re-reads
 * after anything that can change it (a finished game, a settings toggle, a
 * server reconcile). Every component that needs "is this bot locked?" or "how
 * many coins?" subscribes here instead of reading localStorage itself, which is
 * what keeps the cards, the profile panel and the reward track in agreement.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getAllProgress,
  getRewardTrack,
  getRewards,
  getSettings,
  getUnlockMap,
  setSetting,
  resetAll,
  totalDefeated,
  defeatedIn,
} from '../services/BotProgressService';
import { getBotById, getBand } from '../data/bots';
import { syncProgress } from '../services/botsApi';

export function useBotProgress({ sync = true } = {}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [progress, setProgress] = useState(() => getAllProgress(user));
  const [rewards, setRewards] = useState(() => getRewards(user));
  const [settings, setSettingsState] = useState(() => getSettings());
  const [syncState, setSyncState] = useState('idle'); // idle | syncing | synced | offline

  /* Keep the latest user in a ref so `refresh` never needs to be memoised
   * against a changing identity (it changes on every /auth/me response). */
  const userRef = useRef(user);
  userRef.current = user;

  const refresh = useCallback(() => {
    const u = userRef.current;
    setProgress(getAllProgress(u));
    setRewards(getRewards(u));
    return true;
  }, []);

  /* Reconcile with the server when signed in. Failure is silent by design: the
   * local cache is a complete, playable mirror of the feature (§25). */
  useEffect(() => {
    let alive = true;
    if (!sync) return undefined;
    if (userId == null) {
      setSyncState('idle');
      return undefined;
    }
    setSyncState('syncing');
    syncProgress(userRef.current).then((ok) => {
      if (!alive) return;
      if (ok) {
        setProgress(getAllProgress(userRef.current));
        setRewards(getRewards(userRef.current));
        setSyncState('synced');
      } else {
        setSyncState('offline');
      }
    });
    return () => {
      alive = false;
    };
  }, [userId, sync]);

  const updateSetting = useCallback(
    (key, value) => {
      const next = setSetting(key, value);
      setSettingsState(next);
      return next;
    },
    [],
  );

  const hardReset = useCallback(() => {
    resetAll(userRef.current);
    refresh();
  }, [refresh]);

  /* Derived views, memoised so cards do not re-render on unrelated updates. */
  const unlockMap = useMemo(() => getUnlockMap(user, rewards), [progress, rewards, userId]);
  const track = useMemo(() => getRewardTrack(user), [rewards, userId]);
  const defeated = useMemo(() => totalDefeated(user), [progress, userId]);
  const byTier = useMemo(() => {
    const out = {};
    for (const band of ['Beginner', 'Casual', 'Intermediate', 'Advanced', 'Expert', 'Master']) {
      out[band] = defeatedIn(band, user);
    }
    return out;
  }, [progress, userId]);

  /** Everything the bot card needs, in one object. */
  const forBot = useCallback(
    (botId) => {
      const bot = getBotById(botId);
      if (!bot) return null;
      const rec = progress[botId] || null;
      const gate = unlockMap[botId] || { unlocked: false, reason: 'Locked' };
      return {
        bot,
        record: rec,
        unlocked: gate.unlocked,
        lockReason: gate.reason,
        defeated: Boolean(rec?.defeated),
        played: Boolean(rec && rec.gamesPlayed > 0),
        gamesPlayed: rec?.gamesPlayed || 0,
        wins: rec?.wins || 0,
        losses: rec?.losses || 0,
        draws: rec?.draws || 0,
        bestAccuracy: rec?.bestAccuracy || 0,
        lastPlayedAt: rec?.lastPlayedAt || null,
        band: getBand(bot.difficulty),
      };
    },
    [progress, unlockMap],
  );

  return {
    user,
    progress,
    rewards,
    track,
    settings,
    unlockMap,
    defeated,
    defeatedByTier: byTier,
    syncState,
    refresh,
    updateSetting,
    reset: hardReset,
    forBot,
  };
}

export default useBotProgress;