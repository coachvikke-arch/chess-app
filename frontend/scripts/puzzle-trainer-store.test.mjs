// Tests for the puzzle trainer's device-local store
// (frontend/src/config/puzzleTrainer.js, src/pages/PuzzleTrainer.jsx) —
//   run with: node --test scripts/puzzle-trainer-store.test.mjs   (from frontend/)
//
// The trainer keeps its score on the device: band, per-band solves, the seen-id
// window and the streak, all under `knightpath-puzzle-trainer:*:<userId>`. Two
// things this pins down:
//   1. The streak is React state that nothing wrote to storage, so reloading the
//      page mid-run showed 0 after a run the student had actually earned.
//   2. Every failure of the feed used to say "check your connection", including
//      the ones that are not a connection — a switched-off permission and an
//      empty band both need a different reply from the student.
//
// The store is plain ES modules over `localStorage`, so it runs in node with a
// stub instead of a browser; the page rule is a source assertion because the
// message table sits inside a component file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, '..');

/* Minimal Storage double: the module only ever calls getItem/setItem, and each
   read is wrapped in try/catch, so a throwing stub is what "private mode" looks
   like from the page's point of view. */
function stubStorage() {
  const data = new Map();
  const store = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    clear: () => data.clear(),
    get size() { return data.size; },
    keys: () => [...data.keys()],
  };
  globalThis.localStorage = store;
  return store;
}

function setUserId(id) {
  if (id === null) globalThis.localStorage.removeItem('user');
  else globalThis.localStorage.setItem('user', JSON.stringify(id ? { id } : null));
}

async function freshStore() {
  const url = pathToFileURL(join(FRONTEND, 'src', 'config', 'puzzleTrainer.js'));
  return import(`${url.href}?t=${Math.random()}`);
}

test('the streak survives a reload', async () => {
  stubStorage();
  setUserId(7);
  const m = await freshStore();

  assert.equal(m.readStreak(), 0, 'a fresh device has no run going');
  m.writeStreak(6);
  // The "reload" is a second read of the same storage; nothing else is kept.
  assert.equal(m.readStreak(), 6, 'the run the student earned is still there');
});

test('the streak is junk-proof and zero-proof', async () => {
  stubStorage();
  setUserId(7);
  const m = await freshStore();

  m.writeStreak(-3);
  assert.equal(m.readStreak(), 0, 'a negative run is not a run');
  m.writeStreak('banana');
  assert.equal(m.readStreak(), 0, 'unparseable storage falls back to zero');
  m.writeStreak(4.7);
  assert.equal(m.readStreak(), 4, 'a stored fraction is floored');
  globalThis.localStorage.setItem('knightpath-puzzle-trainer:streak:7', 'null');
  assert.equal(m.readStreak(), 0, 'a stored null reads as zero, not NaN');
});

test('the streak belongs to the signed-in student, not the device', async () => {
  stubStorage();
  const m = await freshStore();

  setUserId(11);
  m.writeStreak(9);
  setUserId(12);
  assert.equal(m.readStreak(), 0, 'a second account starts its own run');
  setUserId(11);
  assert.equal(m.readStreak(), 9, 'and the first account gets its run back');
  setUserId(null);
  assert.equal(m.readStreak(), 0, 'a guest gets its own slot');
});

test('solving keeps counting per band, and the bands keep their own numbers', async () => {
  stubStorage();
  setUserId(7);
  const m = await freshStore();

  assert.deepEqual(m.readSolvedCounts(), [0, 0, 0, 0, 0], 'five bands, none solved');
  assert.deepEqual(m.countSolve(2), [0, 0, 1, 0, 0]);
  assert.deepEqual(m.countSolve(2), [0, 0, 2, 0, 0]);
  assert.deepEqual(m.countSolve(0), [1, 0, 2, 0, 0], 'another band does not disturb this one');
  assert.equal(m.readSolvedCounts()[2], 2, 'and the row is still there when read back');

  assert.deepEqual(m.countSolve(99), [1, 0, 2, 0, 0], 'a band that does not exist solves nothing');
});

test('storage that is unavailable is survived, not thrown through', async () => {
  stubStorage();
  setUserId(7);
  const m = await freshStore();

  m.writeStreak(3);
  globalThis.localStorage = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
  };
  assert.equal(m.readStreak(), 0, 'a blocked read gives the default');
  assert.doesNotThrow(() => m.writeStreak(4), 'a blocked write is dropped, not raised');
});

test('the page seeds the streak from storage and writes every change through it', () => {
  const src = readFileSync(join(FRONTEND, 'src', 'pages', 'PuzzleTrainer.jsx'), 'utf8');
  assert.match(src, /useState\(readStreak\)/,
    'the first render must read the stored run, not start at 0');
  assert.match(src, /const setStreakRun = useCallback\(\(next\) => \{\s*streakRef\.current = next;\s*writeStreak\(next\);\s*setStreak\(next\);/,
    'one helper owns the write, so no streak change can skip storage');
  assert.match(src, /setStreakRun\(messy \? 0 : streakRef\.current \+ 1\)/,
    'a clean solve extends the stored run');
  assert.doesNotMatch(src, /setStreak\(0\)/,
    'a bare state reset would clear the screen but leave the stored run intact');
  assert.equal((src.match(/setStreakRun\(0\)/g) || []).length, 2,
    'a wrong try and a band change both break the run, and both must persist it');
});

test('a failed load says which kind of failure it is', () => {
  const src = readFileSync(join(FRONTEND, 'src', 'pages', 'PuzzleTrainer.jsx'), 'utf8');
  assert.match(src, /err\?\.response\?\.status/,
    'the status code is what distinguishes the cases');
  assert.match(src, /status === 403[\s\S]{0,160}switched off/i,
    'a disabled permission must not be reported as a network problem');
  assert.match(src, /status === 404[\s\S]{0,160}band/i,
    'an exhausted band gets its own wording');
  assert.match(src, /describeLoadFailure\(failure\)/,
    'and the load path reports it instead of a fixed sentence');
  assert.doesNotMatch(src, /Could not load a puzzle\. Check your connection\./,
    'the blanket message is gone');
  assert.match(src, /pendingRef\.current = \{ level: lv, promise: fetchPuzzle\(lv\)\.catch\(\(\) => null\) \}/,
    'the warm prefetch must stay caught: loadPuzzle awaits it unguarded');
});

test('the status line shows the whole message instead of an ellipsis', () => {
  const css = readFileSync(join(FRONTEND, 'src', 'pages', 'puzzle-trainer.css'), 'utf8');
  const rule = /\.pt-msg > span \{[^}]*\}/.exec(css);
  assert.ok(rule, 'the status span keeps its own rule');
  assert.doesNotMatch(rule[0], /text-overflow:\s*ellipsis/,
    'a truncated message loses the instruction — "switched off for your accou…" tells nobody what to do');
  assert.match(rule[0], /white-space:\s*normal/, 'the wording is allowed to wrap');
  assert.match(rule[0], /min-width: 0/, 'and the Retry button still cannot be pushed off screen');
});
