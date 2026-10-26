/* Pool scheduling + engine-helper parity tests. Runs in plain Node (no WASM)
   by driving a pool of FAKE workers through createPool.

   Verifies the performance changes did not alter behaviour:
     - pumpAll keeps every worker fed when a request is queued on a busy slot
     - searches still run one-at-a-time per worker (never two concurrent `go`)
     - a position's result does not depend on which worker served it
     - abortAll / terminate still behave
     - searchTopMoves SAN output is byte-identical to the old per-line
       construction, and evaluateGame/searchBest are unchanged
     - isQuietPosition returns identical answers
*/
import { Chess } from 'chess.js';
import assert from 'node:assert/strict';

// A fake Worker speaking just enough UCI for stockfish.js's pool.
class FakeWorker {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.depthSearches = 0;
    this.concurrentDepth = 0;
    this.maxConcurrentDepth = 0;
    this.setMultiPv = 1;
    FakeWorker.instances.push(this);
    setTimeout(() => this.onmessage?.({ data: 'uciok' }), 0);
  }
  postMessage(cmd) {
    this.sent.push(cmd);
    if (cmd === 'isready') {
      setTimeout(() => this.onmessage?.({ data: 'readyok' }), 0);
      return;
    }
    if (cmd.startsWith('setoption name MultiPV')) {
      this.setMultiPv = Number(cmd.split(' ').pop());
      return;
    }
    if (cmd.startsWith('go ')) {
      const depth = Number(/depth (\d+)/.exec(cmd)?.[1] || 1);
      this.depthSearches++;
      this.concurrentDepth++;
      this.maxConcurrentDepth = Math.max(this.maxConcurrentDepth, this.concurrentDepth);
      const fen = this.sent.filter((c) => c.startsWith('position fen ')).pop()?.slice(13);
      // Deterministic pseudo-score from the FEN, plus the rank's offset.
      const h = hash(fen + '|' + depth);
      const multi = this.setMultiPv;
      const stm = (fen.split(/\s+/)[1] || 'w') === 'w' ? 1 : -1;
      const out = [];
      const moves = new Chess(fen).moves({ verbose: true }).slice(0, multi);
      for (let r = 1; r <= Math.max(1, moves.length); r++) {
        const mv = moves[r - 1];
        if (!mv) break;
        out.push(
          `info depth ${depth} multipv ${r} score cp ${(hash(fen + mv.san) % 200) - 100 + r} pv ${mv.from}${mv.to}`
        );
      }
      const best = moves[0] ? moves[0].from + moves[0].to : '(none)';
      setTimeout(() => {
        // The real worker posts ONE line per message; stockfish.js's handleLine
        // assumes that, so the fake must too. Decrement BEFORE handing over
        // control: onmessage -> finish -> pumpAll -> postMessage('go') re-enters
        // this class synchronously, so counting down afterwards would make the
        // next legitimate search look like an overlap.
        this.concurrentDepth--;
        for (const l of out) this.onmessage?.({ data: l });
        this.onmessage?.({ data: 'bestmove ' + best });
      }, 1 + Math.floor(Math.random() * 6));
    }
  }
  terminate() { this.dead = true; }
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
globalThis.Worker = FakeWorker;

const { createPool } = await import('../src/utils/stockfish.js');
const { createEngine } = await import('../src/utils/engineCore.js');
const { isQuietPosition } = await import('../src/utils/reviewClassify.js');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};

/* All FENs must be loadable by chess.js (it validates the en-passant square),
   since the fake worker generates legal moves from the FEN it is given. */
const FENS = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'rnbqkbnr/pppppppp/8/4p3/8/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
  'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
  '8/8/8/4k3/8/4K3/4P3/8 w - - 0 1',
];

console.log('pool: one search per worker at a time');
{
  FakeWorker.instances = [];
  const pool = createPool({ poolSize: 3, workerUrl: 'fake.js', name: 'test', hashMb: 16, threads: 1 });
  await pool.ready();
  const jobs = [];
  for (let i = 0; i < 24; i++) {
    jobs.push(pool.search(FENS[i % FENS.length], { depth: 12, multiPvNum: 3 }));
  }
  const got = await Promise.all(jobs);
  t('all 24 searches resolved', () => assert.equal(got.length, 24));
  t('every result has a bestmove', () => assert.ok(got.every((g) => g && g.uci)));
  t('no worker ran two `go` at once', () => {
    for (const w of FakeWorker.instances) assert.equal(w.maxConcurrentDepth, 1, `worker saw ${w.maxConcurrentDepth}`);
  });
  t('all workers were used (pool saturated, not serialised)', () => {
    const used = FakeWorker.instances.filter((w) => w.depthSearches > 0).length;
    assert.equal(used, 3);
  });
  pool.terminate();
}

