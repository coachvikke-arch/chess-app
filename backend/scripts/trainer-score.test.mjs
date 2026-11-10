// Pins the trainer's points and ladder (backend/src/services/puzzleTrainerScore.js).
//   run with: npm run test:trainer-score   (from backend/)
//
// No database is contacted. `db.query` and `db.pool.connect()` are both routed to
// one in-memory model, so the transaction, the composite-key idempotency and the
// aggregate upsert are exercised for real against the SQL the service sends.
//
// The ladder query is the one thing a stand-in cannot execute: its SQL is asserted
// structurally (where the privacy filter sits, what decides rank, how the viewer's
// own row survives the top-ten cut) and its RESPONSE MAPPING is driven with rows
// shaped the way Postgres returns them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = require(join(BACKEND, 'src', 'config', 'database.js'));
const { toTrainerPuzzle } = require(join(BACKEND, 'src', 'services', 'puzzleGenerator', 'lichessSource.js'));

const SEED = JSON.parse(readFileSync(join(BACKEND, 'data', 'trainerPuzzlePool.json'), 'utf8'));
const [POOL_ID, POOL_FEN, POOL_MOVES] = SEED[0];
const SOLUTION = toTrainerPuzzle({ puzzle_id: POOL_ID, fen: POOL_FEN, moves: POOL_MOVES }).moves;
const [OTHER_ID, OTHER_FEN, OTHER_MOVES] = SEED[1];
const OTHER_SOLUTION = toTrainerPuzzle({ puzzle_id: OTHER_ID, fen: OTHER_FEN, moves: OTHER_MOVES }).moves;
const POOL = [
  { puzzle_id: POOL_ID, fen: POOL_FEN, moves: POOL_MOVES },
  { puzzle_id: OTHER_ID, fen: OTHER_FEN, moves: OTHER_MOVES },
];

const SERVICE_PATH = join(BACKEND, 'src', 'services', 'puzzleTrainerScore.js');
const POOL_PATH = join(BACKEND, 'src', 'services', 'puzzleTrainer.js');

/** A fresh copy of both services so their memoised install state starts clean. */
function loadService() {
  delete require.cache[require.resolve(SERVICE_PATH)];
  delete require.cache[require.resolve(POOL_PATH)];
  return require(SERVICE_PATH);
}

/**
 * In-memory pg stand-in. `ladder` is the canned result of the ranked query;
 * `failAt` throws at one stage so the rollback path can be proved.
 */
function stubDb({ users = { 7: 'Meera', 8: 'Arjun' }, ladder = [], failAt = null } = {}) {
  const state = {
    log: [], ddl: [], begin: 0, commit: 0, rollback: 0, released: 0,
    users: new Map(Object.entries(users).map(([id, name]) => [Number(id), name])),
    solves: new Map(), scores: new Map(), ladder, failAt,
    snapshot: null,
  };

  const run = async (sql, params = []) => {
    const flat = sql.replace(/\s+/g, ' ').trim();
    state.log.push({ sql: flat, params });
    if (state.failAt && flat.includes(state.failAt)) throw new Error(`stub failure at ${state.failAt}`);

    if (sql === 'BEGIN') {
      state.begin += 1;
      state.snapshot = { solves: new Map(state.solves), scores: new Map(state.scores) };
      return { rows: [] };
    }
    if (sql === 'COMMIT') { state.commit += 1; state.snapshot = null; return { rows: [] }; }
    if (sql === 'ROLLBACK') {
      state.rollback += 1;
      if (state.snapshot) { state.solves = state.snapshot.solves; state.scores = state.snapshot.scores; }
      state.snapshot = null;
      return { rows: [] };
    }
    if (sql.includes('to_regclass')) return { rows: [{ t: 'lichess_puzzles' }] };
    if (sql.startsWith('CREATE')) { state.ddl.push(flat); return { rows: [] }; }
    if (sql.includes('count(*)::int AS n FROM lichess_puzzles')) return { rows: [{ n: SEED.length }] };
    if (flat.startsWith('SELECT puzzle_id, fen, moves FROM lichess_puzzles WHERE puzzle_id')) {
      const row = POOL.find((r) => r.puzzle_id === params[0]);
      return { rows: row ? [row] : [] };
    }
    if (flat.startsWith('SELECT name FROM users WHERE id')) {
      const name = state.users.get(Number(params[0]));
      return { rows: name ? [{ name }] : [] };
    }
    if (flat.startsWith('INSERT INTO puzzle_trainer_solves')) {
      const [userId, puzzleId, points, firstTry, solveMs, level] = params;
      const key = `${userId}|${puzzleId}`;
      if (state.solves.has(key)) return { rows: [] };   // ON CONFLICT DO NOTHING
      state.solves.set(key, { userId, puzzleId, points, firstTry, solveMs, level });
      return { rows: [{ points }] };
    }
    if (flat.startsWith('INSERT INTO puzzle_trainer_scores')) {
      const [userId, name, points] = params;
      const prev = state.scores.get(userId) || { total_points: 0, solved_count: 0 };
      const next = { name, total_points: prev.total_points + points, solved_count: prev.solved_count + 1 };
      state.scores.set(userId, next);
      return { rows: [next] };
    }
    if (flat.startsWith('SELECT total_points, solved_count FROM puzzle_trainer_scores')) {
      const row = state.scores.get(Number(params[0]));
      return { rows: row ? [row] : [] };
    }
    if (flat.startsWith('WITH visible AS')) {
      state.ladderSql = flat;
      state.ladderParams = params;
      return { rows: state.ladder };
    }
    throw new Error(`unhandled stub query: ${flat.slice(0, 80)}`);
  };

  db.query = run;
  db.pool = {
    connect: async () => ({
      query: run,
      release: () => { state.released += 1; },
    }),
  };
  return state;
}

