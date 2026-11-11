/* ──────────────────────────────────────────────────────────────────────────
 * Walking away from a live board.
 *
 * REQUIREMENT (user): there is no "Leave the game? Your game is still in
 * progress." confirmation any more. Back, another page, closing the board and
 * losing the connection all end the match immediately, and the SERVER decides
 * what that means:
 *
 *   - no move played   -> aborted, and NOTHING is rated;
 *   - at least one ply -> resignation: the leaver loses, ratings apply as usual.
 *
 * Both the explicit route (`POST /online/games/:id/leave`), the classroom-wide
 * settle (`POST /online/leave-active`) and the socket disconnect timer go
 * through the same `finishAsLeft`, so the stored result cannot depend on which
 * exit the user took.
 *
 * Run: node --test scripts/online-leave-game.test.mjs   (from backend/)
 *
 * The real controller runs against an in-memory pg stand-in, so no database is
 * touched. The stub models the two properties the code leans on:
 *   - both finish UPDATEs are `WHERE id = $1 AND status = 'active'`, so a second
 *     writer gets rowCount 0 instead of rating the match twice;
 *   - every row read is a COPY, so a handler cannot mutate the store by accident.
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
const rating = require(join(BACKEND, 'src', 'services', 'ratingService.js'));
const online = require(join(BACKEND, 'src', 'controllers', 'onlineController.js'));

/* Both participants are students, so a resignation is a rated result. The
   creator plays `admin_color`. */
const CREATOR = 21;
const OPPONENT = 22;

const OPENING = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MOVED_PGN = '1. e4 e5 2. Nf3 *';

let nextGameId = 500;
function gameRow(overrides = {}) {
  return {
    id: nextGameId++,
    admin_id: CREATOR,
    student_id: OPPONENT,
    admin_color: 'white',
    admin_name: 'Creator',
    student_name: 'Opponent',
    class_id: null,
    is_bot: false,
    bot_level: null,
    bot_color: null,
    status: 'active',
    result: null,
    result_reason: null,
    pgn: '',
    fen: OPENING,
    time_base_minutes: 10,
    time_increment_seconds: 5,
    white_ms: 590000,
    black_ms: 590000,
    draw_offered_by: null,
    draw_offered_at: null,
    rematch_requested_by: null,
    rematch_requested_at: null,
    last_react_at: null,
    created_at: new Date(Date.now() - 120000),
    updated_at: new Date(),
    ...overrides,
  };
}

function fakeIo() {
  const events = [];
  const room = (name) => ({
    emit: (event, data) => { events.push({ to: name, event, data }); },
    fetchSockets: async () => [],
  });
  return {
    events,
    to: room,
    in: room,
    emit: (event, data) => { events.push({ to: null, event, data }); },
    updatesFor: (id) => events.filter((e) => e.event === 'game-update'
      && [`game:${id}`, `user:${CREATOR}`, `user:${OPPONENT}`].includes(e.to)),
  };
}

/* `state.games` is the whole online_games table; `state.settled` is the set of
   ids another writer already finished, which is what makes the guarded UPDATE
   miss. */
