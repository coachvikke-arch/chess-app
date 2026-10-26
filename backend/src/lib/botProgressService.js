/* Bot progression service — server-side authority for signed-in students.
 *
 * The client mirror (frontend/src/services/botsApi.js) is failure-tolerant by
 * design: the whole feature works offline. This module is the opposite. It is
 * the record that survives clearing localStorage or switching devices, and it
 * re-derives every number from the request rather than trusting the client.
 *
 * The ladder and coin values are DECLARED here rather than imported from the
 * frontend catalogue, because the catalogue is a client bundle and cannot be
 * required from Node. `scripts/bot-progression.test.mjs` (frontend) and
 * `scripts/bot-progress-api.test.mjs` (backend) both assert these constants
 * match the catalogue, so the two cannot drift silently.
 */

const db = require('../config/database');

/* Keep in sync with DIFFICULTY_BANDS in frontend/src/data/bots.ts. */
const BOT_DIFFICULTIES = ['Beginner', 'Casual', 'Intermediate', 'Advanced', 'Expert', 'Master'];

const COINS_PER_WIN = {
  Beginner: 5,
  Casual: 8,
  Intermediate: 12,
  Advanced: 20,
  Expert: 30,
  Master: 50,
};

/* A draw pays half the tier's win value; a loss pays nothing. */
const DRAW_MULTIPLIER = 0.5;

/* Three cosmetic unlocks, matching the frontend track. The two coin-gated
   SPECIAL BOTS that used to sit at 100 and 125 were removed along with the
   tier ladder, so the top of the track is now 75. */
const REWARD_MILESTONES = [25, 50, 75];

/* Which tier must be beaten N times to open the next one. Empty: the ladder was
   removed, so every tier is open from the first visit. Kept as a declared
   constant rather than deleted so the frontend and the backend can both assert
   "there is no ladder" instead of one side having nothing to compare. */
const UNLOCK_LADDER = {};

/* Bots anyone may face from the start. All of them, for the same reason. */
const FREE_DIFFICULTIES = BOT_DIFFICULTIES;

function isValidDifficulty(value) {
  return BOT_DIFFICULTIES.includes(value);
}

function isValidResult(value) {
  return value === 'win' || value === 'loss' || value === 'draw';
}

/**
 * Coins for one game. A draw is worth half, rounded down so the server can
 * never be talked into paying more than the client believes it should.
 */
function coinsFor(difficulty, result) {
  const win = COINS_PER_WIN[difficulty];
  if (win == null) return 0;
  if (result === 'win') return win;
  if (result === 'draw') return Math.floor(win * DRAW_MULTIPLIER);
  return 0;
}

/**
 * Full authoritative snapshot in the shape `mergeServerState` expects:
 * `{ progress: { <botId>: {...} }, rewards: { coins, claimedRewards: [...] } }`.
 *
 * Called with the roster of known bot ids so a client that has never played a
 * given bot still receives a `defeated: false` entry — otherwise a stale local
 * "defeated" flag would survive a server-side reset.
 */
async function getSnapshot(userId, botIds = []) {
  const [progressRows, rewardRow, unlockRows] = await Promise.all([
    db.query(
      'SELECT bot_id, difficulty, defeated, games_won, games_lost, games_drawn, best_accuracy, last_played_at FROM bot_progress WHERE student_user_id = $1',
      [userId]
    ),
    db.query('SELECT coins FROM bot_rewards WHERE student_user_id = $1', [userId]),
    db.query('SELECT milestone_coins FROM bot_reward_unlocks WHERE student_user_id = $1 ORDER BY milestone_coins', [userId])
  ]);

  const byBot = new Map(progressRows.rows.map((r) => [r.bot_id, r]));

  const progress = {};
  for (const id of botIds) {
    const row = byBot.get(id);
    progress[id] = {
      defeated: Boolean(row?.defeated),
      gamesWon: Number(row?.games_won ?? 0),
      gamesLost: Number(row?.games_lost ?? 0),
      gamesDrawn: Number(row?.games_drawn ?? 0),
      bestAccuracy: row?.best_accuracy == null ? null : Number(row.best_accuracy),
      lastPlayedAt: row?.last_played_at ?? null,
    };
  }

  const rewards = {
    coins: Number(rewardRow.rows[0]?.coins ?? 0),
    claimedRewards: unlockRows.rows.map((r) => Number(r.milestone_coins)),
  };

  return { progress, rewards };
}

/**
 * Record one finished game. Idempotent on `gameId`.
 *
 * The order matters: the ledger row is inserted FIRST, and its
 * `ON CONFLICT DO NOTHING` result decides whether this is a first time award.
 * Doing it the other way round would let two concurrent requests both credit
 * coins before either noticed the other.
 *
 * Returns `{ duplicate: true }` without touching any balance when the game id
 * has already been counted.
 */