const solve = (svc, over = {}) => svc.recordSolve({
  userId: 7, puzzleId: POOL_ID, line: SOLUTION, firstTry: true, solveMs: 9000, level: 0, ...over,
});

/* ─────────────── the submitted line ─────────────── */

test('a line is cleaned, and anything that is not UCI is refused', () => {
  const svc = loadService();
  assert.deepEqual(svc.normalizeLine([' E2E4 ', 'e7e5']), ['e2e4', 'e7e5']);
  assert.deepEqual(svc.normalizeLine('e2e4 e7e5'), ['e2e4', 'e7e5']);
  assert.deepEqual(svc.normalizeLine(['e7e8q']), ['e7e8q'], 'a promotion is a legal ply');
  assert.equal(svc.normalizeLine([]), null);
  assert.equal(svc.normalizeLine(['e2e4', 'nonsense']), null);
  assert.equal(svc.normalizeLine(['e2e9']), null);
  assert.equal(svc.normalizeLine(Array.from({ length: 41 }, () => 'e2e4')), null, 'an unbounded line was accepted');
});

/* ─────────────── the award ─────────────── */

test('a clean first try inside the speed window is worth 10 + 2', async () => {
  const state = stubDb();
  const svc = loadService();
  const out = await solve(svc);
  assert.equal(out.ok, true);
  assert.equal(out.counted, true, 'a student solve must be reported as counted');
  assert.equal(out.credited, true);
  assert.equal(out.points, 12);
  assert.equal(out.base_points, 10);
  assert.equal(out.bonus_points, 2);
  assert.equal(out.total_points, 12);
  assert.equal(out.solved_count, 1);
  assert.equal(state.scores.get(7).name, 'Meera', 'the name snapshot was not stored');
  assert.equal(state.solves.get(`7|${POOL_ID}`).firstTry, true);
  assert.equal(state.commit, 1);
  assert.equal(state.rollback, 0);
  assert.equal(state.released, 1, 'the connection leaked');
  assert.ok(out.leaderboard && Array.isArray(out.leaderboard.top), 'the fresh ladder did not ride back with the award');
});

test('a wrong move costs the solve 5 points, and earns nothing itself', async () => {
  stubDb();
  const svc = loadService();
  const out = await solve(svc, { firstTry: false });
  assert.equal(out.points, 7, 'after a miss: 5 + the 2 speed bonus');
  assert.equal(out.base_points, 5);
  assert.equal(svc.SCORING.wrong_move, 0);
});

test('the speed bonus stops at 30 s, and an unreported time earns none', async () => {
  /* One ledger per case: the same puzzle solved twice is a replay, and a replay
     is worth 0 by design, which would hide what the window actually does. */
  const cases = [
    [{ solveMs: 30000 }, 12, 'the window is inclusive'],
    [{ solveMs: 30001 }, 10],
    [{ solveMs: null }, 10],
    [{ solveMs: undefined }, 10],
    [{ solveMs: '' }, 10, 'an empty claim is not a time of 0 ms'],
    [{ solveMs: true }, 10],
    [{ solveMs: 'fast' }, 10],
    [{ solveMs: -5 }, 10, 'a negative claim must not buy the bonus'],
    [{ firstTry: false, solveMs: 30001 }, 5],
  ];
  for (const [over, expected, why] of cases) {
    stubDb();
    const svc = loadService();
    assert.equal((await solve(svc, over)).points, expected, why || `solveMs ${over.solveMs}`);
  }
});