function stubDb(state) {
  const calls = { abortedWrites: 0, resignWrites: 0, settles: [], ratingCalls: [], sql: [] };
  const byId = () => Object.fromEntries((state.games || []).map((g) => [g.id, g]));

  state.originalApplyGameResult = rating.applyGameResult;
  rating.applyGameResult = async (args) => {
    calls.ratingCalls.push(args);
    return { applied: true };
  };

  const originalQuery = db.query;
  db.query = async (sql, params = []) => {
    const flat = String(sql).replace(/\s+/g, ' ').trim();
    calls.sql.push(flat);

    /* finishAbandonedGamesFor: the active matches this user is in, optionally
       narrowed to one classroom. */
    if (flat.includes("WHERE status = 'active' AND (admin_id = $1 OR student_id = $1)")) {
      calls.settles.push(params);
      const uid = Number(params[0]);
      const classId = params[1] == null ? null : Number(params[1]);
      const rows = (state.games || []).filter((g) => g.status === 'active'
        && (Number(g.admin_id) === uid || Number(g.student_id) === uid)
        && (classId == null || Number(g.class_id) === classId));
      return { rows: rows.map((g) => ({ ...g })), rowCount: rows.length };
    }

    /* No moves: the match never began, so it is aborted and never rated. */
    if (flat.includes("SET status = 'finished', result = 'aborted'")) {
      calls.abortedWrites += 1;
      const row = byId()[Number(params[0])];
      if (!row || row.status !== 'active' || state.settled?.has(row.id)) return { rows: [], rowCount: 0 };
      row.status = 'finished';
      row.result = 'aborted';
      row.result_reason = 'aborted';
      row.updated_at = new Date();
      return { rows: [], rowCount: 1 };
    }

    /* A real position exists: resignation, and the leaver loses. */
    if (flat.includes("SET status = 'finished', result = $2, result_reason = 'resignation'")) {
      calls.resignWrites += 1;
      const row = byId()[Number(params[0])];
      if (!row || row.status !== 'active' || state.settled?.has(row.id)) return { rows: [], rowCount: 0 };
      row.status = 'finished';
      row.result = params[1];
      row.result_reason = 'resignation';
      row.updated_at = new Date();
      return { rows: [], rowCount: 1 };
    }

    /* getGameRow (and the emit re-read). A copy, exactly like pg. */
    if (flat.includes('FROM online_games g') && flat.includes('WHERE g.id = $1')) {
      const row = byId()[Number(params[0])];
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }

    /* applyOnlineRating's eligibility gates. */
    if (flat.includes('FROM users WHERE id IN ($1,$2)')) {
      return { rows: [{ id: CREATOR, role: 'student' }, { id: OPPONENT, role: 'student' }] };
    }
    if (flat.includes('FROM students WHERE user_id IN')) {
      return { rows: [{ id: 1, user_id: CREATOR }, { id: 2, user_id: OPPONENT }] };
    }
    if (flat.includes('FROM students s JOIN users u')) {
      return {
        rows: [
          { id: 1, current_rating: 1500, name: 'Creator' },
          { id: 2, current_rating: 1400, name: 'Opponent' },
        ],
      };
    }

    /* Classroom notifications, analysis queue: nothing to find. */
    return { rows: [], rowCount: 0 };
  };

  return {
    calls,
    restore() {
      db.query = originalQuery;
      rating.applyGameResult = state.originalApplyGameResult;
    },
  };
}

function fakeReq(row, user, io, body = {}) {
  return {
    params: { id: String(row.id) },
    query: {},
    user: { id: user, role: 'student', name: 'tester' },
    body,
    app: { get: (k) => (k === 'io' ? io : undefined) },
  };
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
  };
}

const drain = () => new Promise((resolve) => setTimeout(resolve, 0));

async function run(state, fn) {
  const stub = stubDb(state);
  try {
    const out = await fn();
    await drain();
    return out;
  } finally {
    stub.restore();
  }
}

/* ── 1. the rule: aborted before the first move, resigned after ───────────── */

test('leaving before the first move aborts the match and rates nobody', async () => {
  const row = gameRow();
  const state = { games: [row] };
  const io = fakeIo();
  const stub = stubDb(state);
  const res = fakeRes();
  try {
    await online.leaveGame(fakeReq(row, CREATOR, io), res);
    await drain();
  } finally {
    stub.restore();
  }

  assert.equal(res.statusCode, null, `expected success, got ${JSON.stringify(res.body)}`);
  assert.equal(row.status, 'finished');
  assert.equal(row.result, 'aborted');
  assert.equal(row.result_reason, 'aborted');
  assert.equal(stub.calls.abortedWrites, 1);
  assert.equal(stub.calls.resignWrites, 0);
  assert.equal(stub.calls.ratingCalls.length, 0, 'an unborn game is never rated');
  assert.equal(res.body.result, 'aborted', 'the client is answered with the ending it caused');
});

test('leaving after a move resigns the match: the leaver loses and it is rated', async () => {
  const row = gameRow({ pgn: MOVED_PGN });
  const state = { games: [row] };
  const stub = stubDb(state);
  try {
    await online.leaveGame(fakeReq(row, CREATOR, fakeIo()), fakeRes());
    await drain();
  } finally {
    stub.restore();
  }

  assert.equal(row.status, 'finished');
  assert.equal(row.result, 'black', 'the creator left as White, so Black wins');
  assert.equal(row.result_reason, 'resignation');
  assert.equal(stub.calls.resignWrites, 1);
  assert.equal(stub.calls.abortedWrites, 0);
  assert.equal(stub.calls.ratingCalls.length, 1, 'a played game is rated exactly once');
  assert.equal(stub.calls.ratingCalls[0].player.score, 0, 'the leaver scored zero');
  assert.equal(stub.calls.ratingCalls[0].opponent.score, 1);
});

