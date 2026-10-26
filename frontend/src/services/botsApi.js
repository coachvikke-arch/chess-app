/* Bot progression API — optional server sync.
 *
 * The whole bot feature works offline (§25), so nothing in the game itself
 * depends on this file succeeding. It is a MIRROR: the local cache renders the
 * UI instantly, and when the user is signed in we reconcile with the server,
 * which owns coins and defeat flags for real accounts (§27).
 *
 * Every call is failure-tolerant by design. A 404 (migrations not applied), a
 * 401 (session expired), or no backend at all all resolve quietly to `null` so
 * the caller keeps using the local cache instead of surfacing an error.
 */

import api from './api';
import { getBotGameContext } from '../utils/botGameContext';
import {
  scopeFor,
  getAllProgress,
  getRewards,
  mergeServerState,
  recordResult as recordLocal,
} from './BotProgressService';
import { getBotById } from '../data/bots';

/** True when there is a usable session to sync against. */
function canSync(user) {
  return Boolean(user && user.id != null && localStorage.getItem('token'));
}

/**
 * Fetch the server's authoritative progress snapshot and merge it locally.
 * Resolves to true when the merge happened, false when sync was skipped/failed.
 */
export async function syncProgress(user) {
  if (!canSync(user)) return false;
  try {
    const res = await api.get('/bots/progress', { cache: false });
    return Boolean(mergeServerState(user, res.data));
  } catch {
    return false;
  }
}

/**
 * Report a finished game to the server.
 *
 * The server re-derives the coin award from the bot id and the result — it does
 * NOT trust a client-sent amount — and de-duplicates on `gameId`, so a replayed
 * or double-submitted game cannot be credited twice.
 *
 * Resolves to `{ coins, progress }` on success or null when offline; the caller
 * falls back to the local record in that case.
 */
export async function submitResult({ bot, result, user, gameId, accuracy = 0, plies = 0 }) {
  const local = recordLocal({ botId: bot?.id, result, user, gameId, playerAccuracy: accuracy });

  if (!canSync(user) || !bot) return local;

  /* If a classroom is open in this browser, attribute the game to it so the
     coins can count on that class's leaderboard. Purely a hint - the server
     verifies membership and drops it otherwise, and omitting it entirely just
     means the game counts for the arena only. */
  const classContext = getBotGameContext();

  /* The server re-derives the tier from the bot id, so `difficulty` is advisory.
     It is still sent so a server with a stale roster can log the mismatch. */
  try {
    const res = await api.post(
      '/bots/result',
      {
        botId: bot.id,
        difficulty: bot.difficulty,
        result, // 'win' | 'loss' | 'draw'
        gameId: String(gameId || '').slice(0, 64),
        accuracy: Math.round(Number(accuracy) || 0),
        plies: Math.max(0, Math.round(Number(plies) || 0)),
        ...(classContext ? { classId: classContext.classId } : {}),
      },
      { cache: false },
    );
    const data = res.data || {};
    /* The server has the final say on coins and defeats. */
    mergeServerState(user, { rewards: data.rewards, progress: data.progress });
    return {
      duplicate: false,
      coinsEarned: Number(data.coinsEarned ?? local?.coinsEarned ?? 0),
      coins: Number(data.rewards?.coins ?? local?.coins ?? 0),
      milestones: data.newlyUnlockedRewards || [],
      progress: getAllProgress(user)[bot.id] || local?.progress || null,
      synced: true,
    };
  } catch {
    /* Offline / server error: the local record already stands. */
    return { ...local, synced: false };
  }
}

/**
 * Report a finished game WITHOUT touching local storage.
 *
 * Used by the analysis page and any read-only view that must not be able to
 * mutate progression by accident.
 */
export async function getSummary(user) {
  if (!canSync(user)) return null;
  try {
    const res = await api.get('/bots/summary', { cache: false });
    return res.data;
  } catch {
    return null;
  }
}

/** Validate a bot id against the server roster before starting a game. */
export async function verifyBot(botId) {
  const local = getBotById(botId);
  if (!local) return null;
  if (!localStorage.getItem('token')) return local;
  try {
    const res = await api.get(`/bots/${encodeURIComponent(botId)}`, { cache: false });
    return res.data?.bot || local;
  } catch {
    return local;
  }
}

export const botsApi = {
  syncProgress,
  submitResult,
  getSummary,
  verifyBot,
  scopeFor,
};

export default botsApi;