test('the same puzzle can only be credited once', async () => {
  const state = stubDb();
  const svc = loadService();
  const first = await solve(svc);
  const again = await solve(svc);
  assert.equal(first.credited, true);
  assert.equal(again.credited, false);
  assert.equal(again.already, true);
  assert.equal(again.points, 0);
  assert.equal(again.total_points, 12, 'a replay changed the total');
  assert.equal(again.solved_count, 1);
  assert.equal(state.solves.size, 1);
  assert.equal(state.scores.get(7).total_points, 12);
});

test('a second puzzle adds to the same row instead of replacing it', async () => {
  const state = stubDb();
  const svc = loadService();
  await solve(svc);
  const out = await solve(svc, { puzzleId: OTHER_ID, line: OTHER_SOLUTION, firstTry: false, solveMs: 60000 });
  assert.equal(out.points, 5);
  assert.equal(out.total_points, 17);
  assert.equal(out.solved_count, 2);
  assert.equal(state.solves.size, 2, 'the second solve overwrote the first');
});

test('a line that does not solve the puzzle writes nothing', async () => {
  const state = stubDb();
  const svc = loadService();
  const out = await solve(svc, { line: ['e2e4'] });
  assert.deepEqual(out, { ok: false, reason: 'line' });
  assert.equal(state.solves.size, 0);
  assert.equal(state.scores.size, 0);
  assert.equal(state.begin, 0, 'a rejected line opened a transaction');
});

test('an id outside the pool is refused before any write', async () => {
  const state = stubDb();
  const svc = loadService();
  assert.deepEqual(await solve(svc, { puzzleId: 'nope' }), { ok: false, reason: 'puzzle' });
  assert.deepEqual(await solve(svc, { puzzleId: '' }), { ok: false, reason: 'puzzle' });
  assert.deepEqual(await solve(svc, { puzzleId: 'x'.repeat(21) }), { ok: false, reason: 'puzzle' });
  assert.equal(state.solves.size, 0);
});

test('a staff solve is verified but never written or ranked', async () => {
  const state = stubDb();
  const svc = loadService();
  const out = await solve(svc, { count: false });
  assert.equal(out.ok, true);
  assert.equal(out.counted, false);
  assert.equal(out.practice, true);
  assert.equal(out.credited, false);
  assert.equal(out.points, 0);
  assert.equal(out.total_points, 0);
  assert.equal(state.solves.size, 0, 'staff practice wrote a ledger row');
  assert.equal(state.scores.size, 0, 'staff practice opened a ladder row');
  assert.equal(state.begin, 0, 'staff practice opened a transaction');
  assert.equal(state.released, 0, 'staff practice took a pooled connection');
  assert.ok(Array.isArray(out.leaderboard.top), 'staff should still see the student ladder');

  /* The line is still the real solution check, not a free pass. */
  assert.deepEqual(await solve(svc, { count: false, line: ['e2e4'] }), { ok: false, reason: 'line' });
});

test('a token naming a deleted account rolls back instead of writing an orphan', async () => {
  const state = stubDb({ users: {} });
  const svc = loadService();
  assert.deepEqual(await solve(svc), { ok: false, reason: 'user' });
  assert.equal(state.rollback, 1);
  assert.equal(state.commit, 0);
  assert.equal(state.released, 1);
});

test('a failed aggregate write rolls the ledger back so the retry can still credit', async () => {
  const state = stubDb({ failAt: 'INSERT INTO puzzle_trainer_scores' });
  const svc = loadService();
  await assert.rejects(() => solve(svc), /stub failure/);
  assert.equal(state.rollback, 1);
  assert.equal(state.solves.size, 0, 'the solve stayed credited-able while its points were lost');
  assert.equal(state.released, 1);

  state.failAt = null;
  const retry = await solve(svc);
  assert.equal(retry.credited, true, 'the retry was told "already counted" and never paid');
  assert.equal(retry.total_points, 12);
});

/* ─────────────── the ladder ─────────────── */

const ladderRow = (rank, userId, name, points, solved, extra = {}) => ({
  rank, user_id: userId, name, total_points: points, solved_count: solved,
  avatar_config: null, profile_image: null, updated_at: '2026-11-10T09:00:00Z', players: 42, ...extra,
});