test('the win follows WHO left, whichever colour they held', async () => {
  /* The opponent (student side = Black) walks away after a move. */
  const row = gameRow({ pgn: MOVED_PGN });
  await run({ games: [row] }, () => online.leaveGame(fakeReq(row, OPPONENT, fakeIo()), fakeRes()));
  assert.equal(row.result, 'white', 'White wins when Black leaves');

  /* Creator holding BLACK leaves: White keeps the point. */
  const row2 = gameRow({ admin_color: 'black', pgn: MOVED_PGN });
  await run({ games: [row2] }, () => online.leaveGame(fakeReq(row2, CREATOR, fakeIo()), fakeRes()));
  assert.equal(row2.result, 'white', 'the creator leaving as Black hands White the win');
});

/* ── 2. the client cannot end somebody else's match ───────────────────────── */

test('a non-participant cannot leave a match', async () => {
  const row = gameRow();
  const state = { games: [row] };
  const res = fakeRes();
  await run(state, () => online.leaveGame(fakeReq(row, 999, fakeIo()), res));

  assert.equal(res.statusCode, 403);
  assert.equal(row.status, 'active');
});

test('leaving an already-finished match is a no-op, never a re-rating', async () => {
  const row = gameRow({ status: 'finished', result: 'white', result_reason: 'checkmate', pgn: MOVED_PGN });
  const state = { games: [row] };
  const stub = stubDb(state);
  const res = fakeRes();
  try {
    await online.leaveGame(fakeReq(row, CREATOR, fakeIo()), res);
    await drain();
  } finally {
    stub.restore();
  }

  assert.equal(res.statusCode, null);
  assert.equal(res.body.result, 'white');
  assert.equal(res.body.resultReason, 'checkmate', 'the recorded ending is preserved');
  assert.equal(stub.calls.resignWrites + stub.calls.abortedWrites, 0);
  assert.equal(stub.calls.ratingCalls.length, 0);
});

test('two simultaneous exits settle the match once', async () => {
  const row = gameRow({ pgn: MOVED_PGN });
  const state = { games: [row] };
  const stub = stubDb(state);
  const io = fakeIo();
  try {
    const resA = fakeRes();
    const resB = fakeRes();
    await Promise.all([
      online.leaveGame(fakeReq(row, CREATOR, io), resA),
      online.leaveGame(fakeReq(row, OPPONENT, io), resB),
    ]);
    await drain();
  } finally {
    stub.restore();
  }

  assert.equal(row.status, 'finished');
  assert.equal(stub.calls.ratingCalls.length, 1, 'the guarded UPDATE lets one writer win');
  /* One settle reaches each participant and the game room once. */
  assert.equal(io.updatesFor(row.id).length, 3);
});

/* ── 3. the result reaches the opponent with no reload ────────────────────── */

test('the opponent and the live-games list are pushed the result', async () => {
  const row = gameRow({ pgn: MOVED_PGN });
  const io = fakeIo();
  await run({ games: [row] }, () => online.leaveGame(fakeReq(row, CREATOR, io), fakeRes()));

  assert.ok(io.events.some((e) => e.to === `user:${OPPONENT}` && e.event === 'game-update'));
  assert.ok(io.events.some((e) => e.to === `user:${CREATOR}` && e.event === 'game-update'));
  assert.ok(io.events.some((e) => e.to === `game:${row.id}` && e.event === 'game-update'));
  assert.ok(io.events.some((e) => e.event === 'live-games-changed' && e.data?.gameId === row.id),
    'a live list that is open elsewhere must drop the dead board');
});

/* ── 4. the classroom-wide settle ─────────────────────────────────────────── */

