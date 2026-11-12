/* ──────────────────────────────────────────────────────────────────────────
 * Leaderboard → Compare sheet, backend contract.
 *
 * The endpoint is `GET /api/leaderboard/compare/:opponentId` and "me" is always
 * the authenticated session. These tests pin the three properties that matter:
 *
 *   1. THE NUMBERS — streaks, recent form and the head-to-head record are
 *      derived from `rating_history`, which is the only per-opponent record that
 *      survives the raw-game cleanup, not from `online_games`.
 *   2. THE ERRORS — a bad id, yourself, a hidden student and a caller with no
 *      student record each get a specific answer, and a hidden account is not
 *      distinguishable from a missing one.
 *   3. THE SURFACE — the route is student-only and behind the leaderboard
 *      switch, and no account field (email, phone, password) is ever selected.
 *
 * The database is an in-memory stand-in keyed on the SQL text, so no live row is
 * read or written. `champion.champions` is stubbed at the module boundary for
 * the same reason: the real one would scan the production tables.
 *
 * Run: node --test scripts/leaderboard-compare.test.mjs   (from backend/)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..');

const db = require(join(BACKEND, 'src', 'config', 'database.js'));
const champion = require(join(BACKEND, 'src', 'services', 'overallChampionService.js'));
const service = require(join(BACKEND, 'src', 'services', 'leaderboardCompareService.js'));
const controller = require(join(BACKEND, 'src', 'controllers', 'leaderboardController.js'));

const ME = { user: 11, student: 111, name: 'Aarav' };
const OPP = { user: 22, student: 222, name: 'Bala' };

function studentRow({ user, student, name }, overrides = {}) {
  return {
    student_id: student,
    user_id: user,
    name,
    role: 'student',
    avatar_config: null,
    profile_image: null,
    hide_from_leaderboard: false,
    active: true,
    highest_level: 2,
    group_name: 'Batch A',
    ...overrides,
  };
}

function historyRow(result, { owner, adminId, adminColor = 'white', daysAgo = 1 }) {
  return {
    student_id: owner.student,
    result,
    opponent_id: owner === ME ? OPP.student : ME.student,
    played_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    online_game_id: 900 + daysAgo,
    owner_user_id: owner.user,
    admin_id: adminId,
    admin_color: adminColor,
  };
}

/* Newest first, as the service receives them. */
const ME_HISTORY = [
  historyRow('win', { owner: ME, adminId: ME.user, adminColor: 'white', daysAgo: 1 }),
  historyRow('win', { owner: ME, adminId: OPP.user, adminColor: 'black', daysAgo: 2 }),
  historyRow('loss', { owner: ME, adminId: ME.user, adminColor: 'black', daysAgo: 3 }),
  historyRow('draw', { owner: ME, adminId: OPP.user, adminColor: 'white', daysAgo: 4 }),
  historyRow('win', { owner: ME, adminId: ME.user, adminColor: 'white', daysAgo: 5 }),
];
const OPP_HISTORY = [
  historyRow('loss', { owner: OPP, adminId: OPP.user, adminColor: 'white', daysAgo: 1 }),
  historyRow('loss', { owner: OPP, adminId: ME.user, adminColor: 'black', daysAgo: 2 }),
  historyRow('loss', { owner: OPP, adminId: OPP.user, adminColor: 'white', daysAgo: 3 }),
];

/* The viewer's rows for the four games the two have played each other. */
const H2H = [
  historyRow('win', { owner: ME, adminId: ME.user, adminColor: 'white', daysAgo: 2 }),
  historyRow('loss', { owner: ME, adminId: OPP.user, adminColor: 'black', daysAgo: 4 }),
  historyRow('draw', { owner: ME, adminId: ME.user, adminColor: 'black', daysAgo: 6 }),
  historyRow('win', { owner: ME, adminId: OPP.user, adminColor: 'white', daysAgo: 8 }),
];

