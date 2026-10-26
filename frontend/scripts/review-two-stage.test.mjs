/* Two-stage review: which positions must be confirmed at full depth, and
   whether a cached search is reusable. Pure functions only — no engine, no DOM.

   These exist because the performance work has two ways to go wrong that a
   timing check would not catch:
     1. sending too few plies deep, which silently reclassifies real mistakes;
     2. serving a cached result for a search that was not the one cached. */

import assert from 'node:assert/strict';
import { needsDeepReview, isMateish } from '../src/utils/reviewScan.js';
import { createReviewCache, cacheKey, CACHE_VERSION } from '../src/utils/reviewCache.js';
import { REVIEW_CRITICAL_CPL, REVIEW_CRITICAL_BAND_CP, REVIEW_ENGINE_VERSION, REVIEW_SCAN_DEPTH, REVIEW_DEPTH } from '../src/utils/reviewConfig.js';

let pass = 0;
let fail = 0;
/* Async-aware on purpose: several of these tests are async, and a harness that
   ignores the returned promise would print "ok" for a test that in fact failed
   and then crash the process with an unhandled rejection much later. */
const t = async (name, fn) => {
  try { await fn(); pass += 1; console.log('  ok   ' + name); }
  catch (err) { fail += 1; console.log('  FAIL ' + name + '\n       ' + err.message); }
};
const pos = (cpl) => ({ cpl, playedM: 0, bestM: cpl });

/* ---- the trigger --------------------------------------------------------- */

await t('a quiet move never reaches a deep search', () => {
  assert.equal(needsDeepReview(pos(0)).deep, false);
  assert.equal(needsDeepReview(pos(30)).deep, false);
});

await t('a clear blunder always reaches a deep search', () => {
  const d = needsDeepReview(pos(400));
  assert.equal(d.deep, true);
  assert.equal(d.reason, 'critical-cpl');
});

await t('a move just under the bar is confirmed, because a shallow search under-reads it', () => {
  const just = REVIEW_CRITICAL_CPL - REVIEW_CRITICAL_BAND_CP;
  assert.equal(needsDeepReview(pos(just)).reason, 'near-critical');
  assert.equal(needsDeepReview(pos(just - 1)).deep, false, 'below the band is cheap');
});

await t('mates are always confirmed, whatever the centipawn loss says', () => {
  const mateScore = 100000;
  assert.equal(needsDeepReview({ cpl: 0, playedM: 0, bestM: mateScore }).reason, 'mate-score');
  assert.equal(needsDeepReview({ cpl: 0, playedM: -mateScore, bestM: 0 }).reason, 'mate-score');
});

await t('a missing evaluation is never trusted', () => {
  assert.equal(needsDeepReview({ cpl: null, playedM: null, bestM: 0 }).reason, 'missing-evaluation');
  assert.equal(needsDeepReview({ cpl: 5, playedM: null, bestM: 0 }).reason, 'missing-evaluation');
  assert.equal(needsDeepReview(pos(0)).deep, false, 'a real zero CPL is cheap, not missing');
});

await t('the trigger responds to the configured bar, so it stays tunable', () => {
  assert.equal(needsDeepReview({ ...pos(120), criticalCpl: 50 }).deep, true, '50cp bar catches 120cp');
  assert.equal(needsDeepReview({ ...pos(120), criticalCpl: 200 }).deep, false, '200cp bar does not');
});

await t('the band width is honoured on both sides of the bar', () => {
  const wide = needsDeepReview({ ...pos(35), criticalCpl: 50, criticalBandCp: 20 });
  assert.equal(wide.reason, 'near-critical', '35cp is inside a 20cp band under a 50cp bar');
  const narrow = needsDeepReview({ ...pos(35), criticalCpl: 50, criticalBandCp: 5 });
  assert.equal(narrow.deep, false, '35cp is outside a 5cp band under a 50cp bar');
  assert.equal(needsDeepReview({ ...pos(60), criticalCpl: 50, criticalBandCp: 0 }).reason, 'critical-cpl');
});

await t('mate detection is symmetric and does not fire on normal scores', () => {
  assert.equal(isMateish(100000), true);
  assert.equal(isMateish(-100000), true);
  assert.equal(isMateish(300), false);
  assert.equal(isMateish(null), false);
  assert.equal(isMateish(0), false);
});

/* ---- the cache ----------------------------------------------------------- */

const slow = (v, ms = 5) => new Promise((r) => setTimeout(() => r(v), ms));

await t('a repeated search is answered from memory, not re-run', async () => {
  const c = createReviewCache();
  let calls = 0;
  const run = () => c.wrap('fen1', 18, 3, async () => { calls += 1; return 'first'; });
  assert.equal(await run(), 'first');
  assert.equal(await run(), 'first');
  assert.equal(calls, 1, 'the engine ran once');
  assert.equal(c.stats.hits, 1);
  assert.equal(c.stats.misses, 1);
});