test('leaving the classroom settles this user\'s boards in that room only', async () => {
  const inside = gameRow({ class_id: 7, pgn: MOVED_PGN });
  const otherClass = gameRow({ class_id: 8, pgn: MOVED_PGN });
  const playArena = gameRow({ class_id: null, pgn: MOVED_PGN });
  const someoneElse = gameRow({ class_id: 7, admin_id: 40, student_id: 41, pgn: MOVED_PGN });
  const state = { games: [inside, otherClass, playArena, someoneElse] };
  const stub = stubDb(state);
  const res = fakeRes();
  try {
    await online.leaveActiveGames(fakeReq(inside, CREATOR, fakeIo(), { classId: 7 }), res);
    await drain();
  } finally {
    stub.restore();
  }

  assert.equal(res.statusCode, null);
  assert.equal(res.body.games, 1, 'only the board in the room being left');
  assert.equal(inside.status, 'finished');
  assert.equal(inside.result_reason, 'resignation');
  assert.equal(otherClass.status, 'active', 'another classroom is untouched');
  assert.equal(playArena.status, 'active', 'a Play Arena match open elsewhere is untouched');
  assert.equal(someoneElse.status, 'active', 'other people\'s matches are never touched');
});

test('a closed tab settles every active board the user is on', async () => {
  const one = gameRow({ class_id: 7, pgn: MOVED_PGN });
  const two = gameRow({ class_id: null });
  const state = { games: [one, two] };

  const finished = await run(state, () => online.finishAbandonedGamesFor(fakeIo(), CREATOR));

  assert.equal(finished, 2);
  assert.equal(one.result_reason, 'resignation', 'a played game is resigned');
  assert.equal(two.result, 'aborted', 'an empty board is aborted');
});

test('a coach closing a tab never resigns the class board they drive', async () => {
  /* Classroom computer games put the INSTRUCTOR in admin_id and the student in
     student_id; the student is the one playing. The host's disconnect must not
     end those games. */
  const botGame = gameRow({ class_id: 7, is_bot: true, pgn: MOVED_PGN });
  const state = { games: [botGame] };
  const finished = await run(state, () => online.finishAbandonedGamesFor(fakeIo(), CREATOR));

  assert.equal(finished, 0);
  assert.equal(botGame.status, 'active');

  /* The student leaving DOES end their own board, and a bot game is never rated. */
  const stub = stubDb(state);
  try {
    const n = await online.finishAbandonedGamesFor(fakeIo(), OPPONENT);
    await drain();
    assert.equal(n, 1);
    assert.equal(botGame.status, 'finished');
    assert.equal(botGame.result_reason, 'resignation');
    assert.equal(stub.calls.ratingCalls.length, 0, 'computer games are not rated');
  } finally {
    stub.restore();
  }
});

/* ── 5. the wiring the behaviour above depends on ──────────────────────────
   The two tests above drive `finishAsLeft` through its callers; these two read
   the socket and the router so a refactor that drops the disconnect grace or
   unregisters a route fails here instead of silently shipping. */

const SOCKET = readFileSync(new URL('../src/socket/liveClassSocket.js', import.meta.url), 'utf8');
const ROUTES = readFileSync(new URL('../src/routes/onlineRoutes.js', import.meta.url), 'utf8');

test('closing the tab settles the match after a cancellable grace', () => {
  assert.match(SOCKET, /const ABANDON_GRACE_MS = 10000;/,
    'a refresh must be able to reconnect before its board is resigned');
  assert.match(SOCKET, /socket\.on\('disconnect', async \(\) => \{[\s\S]{0,2500}scheduleAbandonOnDisconnect\(io, userId\)/,
    'the disconnect handler is what settles a closed tab');
  assert.match(SOCKET, /cancelAbandonOnReconnect\(userId\)/,
    'a reconnect must cancel the timer the disconnect started');
  assert.match(SOCKET, /onlineCtrl\.finishAbandonedGamesFor\(io, userId\)/,
    'the timer must go through the same settle the explicit leave uses');
});

test('the leave routes exist and are participant-scoped', () => {
  assert.match(ROUTES, /router\.post\('\/games\/:id\/leave', roleMiddleware\('admin', 'student'\), ctrl\.leaveGame\)/);
  assert.match(ROUTES, /router\.post\('\/leave-active', roleMiddleware\('admin', 'student'\), ctrl\.leaveActiveGames\)/);
});