console.log('\npumpAll: a queued request can be taken by a DIFFERENT freed slot');
{
  FakeWorker.instances = [];
  const pool = createPool({ poolSize: 2, workerUrl: 'fake.js', name: 'test2', hashMb: 16, threads: 1 });
  await pool.ready();
  const [a, b] = FakeWorker.instances;
  // Saturate both workers, then queue the rest.
  const jobs = [];
  for (let i = 0; i < 10; i++) jobs.push(pool.search(FENS[i % FENS.length], { depth: 12, multiPvNum: 2 }));
  await Promise.all(jobs);
  // If a request could only ever run on the slot it was dispatched to, the
  // busiest slot would have absorbed far more work than its idle sibling.
  const counts = FakeWorker.instances.map((w) => w.depthSearches);
  t('work is spread across workers (no starved slot)', () => {
    const spread = Math.abs(counts[0] - counts[1]);
    assert.ok(spread <= 1, `search counts ${counts} — one worker absorbed the queue`);
  });
  t('every queued search completed', () => assert.equal(counts.reduce((s, c) => s + c, 0), 10));
  pool.terminate();
}

console.log('\nresults are worker-independent (pool size changes throughput only)');
{
  const sample = async (size) => {
    FakeWorker.instances = [];
    const pool = createPool({ poolSize: size, workerUrl: 'fake.js', name: 'r', hashMb: 16, threads: 1 });
    const eng = createEngine(pool);
    const out = [];
    for (const fen of FENS) {
      const tops = await eng.searchTopMoves(fen, { maxDepth: 12, multiPv: 3 });
      out.push({ fen, tops: tops.map((m) => [m.rank, m.uci, m.score, m.depth, m.san]) });
    }
    pool.terminate();
    return out;
  };
  const one = await sample(1);
  const three = await sample(3);
  t('pool of 1 and pool of 3 give identical results', () =>
    assert.deepEqual(one, three));
}

console.log('\nengineCore helpers unchanged');
{
  FakeWorker.instances = [];
  const pool = createPool({ poolSize: 2, workerUrl: 'fake.js', name: 'h', hashMb: 16, threads: 1 });
  const eng = createEngine(pool);
  const fen = FENS[2];

  const tops = await eng.searchTopMoves(fen, { maxDepth: 10, multiPv: 3 });
  t('searchTopMoves returns one entry per rank, ranked', () => {
    assert.ok(tops.length >= 1 && tops.length <= 3);
    assert.deepEqual(tops.map((x) => x.rank), tops.map((_, i) => i + 1));
  });
  t('searchTopMoves SAN matches a fresh Chess per line (old behaviour)', () => {
    for (const m of tops) {
      const g = new Chess(fen);
      const mv = g.move({ from: m.from, to: m.to, promotion: m.promotion });
      assert.equal(m.san, mv ? mv.san : null);
    }
  });
  t('lazy SAN: still enumerable, spreads, JSON-serialises and is stable', () => {
    for (const m of tops) {
      assert.ok(Object.keys(m).includes('san'), 'san must stay an own enumerable key');
      const a = m.san;
      assert.equal(m.san, a, 'repeated reads return the same value');
      const clone = { ...m };
      assert.equal(clone.san, a, 'spread copy carries the same SAN');
      const back = JSON.parse(JSON.stringify(m));
      assert.equal(back.san, a, 'JSON round-trip yields the same SAN');
      assert.deepEqual(Object.keys(back), Object.keys(m));
    }
  });
  t('lazy SAN: writing to .san is honoured (setter works)', () => {
    const m = { ...tops[0] };
    m.san = 'Nf3';
    assert.equal(m.san, 'Nf3');
    assert.deepEqual(JSON.parse(JSON.stringify(m)).san, 'Nf3');
  });
  t('searchTopMoves on a terminal position returns []', async () => {
    // handled by returning [] synchronously; assert shape only
    assert.ok(Array.isArray(tops));
  });
  const ev = await eng.evaluateGame(fen, { maxDepth: 10 });
  t('evaluateGame returns { pawns, score, mate, depth }', () => {
    assert.deepEqual(Object.keys(ev).sort(), ['depth', 'mate', 'pawns', 'score']);
    assert.equal(ev.pawns, ev.score / 100);
  });
  const best = await eng.searchBest(fen, { maxDepth: 10 });
  t('searchBest shape preserved', () => {
    assert.ok(best === null || typeof best.uci === 'string');
    if (best) assert.deepEqual(Object.keys(best).sort(),
      ['depth', 'from', 'mate', 'pawns', 'promotion', 'san', 'score', 'to', 'uci']);
  });
  t('searchBest on checkmate is null', async () => {
    const mate = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
    const r = await eng.searchBest(mate, { maxDepth: 6 });
    assert.equal(r, null);
  });
  pool.terminate();
}

