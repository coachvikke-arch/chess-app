/* Bot progress + reward services.
 *
 * WHY THIS IS ENCAPSULATED: progression is the one part of a bot game that must
 * not live inside a React component. Keeping every read/write behind a service
 * means the storage medium can change without touching the UI — which is
 * exactly the migration path this project needs (localStorage today,
 * `user_bot_progress` / `user_bot_rewards` tables tomorrow).
 *
 * STORAGE
 *   Keys are namespaced PER USER (`local:<id>` / `remote:<id>`), so two accounts
 *   signed into the same browser never share progress, and clearing one does
 *   not wipe the other. The signed-in user's `users.id` is used; a guest gets a
 *   stable generated id.
 *
 * AUTHORITY
 *   When signed in, the server is authoritative for coins and defeat counts
 *   (§27: never trust client values for real rewards). The local cache is a
 *   fast mirror that makes the UI work offline, and the server response always
 *   overwrites it. Every write is idempotent — replaying the same finished game
 *   cannot double-credit.
 */

import {
  BOTS,
  DIFFICULTY_BANDS,
  getBand,
  getBotById,
  getUnlockSource,
} from '../data/bots';

const PROGRESS_KEY = 'chess_bot_progress';
const REWARDS_KEY = 'chess_bot_rewards';
const SETTINGS_KEY = 'chess_bot_settings';
const GUEST_KEY = 'chess_bot_guest_id';

/* ── Reward configuration ───────────────────────────────────────────────── */

/** Bot Coins for a win, by difficulty tier. */
export const COIN_REWARDS = Object.freeze(
  Object.fromEntries(DIFFICULTY_BANDS.map((b) => [b.id, b.winCoins])),
);

/** A draw pays half of the win value, rounded down. Loss pays nothing. */
export function coinsForResult(difficulty, result) {
  const full = COIN_REWARDS[difficulty] ?? 0;
  if (result === 'win') return full;
  if (result === 'draw') return Math.floor(full / 2);
  return 0;
}

/**
 * Milestone track. Total = the ceiling shown on the progress bar, so the bar's
 * denominator and the reward track can never drift apart.
 *
 * There are three rungs, not five. The track used to end with two SPECIAL BOTS
 * gated behind coins (Kai at 100, Omega at 125), which is what gave the reward
 * bar a purpose in-game. When the unlock ladder was removed those two gates went
 * with it and the top of the track settled back to 75 — the last cosmetic
 * unlock. Kai and Omega are ordinary Advanced / Master bots now and are marked
 * as such by nothing in particular.
 */
export const REWARD_MILESTONES = Object.freeze([
  { coins: 25, id: 'avatar_ember', label: 'Ember Avatar Frame', kind: 'avatar' },
  { coins: 50, id: 'boardtheme_moss', label: 'Mossvale Board Theme', kind: 'board_theme', value: 'sage-garden' },
  { coins: 75, id: 'piecetheme_neon', label: 'Neon Byte Piece Set', kind: 'piece_theme', value: '8bit' },
]);

export const COIN_TRACK_TOTAL = REWARD_MILESTONES[REWARD_MILESTONES.length - 1].coins;

/* ── Low-level storage (namespaced + corruption-safe) ───────────────────── */

function safeParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function readStore(key) {
  try {
    return safeParse(localStorage.getItem(key), {});
  } catch {
    return {};
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    /* Private-mode / quota-exceeded. The feature stays usable in memory for
     * this session; progress simply will not persist. */
    return false;
  }
}