test('the ladder ranks on points, then solves, then name — and hides private students inside the ranked set', async () => {
  const state = stubDb({ ladder: [ladderRow(1, 8, 'Arjun', 120, 12)] });
  const svc = loadService();
  await svc.trainerLeaderboard({ viewerId: 7 });
  const sql = state.ladderSql;
  assert.match(sql, /ORDER BY v\.total_points DESC, v\.solved_count DESC, v\.name ASC, v\.user_id ASC/);
  /* The privacy filter has to sit in `visible`, BEFORE the window function: applied
     after ranking it would leave gaps (1, 2, 4…) in the public top ten. */
  const visible = sql.slice(sql.indexOf('WITH visible AS'), sql.indexOf('), ranked AS'));
  assert.match(visible, /u\.role = 'student'/,
    'a staff row could reach the student ladder');
  assert.match(visible, /COALESCE\(s\.hide_from_leaderboard, FALSE\) = FALSE OR sc\.user_id = \$1/);
  assert.match(sql, /WHERE r\.rank <= \$2 OR r\.user_id = \$1/, 'the viewer outside the top ten was cut');
  assert.match(sql, /\(SELECT count\(\*\) FROM visible\)::int AS players/);
  assert.deepEqual(state.ladderParams, [7, 10]);
});

test('the live name wins over the stored snapshot, so a rename reaches the ladder', async () => {
  const state = stubDb({ ladder: [ladderRow(1, 8, 'Arjun', 120, 12)] });
  const svc = loadService();
  const board = await svc.trainerLeaderboard({ viewerId: 7 });
  assert.match(state.ladderSql, /JOIN users u ON u\.id = sc\.user_id/);
  assert.match(state.ladderSql, /COALESCE\(u\.name, sc\.name\) AS name/);
  assert.equal(board.top[0].name, 'Arjun');
});

test('the response splits the top ten, the viewer and the player count', async () => {
  const rows = Array.from({ length: 10 }, (_, i) => ladderRow(i + 1, 100 + i, `Player ${i}`, 500 - i * 10, 50 - i));
  rows.push(ladderRow(14, 7, 'Meera', 96, 9));
  stubDb({ ladder: rows });
  const svc = loadService();
  const board = await svc.trainerLeaderboard({ viewerId: 7 });
  assert.equal(board.top.length, 10);
  assert.equal(board.top[0].rank, 1);
  assert.equal(board.players, 42);
  assert.equal(board.me.rank, 14, 'the viewer outside the top ten lost their row');
  assert.equal(board.me.user_id, 7);
  assert.equal(board.me.total_points, 96);
  assert.deepEqual(board.scoring, svc.SCORING);
  assert.ok(!board.top.some((r) => r.user_id === 7));
});

test('a viewer inside the top ten appears once, highlighted by id', async () => {
  stubDb({ ladder: [ladderRow(1, 8, 'Arjun', 120, 12), ladderRow(2, 7, 'Meera', 96, 9)] });
  const svc = loadService();
  const board = await svc.trainerLeaderboard({ viewerId: 7 });
  assert.equal(board.top.length, 2);
  assert.equal(board.me.rank, 2);
  assert.equal(board.top.filter((r) => r.user_id === 7).length, 1);
});

test('an unranked viewer and an empty ladder are both answered, not errored', async () => {
  stubDb({ ladder: [] });
  const svc = loadService();
  const empty = await svc.trainerLeaderboard({ viewerId: 7 });
  assert.deepEqual(empty.top, []);
  assert.equal(empty.me, null);
  assert.equal(empty.players, 0);

  stubDb({ ladder: [ladderRow(1, 8, 'Arjun', 120, 12)] });
  const fresh = await loadService().trainerLeaderboard({ viewerId: 7 });
  assert.equal(fresh.me, null, 'a student with no solve yet was given a rank');
  assert.equal(fresh.players, 42);
});

test('bigint columns arrive as strings and still read as numbers', async () => {
  stubDb({ ladder: [ladderRow('14', '7', 'Meera', '96', '9', { players: '42' })] });
  const svc = loadService();
  const board = await svc.trainerLeaderboard({ viewerId: 7 });
  assert.equal(board.me.rank, 14);
  assert.equal(board.me.total_points, 96);
  assert.equal(board.players, 42);
});

test('the limit is bounded so a hand-crafted request cannot ask for the whole academy', async () => {
  const state = stubDb({ ladder: [] });
  const svc = loadService();
  await svc.trainerLeaderboard({ viewerId: 7, limit: 5000 });
  assert.equal(state.ladderParams[1], 50);
  await svc.trainerLeaderboard({ viewerId: 7, limit: 0 });
  assert.equal(state.ladderParams[1], 10);
});

/* ─────────────── install, wiring, migration ─────────────── */

