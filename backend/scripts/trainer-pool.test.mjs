// Pins the trainer pool's production behaviour (backend/src/services/puzzleTrainer.js).
//   run with: npm run test:trainer-pool   (from backend/)
//
// The deployed app answered every trainer request with
// `relation "lichess_puzzles" does not exist`: the table and its 6.1M-row import
// existed only on the machine that built the feature. The service now installs
// its own pool from data/trainerPuzzlePool.json on first use, and these tests
// drive that path against an in-memory pg stand-in — no database is contacted.
//
// The properties that matter are the ones that could still break production: a
// pool that already has rows must never be rewritten, a failure must not stick,
// the shipped file must reach the image, and every seeded row must be solvable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = require(join(BACKEND, 'src', 'config', 'database.js'));

const SEED = JSON.parse(readFileSync(join(BACKEND, 'data', 'trainerPuzzlePool.json'), 'utf8'));
const { LEVELS } = require(join(BACKEND, 'src', 'services', 'puzzleTrainer.js'));

/** A fresh copy of the service so its memoised pool state starts clean. */
function loadService() {
  delete require.cache[require.resolve(join(BACKEND, 'src', 'services', 'puzzleTrainer.js'))];
  return require(join(BACKEND, 'src', 'services', 'puzzleTrainer.js'));
}

const asRows = (list) =>
  list.map(([puzzle_id, fen, moves, rating, themes]) => ({ puzzle_id, fen, moves, rating, themes }));

/**
 * pg stand-in holding the one table this module touches.
 * `table` is what the database has beforehand, so a test can be the production
 * case (no table at all) or the healthy case (the full Lichess import).
 */
function stubDb({ table = null, rows = [] } = {}) {
  const state = { ddl: [], selects: [], log: [], inserts: 0, table, pool: rows.map((r) => ({ ...r })) };
  db.query = async (sql, params = []) => {
    const flat = sql.replace(/\s+/g, ' ').trim();
    state.log.push({ sql: flat, params });
    if (sql.includes('to_regclass')) return { rows: [{ t: state.table }] };
    if (sql.startsWith('CREATE')) { state.ddl.push(flat); return { rows: [] }; }
    if (sql.includes('count(*)::int')) return { rows: [{ n: state.pool.length }] };
    if (sql.startsWith('INSERT INTO lichess_puzzles')) {
      for (let i = 0; i < params.length; i += 5) {
        state.pool.push({
          puzzle_id: params[i], fen: params[i + 1], moves: params[i + 2],
          rating: params[i + 3], themes: params[i + 4],
        });
      }
      state.inserts += params.length / 5;
      return { rows: [] };
    }
    if (sql.startsWith('SELECT puzzle_id')) {
      state.selects.push({ sql: flat, params });
      const [min, exclude, max] = params;
      return {
        rows: state.pool
          .filter((r) => r.rating >= min && (max == null || r.rating < max) && !exclude.includes(r.puzzle_id))
          .slice(0, 24)
          .map((r) => ({ puzzle_id: r.puzzle_id, fen: r.fen, moves: r.moves })),
      };
    }
    throw new Error(`unhandled stub query: ${flat.slice(0, 60)}`);
  };
  return state;
}

test('the shipped pool covers every band and every row is solvable', () => {
  const { toTrainerPuzzle } = require(join(BACKEND, 'src', 'services', 'puzzleGenerator', 'lichessSource.js'));
  assert.equal(SEED.length, 2500);
  for (const band of LEVELS) {
    const inBand = SEED.filter((r) => r[3] >= band.min && (band.max == null || r[3] < band.max));
    assert.equal(inBand.length, 500, `band ${band.min} should hold 500 rows`);
  }
  const ids = new Set();
  const fens = new Set();
  for (const [id, fen, moves, rating, themes] of SEED) {
    const puzzle = toTrainerPuzzle({ puzzle_id: id, fen, moves });
    assert.ok(puzzle, `${id} does not walk the solver-first line`);
    assert.ok(puzzle.moves.length >= 1, `${id} has no solution`);
    assert.ok(Array.isArray(themes) && themes.length > 0, `${id} has no themes for the generator`);
    assert.ok(rating >= 400, `${id} has no usable rating`);
    assert.ok(!ids.has(id), `duplicate puzzle id ${id}`);
    assert.ok(!fens.has(puzzle.fen), `${id} repeats a position another row teaches`);
    ids.add(id);
    fens.add(puzzle.fen);
  }
});

