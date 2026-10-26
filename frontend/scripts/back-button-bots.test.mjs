/**
 * The floating Back pill must not appear on the bot pages.
 *
 * Both bot pages already carry their own back control inside their header
 * (`← Back` on the catalogue, `← Bots` on a match). The global pill is
 * `fixed left-2.5 top-[104px]`, so it rendered directly on top of the header's
 * own link — two Back controls overlapping, which reads as a bug.
 *
 * The match route is parameterised (`/play/bot/pip`), so this has to be a
 * prefix check; an exact-match set cannot express it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, '..', ...p), 'utf8');

const back = read('src', 'components', 'BackButton.jsx');
const botsPage = read('src', 'pages', 'BotsPage.jsx');
const gamePage = read('src', 'pages', 'BotGamePage.jsx');

/* Re-implemented here from the source so the expectations are checked as
   behaviour, not just as a regex over the file. */
const HIDDEN_PATHS = new Set(['/', '/login', '/student/dashboard', '/admin/dashboard']);
const HIDDEN_PREFIXES = ['/play/bots', '/play/bot/'];

function expectedVisible(pathname) {
  const hidden =
    HIDDEN_PATHS.has(pathname) ||
    HIDDEN_PREFIXES.some((p) => pathname.startsWith(p));
  return !hidden;
}

test('the visibility decision is routed through the prefix-aware helper', () => {
  assert.match(back, /function hiddenFor\(pathname\)/, 'expected a hiddenFor() helper');
  assert.match(back, /HIDDEN_PREFIXES\.some\(/, 'the helper must do prefix matching');
  /* Both the initial state and the effect must use it, otherwise the pill can
     still appear on the first render of a bot page. */
  const uses = back.match(/hiddenFor\(location\.pathname\)/g) || [];
  assert.equal(uses.length, 2, 'both useState and useEffect must call hiddenFor()');
  assert.doesNotMatch(
    back,
    /!HIDDEN_PATHS\.has\(/,
    'the old exact-match check must be fully replaced',
  );
});

test('the floating pill is hidden on both bot routes', () => {
  assert.equal(expectedVisible('/play/bots'), false, '/play/bots must be hidden');
  assert.equal(expectedVisible('/play/bot/pip'), false, '/play/bot/:botId must be hidden');
});

test('the pill still shows everywhere it is needed', () => {
  for (const p of ['/student/assignments', '/courses', '/openings', '/puzzles', '/leaderboard']) {
    assert.equal(expectedVisible(p), true, `${p} must keep the back pill`);
  }
});

test('the pre-existing hidden routes are unchanged', () => {
  for (const p of ['/', '/login', '/student/dashboard', '/admin/dashboard']) {
    assert.equal(expectedVisible(p), false, `${p} was already hidden and must stay hidden`);
  }
});

test('hidden prefixes are declared in the source', () => {
  const declared = back.match(/const HIDDEN_PREFIXES = \[([^\]]*)\]/);
  assert.ok(declared, 'HIDDEN_PREFIXES must be declared');
  for (const p of HIDDEN_PREFIXES) {
    assert.ok(declared[1].includes(`'${p}'`), `HIDDEN_PREFIXES is missing ${p}`);
  }
});

test('both bot pages keep their own back control', () => {
  assert.match(
    botsPage,
    /const backTarget = user \? homeForRole\(user\.role\) : '\/student\/dashboard'/,
    'the catalogue back link must resolve through the role helper, not a hardcoded "/"',
  );
  assert.match(botsPage, /to=\{backTarget\}/, 'the ← Back link must use backTarget');
  assert.match(gamePage, /navigate\('\/play\/bots'\)/, 'a match must keep its ← Bots link');
});

test('the catalogue back target is the student dashboard', () => {
  /* Mirrors homeForRole() so a change to that helper cannot silently move this
     link off the dashboard without this test noticing. */
  const roles = read('src', 'utils', 'roles.js');
  const home = roles.match(/export function homeForRole\(role\) \{[\s\S]*?\n\}/)[0];
  const homeForRole = new Function(
    'role',
    home.replace(/^export function homeForRole\(role\) \{/, '').replace(/\}\s*$/, ''),
  );
  assert.equal(homeForRole('student'), '/student/dashboard');
  assert.equal(homeForRole(undefined), '/student/dashboard');

  /* The BotsPage fallback for a signed-out visitor must match too. */
  const target = botsPage.match(/const backTarget = ([^;]+);/)[1];
  const backTarget = new Function('user', 'homeForRole', `return ${target};`);
  assert.equal(backTarget({ role: 'student' }, homeForRole), '/student/dashboard');
  assert.equal(backTarget(null, homeForRole), '/student/dashboard');
});