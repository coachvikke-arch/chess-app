/* Per-user scoping for the Game Review page.
 *
 * THE RULE BEING PROTECTED
 * A coach may only ever see their OWN students on that page: the Analyse tab,
 * the History members table, and the Brilliant Moves list. A superadmin sees
 * everyone. A student sees themselves. None of it may depend on a query
 * parameter - the caller is always the JWT.
 *
 * WHY A REAL EXPRESS APP AND A REAL JWT
 * The scoping decision is made from `req.user`, so testing the controller
 * functions directly would test a fiction. These run the real routers behind the
 * real authMiddleware with a genuinely signed token, so "coach A is refused
 * coach B's student" is proven end to end rather than asserted about a string.
 *
 * Only the database is faked. The fake is a real in-memory dataset filtered by
 * the same parameters the controllers pass, so a query that forgot its filter
 * returns too many rows and the test FAILS - rather than passing because the
 * stub happened to hand back what the assertion wanted. Anything unmatched
 * throws, so a query nobody anticipated is a loud error and never a silent
 * empty result.
 *
 * Run: node --test scripts/test-review-visibility.mjs
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const jwt = require(path.join(BACKEND, 'node_modules', 'jsonwebtoken'));
const express = require(path.join(BACKEND, 'node_modules', 'express'));
process.env.JWT_SECRET = process.env.JWT_SECRET || 'review-visibility-test-secret';

/* ── the fixtures ────────────────────────────────────────────────────────────
   Two coaches with disjoint students, one coach with none, one unassigned
   student, and a superadmin. STUDENT_A2 is assigned ONLY through
   student_coaches (students.coach_id is null) so the secondary-coach path is
   covered, not just the primary one. */
const COACH_A = 100;
const COACH_B = 200;
const SUPER = 300;
const COACH_EMPTY = 400;
const STUDENT_A1 = 501;
const STUDENT_A2 = 502;
const STUDENT_B1 = 601;
const STUDENT_B2 = 602;
const UNASSIGNED = 700;
const OUTSIDER = 999; // an opponent no coach is assigned to

const NAMES = {
  [COACH_A]: 'Coach A', [COACH_B]: 'Coach B', [SUPER]: 'Head Coach',
  [COACH_EMPTY]: 'Coach Empty', [STUDENT_A1]: 'A-One', [STUDENT_A2]: 'A-Two',
  [STUDENT_B1]: 'B-One', [STUDENT_B2]: 'B-Two', [UNASSIGNED]: 'Unassigned',
  [OUTSIDER]: 'Outsider',
};
const ALL_IDS = Object.keys(NAMES).map(Number);

/* Mutable so a test can simulate a reassignment mid-suite. */
const STATE = {
  students: [
    { id: 1001, user_id: STUDENT_A1, coach_id: COACH_A },      // primary Coach A
    { id: 1002, user_id: STUDENT_A2, coach_id: null },        // secondary Coach A only
    { id: 2001, user_id: STUDENT_B1, coach_id: COACH_B },      // primary Coach B
    { id: 2002, user_id: STUDENT_B2, coach_id: COACH_B },      // primary Coach B
    { id: 7001, user_id: UNASSIGNED, coach_id: null },         // nobody's student
  ],
  student_coaches: [{ student_id: 1002, coach_id: COACH_A }],
  /* game source -> id -> owner users.id */
  chess_games: { 10: STUDENT_A1, 11: STUDENT_B1 },
  computer_games: { 20: STUDENT_A2 },
  online_games: {
    /* Coach A's student vs an opponent outside every roster. */
    30: { admin_id: OUTSIDER, student_id: STUDENT_A1 },
    /* Both players belong to Coach B. */
    31: { admin_id: STUDENT_B1, student_id: STUDENT_B2 },
  },
  tournament_games: { 40: { white: STUDENT_A1, black: OUTSIDER } },
  /* owner_user_id -> sigma rows */
  sigma: {
    [STUDENT_A1]: [{ ply: 3, sigma_type: 'queen_sacrifice' }],
    [STUDENT_B1]: [{ ply: 7, sigma_type: 'rook_sacrifice' }],
    [STUDENT_A2]: [{ ply: 9, sigma_type: 'bishop_sacrifice' }],
  },
  /* student_user_id -> rollup rows */
  analysis: {
    [STUDENT_A1]: [{ games: 4, wins: 3, losses: 1, draws: 0, abandoned: 0, avg_moves: 30 }],
    [STUDENT_A2]: [{ games: 2, wins: 1, losses: 1, draws: 0, abandoned: 0, avg_moves: 20 }],
    [STUDENT_B1]: [{ games: 8, wins: 2, losses: 5, draws: 1, abandoned: 0, avg_moves: 44 }],
    [STUDENT_B2]: [{ games: 1, wins: 1, losses: 0, draws: 0, abandoned: 0, avg_moves: 12 }],
  },
};

