// Cross-checks for the bot progression API
// (backend/src/lib/botProgressService.js, backend/src/controllers/botController.js) —
//   run with: node --test scripts/bot-progress-api.test.mjs   (from backend/)
//
// Two files hold the same rules (the client catalogue and the server's mirror of
// it) and cannot import each other, so these tests are what stops them drifting.
// A bot that is renamed or re-tiered on the client must fail here rather than
// silently 404ing or paying the wrong number of coins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, '..');
const FRONTEND = join(BACKEND, '..', 'frontend');

const require = createRequire(import.meta.url);
const svc = require(join(BACKEND, 'src', 'lib', 'botProgressService.js'));
const ctrl = require(join(BACKEND, 'src', 'controllers', 'botController.js'));

const catalogueSrc = readFileSync(join(FRONTEND, 'src', 'data', 'bots.ts'), 'utf8');

/** `{ <botId>: <difficulty> }` parsed straight out of the client catalogue. */
function parseCatalogue() {
  const out = {};
  let id = null;
  for (const line of catalogueSrc.split('\n')) {
    const idMatch = line.match(/\bid:\s*'([a-z][a-z0-9-]*)'/);
    if (idMatch) id = idMatch[1];
    const diffMatch = line.match(/difficulty:\s*'(\w+)'/);
    if (diffMatch && id) {
      out[id] = diffMatch[1];
      id = null;
    }
  }
  return out;
}

/** `{ <difficulty>: <winCoins> }` parsed out of DIFFICULTY_BANDS. */
function parseBandCoins() {
  const out = {};
  let current = null;
  for (const line of catalogueSrc.split('\n')) {
    const idMatch = line.match(/^\s*id:\s*'(\w+)',/);
    if (idMatch) current = idMatch[1];
    const coinMatch = line.match(/winCoins:\s*(\d+)/);
    if (coinMatch && current) {
      out[current] = Number(coinMatch[1]);
      current = null;
    }
  }
  return out;
}

const catalogue = parseCatalogue();
const bandCoins = parseBandCoins();

test('the catalogue parser actually found the bots', () => {
  /* Guards the parsers above: if the catalogue is reformatted, these tests must
     fail loudly rather than pass against an empty object. */
  assert.equal(Object.keys(catalogue).length, 30, 'expected 30 bots in the catalogue');
  assert.equal(Object.keys(bandCoins).length, 6, 'expected 6 difficulty bands');
});

test('the server roster matches the client catalogue exactly', () => {
  assert.deepEqual(ctrl.BOT_ROSTER, catalogue, 'BOT_ROSTER has drifted from data/bots.ts');
});

test('every tier has the same coin value on both sides', () => {
  assert.deepEqual(svc.COINS_PER_WIN, bandCoins, 'COINS_PER_WIN has drifted from DIFFICULTY_BANDS');
});

test('there is no unlock ladder on either side', () => {
  /* The ladder was removed: Intermediate no longer needs 3 Beginner defeats,
     Advanced no longer needs 5 Intermediate, and so on down the tier list.
     Both sides used to declare the same rules in their own file, so the mirror
     shape is kept and asserted EMPTY rather than one side having nothing to
     compare — a tier re-gated on only one side must fail here. */
  const catalogue = catalogueSrc.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.deepEqual(svc.UNLOCK_LADDER, {}, 'the server must declare no unlock ladder');
  assert.deepEqual(
    [...catalogue.matchAll(/unlocksFrom:\s*'(\w+)'/g)].map((m) => m[1]),
    [],
    'no tier in the catalogue may name a tier it unlocks from',
  );
  /* Beginner and Casual were BOTH free, which is why the ladder could never be
     inferred by walking backwards through the tier list. Now all six are. */
  assert.deepEqual(svc.FREE_DIFFICULTIES, svc.BOT_DIFFICULTIES, 'every tier must be free');
  assert.equal(svc.UNLOCK_LADDER.Beginner, undefined);
  assert.equal(svc.UNLOCK_LADDER.Casual, undefined);
});

