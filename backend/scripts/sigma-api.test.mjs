// HTTP-level tests for the Σ Sigma Moves API
// (backend/src/controllers/sigmaController.js, routes/sigmaRoutes.js) -
//   run with: node --test scripts/sigma-api.test.mjs   (from backend/)
//
// These exercise the real Express router with a stubbed database, so the
// assertions are about the CONTROLLER's behaviour - validation, ownership,
// scoping - without needing a live Postgres or the auth secret.
//
// What is deliberately NOT stubbed: authMiddleware. A route that a student can
// reach by guessing an id is the whole risk in this feature, so the tests log
// in as real users with real (test-signed) tokens rather than injecting
// req.user by hand.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, '..');
const require = createRequire(import.meta.url);

/* ── the fake database ───────────────────────────────────────────────────────
   Queries are matched on their distinctive text so each test can say which row
   set it wants back. Anything unmatched THROWS, because a silent default would
   let a query the test never anticipated return "no rows" and pass a 404 check
   for entirely the wrong reason. */

let JOBS = [];            // [{ match, rows }]
let WRITES = [];          // every write the controller attempted
let FAIL_ON = false;      // make any sigma_moves write throw (transaction test)
let TRANSACTION_LOG = []; // BEGIN / ROLLBACK / COMMIT, in order

function installFakeDb() {
  const rowsFor = (text) => {
    const job = JOBS.find((j) => text.includes(j.match));
    if (!job) {
      throw new Error(`unstubbed query: ${text.replace(/\s+/g, ' ').slice(0, 90)}`);
    }
    return job.rows;
  };

  const fake = {
    pool: {
      connect: async () => {
        const client = {
          query: async (text) => {
            if (/^\s*BEGIN/i.test(text)) { TRANSACTION_LOG.push('BEGIN'); return { rows: [] }; }
            if (/^\s*COMMIT/i.test(text)) { TRANSACTION_LOG.push('COMMIT'); return { rows: [] }; }
            if (/^\s*ROLLBACK/i.test(text)) { TRANSACTION_LOG.push('ROLLBACK'); return { rows: [] }; }
            if (FAIL_ON && /sigma_moves/i.test(text)) {
              throw new Error('simulated write failure');
            }
            WRITES.push(text.replace(/\s+/g, ' ').trim());
            return { rows: [] };
          },
          release: () => {},
        };
        return client;
      },
      end: async () => {},
    },
    query: async (text, params) => ({ rows: rowsFor(text), params }),
  };
  return fake;
}

/* Swap the controller's database for the fake BEFORE it is required, so every
   query inside it goes to the stub. */
const dbPath = require.resolve(join(BACKEND, 'src', 'config', 'database.js'));
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: installFakeDb(),
};

const ctrl = require(join(BACKEND, 'src', 'controllers', 'sigmaController.js'));

/* ── app + real auth ──────────────────────────────────────────────────────── */
const jwt = require(join(BACKEND, 'node_modules', 'jsonwebtoken'));
const express = require(join(BACKEND, 'node_modules', 'express'));
process.env.JWT_SECRET = process.env.JWT_SECRET || 'sigma-test-secret';

const SIGMA = ctrl.GAME_SOURCES;
const TYPES = ctrl.SIGMA_TYPES;

const app = express();
app.use(express.json());
// Mounted WITHOUT authMiddleware so each test can choose the acting user
// precisely; the auth wiring itself is asserted separately below.
app.use('/api/sigma', require(join(BACKEND, 'src', 'routes', 'sigmaRoutes.js')));
const authed = express();
authed.use(express.json());
authed.use(require(join(BACKEND, 'src', 'middleware', 'authMiddleware.js')));
authed.use('/api/sigma', require(join(BACKEND, 'src', 'routes', 'sigmaRoutes.js')));

let server;
let base;

before(async () => {
  server = authed.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server && server.close(); });