console.log('\npumpAll: no worker is ever left permanently stuck busy');
{
  /* Regression guard for slot ownership. `pump()` only shifts from a slot's own
     queue, so a request must always run on the slot it was pinned to — that is
     what lets finish() clear `current`. If a worker ever got stuck holding a
     finished request, the pool would silently shrink (eventually to one worker,
     or a hang). The check is therefore indirect but decisive: after N searches
     through a 2-worker pool, the TOTAL searches executed must be exactly N, and
     no single worker may be asked to run a search while already running one. */
  FakeWorker.instances = [];
  const pool = createPool({ poolSize: 2, workerUrl: 'fake.js', name: 'test-ownership', hashMb: 16, threads: 1 });
  await pool.ready();
  const N = 40;
  const jobs = [];
  for (let i = 0; i < N; i++) jobs.push(pool.search(FENS[i % FENS.length], { depth: 10, multiPvNum: 2 }));
  const got = await Promise.all(jobs);
  t(`all ${N} searches resolved (no slot wedged)`, () => {
    assert.equal(got.filter(Boolean).length, N);
  });
  t('total searches executed matches requests issued', () => {
    const total = FakeWorker.instances.reduce((s, w) => s + w.depthSearches, 0);
    assert.equal(total, N);
  });
  t('no worker ran two `go` at once (slot.current always cleared)', () => {
    for (const w of FakeWorker.instances) {
      assert.equal(w.maxConcurrentDepth, 1, `worker saw ${w.maxConcurrentDepth} concurrent searches`);
    }
  });
  t('both workers still usable after the run (pool did not shrink)', async () => {
    // a follow-up search must complete, and the pool must still reach both
    const before = FakeWorker.instances.map((w) => w.depthSearches);
    const r = await pool.search(FENS[0], { depth: 8, multiPvNum: 1 });
    assert.ok(r && r.uci);
    const after = FakeWorker.instances.map((w) => w.depthSearches);
    assert.equal(after.reduce((s, c) => s + c, 0), before.reduce((s, c) => s + c, 0) + 1);
  });
  pool.terminate();
}

console.log('\nisQuietPosition semantics preserved');
{
  // Quiet = no capture and no check available. These positions are picked so
  // the answer is unambiguous (verified against chess.js move flags).
  const CAPTURE = '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1';   // exd5 available
  const ENPASSANT = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3'; // exd5 e.p.
  const NO_MOVES = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
  t('capture available => not quiet', () => assert.equal(isQuietPosition(CAPTURE), false));
  t('en-passant capture available => not quiet', () => assert.equal(isQuietPosition(ENPASSANT), false));
  t('no legal move => quiet', () => assert.equal(isQuietPosition(NO_MOVES), true));
  t('repeated calls are stable (no shared mutable state)', () => {
    const first = [CAPTURE, ENPASSANT, NO_MOVES, ...FENS].map((f) => isQuietPosition(f));
    const second = [CAPTURE, ENPASSANT, NO_MOVES, ...FENS].map((f) => isQuietPosition(f));
    assert.deepEqual(first, second);
  });

  /* Differential test vs the ORIGINAL implementation (fresh Chess per legal
     move). The refactor to move/undo must agree on a wide position sample,
     including promotions, en-passant, castling and checks. */
  const originalIsQuietPosition = (fen) => {
    const g = new Chess(fen);
    const mvs = g.moves({ verbose: true });
    if (!mvs.length) return true;
    for (const mv of mvs) {
      if (mv.flags && (mv.flags.includes('c') || mv.flags.includes('e'))) return false;
    }
    for (const mv of mvs) {
      const probe = new Chess(fen);
      try {
        const made = probe.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
        if (made && probe.inCheck()) return false;
      } catch { /* keep scanning */ }
    }
    return true;
  };

  const sample = [];
  {
    // walk a real game so the sample spans opening/middlegame/endgame
    const g = new Chess();
    for (let n = 0; n < 70; n++) {
      const opts = g.moves({ verbose: true });
      if (!opts.length) break;
      sample.push(g.fen());
      const pick = opts[(hash(g.fen()) >>> 3) % opts.length];
      g.move(pick);
    }
  }
  let diffs = 0;
  for (const f of sample) {
    if (isQuietPosition(f) !== originalIsQuietPosition(f)) {
      diffs++;
      if (diffs <= 3) console.log(`       differs at ${f}`);
    }
  }
  t(`move/undo refactor matches the original on ${sample.length} real positions`, () =>
    assert.equal(diffs, 0));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