test('the score tables install themselves once, and a failure is not memoised', async () => {
  const state = stubDb();
  const svc = loadService();
  await svc.ensureScores();
  await svc.ensureScores();
  assert.equal(state.ddl.length, 4, 'the install ran twice for one container');
  assert.ok(state.ddl.some((d) => d.startsWith('CREATE TABLE IF NOT EXISTS puzzle_trainer_scores')));
  assert.ok(state.ddl.some((d) => d.startsWith('CREATE TABLE IF NOT EXISTS puzzle_trainer_solves')));
  assert.ok(state.ddl.every((d) => d.includes('IF NOT EXISTS')), 'an install could overwrite a live table');

  const broken = stubDb({ failAt: 'CREATE TABLE IF NOT EXISTS puzzle_trainer_solves' });
  const svc2 = loadService();
  await assert.rejects(() => svc2.ensureScores(), /stub failure/);
  broken.failAt = null;
  await assert.doesNotReject(() => svc2.ensureScores());
});

test('the ledger key is the idempotency rule, in the DDL and in the insert', async () => {
  const state = stubDb();
  const svc = loadService();
  await solve(svc);
  const ddl = state.ddl.find((d) => d.startsWith('CREATE TABLE IF NOT EXISTS puzzle_trainer_solves'));
  assert.match(ddl, /PRIMARY KEY \(user_id, puzzle_id\)/);
  const insert = state.log.find((q) => q.sql.startsWith('INSERT INTO puzzle_trainer_solves'));
  assert.match(insert.sql, /ON CONFLICT \(user_id, puzzle_id\) DO NOTHING/);
  const upsert = state.log.find((q) => q.sql.startsWith('INSERT INTO puzzle_trainer_scores'));
  assert.match(upsert.sql, /total_points = puzzle_trainer_scores\.total_points \+ EXCLUDED\.total_points/);
  assert.match(upsert.sql, /solved_count = puzzle_trainer_scores\.solved_count \+ 1/);
});

test('both trainer writes are declared above the /:id readers', () => {
  const routes = readFileSync(join(BACKEND, 'src', 'routes', 'puzzleRoutes.js'), 'utf8');
  const wildcard = routes.indexOf("router.get('/:id'");
  for (const needle of ["router.post('/trainer/solve'", "router.get('/trainer/leaderboard'"]) {
    const at = routes.indexOf(needle);
    assert.ok(at > -1, `${needle} is not routed`);
    assert.ok(at < wildcard, `${needle} sits below /:id and would be swallowed`);
    const line = routes.slice(at, routes.indexOf('\n', at));
    assert.match(line, /trainerRoles/);
    assert.match(line, /trainerAccess/);
  }
});

test('staff reach the trainer, but the feature switch still governs students', () => {
  const routes = readFileSync(join(BACKEND, 'src', 'routes', 'puzzleRoutes.js'), 'utf8');
  assert.match(routes, /roleMiddleware\('student', 'admin'\)/, 'staff were left out of the trainer roles');
  const gate = routes.slice(routes.indexOf('function trainerAccess'), routes.indexOf('const trainerRoles'));
  assert.match(gate, /isAdminRole\(req\.user\?\.role\)\) return next\(\)/,
    'staff must not be checked against a student feature switch');
  assert.match(gate, /requireFeature\('puzzle_trainer'\)\(req, res, next\)/,
    'students lost their puzzle_trainer gate');
});

test('the migration file carries the same tables and columns as the self-install', () => {
  const sql = readFileSync(join(BACKEND, 'migrations', 'add_puzzle_trainer_scores.sql'), 'utf8');
  for (const needle of [
    'CREATE TABLE IF NOT EXISTS puzzle_trainer_scores',
    'CREATE TABLE IF NOT EXISTS puzzle_trainer_solves',
    'total_points INTEGER NOT NULL DEFAULT 0',
    'solved_count INTEGER NOT NULL DEFAULT 0',
    'updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    'PRIMARY KEY (user_id, puzzle_id)',
    'puzzle_trainer_scores_ladder_idx',
  ]) {
    assert.ok(sql.includes(needle), `migration is missing ${needle}`);
  }
});

test('the score tables are installed at boot, not on a student’s first solve', () => {
  const boot = readFileSync(join(BACKEND, 'server.js'), 'utf8');
  const warm = boot.match(/require\('\.\/src\/services\/puzzleTrainerScore'\)\.ensureScores\(\)[\s\S]{0,200}/);
  assert.ok(warm, 'server.js no longer warms the trainer score tables');
  assert.ok(warm[0].includes('.catch'), 'a failed install could crash the server');
});