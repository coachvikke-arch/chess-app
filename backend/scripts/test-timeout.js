/* End-to-end check of the TIME-OUT (flag-fall) and FIFTY-MOVE finishes on an
 * online match.
 *
 * Run: node scripts/test-timeout.js
 *
 * A clock running out used to be recorded as a RESIGNATION: the client called
 * the resign endpoint, so the stored reason was 'resignation' no matter what
 * actually happened, and the winner was inferred from the final position. A
 * clock is not a resignation. These lock down the properties that make it its
 * own result:
 *
 *   1. Flagging reports reason 'timeout' — never 'resignation'.
 *   2. The side whose clock fell LOSES; the opponent wins, independent of the
 *      final position.
 *   3. Per FIDE 6.9 it is a DRAW when the opponent can no longer mate.
 *   4. Authorization is unchanged: participants only.
 *   5. A position reaching the fifty-move rule finishes as a draw.
 *
 * Snapshot/restore: no game, rating or level rows are left behind. */
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const db = require('../src/config/database');

let pass = 0;
let fail = 0;
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function api(path, token, opts = {}) {
  const res = await fetch(`${base}${path}`, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
}

const sign = (id, role) =>
  jwt.sign({ id, role, name: 'tester', email: 't@example.invalid' }, process.env.JWT_SECRET, {
    expiresIn: '5m',
  });

async function check(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    fail += 1;
    console.log(`  FAIL ${name}\n         ${err.message}`);
  }
}

const START = '1. e4 e5 ';
/* Two lone kings: the side on move cannot possibly mate. */
const LONE_KINGS = '[SetUp "1"]\n[FEN "7k/8/8/8/8/8/8/K7 w - - 0"]\n';
/* K+R vs K with the fifty-move counter already at 99: any move hits 100. */
const FIFTY = '[SetUp "1"]\n[FEN "7k/8/8/8/8/8/8/KR6 w - - 99"]\n';

/** An active game between the two students. */
async function makeGame(overrides = {}) {
  const q = await db.query(
    `INSERT INTO online_games (admin_id, student_id, admin_color, status, result, result_reason,
       fen, pgn, time_base_minutes, time_increment_seconds, white_ms, black_ms,
       is_bot, bot_level, draw_offered_by, draw_offered_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'start',$7,10,5,600000,600000,$8,$9,$10,$11,NOW(),NOW())
     RETURNING id`,
    [
      overrides.adminId, overrides.studentId,
      overrides.adminColor || 'white',
      overrides.status || 'active',
      overrides.result || null,
      overrides.reason || null,
      overrides.pgn || START,
      overrides.isBot === true,
      overrides.isBot === true ? 3 : null,
      overrides.offeredBy ?? null,
      overrides.offeredAt ?? null,
    ]
  );
  return q.rows[0].id;
}

async function gameRow(id) {
  const r = await db.query(
    `SELECT status, result, result_reason FROM online_games WHERE id = $1`,
    [id]
  );
  return r.rows[0];
}