function stub({ students = [studentRow(ME), studentRow(OPP)], history = ME_HISTORY, opponentHistory = OPP_HISTORY, h2h = H2H } = {}) {
  const originalQuery = db.query;
  const originalChampions = champion.champions;
  const calls = { sql: [] };

  db.query = async (sql, params = []) => {
    calls.sql.push(sql);
    const flat = String(sql).replace(/\s+/g, ' ');

    if (flat.includes('s.hide_from_leaderboard, s.active, s.highest_level')) {
      return { rows: students.map((s) => ({ ...s })) };
    }
    if (flat.includes('WITH ladder AS')) {
      return {
        rows: [
          { user_id: ME.user, rank: 5, rapid_rating: 1520, rapid_peak: 1580, rapid_games: 30, rapid_highest_level: 3 },
          { user_id: OPP.user, rank: 2, rapid_rating: 1710, rapid_peak: 1750, rapid_games: 44, rapid_highest_level: 4 },
        ],
      };
    }
    if (flat.includes('FROM puzzle_attempts')) {
      return { rows: [{ student_id: ME.student, points: 180 }, { student_id: OPP.student, points: 95 }] };
    }
    if (flat.includes('WITH analysed AS')) {
      return { rows: [{ user_id: ME.user, accuracy: '72.4' }] };
    }
    if (flat.includes('WITH recent AS')) {
      return { rows: [...history.map((r) => ({ ...r })), ...opponentHistory.map((r) => ({ ...r }))] };
    }
    if (flat.includes('rh.student_id = $1 AND rh.opponent_id = $2')) {
      return { rows: h2h.map((r) => ({ ...r })) };
    }
    throw new Error(`unexpected SQL in compare: ${flat.slice(0, 90)}`);
  };

  champion.champions = async () => ({
    rows: [
      {
        user_id: ME.user, games: 40, wins: 20, losses: 15, draws: 5,
        winRate: 50, puzzlesSolved: 12, puzzleAccuracy: 62.5,
      },
      {
        user_id: OPP.user, games: 60, wins: 35, losses: 20, draws: 5,
        winRate: 58.3, puzzlesSolved: 30, puzzleAccuracy: 75,
      },
    ],
    weights: {},
  });

  return {
    calls,
    restore() {
      db.query = originalQuery;
      champion.champions = originalChampions;
    },
  };
}

function withStub(options, fn) {
  const handle = stub(options);
  return Promise.resolve(fn(handle)).finally(() => handle.restore());
}

/* ── the pure derivations ────────────────────────────────────────────────── */

test('a streak counts from the newest game and stops at a different result', () => {
  assert.deepEqual(
    service.currentStreak([{ result: 'win' }, { result: 'win' }, { result: 'loss' }]),
    { type: 'W', count: 2 },
  );
  assert.deepEqual(
    service.currentStreak([{ result: 'loss' }, { result: 'loss' }]),
    { type: 'L', count: 2 },
  );
  /* A draw ends both a win and a loss run: there is no "streak" to report. */
  assert.equal(service.currentStreak([{ result: 'draw' }, { result: 'win' }]), null);
  assert.equal(service.currentStreak([]), null);
});

test('head-to-head counts each stored game once and maps the viewer side', () => {
  const h2h = service.summariseHeadToHead(
    [
      { result: 'win', played_at: '2026-11-01', online_game_id: 1, admin_id: ME.user, admin_color: 'white' },
      { result: 'loss', played_at: '2026-10-30', online_game_id: 2, admin_id: OPP.user, admin_color: 'black' },
      { result: 'draw', played_at: '2026-10-28', online_game_id: 3, admin_id: ME.user, admin_color: 'black' },
    ],
    ME.user,
  );
  assert.equal(h2h.total, 3);
  assert.equal(h2h.myWins, 1);
  assert.equal(h2h.opponentWins, 1);
  assert.equal(h2h.draws, 1);
  assert.equal(h2h.winRate, 33.3);
  assert.deepEqual(h2h.lastGames[0], {
    id: 1, date: '2026-11-01', result: 'W', color: 'white',
  });
  /* The viewer was the student, and the creator played black, so the viewer was white. */
  assert.equal(h2h.lastGames[1].color, 'white');
});

/* ── the full response ───────────────────────────────────────────────────── */

