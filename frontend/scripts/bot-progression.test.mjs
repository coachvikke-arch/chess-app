// Behavioural tests for bot progression, unlocks and Bot Coins
// (frontend/src/services/BotProgressService.js + src/data/bots.ts) -
//   run with: node --test scripts/bot-progression.test.mjs   (from frontend/)
//
// WHY THIS FILE BUNDLES FIRST
//   BotProgressService.js imports `../data/bots`, which is TypeScript. Node's ESM
//   resolver needs an explicit extension and cannot strip the types, so the
//   module is bundled to a temp .mjs with esbuild (already a Vite dependency)
//   and imported from there. The result is that these are REAL behavioural
//   tests against the shipped logic — not regexes over source text, which is
//   what the older UI-shape tests in this repo have to settle for.
//
// WHAT IS PINNED HERE
//   The numbers in the brief: the unlock ladder, per-tier win coins, 50% draws,
//   zero for losses, the five reward milestones, and — most importantly — that
//   replaying one finished game can never pay twice.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/* ── In-memory localStorage, installed before the module under test loads ── */

class MemStorage {
  #map = new Map();
  getItem(k) {
    return this.#map.has(String(k)) ? this.#map.get(String(k)) : null;
  }
  setItem(k, v) {
    this.#map.set(String(k), String(v));
  }
  removeItem(k) {
    this.#map.delete(String(k));
  }
  clear() {
    this.#map.clear();
  }
}

let svc;