test('a database without the table gets it created and seeded', async () => {
  const state = stubDb({ table: null, rows: [] });
  const svc = loadService();
  const n = await svc.ensurePool();
  assert.equal(n, 2500);
  assert.equal(state.inserts, 2500, 'every seeded row must be inserted');
  assert.ok(state.ddl.some((d) => d.startsWith('CREATE TABLE IF NOT EXISTS lichess_puzzles')));
  assert.ok(state.ddl.some((d) => d.startsWith('CREATE INDEX IF NOT EXISTS lichess_puzzles_rating')), 'rating index missing');
  assert.ok(state.ddl.some((d) => d.startsWith('CREATE INDEX IF NOT EXISTS lichess_puzzles_themes')), 'themes index missing');
});

test('seeding is batched and cannot overwrite anything', async () => {
  const state = stubDb({ table: null, rows: [] });
  const svc = loadService();
  await svc.ensurePool();
  const inserts = state.log.filter((q) => q.sql.startsWith('INSERT INTO lichess_puzzles'));
  assert.equal(inserts.length, 10, `expected ten batches, got ${inserts.length}`);
  assert.equal(state.inserts, 2500);
  assert.ok(inserts.every((q) => q.params.length / 5 <= 250), 'a batch grew past 250 rows');
  /* Guarded because a hand-run Lichess import can overlap the shipped pool: the
     duplicate must be skipped, not abort the whole install. */
  assert.ok(inserts.every((q) => q.sql.includes('ON CONFLICT DO NOTHING')), 'an insert could overwrite live rows');
});

test('a pool that already has rows is never created over or reseeded', async () => {
  const state = stubDb({ table: 'lichess_puzzles', rows: asRows(SEED.slice(0, 600)) });
  const svc = loadService();
  const n = await svc.ensurePool();
  assert.equal(n, 600);
  assert.equal(state.ddl.length, 0, 'DDL ran against a database that already has the table');
  assert.equal(state.inserts, 0, 'a populated pool must not be written to');
  assert.equal(state.pool.length, 600, 'the existing rows were modified');
});

test('a small pool is read whole because a page sample would round to nothing', async () => {
  const state = stubDb({ table: 'lichess_puzzles', rows: asRows(SEED) });
  const svc = loadService();
  const puzzle = await svc.pickTrainerPuzzle({ level: 0, seen: '' });
  assert.ok(puzzle && puzzle.id, 'nothing was drawn from the shipped pool');
  assert.equal(state.selects.length, 1);
  assert.ok(!state.selects[0].sql.includes('TABLESAMPLE'), 'a 2,500-row table was sampled');
});

test('a large pool keeps the page sample that makes 6M rows cheap', async () => {
  const big = asRows(SEED).concat(
    Array.from({ length: 50000 }, (_, i) => ({
      puzzle_id: `synthetic${i}`, fen: SEED[0][1], moves: SEED[0][2], rating: SEED[0][3], themes: SEED[0][4],
    }))
  );
  const state = stubDb({ table: 'lichess_puzzles', rows: big });
  const svc = loadService();
  await svc.pickTrainerPuzzle({ level: 0, seen: '' });
  assert.ok(state.selects[0].sql.includes('TABLESAMPLE SYSTEM'), 'the full import stopped being sampled');
});

test('a fully seen band serves a repeat instead of running dry', async () => {
  const bandRows = asRows(SEED.filter((r) => r[3] >= 400 && r[3] < 800));
  const state = stubDb({ table: 'lichess_puzzles', rows: bandRows });
  const svc = loadService();
  const puzzle = await svc.pickTrainerPuzzle({ level: 0, seen: bandRows.map((r) => r.puzzle_id).join(',') });
  assert.ok(puzzle, 'the trainer dead-ended on a band the student has finished');
  assert.equal(state.selects.length, 2, 'expected the exclusion query, then the repeat query');
  assert.deepEqual(state.selects[1].params[1], [], 'the retry still excluded the seen ids');
});

test('a database failure is not memoised into permanent silence', async () => {
  db.query = async () => { throw new Error('connection reset by peer'); };
  const svc = loadService();
  await assert.rejects(() => svc.ensurePool(), /connection reset/);
  const state = stubDb({ table: null, rows: [] });
  await assert.doesNotReject(() => svc.ensurePool());
  assert.equal(state.inserts, 2500, 'the retry did not rebuild the pool');
});

test('the pool file is not shut out of the Railway image', () => {
  const ignored = readFileSync(join(BACKEND, '.railwayignore'), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('!'));
  const target = 'data/trainerPuzzlePool.json';
  const hit = ignored.find((p) => target === p || (p.endsWith('*') && target.startsWith(p.slice(0, -1))));
  assert.equal(hit, undefined, `${hit} would exclude the trainer pool from the deploy`);
});