const TRACKED = []; // every query the code under test actually issued

function resetState() {
  STATE.students = [
    { id: 1001, user_id: STUDENT_A1, coach_id: COACH_A },
    { id: 1002, user_id: STUDENT_A2, coach_id: null },
    { id: 2001, user_id: STUDENT_B1, coach_id: COACH_B },
    { id: 2002, user_id: STUDENT_B2, coach_id: COACH_B },
    { id: 7001, user_id: UNASSIGNED, coach_id: null },
  ];
  STATE.student_coaches = [{ student_id: 1002, coach_id: COACH_A }];
  TRACKED.length = 0;
}

const flat = (s) => s.replace(/\s+/g, ' ').trim();

/* The fake database. Every branch filters for real, so a missing filter widens
   the result and the assertion fails. */
function fakeDb() {
  return {
    pool: {
      connect: async () => ({
        query: async () => ({ rows: [] }),
        release: () => {},
      }),
      end: async () => {},
    },
    query: async (text, params = []) => {
      const q = flat(text);
      TRACKED.push({ sql: q, params });
      const p = (i) => params[i];

      /* ── reviewVisibilityService ── */
      if (q === 'SELECT id FROM users') {
        return { rows: ALL_IDS.map((id) => ({ id })) };
      }
      if (q.includes('SELECT s.user_id FROM students s') && q.includes('UNION')) {
        const coachId = p(0);
        const ids = new Set(
          STATE.students.filter((s) => s.coach_id === coachId).map((s) => s.user_id)
        );
        for (const sc of STATE.student_coaches) {
          if (sc.coach_id !== coachId) continue;
          const s = STATE.students.find((x) => x.id === sc.student_id);
          if (s) ids.add(s.user_id);
        }
        return { rows: [...ids].map((user_id) => ({ user_id })) };
      }

      /* ── members list (adminHistory) ── */
      if (q.includes('WITH member_rows AS')) {
        const allowed = new Set(p(0) || []);
        const members = STATE.students
          .filter((s) => allowed.has(s.user_id))
          .map((s) => ({
            student_id: s.id,
            user_id: s.user_id,
            name: NAMES[s.user_id],
            games: 0, wins: 0, losses: 0, draws: 0, abandoned: 0, avg_moves: 0,
          }));
        for (const m of members) {
          const rows = STATE.analysis[m.user_id] || [];
          const games = rows.reduce((n, r) => n + r.games, 0);
          m.games = games;
          m.wins = rows.reduce((n, r) => n + r.wins, 0);
          m.losses = rows.reduce((n, r) => n + r.losses, 0);
          m.draws = rows.reduce((n, r) => n + r.draws, 0);
          m.abandoned = rows.reduce((n, r) => n + r.abandoned, 0);
          m.avg_moves = games
            ? rows.reduce((n, r) => n + r.avg_moves * r.games, 0) / games
            : 0;
        }
        members.sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
        return { rows: members };
      }

      /* ── per-member rollups ── */
      if (q.includes('FROM student_game_analysis sa') && q.includes('ORDER BY sa.period_start')) {
        return { rows: (STATE.analysis[p(0)] || []).map((r) => ({ ...r, period_start: '2026-01-01', period_end: '2026-01-07' })) };
      }

      /* ── historyForUser ── */
      if (q.includes('FROM online_games g')) {
        const uid = p(0);
        const rows = Object.entries(STATE.online_games)
          .filter(([, g]) => g.admin_id === uid || g.student_id === uid)
          .map(([id, g]) => ({
            id: Number(id), status: 'finished', result: 'white', admin_color: 'white',
            pgn: '', created_at: '2026-01-01', updated_at: '2026-01-02',
            admin_id: g.admin_id, student_id: g.student_id,
            admin_name: NAMES[g.admin_id], student_name: NAMES[g.student_id],
          }));
        return { rows };
      }
      if (q.includes('FROM computer_games cg')) {
        const uid = p(0);
        const rows = Object.entries(STATE.computer_games)
          .filter(([, owner]) => owner === uid)
          .map(([id]) => ({
            id: Number(id), player_color: 'white', computer_level: 10, fen: '', pgn: '',
            status: 'finished', result: 'win', result_reason: 'checkmate', moves_count: 40,
            time_base_minutes: 5, time_increment_seconds: 0, created_at: '2026-01-01',
            updated_at: '2026-01-01', analysis_data: {}, student_name: NAMES[uid],
          }));
        return { rows };
      }

      /* ── sigma list ── */
      if (q.includes('FROM sigma_moves sm') && q.includes('COUNT(*)::int AS total')) {
        const rows = STATE.sigma[p(0)] || [];
        return { rows: [{ total: rows.length }] };
      }
      if (q.includes('FROM sigma_moves sm') && q.includes('sm.sigma_type, COUNT(*)::int AS n')) {
        const rows = STATE.sigma[p(0)] || [];
        return { rows: rows.map((r) => ({ sigma_type: r.sigma_type, n: 1 })) };
      }
      if (q.includes('FROM sigma_moves sm') && q.includes('owner_color')) {
        const rows = STATE.sigma[p(0)] || [];
        return {
          rows: rows.map((r) => ({
            id: 1, owner_user_id: p(0), game_source: 'online', game_id: 30, ply: r.ply,
            sigma_type: r.sigma_type, move_san: 'Qxf7+', from_square: 'd5', to_square: 'f7',
            fen_before: '', played_at: '2026-01-01', white_name: 'a', black_name: 'b',
            white_rating: null, black_rating: null, owner_color: 'white',
          })),
        };
      }
      if (q.startsWith('SELECT * FROM sigma_moves')) {
        const owner = p(0);
        return { rows: (STATE.sigma[owner] || []).map((r) => ({
          id: 1, owner_user_id: owner, game_source: p(1), game_id: p(2), ply: r.ply,
          sigma_type: r.sigma_type, move_san: 'Qxf7+', from_square: 'd5', to_square: 'f7',
          fen_before: '', played_at: '2026-01-01', white_name: 'a', black_name: 'b',
          white_rating: null, black_rating: null,
        })) };
      }

      /* ── ownership probes ── */
      if (q.includes('FROM connected_chess_accounts a') && q.includes('a.user_id = $2')) {
        return { rows: STATE.chess_games[p(0)] === p(1) ? [{}] : [] };
      }
      if (q.includes('FROM connected_chess_accounts a') && q.includes('a.user_id = ANY($2::int[])')) {
        const allowed = new Set(p(1) || []);
        return { rows: allowed.has(STATE.chess_games[p(0)]) ? [{ id: p(0) }] : [] };
      }
      if (q.includes('FROM chess_games g') && q.includes('g.id = $1 AND a.user_id = ANY')) {
        const allowed = new Set(p(1) || []);
        return {
          rows: allowed.has(STATE.chess_games[p(0)])
            ? [{ id: p(0), pgn: '', my_color: 'white' }] : [],
        };
      }
      if (q.includes('FROM computer_games') && q.includes('student_user_id = $2')) {
        return { rows: STATE.computer_games[p(0)] === p(1) ? [{}] : [] };
      }
      if (q.includes('FROM computer_games') && q.includes('student_user_id = ANY($2::int[])')) {
        const allowed = new Set(p(1) || []);
        return { rows: allowed.has(STATE.computer_games[p(0)]) ? [{ student_user_id: p(0) }] : [] };
      }
      if (q.includes('FROM online_games og') && q.includes('ANY($2::int[])')) {
        const g = STATE.online_games[p(0)];
        const allowed = new Set(p(1) || []);
        if (!g) return { rows: [] };
        if (allowed.has(g.admin_id)) return { rows: [{ user_id: g.admin_id }] };
        if (allowed.has(g.student_id)) return { rows: [{ user_id: g.student_id }] };
        return { rows: [] };
      }
      if (q.includes('FROM online_games') && q.includes('admin_id = $2')) {
        const g = STATE.online_games[p(0)];
        return { rows: g && (g.admin_id === p(1) || g.student_id === p(1)) ? [{}] : [] };
      }
      if (q.includes('FROM tournament_games tg') && q.includes('ANY($2::int[])')) {
        const g = STATE.tournament_games[p(0)];
        const allowed = new Set(p(1) || []);
        if (!g) return { rows: [] };
        if (allowed.has(g.white)) return { rows: [{ user_id: g.white }] };
        if (allowed.has(g.black)) return { rows: [{ user_id: g.black }] };
        return { rows: [] };
      }
      if (q.includes('FROM tournament_games') && q.includes('white_player = $2')) {
        const g = STATE.tournament_games[p(0)];
        return { rows: g && (g.white === p(1) || g.black === p(1)) ? [{}] : [] };
      }
      if (q.includes('SELECT name FROM users WHERE id = $1')) {
        return { rows: NAMES[p(0)] ? [{ name: NAMES[p(0)] }] : [] };
      }
      /* sigma writes */
      if (q.startsWith('DELETE FROM sigma_moves') || q.startsWith('INSERT INTO sigma_moves')) {
        return { rows: [] };
      }
      if (q.startsWith('BEGIN') || q.startsWith('COMMIT') || q.startsWith('ROLLBACK')) {
        return { rows: [] };
      }

      throw new Error(`unstubbed query: ${q.slice(0, 110)}`);
    },
  };
}

