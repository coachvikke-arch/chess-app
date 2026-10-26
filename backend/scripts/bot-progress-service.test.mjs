// Behavioural test for the bot progression service
// (backend/src/lib/botProgressService.js) —
//   run with: node --test scripts/bot-progress-service.test.mjs   (from backend/)
//
// bot-progress-api.test.mjs pins the CONSTANTS against the client catalogue.
// This file pins the BEHAVIOUR, driving recordGame against an in-memory stub
// that stands in for pg. The stub models the one thing the real database
// provides that the code depends on: the UNIQUE (student_user_id, game_id)
// constraint, so a replayed game id inserts nothing and the credit path is
// skipped. That ordering is the security property — coins must never be
// awarded before the duplicate check resolves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..');

const db = require(join(BACKEND, 'src', 'config', 'database.js'));
const svc = require(join(BACKEND, 'src', 'lib', 'botProgressService.js'));

/**
 * A minimal pg stand-in.
 * `existingGames` seeds the unique constraint: any game id in it behaves like an
 * already-recorded result.
 */
function stubDb({ existingGames = [], startingCoins = 0 } = {}) {
  const state = {
    ledger: new Set(existingGames),
    coins: startingCoins,
    /* A balance can only have been accumulated by claiming those milestones,
       so seed them too. Without this a "returning player" would look like they
       are claiming 25/50/75 for the first time. */
    unlocked: new Set(svc.REWARD_MILESTONES.filter((m) => m <= startingCoins)),
    progress: new Map(),
    sql: [],
    rollbacks: 0,
  };

  state.client = {
    async query(sql, params = []) {
      const flat = sql.replace(/\s+/g, ' ').trim();
      state.sql.push(flat);

      if (flat === 'BEGIN' || flat === 'COMMIT') return { rows: [] };
      if (flat === 'ROLLBACK') { state.rollbacks++; return { rows: [] }; }

      /* The idempotency gate. */
      if (flat.includes('ON CONFLICT (student_user_id, game_id) DO NOTHING')) {
        if (state.ledger.has(params[1])) return { rows: [] };
        state.ledger.add(params[1]);
        return { rows: [{ id: 1 }] };
      }

      /* The balance upsert must be matched BEFORE the generic `RETURNING coins`
         probe below, otherwise the stub answers with the pre-update total. */
      if (flat.includes('bot_rewards (student_user_id, coins) VALUES')) {
        state.coins += params[1];
        return { rows: [{ coins: state.coins }] };
      }

      if (flat.includes('RETURNING coins')) return { rows: [{ coins: state.coins }] };

      if (flat.includes('bot_reward_unlocks')) {
        if (state.unlocked.has(params[1])) return { rows: [] };
        state.unlocked.add(params[1]);
        return { rows: [{ milestone_coins: params[1] }] };
      }

      return { rows: [] };
    },
    release() {},
  };

  return state;
}

/** Install the stub for one test, restoring the real pool afterwards. */
async function withStub(options, fn) {
  const realConnect = db.pool.connect.bind(db.pool);
  const state = stubDb(options);
  db.pool.connect = async () => state.client;
  try {
    return await fn(state);
  } finally {
    db.pool.connect = realConnect;
  }
}

const win = (over = {}) => ({ botId: 'pip', difficulty: 'Beginner', result: 'win', gameId: 'g1', ...over });

test('a first-time win pays the tier value and awards the milestone', async () => {
  await withStub({}, async (state) => {
    const out = await svc.recordGame(999, win({ botId: 'omega', difficulty: 'Master' }));
    assert.equal(out.duplicate, false);
    assert.equal(out.coinsEarned, 50);
    assert.equal(out.coins, 50);
    assert.deepEqual(out.newlyUnlockedRewards, [25, 50]);
  });
});

test('replaying the same game id pays nothing a second time', async () => {
  await withStub({}, async (state) => {
    const first = await svc.recordGame(999, win());
    const replay = await svc.recordGame(999, win());

    assert.equal(first.coinsEarned, 5);
    assert.equal(replay.duplicate, true, 'the replay was not detected as a duplicate');
    /* A duplicate must not report a fresh award to the client. */
    assert.equal(replay.coinsEarned, undefined);

    /* Exactly one balance update across both calls. */
    const coinUpdates = state.sql.filter((s) => s.includes('bot_rewards.coins + $2'));
    assert.equal(coinUpdates.length, 1, 'the balance was credited twice');
    assert.equal(state.rollbacks, 1, 'the replay should have rolled back');
  });
});

test('a game id already in the ledger is treated as a replay', async () => {
  /* Models arriving from another device: the row exists server-side already. */
  await withStub({ existingGames: ['g-known'] }, async (state) => {
    const out = await svc.recordGame(999, win({ gameId: 'g-known' }));
    assert.equal(out.duplicate, true);
    assert.equal(state.coin ?? 0, 0);
  });
});

test('the ledger insert precedes the balance update', async () => {
  await withStub({}, async (state) => {
    await svc.recordGame(999, win());
    const ledgerAt = state.sql.findIndex((s) => s.includes('ON CONFLICT (student_user_id, game_id) DO NOTHING'));
    const coinsAt = state.sql.findIndex((s) => s.includes('bot_rewards.coins + $2'));
    assert.ok(ledgerAt >= 0 && coinsAt >= 0, 'expected both statements to run');
    assert.ok(ledgerAt < coinsAt, 'coins were credited before the duplicate check');
  });
});

test('a loss credits no coins but still records the game', async () => {
  await withStub({}, async () => {
    const out = await svc.recordGame(999, win({ result: 'loss', gameId: 'g-loss' }));
    assert.equal(out.coinsEarned, 0);
    assert.equal(out.duplicate, false, 'the game must still be counted for statistics');
  });
});

test('a draw pays half, rounded down', async () => {
  await withStub({}, async () => {
    assert.equal((await svc.recordGame(999, win({ result: 'draw', botId: 'omega', difficulty: 'Master', gameId: 'd1' }))).coinsEarned, 25);
    /* 5 * 0.5 = 2.5, floored so the server can never overpay. */
    assert.equal((await svc.recordGame(999, win({ result: 'draw', gameId: 'd2' }))).coinsEarned, 2);
  });
});

test('milestones are awarded once each, in order', async () => {
  await withStub({ startingCoins: 120 }, async () => {
    const out = await svc.recordGame(999, win({ botId: 'omega', difficulty: 'Master', gameId: 'm1' }));
    /* Already past 25/50/75/100, so only the new 125 is fresh. */
    assert.deepEqual(out.newlyUnlockedRewards, [125]);
  });
});

test('an unknown difficulty or result is refused before any write', async () => {
  await withStub({}, async (state) => {
    await assert.rejects(() => svc.recordGame(999, win({ difficulty: 'Grandmaster' })), /Unknown difficulty/);
    await assert.rejects(() => svc.recordGame(999, win({ result: 'victory' })), /Unknown result/);
    await assert.rejects(() => svc.recordGame(999, win({ gameId: '' })), /gameId is required/);
    assert.equal(state.ledger.size, 0, 'a rejected request must not touch the ledger');
    assert.equal(state.rollbacks, 0, 'validation happens before BEGIN');
  });
});

test('distinct game ids each pay out', async () => {
  await withStub({}, async (state) => {
    for (const id of ['a', 'b', 'c']) {
      await svc.recordGame(999, win({ gameId: id }));
    }
    const coinUpdates = state.sql.filter((s) => s.includes('bot_rewards.coins + $2'));
    assert.equal(coinUpdates.length, 3, 'three distinct games should credit three times');
  });
});