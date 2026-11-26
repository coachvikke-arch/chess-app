/* Rematch rules, tested with NO database and NO server.

   `scripts/test-draw-offer.js` boots the real app against the connection in
   backend/.env — which on this machine is the production database — so the
   rematch contract is verified here instead, against a stubbed query layer that
   records every statement. That keeps the assertions honest about what the SQL
   would do while touching nothing.

   Covered: who may ask, the one-request-per-game rule, accept (a NEW row with the
   sides swapped and the same clock), reject, cancel, expiry, and the drop that
   happens when a player moves on.

   Run: npm run test:rematch */
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');

const db = require('../src/config/database');

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/* ── the stub ──────────────────────────────────────────────────────────────── */

const state = {
  row: null,
  statements: [],
  inserted: null,
};

function gameRow(over = {}) {
  return {
    id: 7,
    admin_id: 1, student_id: 2,
    admin_name: 'Ada', student_name: 'Bo',
    admin_profile_image: null, admin_avatar_config: null,
    student_profile_image: null, student_avatar_config: null,
    admin_color: 'white',
    status: 'finished', result: 'white', result_reason: 'checkmate',
    is_bot: false, bot_level: null, bot_color: null, class_id: null,
    fen: START, pgn: '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4',
    time_base_minutes: 10, time_increment_seconds: 3,
    white_ms: 600000, black_ms: 420000,
    draw_offered_by: null, draw_offered_at: null,
    rematch_requested_by: null, rematch_requested_at: null,
    last_react_at: null, last_react_by: null, last_react_emoji: null,
    created_at: new Date('2026-11-01T10:00:00Z'),
    updated_at: new Date('2026-11-01T10:30:00Z'),
    ...over,
  };
}

let nextGameId = 8;

db.query = async function stub(sql, params = []) {
  const text = String(sql).replace(/\s+/g, ' ').trim();
  state.statements.push({ text, params });

  if (/^INSERT INTO online_games/.test(text)) {
    const id = nextGameId++;
    state.inserted = { params, returningId: id };
    /* The new row is read straight back after the insert, so the stub has to
       behave like the database and hold it. */
    state.created = gameRow({
      id,
      admin_id: params[0], student_id: params[1], admin_color: params[2],
      fen: params[3], pgn: '', status: 'active',
      time_base_minutes: params[4], time_increment_seconds: params[5],
      white_ms: params[6], black_ms: params[6],
      result: null, result_reason: null,
      updated_at: new Date(),
      rematch_requested_by: null,
    });
    return { rows: [{ id }] };
  }

  if (/^UPDATE online_games SET rematch_requested_by = \$2/.test(text)) {
    const target = state.rowFor(params[0]);
    target.rematch_requested_by = params[1];
    target.rematch_requested_at = new Date();
    return { rows: [target] };
  }

  if (/^UPDATE online_games SET rematch_requested_by = NULL/.test(text)) {
    const target = state.rowFor(params[0]);
    target.rematch_requested_by = null;
    target.rematch_requested_at = null;
    return { rows: [target] };
  }

  /* The disconnect / moved-on sweep. */
  if (/rematch_requested_by IS NOT NULL/.test(text) && /^SELECT/.test(text)) {
    const uid = Number(params[0]);
    const rows = [state.row, state.created].filter(Boolean).filter((g) => (
      g.rematch_requested_by != null && (g.admin_id === uid || g.student_id === uid)
    ));
    return { rows };
  }

  if (/^SELECT g\.\*.*FROM online_games/.test(text)) {
    const found = state.rowFor(params[0], { quiet: true });
    return { rows: found ? [found] : [] };
  }

  if (/^UPDATE notifications/.test(text)) return { rows: [] };
  if (/^INSERT INTO notifications/.test(text)) return { rows: [] };
  if (/^SELECT/.test(text)) return { rows: [] };
  return { rows: [] };
};

state.rowFor = (id, { quiet } = {}) => {
  const all = [state.row, state.created].filter(Boolean);
  const found = all.find((g) => Number(g.id) === Number(id));
  if (!found && !quiet) throw new Error(`stub: no game row for id ${id}`);
  return found || null;
};

/* ── the controller + fakes ────────────────────────────────────────────────── */

const onlineCtrl = require('../src/controllers/onlineController');

const io = {
  rooms: [],
  to(room) {
    return { emit: (event, data) => io.rooms.push({ room, event, data }) };
  },
  emit: () => {},
};

function makeRes() {
  const res = { statusCode: 200, body: null, ended: false };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; res.ended = true; return res; };
  return res;
}

function makeReq(userId, role = 'student', body = {}) {
  return {
    params: { id: String(state.row.id) },
    body,
    user: { id: userId, role, name: role === 'admin' ? 'Ada' : 'Bo' },
    app: { get: (k) => (k === 'io' ? io : null) },
  };
}