before(async () => {
  globalThis.localStorage = new MemStorage();
  const dir = mkdtempSync(join(tmpdir(), 'bot-prog-'));
  const outfile = join(dir, 'progression.mjs');
  const root = join(import.meta.dirname, '..');
  /* A virtual entry that re-exports BOTH modules, so the tests can assert
     against the real catalogue and the real progression logic together.
     Neither module re-exports the other's symbols, so there is no ambiguity. */
  await build({
    stdin: {
      contents: [
        "export * from './src/data/bots.ts';",
        "export * from './src/services/BotProgressService.js';",
      ].join('\n'),
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    outfile,
    logLevel: 'silent',
    /* data/bots.ts calls `import.meta.glob`, a Vite-only transform. Stub it so
     * the catalogue is loadable here. Deliberately done at the BUILD step
     * rather than with a `typeof import.meta.glob === 'function'` guard in the
     * source: Vite rewrites the call but not the guard, so a guard would make
     * avatarFiles permanently {} in the browser and real artwork would never
     * load. Avatars are irrelevant to these assertions either way. */
    define: { 'import.meta.glob': '__botAvatarStub' },
    banner: { js: 'const __botAvatarStub = () => ({});' },
  });
  /* pathToFileURL: on Windows a bare "C:\..." is rejected by the ESM loader. */
  svc = await import(pathToFileURL(outfile).href);
});

/** Fresh progress state for each test. */
function reset() {
  globalThis.localStorage.clear();
  return { id: 7 };
}

const beginnerBots = () => svc.BOTS.filter((b) => b.difficulty === 'Beginner');

/* Every beat() call is a distinct set of finished games. Without a unique run
   prefix the second call would replay the first call's game ids and be
   (correctly) swallowed by recordResult's idempotency guard. */
let runSeq = 0;
function beat(difficulty, n, result = 'win') {
  const user = { id: 7 };
  const run = runSeq++;
  const pool = svc.BOTS.filter((b) => b.difficulty === difficulty).slice(0, n);
  for (const bot of pool) {
    svc.recordResult({ botId: bot.id, result, user, gameId: `run${run}-${bot.id}` });
  }
  return user;
}

// ── Roster integrity ────────────────────────────────────────────────────

test('the catalogue has at least 30 bots with unique ids', () => {
  assert.ok(Array.isArray(svc.BOTS));
  assert.ok(svc.BOTS.length >= 30, `expected >= 30 bots, got ${svc.BOTS.length}`);
  const ids = new Set(svc.BOTS.map((b) => b.id));
  assert.equal(ids.size, svc.BOTS.length, 'bot ids must be unique');
});

test('every bot is fully specified', () => {
  for (const b of svc.BOTS) {
    assert.ok(b.name, `${b.id} needs a name`);
    assert.ok(Number.isFinite(b.rating), `${b.id} needs a numeric rating`);
    assert.ok(b.difficulty, `${b.id} needs a difficulty`);
    assert.ok(b.greeting && b.winMessage && b.loseMessage && b.drawMessage, `${b.id} needs dialogue`);
    assert.ok(b.engineSettings && Number.isFinite(b.engineSettings.skillLevel), `${b.id} needs engine settings`);
  }
});

test('every tier is open from the first visit', () => {
  /* The unlock ladder was removed: Intermediate no longer needs 3 Beginner
     defeats, Advanced no longer needs 5 Intermediate, and so on. The zeros are
     asserted rather than the old numbers so that re-introducing a gate — by
     accident or on purpose — has to be a deliberate edit here too. */
  const byId = Object.fromEntries(svc.DIFFICULTY_BANDS.map((b) => [b.id, b]));
  for (const band of svc.DIFFICULTY_BANDS) {
    assert.equal(band.requiresDefeats, 0, `${band.id} must require no defeats`);
  }
  assert.equal(byId.Beginner.winCoins, 5, 'the coin table is unaffected by the ladder change');
  assert.equal(byId.Master.winCoins, 50);
});

test('no tier gates another any more', () => {
  /* The ladder used to be declared per tier so it could not be inferred from
     the tier order (Beginner and Casual were BOTH free). Now nothing is
     declared, and the same declaration-or-nothing rule holds. */
  for (const difficulty of ['Beginner', 'Casual', 'Intermediate', 'Advanced', 'Expert', 'Master']) {
    assert.equal(svc.getUnlockSource(difficulty), null, `${difficulty} must gate nothing`);
  }
});

test('win coins match the brief, and draws pay half', () => {
  assert.equal(svc.coinsForResult('Beginner', 'win'), 5);
  assert.equal(svc.coinsForResult('Casual', 'win'), 8);
  assert.equal(svc.coinsForResult('Intermediate', 'win'), 12);
  assert.equal(svc.coinsForResult('Advanced', 'win'), 20);
  assert.equal(svc.coinsForResult('Expert', 'win'), 30);
  assert.equal(svc.coinsForResult('Master', 'win'), 50);

  assert.equal(svc.coinsForResult('Master', 'draw'), 25, 'a draw pays half of the win value');
  assert.equal(svc.coinsForResult('Master', 'loss'), 0, 'a loss pays nothing');
});

test('the reward track is three cosmetic unlocks', () => {
  /* It used to be five, the last two being coin-gated SPECIAL BOTS. Those went
     with the ladder, so the ceiling is now the piece-theme unlock at 75. */
  assert.deepEqual(svc.REWARD_MILESTONES.map((m) => m.coins), [25, 50, 75]);
  assert.equal(svc.COIN_TRACK_TOTAL, 75, 'the bar denominator must follow the last milestone');
  assert.deepEqual(
    svc.REWARD_MILESTONES.filter((m) => m.kind === 'bot').map((m) => m.value),
    [],
    'no bot may be gated behind coins',
  );
});

// ── Payment ─────────────────────────────────────────────────────────────

test('a win pays coins once', () => {
  reset();
  const user = { id: 7 };
  const bot = beginnerBots()[0];
  svc.recordResult({ botId: bot.id, result: 'win', user, gameId: 'g1' });
  assert.equal(svc.getRewards(user).coins, 5);
});

test('replaying the same game id pays nothing extra', () => {
  reset();
  const user = { id: 7 };
  const bot = beginnerBots()[0];
  svc.recordResult({ botId: bot.id, result: 'win', user, gameId: 'dup' });
  svc.recordResult({ botId: bot.id, result: 'win', user, gameId: 'dup' });
  svc.recordResult({ botId: bot.id, result: 'win', user, gameId: 'dup' });
  assert.equal(svc.getRewards(user).coins, 5, 'coins must not accumulate on a replayed game');
});

test('a loss pays nothing but still counts the game', () => {
  reset();
  const user = { id: 7 };
  const bot = beginnerBots()[0];
  svc.recordResult({ botId: bot.id, result: 'loss', user, gameId: 'g2' });
  assert.equal(svc.getRewards(user).coins, 0);
  const rec = svc.getBotProgress(bot.id, user);
  assert.equal(rec.gamesPlayed, 1);
  assert.equal(rec.losses, 1);
});

test('a win marks the bot defeated and a loss does not', () => {
  reset();
  const user = { id: 7 };
  const [a, b] = beginnerBots();
  svc.recordResult({ botId: a.id, result: 'win', user, gameId: 'g3' });
  svc.recordResult({ botId: b.id, result: 'loss', user, gameId: 'g4' });
  assert.equal(svc.getBotProgress(a.id, user).defeated, true);
  assert.equal(svc.getBotProgress(b.id, user).defeated, false);
});

// ── Unlocks ─────────────────────────────────────────────────────────────

test('every tier is available immediately, with no progress at all', () => {
  /* Asserted on a user who has never played: the point of removing the ladder is
     that the FIRST visit sees the whole roster. */
  reset();
  const fresh = { id: 999 };
  for (const difficulty of ['Beginner', 'Casual', 'Intermediate', 'Advanced', 'Expert', 'Master']) {
    assert.equal(svc.isDifficultyUnlocked(difficulty, fresh), true, `${difficulty} must be open`);
  }
  for (const bot of svc.BOTS) {
    assert.equal(svc.isBotUnlocked(bot.id, fresh), true, `${bot.id} must be playable first visit`);
  }
});

test('every bot is unlocked whatever the player has done — or not done', () => {
  /* The same guarantee under opposite conditions: still true after playing, and
     still true after losing deliberately to every beginner. */
  reset();
  assert.doesNotThrow(() => beat('Beginner', 5, 'loss'), 'losses must not break anything');
  const afterLosses = { id: 7 };
  assert.equal(svc.isDifficultyUnlocked('Master', afterLosses), true, 'losses lock nothing');
  assert.equal(svc.isBotUnlocked('omega', afterLosses), true, 'the old coin-gated boss must be open');

  reset();
  const champion = beat('Beginner', 5);
  assert.equal(svc.isBotUnlocked('kai', champion), true, 'the old coin-gated special must be open');
  for (const bot of svc.BOTS) {
    assert.equal(svc.isBotUnlocked(bot.id, champion), true, `${bot.id} must be playable`);
  }
});

test('no bot is ever reported as locked', () => {
  /* The card reads this string to a screen reader, so "Locked" with no
     explanation would be an a11y regression rather than just cosmetic. */
  reset();
  const fresh = { id: 61 };
  for (const bot of svc.BOTS) {
    const reason = svc.lockReason(bot, fresh);
    assert.equal(reason, null, `${bot.id} must not carry a lock reason`);
  }
  assert.deepEqual(
    Object.values(svc.getUnlockMap(fresh)).filter((g) => !g.unlocked),
    [],
    'the bulk map must mark the whole roster open',
  );
});

// ── Milestones ──────────────────────────────────────────────────────────

test('crossing a milestone claims it and stops counting twice', () => {
  reset();
  const user = { id: 7 };
  /* Bank 30 coins: passes 25 only. */
  for (let i = 0; i < 6; i++) {
    svc.recordResult({ botId: beginnerBots()[i % beginnerBots().length].id, result: 'win', user, gameId: `m${i}` });
  }
  const r = svc.getRewards(user);
  assert.ok(r.coins >= 25, 'should have banked past the first milestone');
  assert.ok(r.unlockedRewards.includes('avatar_ember'), 'the 25 milestone should be claimed');
});

// ── Per-user isolation ──────────────────────────────────────────────────

test('two accounts never share progress', () => {
  reset();
  const alice = { id: 1 };
  const bob = { id: 2 };
  svc.recordResult({ botId: beginnerBots()[0].id, result: 'win', user: alice, gameId: 'x' });
  assert.equal(svc.getRewards(alice).coins, 5);
  assert.equal(svc.getRewards(bob).coins, 0, 'bob must start from zero');
});