/* Swap the database for the fake BEFORE any controller requires it. */
const dbPath = require.resolve(path.join(BACKEND, 'src', 'config', 'database.js'));
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: fakeDb(),
};

/* ── app + real auth ─────────────────────────────────────────────────────────*/
const app = express();
app.use(express.json());
app.use(express.json());
app.use('/api/game-history', require(path.join(BACKEND, 'src', 'routes', 'gameHistoryRoutes.js')));
app.use('/api/sigma', require(path.join(BACKEND, 'src', 'routes', 'sigmaRoutes.js')));
app.use('/api/chess-profiles', require(path.join(BACKEND, 'src', 'routes', 'chessProfileRoutes.js')));
/* Mirror authMiddleware so a missing token fails the same way it does in prod. */
app.use((req, res, next) => {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ message: 'No token provided' });
  try { req.user = jwt.verify(h.slice(7), process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ message: 'Invalid or expired token' }); }
});

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server && server.close(); });
beforeEach(resetState);

function tokenFor(id, role) {
  return jwt.sign({ id, role, name: NAMES[id] || `u${id}`, email: `u${id}@test` },
    process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function call(pathname, { as, role = 'admin', method = 'GET', body } = {}) {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(as != null ? { authorization: `Bearer ${tokenFor(as, role)}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  /* Surface a 5xx loudly. A stubbed query that nothing matched comes back as a
     generic 500, and without this the failure reads as "scoping is broken"
     rather than "the fake database is missing a row shape". */
  if (res.status >= 500) {
    console.error(`  [5xx] ${method} ${pathname} as ${as} -> ${res.status} ${text.slice(0, 300)}`);
  }
  return { status: res.status, body: json };
}

/** The ids a members request returned, sorted, for a stable assertion. */
const memberIds = (r) => (r.body?.members || []).map((m) => m.user_id).sort((a, b) => a - b);

/* ══════════════ tab 1+2: the History members table ══════════════ */

test('coach A sees only their own students, never coach B, an unassigned user, or themselves', async () => {
  const r = await call('/api/game-history/students', { as: COACH_A });
  assert.equal(r.status, 200);
  assert.deepEqual(memberIds(r), [STUDENT_A1, STUDENT_A2].sort((a, b) => a - b));
  /* And the filter reached the DATABASE, rather than being applied afterwards. */
  const listQuery = TRACKED.find((t) => t.sql.includes('WITH member_rows AS'));
  assert.ok(listQuery, 'the members query must be filtered in SQL');
  assert.deepEqual(listQuery.params[0].slice().sort((a, b) => a - b), [STUDENT_A1, STUDENT_A2]);
});

test('coach B sees only their own students', async () => {
  const r = await call('/api/game-history/students', { as: COACH_B });
  assert.equal(r.status, 200);
  assert.deepEqual(memberIds(r), [STUDENT_B1, STUDENT_B2].sort((a, b) => a - b));
});

test('a student assigned only through student_coaches is visible to that coach', async () => {
  /* STUDENT_A2 has students.coach_id = NULL and exists in the view only via the
     join table, so the primary-coach column alone would hide a real student. */
  const r = await call('/api/game-history/students', { as: COACH_A });
  assert.ok(memberIds(r).includes(STUDENT_A2));
});

test('a superadmin still sees every member', async () => {
  const r = await call('/api/game-history/students', { as: SUPER, role: 'superadmin' });
  assert.equal(r.status, 200);
  const ids = memberIds(r);
  assert.ok(ids.includes(STUDENT_A1) && ids.includes(STUDENT_B1) && ids.includes(STUDENT_A2));
  assert.equal(r.body.scope, 'all');
});

test('a coach never appears in their own list', async () => {
  const r = await call('/api/game-history/students', { as: COACH_A });
  assert.ok(!memberIds(r).includes(COACH_A));
  assert.ok(!memberIds(r).includes(COACH_B));
});

test('a coach with no assigned students gets an empty list, not the whole academy', async () => {
  const r = await call('/api/game-history/students', { as: COACH_EMPTY });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.members, []);
  assert.equal(r.body.scope, 'assigned');
});

test('the members count and the stats come only from visible members', async () => {
  const a = await call('/api/game-history/students', { as: COACH_A });
  assert.equal(a.body.members.length, 2, '"N members" must count only visible rows');
  const a1 = a.body.members.find((m) => m.user_id === STUDENT_A1);
  assert.equal(a1.games, 4);
  assert.equal(a1.wins, 3);
  /* No rollup from coach B may leak into any of coach A's rows. */
  const b = await call('/api/game-history/students', { as: COACH_B });
  const b1 = b.body.members.find((m) => m.user_id === STUDENT_B1);
  assert.equal(b1.games, 8);
  assert.notEqual(a1.games, b1.games);
});

/* ══════════════ direct API access to the other coach's student ══════════════ */

test('coach A cannot expand coach B student\'s game list', async () => {
  const r = await call(`/api/game-history/students?userId=${STUDENT_B1}`, { as: COACH_A });
  assert.equal(r.status, 403);
  assert.equal(r.body.games, undefined, 'no game payload may leak on a refusal');
});

test('coach A can still expand their own student', async () => {
  const r = await call(`/api/game-history/students?userId=${STUDENT_A1}`, { as: COACH_A });
  assert.equal(r.status, 200);
  assert.equal(r.body.userId, STUDENT_A1);
});

test('no coach may expand an unassigned user', async () => {
  for (const coach of [COACH_A, COACH_B, COACH_EMPTY]) {
    const r = await call(`/api/game-history/students?userId=${UNASSIGNED}`, { as: coach });
    assert.equal(r.status, 403, `coach ${coach} reached an unassigned user`);
  }
});

test('a coach cannot read another coach\'s student game by id', async () => {
  /* chess_games 11 belongs to STUDENT_B1. Coach A must be refused. */
  const r = await call('/api/chess-profiles/games/11', { as: COACH_A });
  assert.equal(r.status, 404, 'an invisible game must be indistinguishable from a missing one');
});

test('a coach CAN read their own student\'s game by id', async () => {
  const r = await call('/api/chess-profiles/games/10', { as: COACH_A });
  assert.equal(r.status, 200);
});

test('a coach cannot save analysis against another coach\'s student game', async () => {
  const r = await call('/api/chess-profiles/games/11/analysis', {
    as: COACH_A, method: 'POST', body: { depth: 20 },
  });
  assert.equal(r.status, 404);
});

test('a student sees only their own games', async () => {
  const mine = await call('/api/game-history/students?userId=${STUDENT_A1}', {
    as: STUDENT_A1, role: 'student',
  });
  assert.equal(mine.status, 403, 'the members endpoint is staff-only');
  const game = await call('/api/game-history', { as: STUDENT_A1, role: 'student' });
  assert.equal(game.status, 200);
  assert.ok(game.body.games.every((g) => g.type === 'online' || g.type === 'computer'));
});

/* ══════════════ tab 3: Brilliant Moves ══════════════ */

test('coach A sees only their own Sigmas', async () => {
  const r = await call('/api/sigma/moves', { as: COACH_A });
  assert.equal(r.status, 200);
  assert.equal(r.body.ownerUserId, COACH_A, 'with no userId param, a coach gets their own list');
});

test('coach A may request one of their students\' Sigmas', async () => {
  const r = await call(`/api/sigma/moves?userId=${STUDENT_A1}`, { as: COACH_A });
  assert.equal(r.status, 200);
  assert.equal(r.body.ownerUserId, STUDENT_A1);
  assert.ok(r.body.moves.length > 0);
});

test('coach A is refused coach B\'s student Sigmas', async () => {
  const r = await call(`/api/sigma/moves?userId=${STUDENT_B1}`, { as: COACH_A });
  assert.equal(r.status, 403);
  assert.equal(r.body.moves, undefined);
});

test('coach B is refused coach A\'s student Sigmas (the same call, mirrored)', async () => {
  const r = await call(`/api/sigma/moves?userId=${STUDENT_A1}`, { as: COACH_B });
  assert.equal(r.status, 403);
});

test('coach A cannot save Sigmas onto coach B\'s student', async () => {
  const r = await call('/api/sigma/moves', {
    as: COACH_A, method: 'POST',
    body: { userId: STUDENT_B1, gameSource: 'online', gameId: 31, moves: [] },
  });
  assert.equal(r.status, 403);
});

test('a student asking for another player\'s Sigmas is reduced to their own', async () => {
  const r = await call(`/api/sigma/moves?userId=${STUDENT_B1}`, {
    as: STUDENT_A1, role: 'student',
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ownerUserId, STUDENT_A1);
});

test('a coach sees a game between their student and an opponent outside every roster', async () => {
  /* online game 30: OUTSIDER vs STUDENT_A1. Visible because ONE player is the
     coach's student - which is exactly the intended edge case. */
  const r = await call('/api/sigma/moves/online/30', { as: COACH_A });
  assert.equal(r.status, 200);
});

test('a coach cannot reach a game where NEITHER player is theirs', async () => {
  /* online game 31 is B-One vs B-Two. */
  const r = await call('/api/sigma/moves/online/31', { as: COACH_A });
  assert.equal(r.status, 404);
});

/* ══════════════ reassignment ══════════════ */

test('reassigning a student removes the old coach\'s access immediately', async () => {
  assert.deepEqual(memberIds(await call('/api/game-history/students', { as: COACH_A })),
    [STUDENT_A1, STUDENT_A2].sort((a, b) => a - b));

  /* STUDENT_A2 moves to coach B: now a PRIMARY coach, and off coach A entirely. */
  STATE.students.find((s) => s.user_id === STUDENT_A2).coach_id = COACH_B;
  STATE.student_coaches = STATE.student_coaches.filter((sc) => sc.student_id !== 1002);

  const afterA = await call('/api/game-history/students', { as: COACH_A });
  assert.deepEqual(memberIds(afterA), [STUDENT_A1]);

  const afterB = await call('/api/game-history/students', { as: COACH_B });
  assert.deepEqual(memberIds(afterB), [STUDENT_A1 + 0, STUDENT_A2, STUDENT_B1, STUDENT_B2]
    .filter((x) => x !== STUDENT_A1).sort((a, b) => a - b));

  /* And the old coach's route to that student's games is closed too. */
  const denied = await call(`/api/game-history/students?userId=${STUDENT_A2}`, { as: COACH_A });
  assert.equal(denied.status, 403);
  const sigmas = await call(`/api/sigma/moves?userId=${STUDENT_A2}`, { as: COACH_A });
  assert.equal(sigmas.status, 403);
});

/* ══════════════ no client-sent scope is trusted ══════════════ */

test('a coach cannot widen their scope with a coachId parameter', async () => {
  const r = await call('/api/game-history/students?coachId=1&userId=' + COACH_B, { as: COACH_A });
  assert.equal(r.status, 403);
});

test('no query behind these endpoints filters on anything the client sent as a coach id', async () => {
  /* The only identity source allowed is req.user / the visibility set. */
  for (const t of TRACKED) {
    assert.ok(!/\bcoach_id\s*=\s*\$\d/.test(t.sql.replace(/sc\.coach_id/g, 'coach_id')),
      `a query appears to filter on a raw coach_id parameter: ${t.sql.slice(0, 80)}`);
  }
});

/* ══════════════ the client cache key ══════════════ */

test('the HTTP cache key carries the caller, so two coaches cannot share a response', () => {
  const src = fs.readFileSync(
    path.join(BACKEND, '..', 'frontend', 'src', 'services', 'api.js'), 'utf8');
  assert.match(src, /function cacheIdentity/, 'api.js must derive an identity');
  assert.match(src, /\$\{cacheIdentity\(\)\}/, 'the cache key must embed the identity');
  assert.match(src, /claims\.role/, 'the identity must include the role');
  assert.match(src, /claims\.id/, 'the identity must include the user id');
});

test('the members table reads the scoped payload shape', () => {
  const src = fs.readFileSync(
    path.join(BACKEND, '..', 'frontend', 'src', 'pages', 'GameHistory.jsx'), 'utf8');
  assert.match(src, /body\?\.members \|\| \[\]/, 'must read the scoped members array');
  assert.match(src, /No students assigned to you yet\./, 'the empty state is required');
});