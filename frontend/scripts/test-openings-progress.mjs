/* Exercises the openings progress store + badge rules against a fake
   localStorage. Run: node scripts/test-openings-progress.mjs

   The JSON is read with fs rather than imported: src/lib/openings.js imports it
   without a `type: json` attribute because Vite resolves that, while bare Node
   would require the attribute. Reading it here keeps the test runnable outside
   the bundler.
*/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Minimal localStorage stub — the store only needs get/set/removeItem.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const P = await import('../src/lib/openingsProgress.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const OPENINGS = JSON.parse(
  fs.readFileSync(path.join(here, '..', 'src', 'data', 'openingsLibrary.json'), 'utf8'),
).openings;

const byslug = new Map(OPENINGS.map((o) => [o.slug, o]));
const getOpening = (slug) => {
  const o = byslug.get(slug);
  if (!o) throw new Error(`fixture missing: ${slug}`);
  return o;
};

const italian = ['italian-game-giuoco-piano', 'italian-game-evans-gambit', 'two-knights-defence'].map(getOpening);
for (const o of italian) assert.ok(o, 'italian openings resolve');
assert.equal(italian[0].family, 'Italian Game');

let pass = 0;
const check = (label, fn) => {
  fn();
  pass++;
  console.log(`  ok  ${label}`);
};

check('fresh opening reads as not-started', () => {
  const e = P.getOpeningProgress(italian[0].slug, 'u1');
  assert.equal(e.status, P.STATUS.NOT_STARTED);
  assert.equal(e.attempts, 0);
});

check('a weak session marks in-progress, not learned', () => {
  const r = P.recordSession({
    slug: italian[0].slug, correct: 1, total: 6, streak: 1, completed: true,
    opening: italian[0], library: OPENINGS, userId: 'u1',
  });
  assert.equal(r.status, P.STATUS.IN_PROGRESS);
  assert.equal(r.justLearned, false);
  assert.equal(r.accuracy, 17);
  // The "first session" badge is about showing up, not about accuracy.
  assert.ok(r.newBadges.some((b) => b.id === 'first-session'), 'first-session badge awarded on session 1');
});

check('a strong session marks the opening learned', () => {
  const r = P.recordSession({
    slug: italian[0].slug, correct: 6, total: 6, streak: 6, completed: true,
    opening: italian[0], library: OPENINGS, userId: 'u1',
  });
  assert.equal(r.status, P.STATUS.LEARNED);
  assert.equal(r.justLearned, true);
});

check('accuracy is cumulative across sessions', () => {
  P.recordSession({ slug: italian[1].slug, correct: 6, total: 6, streak: 6, completed: true, library: OPENINGS, userId: 'u1' });
  // Cumulative across all three sessions: 1+6+6 correct of 6+6+6 attempted.
  const stats = P.getStats('u1');
  assert.equal(stats.sessions, 3);
  assert.equal(stats.correct, 13);
  assert.equal(stats.total, 18);
  assert.equal(P.getAccuracy('u1'), 72);
});

check('the Italian family badge unlocks only when ALL 3 are learned', () => {
  // Two of three learned so far.
  let shelf = P.badgeShelf(OPENINGS, 'u1').find((b) => b.family === 'Italian Game');
  assert.equal(shelf.learned, 2);
  assert.equal(shelf.total, 3);
  assert.equal(shelf.earned, false);

  const r = P.recordSession({
    slug: italian[2].slug, correct: 6, total: 6, streak: 6, completed: true,
    opening: italian[2], library: OPENINGS, userId: 'u1',
  });
  assert.ok(r.newBadges.some((b) => b.name === 'Italian Game Master'), 'family badge awarded');

  shelf = P.badgeShelf(OPENINGS, 'u1').find((b) => b.family === 'Italian Game');
  assert.equal(shelf.earned, true);
  assert.equal(shelf.learned, 3);
});

check('badges are not awarded twice', () => {
  const again = P.recordSession({
    slug: italian[2].slug, correct: 6, total: 6, streak: 6, completed: true,
    opening: italian[2], library: OPENINGS, userId: 'u1',
  });
  assert.equal(again.newBadges.length, 0, 'no duplicate badges');
});

check('progress is namespaced per user', () => {
  const other = P.getOpeningProgress(italian[0].slug, 'u2');
  assert.equal(other.status, P.STATUS.NOT_STARTED, 'u2 sees a clean slate');
  const mine = P.getOpeningProgress(italian[0].slug, 'u1');
  assert.equal(mine.status, P.STATUS.LEARNED);
});

check('a low-accuracy session cannot mark an opening learned', () => {
  const r = P.recordSession({
    slug: 'london-system', correct: 2, total: 5, streak: 2, completed: true,
    library: OPENINGS, userId: 'u3',
  });
  assert.equal(r.status, P.STATUS.IN_PROGRESS);
  assert.equal(r.justLearned, false);
});

check('setStatus + resetProgress work', () => {
  P.setStatus('london-system', P.STATUS.LEARNED, 'u4');
  assert.equal(P.getOpeningProgress('london-system', 'u4').status, P.STATUS.LEARNED);
  P.resetProgress('u4');
  assert.equal(P.getOpeningProgress('london-system', 'u4').status, P.STATUS.NOT_STARTED);
});

check('a corrupt localStorage payload degrades gracefully', () => {
  mem.set('np:openings:progress:v1:guest', '{not json');
  assert.equal(P.getOpeningProgress('london-system').status, P.STATUS.NOT_STARTED);
});

check('an unknown schema version is ignored', () => {
  mem.set('np:openings:progress:v1:guest', JSON.stringify({ v: 99, openings: { 'london-system': { status: 'learned' } } }));
  assert.equal(P.getOpeningProgress('london-system').status, P.STATUS.NOT_STARTED);
});

check('day streak starts at 1 and does not double-count same-day sessions', () => {
  const s = P.getStats('u1');
  assert.equal(s.currentStreak, 1, 'same day => still 1');
  assert.equal(s.bestStreak, 6);
});

console.log(`\n${pass} checks passed\n`);