await t('depth and multiPV each make a distinct search', async () => {
  /* ONE cache, so the keys genuinely collide unless they differ. Using a fresh
     cache per case would pass even with a key of just the FEN, which is
     exactly the bug this test exists to catch.
     The engine version is deliberately NOT varied here: it is fixed when the
     cache is built, so two versions cannot coexist in one cache by design. The
     version is covered by the key-text test below. */
  const c = createReviewCache();
  let calls = 0;
  const run = (d, m) => c.wrap('same-fen', d, m, async () => { calls += 1; return `${d}/${m}`; });
  const seen = [await run(18, 3), await run(16, 3), await run(18, 1)];
  assert.equal(calls, 3, 'three genuinely different searches, none of them reused');
  assert.equal(new Set(seen).size, 3, 'a MultiPV-1 result must never be served for a MultiPV-3 request');
  assert.equal(c.stats.misses, 3);
  assert.equal(c.stats.hits, 0);
});

await t('re-requesting an identical search is a hit, not a second run', async () => {
  const c = createReviewCache();
  let calls = 0;
  const run = () => c.wrap('same-fen', 18, 3, async () => { calls += 1; return 'v'; });
  await run(); await run(); await run();
  assert.equal(calls, 1);
  assert.equal(c.stats.hits, 2);
});

await t('the key is built from all four inputs', () => {
  const base = cacheKey('fen', 18, 3, 1);
  assert.notEqual(base, cacheKey('other', 18, 3, 1), 'FEN matters');
  assert.notEqual(base, cacheKey('fen', 16, 3, 1), 'depth matters');
  assert.notEqual(base, cacheKey('fen', 18, 1, 1), 'multiPV matters');
  assert.notEqual(base, cacheKey('fen', 18, 3, 2), 'engine version matters');
  assert.equal(base, cacheKey('fen', 18, 3, 1), 'the same inputs give the same key');
});

await t('a shallow scan and a deep search of one position never share a slot', async () => {
  const c = createReviewCache();
  let calls = 0;
  const scan = await c.wrap('fen5', REVIEW_SCAN_DEPTH, 3, async () => { calls += 1; return 'shallow'; });
  const deep = await c.wrap('fen5', REVIEW_DEPTH, 3, async () => { calls += 1; return 'deep'; });
  assert.deepEqual([scan, deep], ['shallow', 'deep']);
  assert.equal(calls, 2, 'the depth-18 result did not overwrite or read the depth-10 result');
});

await t('the same position asked for twice at once is searched once', async () => {
  const c = createReviewCache();
  let calls = 0;
  const run = () => c.wrap('fen2', 18, 3, async () => { calls += 1; await slow(null, 20); return 'shared'; });
  const [a, b, d] = await Promise.all([run(), run(), run()]);
  assert.equal(calls, 1, 'three concurrent requests, one search');
  assert.deepEqual([a, b, d], ['shared', 'shared', 'shared']);
  assert.equal(c.stats.coalesced, 2);
});

await t('a failed search is not cached, so the next request retries', async () => {
  const c = createReviewCache();
  let calls = 0;
  await assert.rejects(c.wrap('fen3', 18, 3, async () => { calls += 1; throw new Error('engine died'); }));
  assert.equal(await c.wrap('fen3', 18, 3, async () => { calls += 1; return 'ok'; }), 'ok');
  assert.equal(calls, 2);
  assert.equal(c.has('fen3', 18, 3), true, 'the successful retry is cached');
});

await t('the cache is bounded, so a long session cannot grow without limit', async () => {
  const c = createReviewCache({ maxEntries: 3 });
  for (let i = 0; i < 6; i += 1) await c.wrap(`fen${i}`, 18, 3, async () => i);
  assert.equal(c.size, 3);
  assert.equal(c.stats.evictions, 3);
  assert.equal(c.has('fen0', 18, 3), false, 'the oldest entry was dropped');
  assert.equal(c.has('fen5', 18, 3), true);
});

await t('the version is part of the key, so a stale result cannot be served', async () => {
  const old = createReviewCache({ version: CACHE_VERSION });
  await old.wrap('fen4', 18, 3, async () => 'from-old-build');
  /* A new build gets a new cache, so this is about the KEY carrying the version:
     with the version dropped from the key, a cache spanning a rebuild would
     happily serve the old engine's answer. Assert the key text, not the object. */
  assert.notEqual(
    cacheKey('fen4', 18, 3, CACHE_VERSION),
    cacheKey('fen4', 18, 3, CACHE_VERSION + 1),
    'a rebuild produces a different key for the same search',
  );
  assert.ok(cacheKey('fen4', 18, 3, CACHE_VERSION).endsWith(`v${CACHE_VERSION}`), 'the version is in the key');
});

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
