// Behavioural test for the SERVER-SIDE flag fall in online matches
// (backend/src/controllers/onlineController.js) —
//   run with: node --test scripts/online-clock-settlement.test.mjs   (from backend/)
//
// REQUIREMENT (user): when a clock reaches 0:00 the game must end IMMEDIATELY,
// the side that ran out must LOSE, the server must be the source of truth (not
// only the client timer), and it must still end when the player on 0:00 has
// disconnected or closed the app. A flag against a king that cannot mate is a
// DRAW (FIDE 6.9).
//
// Everything the decision depends on is derived from the stored row, so this
// drives the real controller against an in-memory pg stand-in and never touches
// a database. The stub models the two properties the code actually leans on:
//   - the finish UPDATE is `WHERE id = $1 AND status = 'active'`, so it returns
//     rowCount 0 for a match another writer already settled;
//   - the row a handler holds is a copy, so a stale read must not be able to
//     rate or broadcast a match twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..');

const db = require(join(BACKEND, 'src', 'config', 'database.js'));
const rating = require(join(BACKEND, 'src', 'services', 'ratingService.js'));
const online = require(join(BACKEND, 'src', 'controllers', 'onlineController.js'));

/* ── the match, in memory ───────────────────────────────────────────────────
   `admin_id` is the creator and plays `admin_color`; `student_id` is the
   opponent. Both are students so a finished match is rated. */
const CREATOR = 11;
const OPPONENT = 12;

/* Every match in this file gets its own id. The finish broadcast is deduped per
   game for a few seconds (a rating hook, a retry and a reload all land on the
   same end), so a reused id would let one test swallow another's events. */
let nextGameId = 100;

/**
 * Black is on the clock and has already run out; White still has `whiteMs`.
 * The 60s of elapsed time only widens the gap between the stored clock and the
 * live reading, so a stored loser can never be mistaken for the winner.
 */
function blackFlaggedRow(overrides = {}) {
  return {
    id: nextGameId++,
    admin_id: CREATOR,
    student_id: OPPONENT,
    admin_color: 'white',
    admin_name: 'White Player',
    student_name: 'Black Player',
    class_id: null,
    is_bot: false,
    bot_level: null,
    bot_color: null,
    status: 'active',
    result: null,
    result_reason: null,
    /* White has a rook: enough to mate, so the flag is a loss for Black. */
    pgn: '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/4K2R b - - 0 1"]\n',
    fen: 'start',
    time_base_minutes: 10,
    time_increment_seconds: 5,
    white_ms: 40000,
    black_ms: 0,
    draw_offered_by: null,
    draw_offered_at: null,
    rematch_requested_by: null,
    rematch_requested_at: null,
    last_react_at: null,
    created_at: new Date(Date.now() - 600000),
    /* A minute ago: the clock has been counting down against Black the whole time. */
    updated_at: new Date(Date.now() - 60000),
    ...overrides,
  };
}

/** A fresh Socket.io stand-in that records every emit by room. */
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
    /* Every `game-update` the finished match broadcast produced. */
    gameUpdates: (gameId) => events.filter((e) => e.event === 'game-update'
      && (e.to === `game:${gameId}` || e.to === `user:${CREATOR}` || e.to === `user:${OPPONENT}`)),
    first: (event) => events.find((e) => e.event === event),
  };
}

/**
 * Install the pg stand-in. `state.row` is the live row every handler reads;
 * `state.settled` is what makes the finish UPDATE return rowCount 0 the second
 * time, which is how the real database rejects a concurrent claim.
 */
