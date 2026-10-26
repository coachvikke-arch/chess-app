// HTTP-level tests for the persistent game-analysis store
// (backend/src/services/unifiedProfileService.js, controllers/chessProfileController.js,
//  routes/chessProfileRoutes.js) - run with:
//     node --test scripts/analysis-store.test.mjs   (from backend/)
//
// The store is what makes "analyse once, reuse forever" true across devices:
// the complete canonical review lives in `imported_game_analysis`, keyed by
// (game_id, user_id), and the client validates the envelope it gets back.
//
// The regression this file exists for: the endpoint returned
// `{ data: envelope, created_at }` while the client validates the ENVELOPE.
// Every persistent lookup therefore looked like a miss, and Stockfish re-ran
// the whole review on every open of an already-reviewed game - with a complete
// analysis sitting in the database the whole time.
//
// The database is stubbed, so the assertions are about the CONTRACT: the
// response shape, the upsert, and the per-user scoping.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, '..');
const require = createRequire(import.meta.url);

/* ── the fake database ───────────────────────────────────────────────────────
   Queries are matched on their distinctive text. Anything unmatched THROWS:
   a silent default would let a query the test never anticipated return "no
   rows" and pass a 404 check for entirely the wrong reason. */

let JOBS = [];      // [{ match, rows }]
let WRITES = [];    // every write the service attempted
let READS = [];     // every read, with its params

function installFakeDb() {
  const rowsFor = (text) => {
    const job = JOBS.find((j) => text.includes(j.match));
    if (!job) {
      throw new Error(`unstubbed query: ${text.replace(/\s+/g, ' ').slice(0, 90)}`);
    }
    return job.rows;
  };
  return {
    pool: { connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }), end: async () => {} },
    query: async (text, params) => {
      const sql = text.replace(/\s+/g, ' ').trim();
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) {
        WRITES.push({ sql, params });
        return { rows: [] };
      }
      READS.push({ sql, params });
      return { rows: rowsFor(text), params };
    },
  };
}

const dbPath = require.resolve(join(BACKEND, 'src', 'config', 'database.js'));
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: installFakeDb(),
};

/* ── app + real auth ──────────────────────────────────────────────────────── */
const jwt = require(join(BACKEND, 'node_modules', 'jsonwebtoken'));
const express = require(join(BACKEND, 'node_modules', 'express'));
process.env.JWT_SECRET = process.env.JWT_SECRET || 'analysis-store-test-secret';

const app = express();
app.use(express.json());
app.use(require(join(BACKEND, 'src', 'middleware', 'authMiddleware.js')));
app.use('/api/chess-profiles', require(join(BACKEND, 'src', 'routes', 'chessProfileRoutes.js')));

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server && server.close(); });

beforeEach(() => { JOBS = []; WRITES = []; READS = []; });