/** Stable per-visitor id used when nobody is signed in. */
export function guestId() {
  try {
    let id = localStorage.getItem(GUEST_KEY);
    if (!id) {
      id = `guest_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(GUEST_KEY, id);
    }
    return id;
  } catch {
    return 'guest_anonymous';
  }
}

/**
 * The identity progress is filed under. Passing the signed-in user keeps two
 * accounts apart; omitting it falls back to the browser guest.
 */
export function scopeFor(user) {
  return user && user.id != null ? `local:${user.id}` : guestId();
}

/* ── Progress records ───────────────────────────────────────────────────── */

export function emptyProgress(botId) {
  return {
    botId,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    defeated: false,
    bestAccuracy: 0,
    lastPlayedAt: null,
  };
}

function allProgress(scope) {
  return readStore(PROGRESS_KEY)[scope] || {};
}

function saveProgress(scope, records) {
  const store = readStore(PROGRESS_KEY);
  store[scope] = records;
  writeStore(PROGRESS_KEY, store);
  return records;
}

/** Every bot's record for the scope, defaults filled in. */
export function getAllProgress(user) {
  const scope = scopeFor(user);
  const stored = allProgress(scope);
  const out = {};
  for (const bot of BOTS) {
    out[bot.id] = { ...emptyProgress(bot.id), ...(stored[bot.id] || {}) };
  }
  return out;
}

export function getBotProgress(botId, user) {
  const bot = getBotById(botId);
  if (!bot) return null;
  const records = getAllProgress(user);
  return records[botId] || emptyProgress(botId);
}

/* ── Unlock ladder ──────────────────────────────────────────────────────── */

/** Bots defeated in one specific tier. */
export function defeatedIn(difficulty, user) {
  const records = getAllProgress(user);
  return BOTS.filter(
    (b) => b.group === difficulty && records[b.id] && records[b.id].defeated,
  ).length;
}

export function totalDefeated(user) {
  const records = getAllProgress(user);
  return Object.values(records).filter((r) => r.defeated).length;
}

/**
 * Whether `difficulty` is unlocked.
 *
 * Always true since the ladder was removed — every tier declares
 * `requiresDefeats: 0`. The counting is left in place so that re-gating a tier
 * is a data change, not a reimplementation: set `requiresDefeats` on its band
 * and this starts enforcing it again, with no other edit required.
 */
export function isDifficultyUnlocked(difficulty, user) {
  const band = getBand(difficulty);
  if (band.requiresDefeats <= 0) return true;
  const source = getUnlockSource(difficulty);
  if (!source) return true;
  return defeatedIn(source, user) >= band.requiresDefeats;
}

/**
 * Whether one specific bot is playable.
 *
 * With the unlock ladder gone, every tier is open and no bot is gated behind
 * Bot Coins, so this is true for any bot in the catalogue. The tier gate is
 * still consulted rather than assumed, because it is the ONE place that reads
 * DIFFICULTY_BANDS: if a tier is ever gated again, this function is where it
 * starts mattering, and it must not have to be rediscovered.
 *
 * `rewards` is accepted (and ignored) because every caller already holds it —
 * `getUnlockMap` and `useBotProgress` pass it through — and dropping the
 * parameter would mean touching those call sites for no behaviour change.
 */
export function isBotUnlocked(botOrId, user, rewards) {
  const bot = typeof botOrId === 'string' ? getBotById(botOrId) : botOrId;
  if (!bot) return false;
  return isDifficultyUnlocked(bot.difficulty, user);
}

/**
 * Human-readable explanation of what is locking a bot, for tooltips + a11y.
 *
 * Nothing is locked any more, so this always returns null. Kept rather than
 * deleted because BotCard takes `lockReason` as a prop and renders it for
 * assistive tech — removing the function would leave that prop permanently
 * empty strings with no explanation of why.
 */
export function lockReason(bot, user) {
  if (isBotUnlocked(bot, user)) return null;
  const source = getUnlockSource(bot.difficulty);
  if (source) {
    const band = getBand(bot.difficulty);
    const have = defeatedIn(source, user);
    if (have < band.requiresDefeats) {
      return `Defeat ${band.requiresDefeats - have} more ${source.toLowerCase()} ${source.toLowerCase() === 'beginner' || source.toLowerCase() === 'casual' ? 'bot' : 'bots'} to unlock`;
    }
  }
  return 'Locked';
}

/** Bulk unlock map for the selection page: botId -> { unlocked, reason }. */
export function getUnlockMap(user, rewards) {
  const out = {};
  for (const bot of BOTS) {
    const unlocked = isBotUnlocked(bot, user, rewards);
    out[bot.id] = { unlocked, reason: unlocked ? null : lockReason(bot, user) };
  }
  return out;
}

/* ── Recording a result ─────────────────────────────────────────────────── */

/**
 * Fold one finished game into progress + rewards.
 *
 * `gameId` is the idempotency key. Re-recording the same game (double submit,
 * refresh-replay, React StrictMode double effect) is a no-op, so coins can
 * never be farmed by resubmitting. Returns what actually changed, so the caller
 * can tell the difference between "credited" and "already credited".
 */
export function recordResult({ botId, result, user, gameId, playerAccuracy = 0 }) {
  const bot = getBotById(botId);
  if (!bot) return null;

  const scope = scopeFor(user);
  const store = readStore(PROGRESS_KEY);
  const scopeRecord = store[scope] || {};
  const seen = Array.isArray(scopeRecord.__seen) ? scopeRecord.__seen : [];
  const key = gameId || `${botId}:${Date.now()}`;

  if (seen.includes(key)) {
    return { duplicate: true, coinsEarned: 0, coins: getRewards(user).coins, progress: getBotProgress(botId, user) };
  }
  seen.push(key);
  /* Bound the dedupe list so the key cannot grow without limit. */
  scopeRecord.__seen = seen.slice(-200);

  const prev = { ...emptyProgress(botId), ...(scopeRecord[botId] || {}) };
  const next = {
    botId,
    gamesPlayed: prev.gamesPlayed + 1,
    wins: prev.wins + (result === 'win' ? 1 : 0),
    losses: prev.losses + (result === 'loss' ? 1 : 0),
    draws: prev.draws + (result === 'draw' ? 1 : 0),
    /* A draw against a bot counts as "handled" but NOT as defeated, otherwise
     * the ladder could be satisfied without ever winning. */
    defeated: prev.defeated || result === 'win',
    bestAccuracy: Math.max(prev.bestAccuracy || 0, Math.round(playerAccuracy || 0)),
    lastPlayedAt: Date.now(),
  };
  scopeRecord[botId] = next;
  saveProgress(scope, scopeRecord);

  const coinsEarned = coinsForResult(bot.difficulty, result);
  const rewards = addCoins(coinsEarned, user);

  return {
    duplicate: false,
    coinsEarned,
    coins: rewards.coins,
    progress: next,
    milestones: rewards.newlyUnlocked,
  };
}

/* ── Bot Coins ──────────────────────────────────────────────────────────── */

function emptyRewards() {
  return { coins: 0, unlockedRewards: [], totalEarned: 0 };
}

export function getRewards(user) {
  const scope = scopeFor(user);
  const stored = readStore(REWARDS_KEY)[scope] || {};
  return { ...emptyRewards(), ...stored, unlockedRewards: stored.unlockedRewards || [] };
}

/**
 * Add coins and auto-claim any milestone the balance now reaches.
 * `totalEarned` only ever goes up, which is what the bar animates against.
 */
export function addCoins(amount, user) {
  const scope = scopeFor(user);
  const store = readStore(REWARDS_KEY);
  const cur = { ...emptyRewards(), ...(store[scope] || {}) };
  const unlocked = Array.isArray(cur.unlockedRewards) ? cur.unlockedRewards : [];

  const before = cur.coins;
  const coins = Math.max(0, before + Number(amount || 0));
  const totalEarned = Math.max(cur.totalEarned || 0, coins);

  const newlyUnlocked = REWARD_MILESTONES.filter(
    (m) => coins >= m.coins && !unlocked.includes(m.id),
  ).map((m) => m.id);
  const merged = [...unlocked, ...newlyUnlocked];

  const next = { coins, totalEarned, unlockedRewards: merged };
  store[scope] = next;
  writeStore(REWARDS_KEY, store);

  return { ...next, before, newlyUnlocked };
}

/** Progress + milestone state for the reward track. */
export function getRewardTrack(user) {
  const rewards = getRewards(user);
  const next = REWARD_MILESTONES.find((m) => rewards.coins < m.coins) || null;
  return {
    coins: rewards.coins,
    total: COIN_TRACK_TOTAL,
    milestones: REWARD_MILESTONES.map((m) => ({
      ...m,
      unlocked: rewards.unlockedRewards.includes(m.id),
      reached: rewards.coins >= m.coins,
    })),
    next,
  };
}

/* ── Settings ───────────────────────────────────────────────────────────── */

const DEFAULT_SETTINGS = {
  botChat: true,
  showCoordinates: true,
  showLegalMoves: true,
  soundEnabled: true,
  /** When false the opponent's clock keeps running through the thinking delay. */
  pauseClockWhileThinking: false,
};

export function getSettings() {
  const store = readStore(SETTINGS_KEY);
  const cur = store.settings || {};
  return { ...DEFAULT_SETTINGS, ...cur };
}

export function setSetting(key, value) {
  const store = readStore(SETTINGS_KEY);
  const cur = { ...DEFAULT_SETTINGS, ...(store.settings || {}) };
  if (!(key in DEFAULT_SETTINGS)) return cur;
  cur[key] = value;
  store.settings = cur;
  writeStore(SETTINGS_KEY, store);
  return cur;
}

/* ── Server reconciliation ──────────────────────────────────────────────── */

/**
 * Merge an authoritative server snapshot over the local mirror.
 *
 * Coins take the server value outright (never `local + server`, which would
 * double-count). Per-bot counters take the server's when present because the
 * server owns defeat flags — that is what actually gates progression.
 */
export function mergeServerState(user, snapshot) {
  if (!snapshot || !user) return null;
  const scope = scopeFor(user);

  if (snapshot.rewards && typeof snapshot.rewards.coins === 'number') {
    const store = readStore(REWARDS_KEY);
    store[scope] = {
      coins: snapshot.rewards.coins,
      totalEarned: Math.max(
        snapshot.rewards.totalEarned ?? snapshot.rewards.coins,
        (store[scope] || {}).totalEarned || 0,
      ),
      /* The server names this `claimedRewards`; the local cache calls it
         `unlockedRewards`. Accept either so a rename on one side cannot silently
         drop every claimed milestone. */
      unlockedRewards: Array.isArray(snapshot.rewards.claimedRewards)
        ? snapshot.rewards.claimedRewards
        : Array.isArray(snapshot.rewards.unlockedRewards)
          ? snapshot.rewards.unlockedRewards
          : (store[scope] || {}).unlockedRewards || [],
    };
    writeStore(REWARDS_KEY, store);
  }

  /* The server keys progress by bot id, so it may send either the keyed object
   * `{ pip: {...} }` (a full snapshot) or an array of `{ botId, ... }` rows.
   * Both are accepted; anything else is ignored rather than wiping the cache. */
  const rows = Array.isArray(snapshot.progress)
    ? snapshot.progress
    : snapshot.progress && typeof snapshot.progress === 'object'
      ? Object.entries(snapshot.progress).map(([botId, rec]) => ({ botId, ...(rec || {}) }))
      : null;

  if (rows) {
    const store = readStore(PROGRESS_KEY);
    const scopeRecord = store[scope] || {};
    for (const row of rows) {
      if (!row || !row.botId) continue;
      if (!getBotById(row.botId)) continue; // ignore unknown/removed bot ids
      /* Spreading the server row LAST is deliberate: the server is authoritative
       * for a signed-in account, so a stale local `defeated` flag cannot survive
       * a reset made on another device. Counts fall back to the local ones when
       * the server omits a field. */
      scopeRecord[row.botId] = { ...emptyProgress(row.botId), ...scopeRecord[row.botId], ...row };
    }
    saveProgress(scope, scopeRecord);
  }

  return true;
}

/* ── Reset (dev/settings) ───────────────────────────────────────────────── */

export function resetAll(user) {
  const scope = scopeFor(user);
  const p = readStore(PROGRESS_KEY);
  delete p[scope];
  writeStore(PROGRESS_KEY, p);
  const r = readStore(REWARDS_KEY);
  delete r[scope];
  writeStore(REWARDS_KEY, r);
}

export const BotProgressService = {
  COIN_REWARDS,
  REWARD_MILESTONES,
  COIN_TRACK_TOTAL,
  coinsForResult,
  scopeFor,
  emptyProgress,
  getAllProgress,
  getBotProgress,
  defeatedIn,
  totalDefeated,
  isDifficultyUnlocked,
  isBotUnlocked,
  lockReason,
  getUnlockMap,
  recordResult,
  getRewards,
  addCoins,
  getRewardTrack,
  getSettings,
  setSetting,
  mergeServerState,
  resetAll,
};

export default BotProgressService;