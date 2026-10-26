/* End-to-end check of the DRAW OFFER flow on an online match.
 *
 * Run: node scripts/test-draw-offer.js
 *
 * A draw used to be a single button wired to endGame(), which set
 * status='finished' on the click — one tap ended the match with the opponent
 * never asked, and nobody was rated. A draw is an OFFER. These lock down the
 * properties that makes it one:
 *
 *   1. Offering does NOT finish the game.
 *   2. Only the OPPONENT may answer, and cannot answer their own offer.
 *   3. Accept finishes it as a draw AND rates it; decline leaves it running.
 *   4. A declined offer is cleared, and a stale offer cannot be answered.
 *   5. Simultaneous offers count as acceptance (the standard chess rule).
 *   6. Authorization is unchanged: participants only.
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

/** A finished-or-active game between the two students. */
async function makeGame(overrides = {}) {
  const q = await db.query(
    `INSERT INTO online_games (admin_id, student_id, admin_color, status, result, result_reason,
       fen, pgn, time_base_minutes, time_increment_seconds, white_ms, black_ms,
       is_bot, bot_level, draw_offered_by, draw_offered_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'start','1. e4 e5 ',10,5,600000,600000,$7,$8,$9,$10,NOW(),NOW())
     RETURNING id`,
    [
      overrides.adminId, overrides.studentId,
      overrides.adminColor || 'white',
      overrides.status || 'active',
      overrides.result || null,
      overrides.reason || null,
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
    `SELECT status, result, result_reason, draw_offered_by, draw_offered_at
       FROM online_games WHERE id = $1`,
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
  /* Marks + a full snapshot for the per-control tables and the rating counters,
     so finishing a draw (which IS a rated result) leaves no residue. */
  const tcMark = (await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM student_time_ratings')).rows[0].id;
  const tcHistMark = (await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM time_control_rating_history')).rows[0].id;
  const before = (await db.query(
`SELECT id, current_rating, peak_rating, highest_level, games_played, provisional_games,
            last_rating_change_at FROM students WHERE id = ANY($1)`, [[a.student_id, b.student_id]],
  )).rows;
  const created = [];

  try {
    await check('offering a draw does NOT finish the game', async () => {
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id });
      created.push(id);
      const r = await api(`/api/online/games/${id}/draw-offer`, aToken, { method: 'POST' });
      assert.equal(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(r.data)}`);
      const row = await gameRow(id);
      assert.equal(row.status, 'active', 'the match must still be running after an offer');
      assert.equal(row.result, null, 'no result may be recorded yet');
      assert.equal(row.draw_offered_by, a.user_id, 'the offer must be attributed to the offerer');
      assert.ok(row.draw_offered_at, 'the offer must be timestamped');
    });

    await check('the offerer sees it as MINE and the opponent does not', async () => {
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id });
      created.push(id);
      await api(`/api/online/games/${id}/draw-offer`, aToken, { method: 'POST' });
      const ra = await api(`/api/online/games/${id}`, aToken);
      const rb = await api(`/api/online/games/${id}`, bToken);
      assert.ok(ra.data.drawOffer, 'the offerer must see a pending offer');
      assert.equal(ra.data.drawOffer.mine, true, "the offerer's own offer must be flagged mine");
      assert.ok(rb.data.drawOffer, 'the opponent must see the pending offer');
      assert.equal(rb.data.drawOffer.mine, false, 'the opponent must NOT see it as theirs');
      /* Same underlying row, two honest perspectives. */
      assert.equal(ra.data.drawOffer.by, rb.data.drawOffer.by, 'both must name the same offerer');
    });

    await check('you cannot answer your OWN draw offer', async () => {
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id });
      created.push(id);
      await api(`/api/online/games/${id}/draw-offer`, aToken, { method: 'POST' });
      const r = await api(`/api/online/games/${id}/draw-respond`, aToken, {
        method: 'POST', body: { accept: true },
      });
      assert.equal(r.status, 400, `self-accept must be refused, got ${r.status}`);
      const row = await gameRow(id);
      assert.equal(row.status, 'active', 'the game must still be running');
    });

    await check('declining leaves the game running and clears the offer', async () => {
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id });
      created.push(id);
      await api(`/api/online/games/${id}/draw-offer`, aToken, { method: 'POST' });
      const r = await api(`/api/online/games/${id}/draw-respond`, bToken, {
        method: 'POST', body: { accept: false },
      });
      assert.equal(r.status, 200, `expected 200, got ${r.status}`);
      const row = await gameRow(id);
      assert.equal(row.status, 'active', 'a declined draw must not end the game');
      assert.equal(row.result, null, 'a declined draw must record no result');
      assert.equal(row.draw_offered_by, null, 'a declined offer must be cleared');
      assert.equal(r.data.drawOffer, null, 'the cleared offer must not come back on the payload');
    });

    await check('a declined offer cannot be answered again', async () => {
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id });
      created.push(id);
      await api(`/api/online/games/${id}/draw-offer`, aToken, { method: 'POST' });
      await api(`/api/online/games/${id}/draw-respond`, bToken, { method: 'POST', body: { accept: false } });
      const r = await api(`/api/online/games/${id}/draw-respond`, bToken, {
        method: 'POST', body: { accept: true },
      });
      assert.equal(r.status, 400, 'there is nothing left to accept');
      const row = await gameRow(id);
      assert.equal(row.status, 'active');
    });

    await check('ACCEPTING finishes the match as a draw', async () => {
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id });
      created.push(id);
      await api(`/api/online/games/${id}/draw-offer`, aToken, { method: 'POST' });
      const r = await api(`/api/online/games/${id}/draw-respond`, bToken, {
        method: 'POST', body: { accept: true },
      });
      assert.equal(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(r.data)}`);
      const row = await gameRow(id);
      assert.equal(row.status, 'finished', 'accepting must finish the match');
      assert.equal(row.result, 'draw', 'an agreed draw records result=draw');
      assert.equal(row.result_reason, 'agreement', 'the reason must be agreement');
      assert.equal(row.draw_offered_by, null, 'the offer must be cleared once answered');
      /* The overlay reads this; without it the card would show a blank title. */
      assert.equal(r.data.result, 'draw', 'the payload must report the draw to the client');
    });

    await check('an agreed draw is RATED (both players get a history row)', async () => {
      /* The old instant-draw button called endGame(), which records
         result='abandoned' and is deliberately unrated — so agreeing a draw left
         both ratings untouched. An agreed draw is a real result and must be
         rated, exactly like a resignation. */
      const { rows } = await db.query(
        `SELECT student_id, result FROM rating_history WHERE online_game_id = $1`,
        [created[created.length - 1]]
      );
      assert.equal(rows.length, 2, `both players must be rated, got ${rows.length} row(s)`);
      for (const row of rows) {
        assert.equal(row.result, 'draw', `a rated agreed draw must record a draw, got ${row.result}`);
      }
    });

    await check('simultaneous offers count as acceptance', async () => {
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id });
      created.push(id);
      await api(`/api/online/games/${id}/draw-offer`, aToken, { method: 'POST' });
      const r = await api(`/api/online/games/${id}/draw-offer`, bToken, { method: 'POST' });
      assert.equal(r.status, 200, `expected 200, got ${r.status}`);
      const row = await gameRow(id);
      assert.equal(row.status, 'finished', 'offering back into an open offer IS acceptance');
      assert.equal(row.result, 'draw');
    });

    await check('re-offering my own pending offer just refreshes it', async () => {
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id });
      created.push(id);
      await api(`/api/online/games/${id}/draw-offer`, aToken, { method: 'POST' });
      const r = await api(`/api/online/games/${id}/draw-offer`, aToken, { method: 'POST' });
      assert.equal(r.status, 200, 're-offering must not error');
      const row = await gameRow(id);
      assert.equal(row.status, 'active', 're-offering must NOT end my own game');
      assert.equal(row.draw_offered_by, a.user_id);
    });

    await check('an offer survives a move (play continues)', async () => {
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id });
      created.push(id);
      await api(`/api/online/games/${id}/draw-offer`, aToken, { method: 'POST' });
      /* The fixture's PGN is "1. e4 e5", so it is White to move and the e-pawn
         has already gone — Nf3 is the legal developing move here (e2-e4 would
         be rejected as an illegal move, testing nothing about the offer). */
      const mv = await api(`/api/online/games/${id}/move`, aToken, {
        method: 'POST', body: { from: 'g1', to: 'f3' },
      });
      assert.equal(mv.status, 200, `the move must still be legal, got ${mv.status}: ${JSON.stringify(mv.data)}`);
      const row = await gameRow(id);
      assert.equal(row.status, 'active', 'an offer must not prevent play');
      assert.equal(row.draw_offered_by, a.user_id, 'the offer must still stand after a move');
    });

    await check('an offer is cleared when the game ends by resignation', async () => {
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id });
      created.push(id);
      await api(`/api/online/games/${id}/draw-offer`, aToken, { method: 'POST' });
      await api(`/api/online/games/${id}/resign`, bToken, { method: 'POST' });
      const row = await gameRow(id);
      assert.equal(row.status, 'finished');
      assert.equal(row.draw_offered_by, null, 'a stale offer must not survive the finish');
      const r = await api(`/api/online/games/${id}/draw-respond`, bToken, {
        method: 'POST', body: { accept: true },
      });
      assert.equal(r.status, 400, 'a finished game cannot answer an offer');
    });

    await check('a computer game cannot be drawn by agreement', async () => {
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id, isBot: true });
      created.push(id);
      const r = await api(`/api/online/games/${id}/draw-offer`, aToken, { method: 'POST' });
      assert.equal(r.status, 400, `a bot game must refuse an offer, got ${r.status}`);
      const row = await gameRow(id);
      assert.equal(row.status, 'active', 'and must not be ended by the refusal');
    });

    await check('a finished game cannot be offered a draw', async () => {
      const id = await makeGame({
        adminId: a.user_id, studentId: b.user_id,
        status: 'finished', result: 'draw', reason: 'stalemate',
      });
      created.push(id);
      const r = await api(`/api/online/games/${id}/draw-offer`, aToken, { method: 'POST' });
      assert.equal(r.status, 400, `expected 400, got ${r.status}`);
    });

    await check('a non-participant can neither offer nor answer', async () => {
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id });
      created.push(id);
      const offer = await api(`/api/online/games/${id}/draw-offer`, coachToken, { method: 'POST' });
      assert.equal(offer.status, 403, `a coach must get 403, got ${offer.status}`);
      await api(`/api/online/games/${id}/draw-offer`, aToken, { method: 'POST' });
      const answer = await api(`/api/online/games/${id}/draw-respond`, coachToken, {
        method: 'POST', body: { accept: true },
      });
      assert.equal(answer.status, 403, `a coach must get 403, got ${answer.status}`);
      const row = await gameRow(id);
      assert.equal(row.status, 'active', 'neither attempt may end the game');
    });

    await check('an unauthenticated draw request is refused', async () => {
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id });
      created.push(id);
      const r = await api(`/api/online/games/${id}/draw-offer`, null, { method: 'POST' });
      assert.equal(r.status, 401, `expected 401, got ${r.status}`);
    });

    await check('a payload with no offer reports drawOffer null, not undefined', async () => {
      const id = await makeGame({ adminId: a.user_id, studentId: b.user_id });
      created.push(id);
      const r = await api(`/api/online/games/${id}`, aToken);
      assert.equal(r.data.drawOffer, null, 'the UI reads this key directly, so it must be present');
    });
  } finally {
    for (const id of created) {
      /* The pool history first: its online_game_id FK is ON DELETE SET NULL, so
         deleting the game would orphan these rows instead of removing them. */
      await db.query('DELETE FROM time_control_rating_history WHERE online_game_id = $1', [id]);
      await db.query('DELETE FROM rating_history WHERE online_game_id = $1', [id]);
      await db.query('DELETE FROM online_games WHERE id = $1', [id]);
    }
    await db.query('DELETE FROM rating_history WHERE id > $1', [ratingMark]);
    await db.query('DELETE FROM time_control_rating_history WHERE id > $1', [tcHistMark]);
    await db.query('DELETE FROM student_time_ratings WHERE id > $1', [tcMark]);
    await db.query('DELETE FROM student_levels WHERE id > $1', [levelMark]);
    /* Restore every rating counter this suite moved. The old line reset
       current_rating to itself, which is a no-op that left games_played and
       peak_rating permanently inflated by this suite. */
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