test('the catalogue requires no defeats in any tier', () => {
  /* The zeros are what `isDifficultyUnlocked` actually reads, so they are
     checked directly rather than inferred from the ladder being gone. */
  const defeats = [...catalogueSrc.matchAll(/requiresDefeats:\s*(\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(new Set(defeats), new Set([0]), `every band must require 0 defeats, saw ${[...new Set(defeats)]}`);
  assert.ok(defeats.length >= 6, `expected a value for each of the 6 bands, saw ${defeats.length}`);
});

test('milestones match the catalogue reward track', () => {
  /* Three, not five: the two coin-gated special bots went with the ladder. */
  assert.deepEqual(svc.REWARD_MILESTONES, [25, 50, 75]);
});

test('a win pays the tier value, a draw half, a loss nothing', () => {
  assert.equal(svc.coinsFor('Master', 'win'), 50);
  assert.equal(svc.coinsFor('Beginner', 'win'), 5);
  assert.equal(svc.coinsFor('Master', 'draw'), 25);
  assert.equal(svc.coinsFor('Beginner', 'draw'), 2); // floor(5 * 0.5)
  assert.equal(svc.coinsFor('Expert', 'draw'), 15);
  assert.equal(svc.coinsFor('Master', 'loss'), 0);
  assert.equal(svc.coinsFor('Beginner', 'loss'), 0);
  /* An unknown tier must never pay, whatever the result claims. */
  assert.equal(svc.coinsFor('Grandmaster', 'win'), 0);
});

test('the award always uses the server tier, not the claimed one', () => {
  /* A client claiming Expert for pip must not turn a 5-coin bot into a 30-coin
     one. resolveDifficulty ignores the claim entirely. */
  for (const claimed of ['Expert', 'Master', 'Beginner', 'nonsense']) {
    assert.equal(ctrl.resolveDifficulty('pip', claimed), 'Beginner', `claim ${claimed} changed the payout tier`);
  }
  /* An unknown id resolves to null rather than falling through to a payout. */
  assert.equal(ctrl.resolveDifficulty('not-a-bot', 'Master'), null);
});

test('input validation rejects anything unexpected', () => {
  assert.equal(svc.isValidDifficulty('Master'), true);
  assert.equal(svc.isValidDifficulty('Grandmaster'), false);
  assert.equal(svc.isValidDifficulty(undefined), false);
  assert.equal(svc.isValidResult('win'), true);
  assert.equal(svc.isValidResult('loss'), true);
  assert.equal(svc.isValidResult('draw'), true);
  /* 'victory' must not be coerced into a win. */
  assert.equal(svc.isValidResult('victory'), false);
  assert.equal(svc.isValidResult(null), false);
});

test('the migration defines every table the service queries', () => {
  const sql = readFileSync(join(BACKEND, 'migrations', 'add_bot_progress.sql'), 'utf8');
  for (const table of ['bot_progress', 'bot_rewards', 'bot_reward_unlocks', 'bot_game_results']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`), `migration is missing ${table}`);
  }
  /* The idempotency the service depends on must exist in the schema, not just
     in the ON CONFLICT clause. */
  assert.match(sql, /CONSTRAINT bot_game_result_unique_game UNIQUE \(student_user_id, game_id\)/);
  assert.match(sql, /CONSTRAINT bot_reward_unlock_unique UNIQUE \(student_user_id, milestone_coins\)/);
  assert.match(sql, /CONSTRAINT bot_progress_unique_student_bot UNIQUE \(student_user_id, bot_id\)/);
});

test('the ledger insert precedes the balance update', () => {
  /* Ordering is the whole point: if the ON CONFLICT gate ran after the coin
     update, two concurrent requests would both pay out. */
  const src = readFileSync(join(BACKEND, 'src', 'lib', 'botProgressService.js'), 'utf8');
  const ledgerAt = src.indexOf('ON CONFLICT (student_user_id, game_id) DO NOTHING');
  const coinsAt = src.indexOf('bot_rewards.coins + $2');
  assert.notEqual(ledgerAt, -1, 'the game-id idempotency gate is missing');
  assert.notEqual(coinsAt, -1, 'the coin balance update is missing');
  assert.ok(ledgerAt < coinsAt, 'coins are credited before the duplicate check');
});

test('every bot route is session-scoped', () => {
  const src = readFileSync(join(BACKEND, 'src', 'routes', 'botRoutes.js'), 'utf8');
  for (const line of ['/progress', '/summary', '/result', '/:botId']) {
    const idx = src.indexOf(`'${line}'`);
    assert.notEqual(idx, -1, `route ${line} is not registered`);
    const registration = src.slice(idx, src.indexOf('\n', idx));
    assert.match(registration, /authMiddleware/, `route ${line} is not behind authMiddleware`);
  }
});

test('the routes are mounted at /api/bots', () => {
  const app = readFileSync(join(BACKEND, 'src', 'app.js'), 'utf8');
  assert.match(app, /require\('\.\/routes\/botRoutes'\)/, 'botRoutes is never required');
  assert.match(app, /app\.use\('\/api\/bots', botRoutes\)/, 'botRoutes is not mounted at /api/bots');
});