function stubDb(state) {
  const calls = { finishUpdates: 0, sweeps: 0, moveWrites: 0, ratingRows: [], sql: [] };
  state.calls = calls;
  /* The controller calls `rating.applyGameResult(...)` at call time, so replacing
     that one property is enough to count ratings without pulling in the whole
     Elo engine and its SQL. */
  state.originalApplyGameResult = rating.applyGameResult;
  rating.applyGameResult = async (args) => {
    calls.ratingRows.push(args);
    return { applied: true };
  };

  const originalQuery = db.query;
  db.query = async (sql, params = []) => {
    const flat = String(sql).replace(/\s+/g, ' ').trim();
    calls.sql.push(flat);

    /* The clock sweep's page of active, timed matches. */
    if (flat.includes("WHERE g.status = 'active'")) {
      calls.sweeps += 1;
      return { rows: state.sweepRows || [], rowCount: (state.sweepRows || []).length };
    }

    /* The one writer. Only the first finish on a match wins. */
    if (flat.includes("SET status = 'finished', result = $2, result_reason = $3")) {
      calls.finishUpdates += 1;
      if (state.settled || state.row.status !== 'active') return { rows: [], rowCount: 0 };
      state.settled = true;
      state.row.status = 'finished';
      state.row.result = params[1];
      state.row.result_reason = params[2];
      state.row.white_ms = params[3];
      state.row.black_ms = params[4];
      state.row.updated_at = new Date();
      return { rows: [], rowCount: 1 };
    }

    /* The move handler's save — must never be reached for a flagged board. */
    if (flat.includes('SET fen = $1, pgn = $2, status = $3')) {
      calls.moveWrites += 1;
      return { rows: [], rowCount: 0 };
    }

    /* getGameRow / the broadcast re-read. A COPY, the way pg hands back a fresh
       object per read: a handler that finished the match mutates its own copy,
       and a competing claim must still be holding an active row — which is what
       makes it reach the UPDATE and be rejected by `AND status = 'active'`. */
    if (flat.includes('FROM online_games g') && flat.includes('WHERE g.id = $1')) {
      return { rows: state.row ? [{ ...state.row }] : [], rowCount: state.row ? 1 : 0 };
    }

    /* applyOnlineRating's eligibility gates, then the two players' ratings. */
    if (flat.includes('FROM users WHERE id IN ($1,$2)')) {
      return { rows: [{ id: CREATOR, role: 'student' }, { id: OPPONENT, role: 'student' }] };
    }
    if (flat.includes('FROM students WHERE user_id IN')) {
      return { rows: [{ id: 1, user_id: CREATOR }, { id: 2, user_id: OPPONENT }] };
    }
    if (flat.includes('FROM students s JOIN users u')) {
      return {
        rows: [
          { id: 1, current_rating: 1500, name: 'White Player' },
          { id: 2, current_rating: 1400, name: 'Black Player' },
        ],
      };
    }

    /* Classroom notification + the analysis-queue upsert: nothing to find. */
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

/** Run one controller handler with the stub in place and restore after. */
async function run(rowState, fn) {
  const stub = stubDb(rowState);
  try {
    const out = await fn();
    /* A finish broadcasts without being awaited — the handler answers the player
       while the socket push is still reading the row back. Drain it before the
       stub goes away or the emits under test never land. */
    await drain();
    return out;
  } finally {
    stub.restore();
  }
}

const drain = () => new Promise((resolve) => setTimeout(resolve, 0));

/* ── 1. the server decides WHO flagged ────────────────────────────────────── */
test('a timeout claim finishes the match from the server clocks alone', async () => {
  const row = blackFlaggedRow();
  const state = { row };
  const io = fakeIo();
  const res = fakeRes();

  const result = await run(state, () => online.timeoutGame(fakeReq(row, CREATOR, io), res));
  assert.equal(result, undefined);
  assert.equal(res.statusCode, null, `claim must succeed, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  assert.equal(row.status, 'finished');
  assert.equal(row.result, 'white', 'the side that still had time must win');
  assert.equal(row.result_reason, 'timeout', 'a clock is not a resignation');

  /* The loser is settled at 0:00 and the winner keeps what they actually had. */
  assert.equal(row.black_ms, 0);
  assert.equal(row.white_ms, 40000);

  /* Both players are told, through their own room and the game room. */
  assert.ok(io.events.some((e) => e.to === 'user:11' && e.event === 'game-update'));
  assert.ok(io.events.some((e) => e.to === 'user:12' && e.event === 'game-update'));
  assert.ok(io.events.some((e) => e.to === `game:${row.id}` && e.event === 'game-update'));

  /* And the payload the claimer gets back already carries the result, so the
     popup needs no second request. */
  assert.equal(res.body.status, 'finished');
  assert.equal(res.body.result, 'white');
  assert.equal(res.body.resultReason, 'timeout');
});

test('WHO flagged comes from the clock, not from whoever happened to call', async () => {
  /* The LOSER (Black) claims. Same answer as when the winner claims: Black still
     loses. A client can therefore never win by being the one to post the flag. */
  const row = blackFlaggedRow();
  const state = { row };
  const res = fakeRes();
  await run(state, () => online.timeoutGame(fakeReq(row, OPPONENT, fakeIo()), res));
  assert.equal(row.result, 'white', 'the claim cannot reassign the win');
  assert.equal(row.white_ms, 40000, 'the winner did not run out');
});

test('either direction: the side to move with no time loses', async () => {
  /* Now it is White on the clock and out. */
  const row = blackFlaggedRow({
    pgn: '[SetUp "1"]\n[FEN "4k1r1/8/8/8/8/8/8/4K3 w - - 0 1"]\n',
    white_ms: 0,
    black_ms: 33000,
    updated_at: new Date(Date.now() - 20000),
  });
  const state = { row };
  const res = fakeRes();
  await run(state, () => online.timeoutGame(fakeReq(row, CREATOR, fakeIo()), res));
  assert.equal(row.result, 'black', 'White ran out, so Black wins on time');
  assert.equal(row.result_reason, 'timeout');
  assert.equal(row.white_ms, 0);
  assert.equal(row.black_ms, 33000);
});

/* ── 2. FIDE 6.9 ──────────────────────────────────────────────────────────── */
test('a flag against a king that cannot mate is a draw', async () => {
  /* Black flags, but White has only a king — there is no legal mate. */
  const row = blackFlaggedRow({
    pgn: '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/4K3 b - - 0 1"]\n',
  });
  const state = { row };
  const res = fakeRes();
  await run(state, () => online.timeoutGame(fakeReq(row, CREATOR, fakeIo()), res));
  assert.equal(row.status, 'finished');
  assert.equal(row.result, 'draw', 'the winner cannot be awarded a win');
  /* The REASON stays 'timeout' — that is what ended the game. The draw is carried
     by `result`, which is also what tells the client to read "Timeout vs
     insufficient material" instead of a plain draw. */
  assert.equal(row.result_reason, 'timeout');
  assert.equal(res.body.result, 'draw');
});

test('a pawn counts as mating material, so a flag is still a loss', async () => {
  const row = blackFlaggedRow({
    pgn: '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/P7/4K3 b - - 0 1"]\n',
  });
  const state = { row };
  await run(state, () => online.timeoutGame(fakeReq(row, CREATOR, fakeIo()), fakeRes()));
  assert.equal(row.result, 'white', 'K+P can mate after promotion, so White wins on time');
  assert.equal(row.result_reason, 'timeout');
});

/* ── 3. the disconnected player ───────────────────────────────────────────── */
test('a match nobody is online to settle still finishes: the clock sweep', async () => {
  const row = blackFlaggedRow();
  const state = { row, sweepRows: [row] };
  const io = fakeIo();

  const stub = stubDb(state);
  let timer;
  try {
    /* startOnlineClockWorker ticks immediately, so one worker start is a pass. */
    timer = online.startOnlineClockWorker(io);
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    clearInterval(timer);
    stub.restore();
  }

  assert.equal(state.calls.sweeps, 1, 'the worker must read the active matches');
  assert.equal(row.status, 'finished', 'an expired clock is settled with no request in sight');
  assert.equal(row.result, 'white');
  assert.equal(row.result_reason, 'timeout');
  /* The waiting opponent is pushed the result — no reload, no polling. */
  assert.ok(io.events.some((e) => e.to === 'user:11' && e.event === 'game-update'));
  assert.ok(io.events.some((e) => e.to === 'user:12' && e.event === 'game-update'));
});

test('the sweep settles one match per pass and only reads timed matches', async () => {
  const first = blackFlaggedRow({ id: 201 });
  const second = blackFlaggedRow({ id: 202 });
  const state = { row: first, sweepRows: [first, second] };

  const stub = stubDb(state);
  let timer;
  try {
    timer = online.startOnlineClockWorker(fakeIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    clearInterval(timer);
    stub.restore();
  }

  assert.equal(first.status, 'finished');
  assert.equal(second.status, 'active', 'a pile of expired clocks drains over passes, not one burst');

  /* Both guards keep this off other people's history: an un-timed legacy row
     would read as long expired (clockState defaults a missing base to 5 minutes),
     and a match last touched days ago is nobody's live game any more. */
  const sweepSql = stub.calls.sql.find((s) => s.includes("WHERE g.status = 'active'"));
  assert.ok(sweepSql, 'the worker must ask for active matches');
  assert.match(sweepSql, /g\.white_ms IS NOT NULL AND g\.black_ms IS NOT NULL/);
  assert.match(sweepSql, /g\.time_base_minutes IS NOT NULL/);
  assert.match(sweepSql, /updated_at > NOW\(\) - \(\$1 \|\| ' minutes'\)::interval/);
});

test('a match that never had a clock is never flagged', async () => {
  /* Legacy rows: no time control at all, last touched two hours ago. */
  const row = blackFlaggedRow({
    white_ms: null,
    black_ms: null,
    time_base_minutes: null,
    updated_at: new Date(Date.now() - 2 * 3600 * 1000),
  });
  const state = { row };
  const res = fakeRes();
  await run(state, () => online.timeoutGame(fakeReq(row, CREATOR, fakeIo()), res));
  assert.equal(res.statusCode, 409, 'nothing ran out because nothing was timed');
  assert.equal(row.status, 'active');
  assert.equal(state.calls.finishUpdates, 0);

  /* And the same guard on the read path: opening the board must not invent a flag. */
  const res2 = fakeRes();
  await run(state, () => online.getGame(fakeReq(row, CREATOR, fakeIo()), res2));
  assert.equal(row.status, 'active');
});

/* ── 4. refusing to invent a flag ─────────────────────────────────────────── */
test('a claim made before the server clock reaches zero is refused', async () => {
  /* 45s still on the clock for the side to move: a browser that counts a little
     fast must not be able to end a match that is still being played. */
  const row = blackFlaggedRow({ black_ms: 45000, updated_at: new Date() });
  const state = { row };
  const res = fakeRes();
  await run(state, () => online.timeoutGame(fakeReq(row, CREATOR, fakeIo()), res));
  assert.equal(res.statusCode, 409, `expected 409, got ${JSON.stringify(res.body)}`);
  assert.match(res.body.message, /run out/i);
  assert.equal(row.status, 'active');
  assert.equal(state.calls.ratingRows.length, 0, 'a refused claim must rate nobody');
});

test('a finished match cannot be flagged again, and an outsider cannot flag it', async () => {
  const over = blackFlaggedRow({ status: 'finished', result: 'black', result_reason: 'timeout' });
  const state = { row: over, settled: true };
  const res = fakeRes();
  await run(state, () => online.timeoutGame(fakeReq(over, CREATOR, fakeIo()), res));
  assert.equal(res.statusCode, 400);

  const row = blackFlaggedRow();
  const state2 = { row };
  const res2 = fakeRes();
  await run(state2, () => online.timeoutGame(fakeReq(row, 999, fakeIo()), res2));
  assert.equal(res2.statusCode, 403);
  assert.equal(row.status, 'active', 'a non-participant must not end the match');
});

/* ── 5. exactly once ──────────────────────────────────────────────────────── */
test('two concurrent claims settle, rate and broadcast the match once', async () => {
  const row = blackFlaggedRow();
  const state = { row };
  const io = fakeIo();
  const stub = stubDb(state);
  const responses = [];
  try {
    /* Both handlers read the same still-active row, then both try to finish it.
       Only the UPDATE whose `AND status = 'active'` still matches lands, and the
       loser of that race is answered with 409 — it has nothing left to settle. */
    const resA = fakeRes();
    const resB = fakeRes();
    responses.push(resA, resB);
    await Promise.all([
      online.timeoutGame(fakeReq(row, CREATOR, io), resA),
      online.timeoutGame(fakeReq(row, OPPONENT, io), resB),
    ]);
    await drain();
  } finally {
    stub.restore();
  }

  assert.equal(stub.calls.finishUpdates, 2, 'both claims must attempt the write');
  assert.equal(row.status, 'finished');
  const codes = responses.map((r) => r.statusCode);
  assert.ok(codes.includes(null) && codes.includes(409),
    `one claim settles and the other is told it already ended, got ${JSON.stringify(codes)}`);
  assert.equal(stub.calls.ratingRows.length, 1, 'a match must be rated exactly once');
  /* The broadcast follows the finish, so one settle reaches the players once:
     the game room plus each participant. */
  assert.equal(io.gameUpdates(row.id).length, 3);
});

/* ── 6. every read path settles ───────────────────────────────────────────── */
test('opening a flagged board (a refresh) returns the finished match', async () => {
  const row = blackFlaggedRow();
  const state = { row };
  const res = fakeRes();
  await run(state, () => online.getGame(fakeReq(row, OPPONENT, fakeIo()), res));
  assert.equal(res.statusCode, null);
  assert.equal(res.body.status, 'finished');
  assert.equal(res.body.result, 'white');
  assert.equal(res.body.resultReason, 'timeout');
  assert.equal(res.body.clock.blackMs, 0, 'the loser must not be shown with time still on it');
  assert.equal(row.white_ms, 40000);
});

test('a move onto a flagged board settles it instead of arguing about turns', async () => {
  const row = blackFlaggedRow();
  const state = { row };
  const res = fakeRes();
  /* The flagged player keeps sending moves; the server answers with the result. */
  await run(state, () => online.moveGame(
    fakeReq(row, OPPONENT, fakeIo(), { from: 'e8', to: 'd8' }), res,
  ));
  assert.equal(res.statusCode, null, `expected a finished payload, got ${JSON.stringify(res.body)}`);
  assert.equal(res.body.status, 'finished');
  assert.equal(res.body.result, 'white');
  assert.equal(state.calls.moveWrites, 0, 'no move may be saved onto a dead board');
  assert.equal(row.status, 'finished');
});

test('a classroom timeout pings the class grid with the reason', async () => {
  const row = blackFlaggedRow({ class_id: 7 });
  const state = { row };
  const io = fakeIo();
  await run(state, () => online.timeoutGame(fakeReq(row, CREATOR, io), fakeRes()));
  const ping = io.first('pvp-finished');
  assert.ok(ping, 'the instructor grid must re-fetch the finished board');
  assert.equal(ping.data.reason, 'timeout');
  assert.equal(ping.data.result, 'white');
});