test('compare returns both cards and the head-to-head from permanent history', () => withStub({}, async (handle) => {
  const data = await service.compare({ viewerUserId: ME.user, opponentUserId: OPP.user });

  assert.deepEqual(Object.keys(data).sort(), ['generatedAt', 'headToHead', 'me', 'opponent']);

  assert.equal(data.me.name, 'Aarav');
  assert.equal(data.me.rank, 5);
  assert.equal(data.me.rapidRating, 1520);
  assert.equal(data.me.rapidPeakRating, 1580);
  assert.equal(data.me.games, 40);
  assert.equal(data.me.wins, 20);
  assert.equal(data.me.losses, 15);
  assert.equal(data.me.draws, 5);
  assert.equal(data.me.winRate, 50);
  assert.equal(data.me.puzzlePoints, 180);
  assert.equal(data.me.puzzlesSolved, 12);
  assert.equal(data.me.accuracy, 72.4);
  assert.deepEqual(data.me.streak, { type: 'W', count: 2 });
  assert.equal(data.me.lastGames.length, 5);
  assert.deepEqual(data.me.lastGames.map((g) => g.result), ['W', 'W', 'L', 'D', 'W']);
  assert.equal(data.me.lastGames[1].color, 'white');

  assert.equal(data.opponent.name, 'Bala');
  assert.equal(data.opponent.rank, 2);
  assert.equal(data.opponent.puzzlePoints, 95);
  assert.equal(data.opponent.accuracy, null, 'no reviewed game must read as no accuracy, not 0');
  assert.deepEqual(data.opponent.streak, { type: 'L', count: 3 });

  assert.equal(data.headToHead.total, 4);
  assert.equal(data.headToHead.myWins, 2);
  assert.equal(data.headToHead.opponentWins, 1);
  assert.equal(data.headToHead.draws, 1);
  assert.equal(data.headToHead.winRate, 50);
  assert.equal(data.headToHead.lastGames.length, 4);

  /* Rank and rating are read from the ladder, games from the champion service:
     neither source is re-derived by hand. */
  assert.ok(handle.calls.sql.some((s) => /WITH ladder AS/.test(s)));
  assert.ok(handle.calls.sql.some((s) => /WITH recent AS/.test(s)));
  assert.ok(!handle.calls.sql.some((s) => /FROM online_games[\s\S]*LIMIT/.test(s)), 'form must not be built from raw games');
}));

test('the response never carries account fields', () => withStub({}, async () => {
  const data = await service.compare({ viewerUserId: ME.user, opponentUserId: OPP.user });
  const flat = JSON.stringify(data);
  for (const secret of ['email', 'password', 'phone', 'birthdate', 'country_code']) {
    assert.equal(flat.includes(secret), false, `${secret} must never leave the server`);
  }
}));

/* ── the refusals ────────────────────────────────────────────────────────── */

test('you cannot compare yourself, use a bad id, or be a non-student viewer', () => withStub({}, async () => {
  await assert.rejects(
    service.compare({ viewerUserId: ME.user, opponentUserId: ME.user }),
    (err) => err.status === 400,
  );
  await assert.rejects(
    service.compare({ viewerUserId: ME.user, opponentUserId: 0 }),
    (err) => err.status === 400,
  );
}));

test('a missing viewer has no "me" to compare', () => withStub(
  { students: [studentRow(OPP)] },
  async () => {
    await assert.rejects(
      service.compare({ viewerUserId: ME.user, opponentUserId: OPP.user }),
      (err) => err.status === 403,
    );
  },
));

test('hidden, inactive and unknown opponents are the same answer', async () => {
  for (const option of [
    studentRow(OPP, { hide_from_leaderboard: true }),
    studentRow(OPP, { active: false }),
    studentRow(OPP, { role: 'admin' }),
  ]) {
    await withStub({ students: [studentRow(ME), option] }, async () => {
      await assert.rejects(
        service.compare({ viewerUserId: ME.user, opponentUserId: OPP.user }),
        (err) => err.status === 404 && err.message === 'Student not found',
      );
    });
  }
  await withStub({ students: [studentRow(ME)] }, async () => {
    await assert.rejects(
      service.compare({ viewerUserId: ME.user, opponentUserId: OPP.user }),
      (err) => err.status === 404,
    );
  });
});

/* ── controller + wiring ─────────────────────────────────────────────────── */

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test('the controller rejects a non-numeric opponent without touching the service', async () => {
  const res = fakeRes();
  await controller.compare(
    { params: { opponentId: 'abc' }, user: { id: ME.user, role: 'student' } },
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Invalid opponent');
});

test('the route is student-only, feature-gated and mounted on /api/leaderboard', () => {
  const ROUTES = readFileSync(join(BACKEND, 'src', 'routes', 'leaderboardRoutes.js'), 'utf8');
  const APP = readFileSync(join(BACKEND, 'src', 'app.js'), 'utf8');
  assert.match(ROUTES, /router\.get\(\s*'\/compare\/:opponentId',\s*roleMiddleware\('student'\),\s*requireFeature\('leaderboard'\),\s*ctrl\.compare,?\s*\)/);
  assert.match(APP, /app\.use\('\/api\/leaderboard', leaderboardRoutes\)/);
});
