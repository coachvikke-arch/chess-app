/**
 * No bot may be rendered twice on the bots page.
 *
 * THE BUG THIS EXISTS FOR
 *
 * `BotsPage` rendered two independent card collections: a "New to chess? Start
 * here" strip built from the first four `NEWCOMER_BOT_IDS`, and the tier grid
 * built from `DIFFICULTY_BANDS` x each bot's `difficulty`.
 *
 * All five newcomer ids are difficulty `Beginner`, and the Beginner band always
 * renders (`requiresDefeats: 0`), so pip, mia, leo and nova each produced TWO
 * live cards a few centimetres apart - two copies of the same bot, each with its
 * own selected ring, lock pill and click handler. Two cards for one opponent is
 * a correctness bug, not a cosmetic one: the player can select either, and
 * nothing on the page says they are the same bot.
 *
 * WHY A SOURCE ASSERTION FOR THE SECOND HALF
 *
 * The duplicate came from the page having two `<BotCard>` call sites, so counting
 * those sites is what actually pins the fix. The data-level invariant below
 * (one difficulty per bot) is what makes the tier grid safe to be the single
 * source of cards, and both halves are asserted together because either alone
 * would still allow the page to reintroduce a second list.
 *
 * Run with: npm run test:bots-page-unique
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* The catalogue is TypeScript and the suite runs plain `node --test` with no
   flags, so Node needs the types stripped to import the real module. */
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.ts')) {
      const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'strip' });
      return { format: 'module', source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { BOTS, DIFFICULTY_BANDS, NEWCOMER_BOT_IDS, getBotsByDifficulty } = await import(
  pathToFileURL(join(ROOT, 'src', 'data', 'bots.ts')).href
);

test('every bot belongs to exactly one difficulty band', () => {
  /* This is what makes the tier grid a complete, non-overlapping partition of
     the roster - the property that made it safe to delete the newcomer strip
     instead of the tier entries. */
  const seen = new Map();
  for (const band of DIFFICULTY_BANDS) {
    for (const bot of getBotsByDifficulty(band.id)) {
      assert.ok(!seen.has(bot.id), `${bot.id} is in both ${seen.get(bot.id)} and ${band.id}`);
      seen.set(bot.id, band.id);
    }
  }
  assert.equal(
    seen.size,
    BOTS.length,
    'every bot must be reachable from exactly one band, or the grid drops or repeats it',
  );
});

test('every difficulty band id corresponds to at least one bot', () => {
  for (const band of DIFFICULTY_BANDS) {
    assert.ok(getBotsByDifficulty(band.id).length > 0, `band ${band.id} renders an empty section`);
  }
});

test('the roster is not accidentally duplicated', () => {
  const ids = BOTS.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate bot id in the roster');
});

/** BotsPage source with comments removed.
 *
 *  The removal matters: the fix is documented in a comment that QUOTES the
 *  deleted markup, so a naive text search would find the very string it is
 *  asserting is gone. Only block comments are stripped, and they cannot appear
 *  inside a string literal in this file, so this cannot eat real code.
 */
function pageCode() {
  return readFileSync(join(ROOT, 'src', 'pages', 'BotsPage.jsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
}

test('the bots page renders exactly ONE collection of cards', () => {
  const callSites = pageCode().match(/<BotCard/g) || [];
  assert.equal(
    callSites.length,
    1,
    `BotsPage has ${callSites.length} <BotCard> sites; a second one renders a second ` +
      'copy of any bot it features, which is the duplicate-card bug',
  );
});

test('the redundant newcomer strip is gone from the page', () => {
  const code = pageCode();
  assert.doesNotMatch(code, /newcomers/, 'the newcomers memo must be removed with its section');
  assert.doesNotMatch(code, /New to chess/, 'the duplicate onboarding strip must not be rendered');
  /* Still referenced only in the explanatory comment, never as a live import. */
  assert.doesNotMatch(code, /import[^;]*NEWCOMER_BOT_IDS/, 'the now-unused import must be dropped');
});

test('every bot is still reachable through the page after the strip was removed', () => {
  /* Removing a section must not cost the player access to anyone: the tier grid
     alone has to cover the whole roster. */
  const reachable = DIFFICULTY_BANDS.flatMap((band) =>
    getBotsByDifficulty(band.id).map((b) => b.id),
  );
  assert.deepEqual(
    [...reachable].sort(),
    BOTS.map((b) => b.id).sort(),
    'the tier grid must still show every bot',
  );
});

test('the newcomer ids remain valid catalogue entries', () => {
  /* NEWCOMER_BOT_IDS is still consumed by BotService, so the export must stay
     real - it just no longer drives a second set of cards on the page. */
  const ids = new Set(BOTS.map((b) => b.id));
  for (const id of NEWCOMER_BOT_IDS) {
    assert.ok(ids.has(id), `NEWCOMER_BOT_IDS references unknown bot "${id}"`);
  }
});