function tokenFor(id, role) {
  return jwt.sign({ id, role, name: `u${id}` }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

/** Call the API as `user`, with the db stub pre-loaded with `jobs`. */
async function call(pathname, { user, method = 'GET', body, jobs = [], failWrites = false } = {}) {
  JOBS = jobs;
  WRITES = [];
  TRANSACTION_LOG = [];
  FAIL_ON = failWrites;
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
  return { status: res.status, body: json, writes: WRITES, txn: TRANSACTION_LOG.slice() };
}

const STUDENT = { id: 7, role: 'student' };
const COACH = { id: 3, role: 'admin' };

/* ── auth ──────────────────────────────────────────────────────────────────── */

test('an unauthenticated request is refused', async () => {
  const r = await call('/api/sigma/moves', { jobs: [] });
  assert.equal(r.status, 401);
});

/* ── the list: scoping ────────────────────────────────────────────────────── */

test('a student only ever sees their own Sigmas', async () => {
  const r = await call('/api/sigma/moves?userId=99', {
    user: STUDENT,
    jobs: [
      { match: 'COUNT(*)', rows: [{ total: 0 }] },
      { match: 'sigma_type, COUNT', rows: [] },
      { match: 'LEFT JOIN tournament_games', rows: [] },
    ],
  });
  assert.equal(r.status, 200);
  /* Asking for someone else is reduced to their own id, not an error and not a
     leak of whether account 99 exists. */
  assert.equal(r.body.ownerUserId, STUDENT.id);
});

test('a coach can view a linked student', async () => {
  const r = await call('/api/sigma/moves?userId=7', {
    user: COACH,
    jobs: [
      /* The coach/student link is no longer a one-off lookup inside this
         controller: it now goes through reviewVisibilityService, whose coach
         query is the students ⋈ student_coaches union. That row set IS the
         permitted set, so a coach linked to student 7 sees exactly {7}.
         The match is on a single unbroken line because this harness compares
         against the RAW sql, not a whitespace-normalised copy. */
      { match: 'WHERE s.coach_id = $1', rows: [{ user_id: STUDENT.id }] },
      { match: 'COUNT(*)', rows: [{ total: 0 }] },
      { match: 'sigma_type, COUNT', rows: [] },
      { match: 'FROM users WHERE id', rows: [{ name: 'Arjun' }] },
      { match: 'LEFT JOIN tournament_games', rows: [] },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ownerUserId, STUDENT.id);
  assert.equal(r.body.ownerName, 'Arjun');
});

test('a coach is refused a player who is not their student', async () => {
  const r = await call('/api/sigma/moves?userId=99', {
    user: COACH,
    jobs: [{ match: 'WHERE s.coach_id = $1', rows: [] }],
  });
  assert.equal(r.status, 403);
});

/* ── the columns the list query actually names ──────────────────────────────
   These are here because the stubbed db CANNOT catch a column that does not
   exist: the original query selected chess_games.white_player, which is not a
   column in that table (it is my_color), every test passed, and every request
   returned 500. The joins and the CASE arms are pinned by text so the real
   schema is checked in one place — by the migration runner, against the live
   database — rather than being trusted from a mock. */

test('the list query only names columns that exist in the four game tables', () => {
  const src = readFileSync(join(BACKEND, 'src', 'controllers', 'sigmaController.js'), 'utf8');
  /* The colour CASE and the joins now live in the RESOLVED_SQL CTE, which both
     the page and its COUNT select from. Anchor on the CTE's projection. */
  const listQuery = src.slice(src.indexOf('SELECT sm.id, sm.owner_user_id'), src.indexOf('LIMIT $${params.length + 1}'));

  /* Per source, the columns the CASE and the joins must use. Anything else is
     a guess. Kept in step with run_migration_sigma_moves.js, which verifies
     these against information_schema. */
  const expected = {
    'chess_games': ['cp.my_color', 'cp.id'],
    'computer_games': ['cg.player_color', 'cg.id'],
    'online_games': ['og.admin_color', 'og.admin_id', 'og.student_id', 'og.id'],
    'tournament_games': ['tg.white_player', 'tg.black_player', 'tg.id'],
  };
  for (const [table, cols] of Object.entries(expected)) {
    for (const col of cols) {
      assert.ok(listQuery.includes(col),
        `${col} must be used for ${table} — check the table really has it`);
    }
  }
  /* The specific column that caused a 500 must never come back. */
  assert.ok(!listQuery.includes('white_player AS'),
    'chess_games has no white_player column — use my_color');
  /* All four sources must be joined, or one of them silently loses its colour. */
  for (const alias of ['cp', 'cg', 'og', 'tg']) {
    assert.match(listQuery, new RegExp(`LEFT JOIN \\w+ ${alias}\\b`),
      `${alias} join missing — a source without a join returns a null colour`);
  }
});

test('the list keeps only the side the owner played, in SQL', async () => {
  /* A review files EVERY Sigma of a game under the owner, including the
     opponent's, so the list must drop those — and it must do so in SQL, before
     LIMIT/OFFSET, or a page can come back mostly-opponent rows and the totals
     and pager disagree with the grid. The old client-side filter ran on one
     server page and silently hid Black-side brilliants. */
  const captured = [];
  const db = require(dbPath);
  const realQuery = db.query;
  db.query = async (text, params) => { captured.push(text); return realQuery(text, params); };
  await call('/api/sigma/moves', {
    user: STUDENT,
    jobs: [
      { match: 'COUNT(*)', rows: [{ total: 0 }] },
      { match: 'sigma_type, COUNT', rows: [] },
      { match: 'LEFT JOIN tournament_games', rows: [] },
    ],
  });
  db.query = realQuery;

  const countQuery = captured.find((t) => /COUNT\(\*\)/.test(t) && !/sigma_type, COUNT/.test(t)) || '';
  const pageQuery = captured.find((t) => /LIMIT/.test(t)) || '';
  for (const [name, sql] of [['count', countQuery], ['page', pageQuery]]) {
    assert.match(sql, /owner_color IS NULL/,
      `${name}: an unattributable move must not be hidden`);
    assert.match(sql, /owner_color = 'white' AND r\.ply % 2 = 0/,
      `${name}: White's moves are on even plies`);
    assert.match(sql, /owner_color = 'black' AND r\.ply % 2 = 1/,
      `${name}: Black's moves are on odd plies`);
    /* The predicate must be applied BEFORE the page is cut. */
    if (name === 'page') {
      assert.ok(sql.indexOf('owner_color') < sql.indexOf('LIMIT'),
        'the owner filter must run before LIMIT');
    }
  }
  /* The type counts use the same predicate, so a chip can never disagree with
     the grid it sits above. */
  const typeQuery = captured.find((t) => /sigma_type, COUNT/.test(t)) || '';
  assert.match(typeQuery, /owner_color = 'black' AND r\.ply % 2 = 1/);
});

test('a move carries the colour its owner played', async () => {
  /* The card is drawn from the mover's side, so this is what stops a coach
     looking at a student's Black game from seeing it drawn the wrong way round. */
  const r = await call('/api/sigma/moves', {
    user: COACH,
    jobs: [
      { match: 'FROM student_coaches', rows: [{ '?column?': 1 }] },
      { match: 'sigma_type, COUNT', rows: [] },
      { match: 'COUNT(*)', rows: [{ total: 1 }] },
      { match: 'LEFT JOIN tournament_games', rows: [{ ...LIST_ROW, owner_color: 'black' }] },
      { match: 'FROM users WHERE id', rows: [{ name: 'Arjun' }] },
    ],
  });
  assert.equal(r.body.moves[0].ownerColor, 'black');
  assert.equal(r.body.moves[0].playedBy, 'black', "a student's move is not the coach's");
});

test('the list query runs against the real database', async () => {
  /* The one check a stub cannot make: that every column named above actually
     exists. Runs only when a database is reachable, so the stubbed tests above
     still work without one. */
  let Pool;
  try {
    ({ Pool } = require(join(BACKEND, 'node_modules', 'pg')));
    require('dotenv').config({ path: join(BACKEND, '.env') });
  } catch { return; }

  const pool = new Pool();
  try {
    await pool.query('SELECT 1');
  } catch {
    await pool.end();
    return;   // no database in this environment — nothing to verify against
  }
  try {
    await pool.query(
      `SELECT sm.*,
              CASE sm.game_source
                WHEN 'chess_profile' THEN cp.my_color
                WHEN 'computer'      THEN cg.player_color
                WHEN 'online'        THEN CASE
                                          WHEN og.admin_id = sm.owner_user_id THEN og.admin_color
                                          WHEN og.student_id = sm.owner_user_id
                                            THEN CASE WHEN og.admin_color = 'white'
                                                      THEN 'black' ELSE 'white' END
                                          ELSE NULL
                                        END
                WHEN 'tournament'    THEN CASE
                                          WHEN tg.white_player = sm.owner_user_id THEN 'white'
                                          WHEN tg.black_player = sm.owner_user_id THEN 'black'
                                          ELSE NULL
                                        END
                ELSE NULL
              END AS owner_color
         FROM sigma_moves sm
         LEFT JOIN chess_games cp
                ON sm.game_source = 'chess_profile' AND cp.id = sm.game_id
         LEFT JOIN computer_games cg
                ON sm.game_source = 'computer' AND cg.id = sm.game_id
         LEFT JOIN online_games og
                ON sm.game_source = 'online' AND og.id = sm.game_id
         LEFT JOIN tournament_games tg
                ON sm.game_source = 'tournament' AND tg.id = sm.game_id
        WHERE sm.owner_user_id = $1
        ORDER BY sm.played_at DESC NULLS LAST, sm.game_id DESC, sm.ply ASC
        LIMIT 1 OFFSET 0`,
      [1]
    );
  } catch (err) {
    assert.fail(`the list query must run against the real schema: ${err.message}`);
  } finally {
    await pool.end();
  }
});

/* ── the list: filters, pagination ─────────────────────────────────────────── */

const LIST_ROW = {
  id: 1, owner_user_id: 7, game_source: 'computer', game_id: 3, ply: 12,
  sigma_type: 'queen_sacrifice', move_san: 'Qxh7+', from_square: 'd5',
  to_square: 'h7', fen_before: '8/8/8/3Q4/8/8/8/k6K w - - 0 20',
  played_at: new Date('2026-01-05T10:00:00Z'),
  white_name: 'Arjun', black_name: 'Computer Lv10',
  white_rating: 1500, black_rating: null,
  owner_color: 'white',
};

test('the default range is 90 days', async () => {
  const r = await call('/api/sigma/moves', {
    user: STUDENT,
    jobs: [
      { match: 'COUNT(*)', rows: [{ total: 0 }] },
      { match: 'sigma_type, COUNT', rows: [] },
      { match: 'LEFT JOIN tournament_games', rows: [] },
    ],
  });
  assert.equal(r.body.range, 'd90');
});

test('every documented range is accepted, and an unknown one falls back to 90d', async () => {
  for (const range of ['d7', 'd30', 'd90', 'y1']) {
    const r = await call(`/api/sigma/moves?range=${range}`, {
      user: STUDENT,
      jobs: [
        { match: 'COUNT(*)', rows: [{ total: 0 }] },
        { match: 'sigma_type, COUNT', rows: [] },
        { match: 'LEFT JOIN tournament_games', rows: [] },
      ],
    });
    assert.equal(r.body.range, range, `${range} must be honoured`);
  }
  const bad = await call('/api/sigma/moves?range=decade', {
    user: STUDENT,
    jobs: [
      { match: 'COUNT(*)', rows: [{ total: 0 }] },
      { match: 'sigma_type, COUNT', rows: [] },
      { match: 'LEFT JOIN tournament_games', rows: [] },
    ],
  });
  assert.equal(bad.body.range, 'd90');
});

test('an all-time range does NOT filter by date at all', async () => {
  /* "all" maps to no range key, so no date predicate is emitted. If one were,
     old Sigmas would silently vanish from the widest possible window. */
  const captured = [];
  JOBS = [
    { match: 'COUNT(*)', rows: [{ total: 0 }] },
    { match: 'sigma_type, COUNT', rows: [] },
    { match: 'LEFT JOIN tournament_games', rows: [] },
  ];
  const db = require(dbPath);
  const realQuery = db.query;
  db.query = async (text, params) => {
    captured.push(text);
    return realQuery(text, params);
  };
  await call('/api/sigma/moves?range=all', {
    user: STUDENT,
    jobs: JOBS,
  });
  db.query = realQuery;
  const pageQuery = captured.find((t) => /LIMIT/.test(t)) || '';
  assert.ok(!/played_at >= NOW\(\)/.test(pageQuery),
    'the all-time range must not emit a date predicate');
});

test('a dated range keeps rows whose played_at is unknown', async () => {
  const captured = [];
  const db = require(dbPath);
  const realQuery = db.query;
  db.query = async (text, params) => { captured.push(text); return realQuery(text, params); };
  await call('/api/sigma/moves?range=d7', {
    user: STUDENT,
    jobs: [
      { match: 'COUNT(*)', rows: [{ total: 0 }] },
      { match: 'sigma_type, COUNT', rows: [] },
      { match: 'LEFT JOIN tournament_games', rows: [] },
    ],
  });
  db.query = realQuery;
  const pageQuery = captured.find((t) => /LIMIT/.test(t)) || '';
  assert.match(pageQuery, /played_at IS NULL OR/,
    'an undated game must not be hidden by a date filter');
});

test('moves are shaped, counted per type and paged', async () => {
  const r = await call('/api/sigma/moves?type=queen_sacrifice&page=2&pageSize=5', {
    user: STUDENT,
    jobs: [
      /* The per-type GROUP BY is matched BEFORE the plain COUNT, because the
         grouping query also contains "COUNT(*)" and the first match wins. */
      { match: 'sigma_type, COUNT', rows: [{ sigma_type: 'queen_sacrifice', n: 7 }, { sigma_type: 'underpromotion', n: 5 }, { sigma_type: 'retired_type', n: 3 }] },
      { match: 'COUNT(*)', rows: [{ total: 12 }] },
      { match: 'LEFT JOIN tournament_games', rows: [LIST_ROW] },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 12);
  assert.equal(r.body.page, 2);
  assert.equal(r.body.pageSize, 5);
  assert.equal(r.body.pageCount, 3);
  const m = r.body.moves[0];
  assert.equal(m.sigmaType, 'queen_sacrifice');
  assert.equal(m.moveNumber, 7, 'ply 12 is White on move 7');
  assert.equal(m.playedBy, 'self');
  assert.equal(m.sourceLabel, 'Computer');
  /* Every type is present even at zero, so the filter row never renders a
     blank chip and then has to decide what to draw. */
  assert.deepEqual(Object.keys(r.body.typeCounts).sort(), [...TYPES].sort());
  assert.equal(r.body.typeCounts.queen_sacrifice, 7);
  assert.equal(r.body.typeCounts.rook_sacrifice, 0);
  /* A type the UI cannot render must not become a chip with no label. */
  assert.equal(r.body.typeCounts.retired_type, undefined);
});

test('an unknown type filter is ignored rather than returning nothing', async () => {
  const r = await call('/api/sigma/moves?type=bogus', {
    user: STUDENT,
    jobs: [
      { match: 'COUNT(*)', rows: [{ total: 0 }] },
      { match: 'sigma_type, COUNT', rows: [] },
      { match: 'LEFT JOIN tournament_games', rows: [] },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 0);
});

test('a huge pageSize is capped', async () => {
  const r = await call('/api/sigma/moves?pageSize=5000', {
    user: STUDENT,
    jobs: [
      { match: 'COUNT(*)', rows: [{ total: 0 }] },
      { match: 'sigma_type, COUNT', rows: [] },
      { match: 'LEFT JOIN tournament_games', rows: [] },
    ],
  });
  assert.ok(r.body.pageSize <= 60);
});

/* ── saving ───────────────────────────────────────────────────────────────── */

const GOOD_MOVE = {
  ply: 12, gameId: 3, gameSource: 'computer', sigmaType: 'queen_sacrifice',
  moveSan: 'Qxh7+', fromSquare: 'd5', toSquare: 'h7',
  fenBefore: '8/8/8/3Q4/8/8/8/k6K w - - 0 20',
  playedAt: '2026-01-05T10:00:00Z', whiteName: 'Arjun', blackName: 'Computer Lv10',
};

test('saving requires authentication, and a list must be an array', async () => {
  assert.equal((await call('/api/sigma/moves', { method: 'POST', body: { moves: [GOOD_MOVE] } })).status, 401);
  const notArray = await call('/api/sigma/moves', {
    user: STUDENT, method: 'POST', body: { moves: 'nope' }, jobs: [],
  });
  assert.equal(notArray.status, 400);
  const missing = await call('/api/sigma/moves', {
    user: STUDENT, method: 'POST', body: {}, jobs: [],
  });
  assert.equal(missing.status, 400);
});

test('an empty batch CLEARS the game, which is how a Sigma is retracted', async () => {
  /* Re-analysing after a detector fix can leave a move that is no longer
     brilliant. The only way to remove its row is to post the new, empty set —
     so an empty array must be ACCEPTED, provided the caller names the game at
     the top level (there is no move on which to hang it). Rejecting it left
     stale rows forever, contradicting the replace-semantics. */
  const cleared = await call('/api/sigma/moves', {
    user: STUDENT, method: 'POST',
    body: { gameSource: 'computer', gameId: 3, moves: [] },
    jobs: [{ match: 'computer_games', rows: [{ '?column?': 1 }] }],
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.saved, 0);
  const del = cleared.writes.find((w) => /^DELETE FROM sigma_moves/.test(w));
  assert.ok(del, 'an empty batch must still delete the old rows');

  /* Without the game named there is nothing to clear, so it is refused. */
  const nameless = await call('/api/sigma/moves', {
    user: STUDENT, method: 'POST', body: { moves: [] }, jobs: [],
  });
  assert.equal(nameless.status, 400);
  assert.match(nameless.body.message, /gameSource is required/);
  assert.equal((await call('/api/sigma/moves', {
    user: STUDENT, method: 'POST', body: { gameSource: 'computer', moves: [] }, jobs: [],
  })).status, 400);
});

test('an empty batch still has to pass the ownership check', async () => {
  /* Otherwise anyone could clear another player\\'s Sigmas by naming a game id. */
  const r = await call('/api/sigma/moves', {
    user: STUDENT, method: 'POST',
    body: { gameSource: 'computer', gameId: 3, moves: [] },
    jobs: [{ match: 'computer_games', rows: [] }],
  });
  assert.equal(r.status, 404);
  assert.equal(r.writes.length, 0, 'an unowned game must not be cleared');
});

test('a top-level game that contradicts the moves is refused', async () => {
  /* Otherwise a buggy caller could clear one game while writing another\\'s. */
  for (const body of [
    { gameSource: 'online', gameId: 3, moves: [GOOD_MOVE] },
    { gameSource: 'computer', gameId: 99, moves: [GOOD_MOVE] },
  ]) {
    const r = await call('/api/sigma/moves', {
      user: STUDENT, method: 'POST', body,
      jobs: [{ match: 'computer_games', rows: [{ '?column?': 1 }] }],
    });
    assert.equal(r.status, 400, `must refuse ${JSON.stringify(body)}`);
    assert.match(r.body.message, /disagrees/);
  }
});

test('matching top-level game info is accepted', async () => {
  const r = await call('/api/sigma/moves', {
    user: STUDENT, method: 'POST',
    body: { gameSource: 'computer', gameId: 3, moves: [GOOD_MOVE] },
    jobs: [{ match: 'computer_games', rows: [{ '?column?': 1 }] }],
  });
  assert.equal(r.status, 200);
});

test('a move with a bad ply, type or source is rejected whole', async () => {
  const cases = [
    { ...GOOD_MOVE, ply: -1 },
    { ...GOOD_MOVE, ply: 1.5 },
    { ...GOOD_MOVE, sigmaType: 'grand_sacrifice' },
    { ...GOOD_MOVE, gameSource: 'not_a_source' },
    { ...GOOD_MOVE, gameId: 0 },
  ];
  for (const bad of cases) {
    const r = await call('/api/sigma/moves', {
      user: STUDENT, method: 'POST', body: { moves: [bad] },
      jobs: [{ match: 'computer_games', rows: [{ '?column?': 1 }] }],
    });
    assert.equal(r.status, 400, `must reject ${JSON.stringify(bad)}`);
    assert.equal(r.writes.length, 0, 'nothing may be written for an invalid batch');
  }
});

test('moves from two different games in one batch are refused', async () => {
  const r = await call('/api/sigma/moves', {
    user: STUDENT, method: 'POST',
    body: { moves: [GOOD_MOVE, { ...GOOD_MOVE, gameId: 9 }] },
    jobs: [],
  });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /same game/);
});

test('a game the player does not own is refused', async () => {
  const r = await call('/api/sigma/moves', {
    user: STUDENT, method: 'POST', body: { moves: [GOOD_MOVE] },
    jobs: [{ match: 'computer_games', rows: [] }],
  });
  assert.equal(r.status, 404);
  assert.equal(r.writes.length, 0, 'an unowned game must not be written');
});

test('saving deletes then re-inserts, inside one transaction', async () => {
  const r = await call('/api/sigma/moves', {
    user: STUDENT, method: 'POST', body: { moves: [GOOD_MOVE] },
    jobs: [{ match: 'computer_games', rows: [{ '?column?': 1 }] }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.saved, 1);
  const del = r.writes.find((w) => /^DELETE FROM sigma_moves/.test(w));
  assert.ok(del, 'the previous set for this game must be cleared');
  /* Scoped to the owner too, or one player re-analysing a shared coach game
     would delete the other player's Sigmas. */
  assert.match(del, /owner_user_id = \$1 AND game_source = \$2 AND game_id = \$3/);
});

test('a failed insert rolls back instead of leaving the game cleared', async () => {
  const r = await call('/api/sigma/moves', {
    user: STUDENT, method: 'POST', body: { moves: [GOOD_MOVE] },
    jobs: [{ match: 'computer_games', rows: [{ '?column?': 1 }] }],
    failWrites: true,
  });
  assert.equal(r.status, 500);
  /* Without the rollback the game's previous Sigmas are already deleted and the
     new ones never land — the player's list would be silently emptied by a
     transient database error. */
  assert.deepEqual(r.txn, ['BEGIN', 'ROLLBACK']);
  assert.ok(!r.txn.includes('COMMIT'), 'a failed batch must never commit');
});

test('a successful save commits', async () => {
  const r = await call('/api/sigma/moves', {
    user: STUDENT, method: 'POST', body: { moves: [GOOD_MOVE] },
    jobs: [{ match: 'computer_games', rows: [{ '?column?': 1 }] }],
  });
  assert.deepEqual(r.txn, ['BEGIN', 'COMMIT']);
});

test('a student cannot save Sigmas onto another player', async () => {
  const r = await call('/api/sigma/moves', {
    user: STUDENT, method: 'POST',
    body: { moves: [GOOD_MOVE], userId: 99 },
    jobs: [],
  });
  assert.equal(r.status, 403);
});

test('each game source is ownership-checked through its own table', async () => {
  const cases = [
    { source: 'chess_profile', match: 'connected_chess_accounts' },
    { source: 'computer', match: 'computer_games' },
    { source: 'online', match: 'online_games' },
    { source: 'tournament', match: 'tournament_games' },
  ];
  for (const { source, match } of cases) {
    const ok = await call('/api/sigma/moves', {
      user: STUDENT, method: 'POST',
      body: { moves: [{ ...GOOD_MOVE, gameSource: source }] },
      jobs: [{ match, rows: [{ '?column?': 1 }] }],
    });
    assert.equal(ok.status, 200, `${source} must be accepted when owned`);
    const notOwned = await call('/api/sigma/moves', {
      user: STUDENT, method: 'POST',
      body: { moves: [{ ...GOOD_MOVE, gameSource: source }] },
      jobs: [{ match, rows: [] }],
    });
    assert.equal(notOwned.status, 404, `${source} must be refused when not owned`);
  }
  assert.equal(SIGMA.length, 4);
});

/* ── one game's Sigmas ────────────────────────────────────────────────────── */

test('a game lookup is ownership-checked and ordered by ply', async () => {
  const ok = await call('/api/sigma/moves/computer/3', {
    user: STUDENT,
    jobs: [
      /* The ownership probe is now visibility-aware: it selects the OWNER aliased as
         `user_id`, not a bare 1, because the caller then reads and writes rows
         keyed by the owning player rather than by the viewer. The stub has to
         hand back that exact column, or the handler correctly concludes "no
         owner" and 404s a game the caller is entitled to see. */
      { match: 'computer_games', rows: [{ user_id: STUDENT.id }] },
      { match: 'ORDER BY ply', rows: [LIST_ROW] },
    ],
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.moves[0].ply, 12);

  const denied = await call('/api/sigma/moves/computer/3', {
    user: STUDENT, jobs: [{ match: 'computer_games', rows: [] }],
  });
  assert.equal(denied.status, 404);
});

test('a bad source or game id in the path is a 400', async () => {
  assert.equal((await call('/api/sigma/moves/nope/3', { user: STUDENT, jobs: [] })).status, 400);
  assert.equal((await call('/api/sigma/moves/computer/abc', { user: STUDENT, jobs: [] })).status, 400);
});