function tokenFor(id, role) {
  return jwt.sign({ id, role, name: `u${id}` }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

/* A realistic canonical envelope: the identity, the versions, and the complete
   move-by-move review - including the null accuracies a book move really
   carries. */
function envelope(overrides = {}) {
  return {
    gameSource: 'chess_profile',
    gameId: 42,
    initialFen: 'start',
    moveCount: 2,
    analysisVersion: 'nnue-18-1+d18m3r1',
    schemaVersion: 1,
    analysis: {
      initialFen: 'start',
      moves: [
        { ply: 0, player: 'w', san: 'e4', uci: 'e2e4', verdict: 'book', cpl: 0, loss: 0, swing: 0, wpd: 0, acc: null, best: 12, played: 12, bestUci: 'e2e4', sigma: null, lines: [] },
        { ply: 1, player: 'b', san: 'e5', uci: 'e7e5', verdict: 'best', cpl: 0, loss: 0, swing: 0, wpd: 0, acc: 100, best: 12, played: 12, bestUci: 'e7e5', sigma: null, lines: [] },
      ],
      white: { accuracy: 95.5, counts: {} },
      black: { accuracy: 92.1, counts: {} },
    },
    ...overrides,
  };
}

/* The stored row, as Postgres returns it: the envelope in `data`. */
const STORED_ROW = {
  data: envelope(),
  created_at: '2026-01-01T00:00:00.000Z',
};

/* The game lookup the service does before a WRITE. */
const GAME_ROW = { id: 42, white_player: 'a', black_player: 'b', my_color: 'white', pgn: '1. e4 e5' };

/** The default stubbed answers: a visible game and a stored analysis. */
function defaultJobs() {
  return [
    { match: 'FROM chess_games g', rows: [GAME_ROW] },
    { match: 'FROM imported_game_analysis', rows: [STORED_ROW] },
  ];
}

async function call(pathname, { user, method = 'GET', body, jobs } = {}) {
  JOBS = jobs || defaultJobs();
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(user ? { authorization: `Bearer ${tokenFor(user.id, user.role)}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep null */ }
  return { status: res.status, body: json, writes: WRITES, reads: READS };
}

const STUDENT = { id: 7, role: 'student' };
const OTHER = { id: 8, role: 'student' };

/* ── the response shape: THE regression ──────────────────────────────────── */

test('the endpoint returns the canonical envelope itself', async () => {
  const r = await call('/api/chess-profiles/games/42/analysis', { user: STUDENT });
  assert.equal(r.status, 200);
  /* The client validates these three fields; if any of them is missing the
     stored analysis is treated as a miss and the engine re-runs. */
  assert.equal(r.body.analysisVersion, STORED_ROW.data.analysisVersion);
  assert.equal(r.body.schemaVersion, STORED_ROW.data.schemaVersion);
  assert.equal(r.body.gameSource, 'chess_profile');
  assert.equal(r.body.gameId, 42);
  assert.ok(r.body.analysis, 'the complete analysis must be in the response');
  assert.equal(r.body.analysis.moves.length, 2);
  assert.equal(r.body.analysis.white.accuracy, 95.5);
  /* The row's metadata rides along, but is not part of the envelope. */
  assert.ok('created_at' in r.body);
});

test('the envelope is NOT wrapped in a `data` property', async () => {
  const r = await call('/api/chess-profiles/games/42/analysis', { user: STUDENT });
  assert.equal(r.body.data, undefined,
    'a wrapped envelope reads as "no analysis version" to the client, i.e. a permanent cache miss');
  assert.notEqual(r.body.analysis, undefined);
});

test('a stored analysis with null accuracies is returned untouched', async () => {
  const r = await call('/api/chess-profiles/games/42/analysis', { user: STUDENT });
  const bookRow = r.body.analysis.moves[0];
  assert.equal(bookRow.acc, null, 'a book move really carries acc === null');
  assert.equal(bookRow.verdict, 'book');
  assert.ok('loss' in bookRow && 'wpd' in bookRow, 'the metric fields must exist');
});

test('nothing stored is an empty answer, not an error', async () => {
  const r = await call('/api/chess-profiles/games/42/analysis', {
    user: STUDENT,
    jobs: [
      { match: 'FROM chess_games g', rows: [GAME_ROW] },
      { match: 'FROM imported_game_analysis', rows: [] },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body, null, 'no row must read as "no analysis", so the client can analyse');
});

/* ── the write: atomic, keyed, no duplicates ─────────────────────────────── */

test('saving is an atomic upsert keyed by (game, user)', async () => {
  const r = await call('/api/chess-profiles/games/42/analysis', {
    user: STUDENT,
    method: 'POST',
    body: envelope(),
  });
  assert.equal(r.status, 200);
  assert.equal(r.writes.length, 1, 'exactly one write');
  const { sql, params } = r.writes[0];
  assert.match(sql, /INSERT INTO imported_game_analysis/i);
  assert.match(sql, /ON CONFLICT \(game_id, user_id\) DO UPDATE/i,
    'the write must be an upsert, so repeated saves cannot create a second row');
  assert.deepEqual(params.slice(0, 2), [42, STUDENT.id],
    'the row is keyed by the game and the OWNER');
});

test('the same game saved twice is ONE row, not two', async () => {
  /* The unique index on (game_id, user_id) plus the upsert is what guarantees
     this; the assertion is on the statement, because the stub cannot count
     real rows. */
  await call('/api/chess-profiles/games/42/analysis', { user: STUDENT, method: 'POST', body: envelope() });
  await call('/api/chess-profiles/games/42/analysis', { user: STUDENT, method: 'POST', body: envelope() });
  assert.equal(WRITES.length, 2);
  for (const w of WRITES) assert.match(w.sql, /ON CONFLICT \(game_id, user_id\) DO UPDATE/i);
});

test('a second user reviewing the same game gets their OWN row', async () => {
  await call('/api/chess-profiles/games/42/analysis', { user: STUDENT, method: 'POST', body: envelope() });
  await call('/api/chess-profiles/games/42/analysis', { user: OTHER, method: 'POST', body: envelope() });
  assert.deepEqual(WRITES.map((w) => w.params[1]), [STUDENT.id, OTHER.id],
    'a coach\'s review must never overwrite the student\'s');
});

test('an incomplete analysis is refused, not stored', async () => {
  /* A partial or cancelled review must never be served back as a finished one. */
  for (const bad of [
    { analysisVersion: 'x', analysis: { moves: [] } },
    { analysisVersion: 'x', analysis: {} },
    { analysis: { moves: [{ san: 'e4' }] } },   // no analysis version
    { analysisVersion: 'x' },                    // no analysis at all
    null,
  ]) {
    WRITES = [];
    const r = await call('/api/chess-profiles/games/42/analysis', {
      user: STUDENT, method: 'POST', body: bad,
    });
    assert.equal(r.status, 400, `must refuse ${JSON.stringify(bad)}`);
    assert.equal(WRITES.length, 0, 'nothing may be written for an incomplete analysis');
  }
});

test('the row metadata is never written into the stored analysis', async () => {
  const r = await call('/api/chess-profiles/games/42/analysis', {
    user: STUDENT,
    method: 'POST',
    body: { ...envelope(), created_at: '2020-01-01T00:00:00.000Z' },
  });
  assert.equal(r.status, 200);
  const stored = JSON.parse(r.writes[0].params[2]);
  assert.equal(stored.created_at, undefined,
    'created_at describes the row, not the analysis - keeping it out makes a re-save byte-identical');
  assert.equal(stored.analysisVersion, envelope().analysisVersion);
  assert.equal(stored.analysis.moves.length, 2);
});

/* ── isolation ────────────────────────────────────────────────────────────── */

test('the read is scoped to the caller', async () => {
  await call('/api/chess-profiles/games/42/analysis', { user: STUDENT });
  const read = READS.find((r) => /FROM imported_game_analysis/i.test(r.sql));
  assert.ok(read, 'the analysis must be read from imported_game_analysis');
  assert.match(read.sql, /user_id = \$2/i, 'the read must be scoped by user id');
  assert.deepEqual(read.params, [42, STUDENT.id]);
});

test('one user never receives another user\'s analysis', async () => {
  /* The stub answers with the stored row whatever the caller is; the guard is
     the user_id in the query, asserted above. Here the point is that the row
     asked for is always the CALLER's own. */
  const r = await call('/api/chess-profiles/games/42/analysis', { user: OTHER });
  assert.equal(r.status, 200);
  const read = READS.find((x) => /FROM imported_game_analysis/i.test(x.sql));
  assert.deepEqual(read.params, [42, OTHER.id], 'the row asked for is the caller\'s own');
});

test('a game the caller cannot see cannot be written to', async () => {
  const r = await call('/api/chess-profiles/games/999/analysis', {
    user: STUDENT,
    method: 'POST',
    body: envelope(),
    jobs: [{ match: 'FROM chess_games g', rows: [] }],
  });
  assert.equal(r.status, 404);
  assert.equal(WRITES.length, 0, 'nothing may be written for a game that is not visible');
});

test('an unauthenticated request is refused', async () => {
  const r = await call('/api/chess-profiles/games/42/analysis');
  assert.equal(r.status, 401);
});