async function main() {
  const { rows: stu } = await db.query(
    "SELECT u.id AS user_id, s.id AS student_id FROM users u JOIN students s ON s.user_id = u.id WHERE u.role = 'student' ORDER BY u.id LIMIT 2",
  );
  const { rows: adm } = await db.query(
    "SELECT id FROM users WHERE role IN ('admin','superadmin') ORDER BY id LIMIT 1",
  );
  assert.ok(stu.length === 2 && adm.length, 'need two students and one admin');

  const a = stu[0];
  const b = stu[1];
  const aToken = sign(a.user_id, 'student');
  const bToken = sign(b.user_id, 'student');
  const coachToken = sign(adm[0].id, adm[0].role);

  const ratingMark = (await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM rating_history')).rows[0].id;
  const levelMark = (await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM student_levels')).rows[0].id;
  const tcMark = (await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM student_time_ratings')).rows[0].id;
  const tcHistMark = (await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM time_control_rating_history')).rows[0].id;
  const before = (await db.query(
`SELECT id, current_rating, peak_rating, highest_level, games_played, provisional_games,
            last_rating_change_at FROM students WHERE id = ANY($1)`, [[a.student_id, b.student_id]],
  )).rows;
  const created = [];

  try {
    await check('flagging records reason "timeout", never "resignation"', async () => {
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id });
      created.push(id);
      const r = await api(`/api/online/games/${id}/timeout`, aToken, { method: 'POST' });
      assert.equal(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(r.data)}`);
      const row = await gameRow(id);
      assert.equal(row.status, 'finished', 'the flag must finish the match');
      assert.equal(row.result_reason, 'timeout', 'the reason must be timeout');
      assert.notEqual(row.result_reason, 'resignation', 'a clock is not a resignation');
      assert.equal(r.data.resultReason, 'timeout', 'the payload must carry the reason');
    });

    await check('the side whose clock fell LOSES (opponent wins)', async () => {
      /* Caller A is the admin/White and flags. The winner is the opponent
         (Black) because A is the side out of time — not because of the final
         position, which is a normal opening. */
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id });
      created.push(id);
      const r = await api(`/api/online/games/${id}/timeout`, aToken, { method: 'POST' });
      assert.equal(r.status, 200);
      const row = await gameRow(id);
      assert.equal(row.result, 'black', `the opponent must win, got ${row.result}`);
    });

    await check('a flag-fall is a DRAW when the opponent cannot mate (FIDE 6.9)', async () => {
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id, pgn: LONE_KINGS });
      created.push(id);
      const r = await api(`/api/online/games/${id}/timeout`, aToken, { method: 'POST' });
      assert.equal(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(r.data)}`);
      const row = await gameRow(id);
      assert.equal(row.status, 'finished');
      assert.equal(row.result, 'draw', `a bare king cannot win, got ${row.result}`);
      assert.equal(row.result_reason, 'insufficient', 'the reason must reflect the impossibility');
    });

    await check('the winner is derived from WHO is out of time, both directions', async () => {
      /* Now the OTHER student flags; the winner flips to White. */
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id });
      created.push(id);
      const r = await api(`/api/online/games/${id}/timeout`, bToken, { method: 'POST' });
      assert.equal(r.status, 200);
      const row = await gameRow(id);
      assert.equal(row.result, 'white', `the opponent must win, got ${row.result}`);
      assert.equal(row.result_reason, 'timeout');
    });

    await check('reaching the fifty-move rule finishes as a draw', async () => {
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id, pgn: FIFTY });
      created.push(id);
      /* White (the admin) is to move; Rb1-b2 takes the half-move counter to 100. */
      const r = await api(`/api/online/games/${id}/move`, aToken, {
        method: 'POST', body: { from: 'b1', to: 'b2' },
      });
      assert.equal(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(r.data)}`);
      const row = await gameRow(id);
      assert.equal(row.status, 'finished', 'the fifty-move rule ends the game');
      assert.equal(row.result, 'draw');
      assert.equal(row.result_reason, 'fifty-move', `expected fifty-move, got ${row.result_reason}`);
    });

    await check('a flag-fall is RATED (both players get a history row)', async () => {
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id });
      created.push(id);
      await api(`/api/online/games/${id}/timeout`, aToken, { method: 'POST' });
      const { rows } = await db.query(
        `SELECT student_id, result FROM rating_history WHERE online_game_id = $1`, [id]
      );
      assert.equal(rows.length, 2, `both players must be rated, got ${rows.length} row(s)`);
    });

    await check('a non-participant cannot flag the match', async () => {
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id });
      created.push(id);
      const r = await api(`/api/online/games/${id}/timeout`, coachToken, { method: 'POST' });
      assert.equal(r.status, 403, `a coach must get 403, got ${r.status}`);
      const row = await gameRow(id);
      assert.equal(row.status, 'active', 'the match must still be running');
    });

    await check('a finished game cannot be flagged again', async () => {
      const id = await makeGame({
        adminId: a.user_id, studentId: b.user_id,
        status: 'finished', result: 'white', reason: 'checkmate',
      });
      created.push(id);
      const r = await api(`/api/online/games/${id}/timeout`, aToken, { method: 'POST' });
      assert.equal(r.status, 400, `expected 400, got ${r.status}`);
    });

    await check('an unauthenticated flag request is refused', async () => {
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id });
      created.push(id);
      const r = await api(`/api/online/games/${id}/timeout`, null, { method: 'POST' });
      assert.equal(r.status, 401, `expected 401, got ${r.status}`);
    });
  } finally {
    for (const id of created) {
      await db.query('DELETE FROM time_control_rating_history WHERE online_game_id = $1', [id]);
      await db.query('DELETE FROM rating_history WHERE online_game_id = $1', [id]);
      await db.query('DELETE FROM online_games WHERE id = $1', [id]);
    }
    await db.query('DELETE FROM rating_history WHERE id > $1', [ratingMark]);
    await db.query('DELETE FROM time_control_rating_history WHERE id > $1', [tcHistMark]);
    await db.query('DELETE FROM student_time_ratings WHERE id > $1', [tcMark]);
    await db.query('DELETE FROM student_levels WHERE id > $1', [levelMark]);
    for (const row of before) {
      await db.query(
        `UPDATE students SET current_rating = $1, peak_rating = $2, highest_level = $3,
           games_played = $4, provisional_games = $5, last_rating_change_at = $6
         WHERE id = $7`,
        [row.current_rating, row.peak_rating, row.highest_level, row.games_played,
          row.provisional_games, row.last_rating_change_at, row.id],
      );
    }
    server.close();
    db.pool?.end?.().catch(() => {});
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('harness error:', e);
  server.close();
  process.exit(1);
});