async function recordGame(userId, { botId, difficulty, result, gameId, accuracy = null, plies = null, classId = null }) {
  if (!isValidDifficulty(difficulty)) throw Object.assign(new Error('Unknown difficulty'), { status: 400 });
  if (!isValidResult(result)) throw Object.assign(new Error('Unknown result'), { status: 400 });
  if (!botId || typeof botId !== 'string') throw Object.assign(new Error('botId is required'), { status: 400 });

  const gid = String(gameId || '').slice(0, 64);
  if (!gid) throw Object.assign(new Error('gameId is required'), { status: 400 });

  const coins = coinsFor(difficulty, result);
  const acc = accuracy == null ? null : Math.max(0, Math.min(100, Math.round(Number(accuracy) || 0)));
  const plyCount = plies == null ? null : Math.max(0, Math.round(Number(plies) || 0));

  /* Optional classroom attribution, so a bot game played during a live class can
     count on that class's leaderboard. The caller must have already verified
     membership (see botController) - this only normalises the shape. NULL means
     "played outside any class", which is the common case and stays uncounted. */
  const cid = classId == null || classId === '' ? null : parseInt(classId, 10);
  if (cid != null && !Number.isFinite(cid)) {
    throw Object.assign(new Error('classId must be a number'), { status: 400 });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    /* Idempotency gate: only the request that actually inserts the ledger row
       is allowed to award coins. */
    const inserted = await client.query(
      `INSERT INTO bot_game_results (student_user_id, game_id, bot_id, result, coins_awarded, accuracy, plies, class_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (student_user_id, game_id) DO NOTHING
       RETURNING id`,
      [userId, gid, botId, result, coins, acc, plyCount, cid]
    );

    if (inserted.rows.length === 0) {
      await client.query('ROLLBACK');
      return { duplicate: true };
    }

    const wonCol = result === 'win' ? 'games_won' : result === 'draw' ? 'games_drawn' : 'games_lost';

    /* `defeated` only ever goes false -> true: a later loss must not erase a
       win that legitimately unlocked a tier. */
    await client.query(
      `INSERT INTO bot_progress (student_user_id, bot_id, difficulty, defeated, ${wonCol}, best_accuracy, last_played_at)
       VALUES ($1, $2, $3, $4, 1, $5, NOW())
       ON CONFLICT (student_user_id, bot_id) DO UPDATE SET
         ${wonCol} = bot_progress.${wonCol} + 1,
         defeated = bot_progress.defeated OR $4,
         best_accuracy = CASE
           WHEN $5::smallint IS NULL THEN bot_progress.best_accuracy
           WHEN bot_progress.best_accuracy IS NULL THEN $5
           ELSE GREATEST(bot_progress.best_accuracy, $5)
         END,
         last_played_at = NOW(),
         updated_at = NOW()`,
      [userId, botId, difficulty, result === 'win', acc]
    );

    const reward = await client.query(
      `INSERT INTO bot_rewards (student_user_id, coins) VALUES ($1, $2)
       ON CONFLICT (student_user_id) DO UPDATE SET
         coins = bot_rewards.coins + $2, updated_at = NOW()
       RETURNING coins`,
      [userId, coins]
    );

    const totalCoins = Number(reward.rows[0].coins);

    /* A milestone already claimed returns 0 rows, so replays never re-award. */
    const newlyUnlocked = [];
    for (const milestone of REWARD_MILESTONES) {
      if (totalCoins < milestone) break;
      const unlocked = await client.query(
        `INSERT INTO bot_reward_unlocks (student_user_id, milestone_coins)
         VALUES ($1, $2)
         ON CONFLICT (student_user_id, milestone_coins) DO NOTHING
         RETURNING milestone_coins`,
        [userId, milestone]
      );
      if (unlocked.rows.length > 0) newlyUnlocked.push(milestone);
    }

    await client.query('COMMIT');

    return {
      duplicate: false,
      coinsEarned: coins,
      coins: totalCoins,
      newlyUnlockedRewards: newlyUnlocked,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Read-only rollup used by dashboards and the summary endpoint. */
async function getSummary(userId) {
  const [byDifficulty, totals, rewardRow] = await Promise.all([
    db.query(
      'SELECT difficulty, COUNT(*)::int AS bots, COUNT(*) FILTER (WHERE defeated)::int AS defeated FROM bot_progress WHERE student_user_id = $1 GROUP BY difficulty',
      [userId]
    ),
    db.query(
      'SELECT COALESCE(SUM(games_won),0)::int AS won, COALESCE(SUM(games_lost),0)::int AS lost, COALESCE(SUM(games_drawn),0)::int AS drawn FROM bot_progress WHERE student_user_id = $1',
      [userId]
    ),
    db.query('SELECT coins FROM bot_rewards WHERE student_user_id = $1', [userId])
  ]);

  return {
    coins: Number(rewardRow.rows[0]?.coins ?? 0),
    games: totals.rows[0] || { won: 0, lost: 0, drawn: 0 },
    tiers: BOT_DIFFICULTIES.map((d) => {
      const row = byDifficulty.rows.find((r) => r.difficulty === d);
      return {
        difficulty: d,
        botsPlayed: Number(row?.bots ?? 0),
        botsDefeated: Number(row?.defeated ?? 0),
        /* Read from FREE_DIFFICULTIES, not from UNLOCK_LADDER. This used to be
           `free || Boolean(UNLOCK_LADDER[d])`, which reported a GATED tier as
           unlocked — the exact opposite of what the ladder meant — so the
           summary claimed four of six tiers were open to a brand-new player. */
        unlocked: FREE_DIFFICULTIES.includes(d),
      };
    }),
    milestones: REWARD_MILESTONES,
  };
}

module.exports = {
  BOT_DIFFICULTIES,
  COINS_PER_WIN,
  DRAW_MULTIPLIER,
  REWARD_MILESTONES,
  UNLOCK_LADDER,
  FREE_DIFFICULTIES,
  isValidDifficulty,
  isValidResult,
  coinsFor,
  getSnapshot,
  recordGame,
  getSummary,
};