const eventsFor = (room) => io.rooms.filter((e) => e.room === room);

function reset(row) {
  state.row = row;
  state.created = null;
  state.inserted = null;
  state.statements.length = 0;
  io.rooms.length = 0;
}

const ADMIN = 1;
const STUDENT = 2;

/* ── asking ────────────────────────────────────────────────────────────────── */

test('only the two players of the match may ask', async () => {
  reset(gameRow());
  const res = makeRes();
  await onlineCtrl.requestRematch(makeReq(99), res);
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(state.row.rematch_requested_by, null);
});

test('a game that is still running, aborted, a bot game or a classroom board cannot be rematched', async () => {
  for (const row of [
    gameRow({ status: 'active', result: null }),
    gameRow({ status: 'finished', result: 'aborted' }),
    gameRow({ is_bot: true, admin_id: ADMIN, student_id: STUDENT }),
    gameRow({ class_id: 4 }),
  ]) {
    reset(row);
    const res = makeRes();
    await onlineCtrl.requestRematch(makeReq(STUDENT), res);
    assert.strictEqual(res.statusCode, 400, JSON.stringify(row.status) + JSON.stringify(res.body));
    assert.strictEqual(row.rematch_requested_by, null);
  }
});

test('asking records the request on the finished match and notifies the opponent only', async () => {
  reset(gameRow());
  const res = makeRes();
  await onlineCtrl.requestRematch(makeReq(ADMIN, 'admin'), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(state.row.rematch_requested_by, ADMIN);
  assert.ok(state.row.rematch_requested_at instanceof Date);

  const pushed = eventsFor('user:2').find((e) => e.event === 'rematch-request');
  assert.ok(pushed, 'the opponent is told over the socket');
  /* The colour that will be played NEXT game, so the responder can be told. */
  assert.strictEqual(pushed.data.adminColor, 'black');
  assert.strictEqual(pushed.data.baseMinutes, 10);
  assert.strictEqual(pushed.data.incrementSeconds, 3);
  assert.strictEqual(pushed.data.requesterName, 'Ada');
  assert.strictEqual(eventsFor('user:1').length, 0, 'the requester is not prompted');

  const card = res.body.rematchRequest;
  assert.strictEqual(card.mine, true);
  assert.strictEqual(card.by, ADMIN);
});

test('asking twice does not re-notify, and the other player cannot start a rival request', async () => {
  reset(gameRow({ rematch_requested_by: ADMIN, rematch_requested_at: new Date() }));
  const again = makeRes();
  await onlineCtrl.requestRematch(makeReq(ADMIN, 'admin'), again);
  assert.strictEqual(again.statusCode, 200);
  assert.strictEqual(eventsFor('user:2').length, 0, 'a duplicate tap sends nothing new');

  const rival = makeRes();
  await onlineCtrl.requestRematch(makeReq(STUDENT), rival);
  assert.strictEqual(rival.statusCode, 409);
  assert.match(rival.body.message, /opponent asked/i);
});

/* ── answering ─────────────────────────────────────────────────────────────── */

test('nobody may answer when no request is outstanding, and the asker cannot answer themselves', async () => {
  reset(gameRow());
  const none = makeRes();
  await onlineCtrl.respondRematch(makeReq(STUDENT, 'student', { accept: true }), none);
  assert.strictEqual(none.statusCode, 400);
  assert.match(none.body.message, /no rematch request/i);

  reset(gameRow({ rematch_requested_by: ADMIN, rematch_requested_at: new Date() }));
  const own = makeRes();
  await onlineCtrl.respondRematch(makeReq(ADMIN, 'admin', { accept: true }), own);
  assert.strictEqual(own.statusCode, 400);
  assert.match(own.body.message, /your own/i);
});

test('declining clears the request and tells the requester who said no', async () => {
  reset(gameRow({ rematch_requested_by: ADMIN, rematch_requested_at: new Date() }));
  const res = makeRes();
  await onlineCtrl.respondRematch(makeReq(STUDENT, 'student', { accept: false }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(state.row.rematch_requested_by, null);
  assert.strictEqual(state.inserted, null, 'declining creates no game');
  const told = eventsFor('user:1').find((e) => e.event === 'rematch-declined');
  assert.strictEqual(told.data.declinerName, 'Bo');
  assert.strictEqual(res.body.rematchRequest, null);
});

test('accepting creates a NEW game: same players, same clock, colours swapped, old match untouched', async () => {
  reset(gameRow({ rematch_requested_by: ADMIN, rematch_requested_at: new Date() }));
  const res = makeRes();
  await onlineCtrl.respondRematch(makeReq(STUDENT, 'student', { accept: true }), res);
  assert.strictEqual(res.statusCode, 201);

  const ins = state.inserted.params;
  assert.strictEqual(ins[0], ADMIN, 'the same two players');
  assert.strictEqual(ins[1], STUDENT);
  assert.strictEqual(ins[2], 'black', 'white becomes black and black becomes white');
  assert.strictEqual(ins[3], START, 'starting position');
  assert.strictEqual(ins[4], 10, 'same base time');
  assert.strictEqual(ins[5], 3, 'same increment');
  assert.strictEqual(ins[6], 600000, 'both clocks back to the original time');

  assert.strictEqual(state.row.rematch_requested_by, null, 'the offer is spent');
  assert.strictEqual(state.row.status, 'finished', 'the played game keeps its result');
  assert.strictEqual(state.row.pgn, '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4');

  /* Both players are handed their OWN scoped view of the new board. */
  const forAdmin = eventsFor('user:1').find((e) => e.event === 'rematch-started');
  const forStudent = eventsFor('user:2').find((e) => e.event === 'rematch-started');
  assert.ok(forAdmin && forStudent, 'both sides move into the new game');
  assert.strictEqual(forAdmin.data.game.myColor, 'black');
  assert.strictEqual(forStudent.data.game.myColor, 'white');
  assert.strictEqual(forAdmin.data.game.id, forStudent.data.game.id);
  assert.strictEqual(forAdmin.data.gameId, 7, 'the card that spawned it');
});

test('a request answered long after its window is refused, not turned into a game', async () => {
  const stale = new Date(Date.now() - 60000);
  reset(gameRow({ rematch_requested_by: ADMIN, rematch_requested_at: stale }));
  const res = makeRes();
  await onlineCtrl.respondRematch(makeReq(STUDENT, 'student', { accept: true }), res);
  assert.strictEqual(res.statusCode, 410);
  assert.strictEqual(state.inserted, null);
  assert.strictEqual(state.row.rematch_requested_by, null);
  assert.ok(eventsFor('user:1').some((e) => e.event === 'rematch-expired'));
});

/* ── withdrawing ───────────────────────────────────────────────────────────── */

test('cancelling is the asker alone, and is harmless once the request is gone', async () => {
  reset(gameRow({ rematch_requested_by: ADMIN, rematch_requested_at: new Date() }));
  const notMine = makeRes();
  await onlineCtrl.cancelRematch(makeReq(STUDENT), notMine);
  assert.strictEqual(notMine.statusCode, 400);
  assert.strictEqual(state.row.rematch_requested_by, ADMIN);

  const mine = makeRes();
  await onlineCtrl.cancelRematch(makeReq(ADMIN, 'admin'), mine);
  assert.strictEqual(mine.statusCode, 200);
  assert.strictEqual(state.row.rematch_requested_by, null);
  assert.ok(eventsFor('user:2').some((e) => e.event === 'rematch-cancelled'));

  /* Unmount cleanup calls this unconditionally — a stale id must not look like
     a failure the client would surface. */
  io.rooms.length = 0;
  const stale = makeRes();
  await onlineCtrl.cancelRematch(makeReq(ADMIN, 'admin'), stale);
  assert.strictEqual(stale.statusCode, 200);
});

test('a player who leaves drops every outstanding request they are part of', async () => {
  reset(gameRow({ rematch_requested_by: ADMIN, rematch_requested_at: new Date() }));
  const dropped = await onlineCtrl.dropPendingRematchesFor(io, ADMIN);
  assert.strictEqual(dropped, 1);
  assert.strictEqual(state.row.rematch_requested_by, null);
  assert.ok(eventsFor('user:2').some((e) => e.event === 'rematch-cancelled'));

  /* Nothing outstanding → nothing dropped and nobody bothered. */
  io.rooms.length = 0;
  assert.strictEqual(await onlineCtrl.dropPendingRematchesFor(io, ADMIN), 0);
  assert.strictEqual(io.rooms.length, 0);
});

test('the game payload describes the request from each viewer\'s side', async () => {
  reset(gameRow());
  const asked = makeRes();
  await onlineCtrl.requestRematch(makeReq(ADMIN, 'admin'), asked);
  assert.strictEqual(asked.body.rematchRequest.mine, true, 'to the asker it is "waiting"');
  assert.strictEqual(asked.body.rematchRequest.byName, 'Ada');
  assert.strictEqual(typeof asked.body.rematchRequest.at, 'number', 'the client counts the window from it');

  const read = await db.query(
    'SELECT g.* FROM online_games g JOIN users au ON au.id = g.admin_id JOIN users su ON su.id = g.student_id WHERE g.id = $1',
    [7],
  );
  assert.strictEqual(read.rows[0].rematch_requested_by, ADMIN);

  /* The same row, seen by the other player, is "answer me" — the `mine` flag is
     the only thing that tells the two situations apart. */
  const res = makeRes();
  await onlineCtrl.getGame(makeReq(STUDENT, 'student'), res);
  assert.strictEqual(res.body.rematchRequest.mine, false);
  assert.strictEqual(res.body.rematchRequest.byName, 'Ada');
});
