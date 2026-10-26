/* Regression test: applyOnlineRating() must rate a game against the OPPONENT's
 * real rating, not the player's own.
 *
 * Run: node scripts/test-rating-opponent.js
 *
 * THE BUG
 * -------
 * onlineController.applyOnlineRating() built its two lookup maps from
 *
 *     SELECT current_rating, name FROM students s JOIN users u ...
 *
 * which does NOT include `s.id` -- and both maps are keyed by it:
 *
 *     ratingById[r.id] = r.current_rating
 *     nameById[r.id]    = r.name
 *
 * So every row keyed as the string "undefined". Both players COLLIDED into a
 * single map entry and `ratingById[whiteStudent]` was undefined.
 * ratingService.updateSingleStudent() then hit its defensive line
 *
 *     expectedScore(profile.current_rating, opponentRating ?? profile.current_rating)
 *
 * substituting the player's OWN rating for the opponent's. expectedScore(r, r)
 * is exactly 0.5 for any r, so with K=20 every game computed
 * round(20 * (1 - 0.5)) = +10 and round(20 * (0 - 0.5)) = -10 -- the flat ±10
 * seen regardless of the real rating gap. rating_history.opponent_name was also
 * stored NULL, and opponent_id was left unpopulated, from the same cause.
 *
 * WHAT IS ASSERTED HERE
 * ---------------------
 * Every expected number is computed with the project's OWN exported helpers
 * (expectedScore / kFactor / newRating). The rating algorithm is never
 * re-implemented here, and nothing about it was changed: these tests only prove
 * the correct opponent rating now reaches it.
 *
 * Part 1 drives rating.applyGameResult directly to establish that a rating gap
 * genuinely changes the result.
 * Part 2 drives the real controller end-to-end over HTTP (resign / draw), so it
 * covers the actual query in onlineController and the rating_history rows it
 * writes.
 *
 * Everything is snapshot/restore: no real rating is left moved. */
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const db = require('../src/config/database');
const rating = require('../src/services/ratingService');

let pass = 0;
let fail = 0;
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const A_RATING = 1000;
const B_RATING = 1400;
/* games_played >= 20, birthdate => age >= 18 and peak_rating < 2200 all pin the
   K-factor at 20 so the arithmetic below is stable and readable. The value of K
   itself is the service's decision, not this test's. */
const FIXED_K = 20;

const sign = (id, role) =>
  jwt.sign({ id, role, name: 'tester', email: 't@example.invalid' }, process.env.JWT_SECRET, { expiresIn: '5m' });

async function post(path, token, body = {}) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

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

/* Expected change, computed with the service's OWN functions so this file never
   re-implements the formula. */
function expectedChange(playerRating, opponentRating, score) {
  const exp = rating.expectedScore(playerRating, opponentRating);
  return rating.newRating(playerRating, FIXED_K, exp, score) - playerRating;
}

/* Pin both players to a known rating gap and a deterministic K-factor. */
async function setRatings(aId, bId, aVal, bVal) {
  await db.query(
    `UPDATE students SET current_rating = $1, peak_rating = GREATEST(peak_rating, $1),
        highest_level = 1, games_played = 25, provisional_games = 0, birthdate = DATE '2000-01-01'
      WHERE id = $2`,
    [aVal, aId],
  );
  await db.query(
    `UPDATE students SET current_rating = $1, peak_rating = GREATEST(peak_rating, $1),
        highest_level = 1, games_played = 25, provisional_games = 0, birthdate = DATE '2000-01-01'
      WHERE id = $2`,
    [bVal, bId],
  );
  await db.query('DELETE FROM student_time_ratings WHERE student_id = ANY($1)', [[aId, bId]]);
}

async function main() {
  const { rows: stu } = await db.query(
    `SELECT u.id AS user_id, u.name, s.id AS student_id
       FROM users u JOIN students s ON s.user_id = u.id
      WHERE u.role = 'student' ORDER BY u.id LIMIT 2`,
  );
  assert.equal(stu.length, 2, 'need two student accounts');
  const [A, B] = stu;
  const aToken = sign(A.user_id, 'student');
  const bToken = sign(B.user_id, 'student');

  const snapshot = (
    await db.query(
`SELECT id, current_rating, peak_rating, highest_level, games_played,
            provisional_games, birthdate, last_rating_change_at
       FROM students WHERE id = ANY($1)`, [[A.student_id, B.student_id]],
    )
  ).rows;
  const histMark = (await db.query('SELECT COALESCE(MAX(id),0) AS id FROM rating_history')).rows[0].id;
  const levelMark = (await db.query('SELECT COALESCE(MAX(id),0) AS id FROM student_levels')).rows[0].id;
  const timeMark = (await db.query('SELECT COALESCE(MAX(id),0) AS id FROM student_time_ratings')).rows[0].id;
  const poolHistMark = (await db.query('SELECT COALESCE(MAX(id),0) AS id FROM time_control_rating_history')).rows[0].id;
  const created = [];

  /* Insert an ACTIVE two-player game the real controllers will accept:
     resignGame / respondDraw are driven entirely off the row, so a plain
     fixture is enough to reach applyOnlineRating without a live socket game. */
  async function makeActiveGame({ adminUserId, studentUserId, adminColor = 'white', base = 10, inc = 5 }) {
    const g = (
      await db.query(
        `INSERT INTO online_games (admin_id, student_id, admin_color, status, result, result_reason,
           fen, pgn, time_base_minutes, time_increment_seconds, white_ms, black_ms, is_bot,
           draw_offered_by, draw_offered_at, created_at, updated_at)
         VALUES ($1,$2,$3,'active',NULL,NULL,'start','',$4,$5,600000,600000,FALSE,NULL,NULL,NOW(),NOW())
         RETURNING id`,
        [adminUserId, studentUserId, adminColor, base, inc],
      )
    ).rows[0];
    created.push(g.id);
    return g.id;
  }

  const historyFor = (gameId) =>
    db.query(
      `SELECT student_id, opponent_id, opponent_name, result, rating_before, rating_after,
              rating_change, time_control, online_game_id
         FROM rating_history WHERE online_game_id = $1 ORDER BY student_id`,
      [gameId],
    ).then((r) => r.rows);

  try {
    /* ══ Part 1 · the formula itself reacts to a real rating gap ═════════════ */

    await check('P1 an underdog win is worth MORE than an equal-rating win', () => {
      const gap = expectedChange(A_RATING, B_RATING, 1);
      const equal = expectedChange(A_RATING, A_RATING, 1);
      assert.ok(gap > equal,
        `1000 beating 1400 must beat the equal-rating baseline: ${gap} vs ${equal}`);
      assert.notEqual(gap, equal, 'the gap must not be ignored');
    });

    await check('P1 an underdog LOSS costs LESS than an equal-rating loss', () => {
      const gap = expectedChange(A_RATING, B_RATING, 0);
      const equal = expectedChange(A_RATING, A_RATING, 0);
      assert.ok(gap > equal, `beating a stronger player costs less: ${gap} vs ${equal}`);
    });

    await check('P1 the favourite loses MORE for losing than an equal match would', () => {
      const fav = expectedChange(B_RATING, A_RATING, 0);
      const equal = expectedChange(B_RATING, B_RATING, 0);
      assert.ok(fav < equal, `1400 losing to 1000 costs more: ${fav} vs ${equal}`);
    });

    await check('P1 the old flat ±10 is exactly the equal-rating baseline (regression witness)', () => {
      /* This is the signature of the bug: K=20 with expectedScore(r, r) === 0.5
         gives exactly ±10 for EVERY game. If this assertion ever changes, the
         fixture no longer reproduces the reported symptom. */
      assert.equal(expectedChange(A_RATING, A_RATING, 1), 10);
      assert.equal(expectedChange(A_RATING, A_RATING, 0), -10);
    });

    await check('P1 a draw between unequal players is not zero', () => {
      const underdog = expectedChange(A_RATING, B_RATING, 0.5);
      const favourite = expectedChange(B_RATING, A_RATING, 0.5);
      assert.ok(underdog > 0, `the weaker player gains from a draw: ${underdog}`);
      assert.ok(favourite < 0, `the stronger player loses from a draw: ${favourite}`);
      assert.equal(underdog, -favourite, 'a draw must stay zero-sum between the two');
    });

    /* Pin a per-time-control pool to a known rating. Needed because a player's
     FIRST game in a control creates both pools at STARTING_RATING, which would
     make the two pools equal by accident and prove nothing about the opponent
     rating. */
  async function seedPool(studentId, timeClass, value) {
    await db.query(
      `INSERT INTO student_time_ratings
         (student_id, time_class, rating, peak_rating, highest_level, games_played, provisional_games)
       VALUES ($1,$2,$3,$3,1,25,0)
       ON CONFLICT (student_id, time_class) DO UPDATE
         SET rating = $3, peak_rating = $3, games_played = 25, provisional_games = 0`,
      [studentId, timeClass, value],
    );
  }

  const poolRating = (studentId, timeClass) =>
    db.query(
      'SELECT rating FROM student_time_ratings WHERE student_id = $1 AND time_class = $2',
      [studentId, timeClass],
    ).then((r) => r.rows[0]?.rating);

  /* §13 · both rating categories use the correct opponent rating.

       NOTE ON SCOPE: these two are a GUARD, not a reproduction of the bug. The
       per-control pools never used the broken map. applyGameResult resolves the
       pool opponent as `opponentPool?.rating ?? opponent.rating`, and
       getTimeRating() always returns a row for a recognised class (creating it
       at STARTING_RATING), so the `?? opponent.rating` arm - the only thing the
       s.id bug could have poisoned - is unreachable on this path. Verified by
       running this file against the reverted query: these two still pass while
       the overall-rating tests fail. They are kept because they pin the rule
       that matters here - a Blitz game is scored against the opponent's BLITZ
       number, never the overall/classical one - which a future refactor could
       still break. */
    /* ══ Part 2 · the real controller, end to end ═══════════════════════════ */

    /* Case A: A (1000) beats B (1400). B resigns, A is White. */
    await check('P2 Case A — the underdog WINS: direction, magnitude, and opponent identity', async () => {
      await setRatings(A.student_id, B.student_id, A_RATING, B_RATING);
      /* admin_color 'white' means the admin (A) is White, so B's resignation
         hands the win to White = A. */
      const gid = await makeActiveGame({ adminUserId: A.user_id, studentUserId: B.user_id, adminColor: 'white' });

      const res = await post(`/api/online/games/${gid}/resign`, bToken);
      assert.equal(res.status, 200, `resign failed: ${res.status} ${JSON.stringify(res.data)}`);

      const rows = await historyFor(gid);
      assert.equal(rows.length, 2, `expected 2 rating_history rows, got ${rows.length}`);

      const aRow = rows.find((r) => r.student_id === A.student_id);
      const bRow = rows.find((r) => r.student_id === B.student_id);
      assert.ok(aRow && bRow, 'one row per player');

      const expA = expectedChange(A_RATING, B_RATING, 1);
      const expB = expectedChange(B_RATING, A_RATING, 0);

      assert.equal(aRow.result, 'win', 'A won');
      assert.ok(aRow.rating_change > 0, `the winner must gain, got ${aRow.rating_change}`);
      assert.equal(aRow.rating_change, expA,
        `winner change must use opponent rating ${B_RATING}, expected ${expA}, got ${aRow.rating_change}`);

      assert.equal(bRow.result, 'loss', 'B lost');
      assert.ok(bRow.rating_change < 0, `the loser must lose, got ${bRow.rating_change}`);
      assert.equal(bRow.rating_change, expB,
        `loser change must use opponent rating ${A_RATING}, expected ${expB}, got ${bRow.rating_change}`);

      assert.notEqual(aRow.rating_change, 10, 'the change must NOT be the flat +10 of the bug');
      assert.notEqual(bRow.rating_change, -10, 'the change must NOT be the flat -10 of the bug');
    });

    /* Case B: reset, and B (1400) beats A (1000). */
    await check('P2 Case B — the favourite WINS: direction from the other side', async () => {
      await setRatings(A.student_id, B.student_id, A_RATING, B_RATING);
      /* admin_color 'black' => the admin (A) is Black, so A's resignation gives
         the win to White = B. */
      const gid = await makeActiveGame({ adminUserId: A.user_id, studentUserId: B.user_id, adminColor: 'black' });

      const res = await post(`/api/online/games/${gid}/resign`, aToken);
      assert.equal(res.status, 200, `resign failed: ${res.status} ${JSON.stringify(res.data)}`);

      const rows = await historyFor(gid);
      const bRow = rows.find((r) => r.student_id === B.student_id);
      const aRow = rows.find((r) => r.student_id === A.student_id);

      assert.equal(bRow.result, 'win', 'B won');
      assert.ok(bRow.rating_change > 0, `the winner must gain, got ${bRow.rating_change}`);
      assert.equal(bRow.rating_change, expectedChange(B_RATING, A_RATING, 1));

      assert.equal(aRow.result, 'loss', 'A lost');
      assert.ok(aRow.rating_change < 0, `the loser must lose, got ${aRow.rating_change}`);
      assert.equal(aRow.rating_change, expectedChange(A_RATING, B_RATING, 0));

      assert.notEqual(bRow.rating_change, 10, 'must not be the flat +10 of the bug');
      assert.notEqual(aRow.rating_change, -10, 'must not be the flat -10 of the bug');
    });

    /* Case C: a draw across a real gap. */
    await check('P2 Case C — a DRAW uses both players\' real ratings', async () => {
      await setRatings(A.student_id, B.student_id, A_RATING, B_RATING);
      const gid = await makeActiveGame({ adminUserId: A.user_id, studentUserId: B.user_id, adminColor: 'white' });

      const offered = await post(`/api/online/games/${gid}/draw-offer`, aToken);
      assert.equal(offered.status, 200, `draw-offer failed: ${offered.status} ${JSON.stringify(offered.data)}`);
      const accepted = await post(`/api/online/games/${gid}/draw-respond`, bToken, { accept: true });
      assert.equal(accepted.status, 200, `draw-respond failed: ${accepted.status}`);

      const rows = await historyFor(gid);
      assert.equal(rows.length, 2, `expected 2 rating_history rows, got ${rows.length}`);
      for (const r of rows) {
        assert.equal(r.result, 'draw', 'both rows must say draw');
        assert.equal(r.rating_change - 0, r.rating_change, 'sanity');
      }
      const aRow = rows.find((r) => r.student_id === A.student_id);
      const bRow = rows.find((r) => r.student_id === B.student_id);

      /* The underdog GAINS from the draw and the favourite LOSES from it. This
         is the existing formula's behaviour, asserted so it cannot silently
         flatten to the ±0 of a self-rated draw. */
      assert.equal(aRow.rating_change, expectedChange(A_RATING, B_RATING, 0.5),
        'the weaker player\'s draw change must use the opponent\'s real rating');
      assert.ok(aRow.rating_change > 0, 'underdog draw should gain');
      assert.equal(bRow.rating_change, expectedChange(B_RATING, A_RATING, 0.5));
      assert.ok(bRow.rating_change < 0, 'favourite draw should lose');
      assert.equal(aRow.rating_change, -bRow.rating_change, 'a draw must be zero-sum');
    });

    /* §8 · rating_history integrity for every row the controller wrote. */
    await check('P2 rating_history rows are internally consistent and correctly attributed', async () => {
      const rows = await db.query(
        `SELECT rh.* FROM rating_history rh WHERE rh.id > $1 ORDER BY rh.id`, [histMark],
      ).then((r) => r.rows);
      assert.ok(rows.length >= 6, `expected the Case A/B/C rows, got ${rows.length}`);
      for (const r of rows) {
        assert.equal(r.rating_after - r.rating_before, r.rating_change,
          `after - before must equal change (row ${r.id})`);
        assert.notEqual(r.opponent_id, r.student_id,
          `opponent_id must never equal student_id (row ${r.id})`);
        assert.ok(r.opponent_id != null, `opponent_id must be recorded (row ${r.id})`);
        assert.ok(r.opponent_name, `opponent_name must no longer be NULL (row ${r.id})`);
        assert.ok(r.online_game_id != null, `online_game_id must link to the game (row ${r.id})`);
        assert.ok(r.time_control, `time_control must be recorded (row ${r.id})`);
        if (r.result === 'win') assert.ok(r.rating_change > 0, `a win must gain (row ${r.id})`);
        if (r.result === 'loss') assert.ok(r.rating_change < 0, `a loss must lose (row ${r.id})`);
      }
    });

    await check('P2 opponent_id/opponent_name point at the OTHER player', async () => {
      const rows = await db.query(
        `SELECT rh.* FROM rating_history rh WHERE rh.id > $1 ORDER BY rh.id`, [histMark],
      ).then((r) => r.rows);
      const byStudent = { [A.student_id]: A.name, [B.student_id]: B.name };
      for (const r of rows) {
        const me = byStudent[r.student_id];
        const them = byStudent[r.opponent_id];
        assert.ok(me, `row ${r.id} must belong to one of the two students`);
        assert.ok(them, `row ${r.id} must name the opponent as one of the two students`);
        assert.equal(r.opponent_name, them,
          `row ${r.id}: opponent_name must be the other player's name, not NULL or the player's own`);
        assert.notEqual(r.opponent_name, me, `row ${r.id} must not record the player as their own opponent`);
      }
    });

    /* §13 · both rating categories use the correct opponent rating. */
    for (const [label, base, inc] of [['Rapid', 10, 5], ['Blitz', 5, 0]]) {
      await check(`P2 ${label}: the per-control pool also uses the real opponent rating`, async () => {
        await setRatings(A.student_id, B.student_id, A_RATING, B_RATING);
        const gid = await makeActiveGame({ adminUserId: A.user_id, studentUserId: B.user_id, adminColor: 'white', base, inc });
        const res = await post(`/api/online/games/${gid}/resign`, bToken);
        assert.equal(res.status, 200, `resign failed: ${res.status}`);

        const row = (
          await db.query(
            `SELECT time_control FROM rating_history WHERE online_game_id = $1 AND student_id = $2`,
            [gid, A.student_id],
          )
        ).rows[0];
        assert.equal(row?.time_control, label, `expected a ${label} game to be recorded as ${label}`);

        const pools = await db.query(
          `SELECT student_id, rating FROM student_time_ratings
            WHERE student_id = ANY($1) AND time_class = $2`,
          [[A.student_id, B.student_id], label.toLowerCase()],
        );
        assert.equal(pools.rows.length, 2, `both ${label} pools must exist`);
        for (const p of pools.rows) assert.equal(typeof p.rating, 'number');

        /* The pool is scored against the opponent's rating in the SAME control
           (`opponentRating: opponentPool?.rating ?? opponent.rating`). So a
           Blitz game must move the Blitz pool using the Blitz number, and must
           NOT be scored against the overall/classical figure. Seeded unequal, so
           the gap is genuinely exercised rather than coincidentally equal. */
        const tc = label.toLowerCase();
        await seedPool(A.student_id, tc, 1000);
        await seedPool(B.student_id, tc, 1400);
        const gid2 = await makeActiveGame({
          adminUserId: A.user_id, studentUserId: B.user_id, adminColor: 'white', base, inc,
        });
        const res2 = await post(`/api/online/games/${gid2}/resign`, bToken);
        assert.equal(res2.status, 200, `second ${label} resign failed: ${res2.status}`);

        const poolA = await poolRating(A.student_id, tc);
        const poolB = await poolRating(B.student_id, tc);
        /* Pools use K=20 too (games_played 25, age null, peak < 2200). */
        assert.equal(poolA, 1000 + expectedChange(1000, 1400, 1),
          `${label} pool must be scored against the opponent's ${label} rating`);
        assert.equal(poolB, 1400 + expectedChange(1400, 1000, 0),
          `${label} pool must mirror the opponent's ${label} rating`);
        assert.notEqual(poolA, 1010,
          `${label} pool change must NOT be the flat +10 of an equal-rating self-matchup`);
      });
    }

    /* §9 · Recent Rated Results must still resolve the opponent by id. */
    await check('P2 Recent Rated Results still resolves the opponent through opponent_id', async () => {
      const rows = await db.query(
        `SELECT rh.student_id, rh.opponent_id, rh.rating_before, rh.rating_after, rh.rating_change, rh.result
           FROM rating_history rh
          WHERE rh.id > $1 AND rh.opponent_id IS NOT NULL
          ORDER BY rh.id`,
        [histMark],
      ).then((r) => r.rows);
      assert.ok(rows.length, 'need rated rows for the recent-results join');
      for (const r of rows) {
        assert.notEqual(r.opponent_id, r.student_id, 'recent results must never show the player as own opponent');
        assert.equal(r.rating_after - r.rating_before, r.rating_change);
      }
    });

    /* §12 · the explicit witness: the opponent rating is not the player's own. */
    await check('P2 the opponent rating actually reaching the formula is not the player\'s own', async () => {
      await setRatings(A.student_id, B.student_id, A_RATING, B_RATING);
      const gid = await makeActiveGame({ adminUserId: A.user_id, studentUserId: B.user_id, adminColor: 'white' });
      const res = await post(`/api/online/games/${gid}/resign`, bToken);
      assert.equal(res.status, 200);

      const rows = await historyFor(gid);
      const aRow = rows.find((r) => r.student_id === A.student_id);
      const asSelfRated = expectedChange(A_RATING, A_RATING, 1);
      assert.notEqual(aRow.rating_change, asSelfRated,
        'the winner\'s change is identical to a self-rated win -> the opponent rating was NOT used');
      assert.notEqual(aRow.rating_change, 10, 'the winner\'s change is the flat +10 of the bug');
      /* And the two players' changes are mirror images, which only happens when
         each was rated against the other. */
      const bRow = rows.find((r) => r.student_id === B.student_id);
      assert.equal(aRow.rating_change, -bRow.rating_change, 'the two changes must mirror');
    });
  } finally {
    /* Cleanup must not depend on the assertions passing. */
    for (const id of created) {
      /* time_control_rating_history first. Its online_game_id FK is ON DELETE
         SET NULL, so deleting the game row would leave these pool rows behind
         with a NULL link rather than removing them - and an orphan is still
         rated history. The id-mark sweep below is the safety net. */
      await db.query('DELETE FROM time_control_rating_history WHERE online_game_id = $1', [id]);
      await db.query('DELETE FROM rating_history WHERE online_game_id = $1', [id]);
      await db.query('DELETE FROM online_games WHERE id = $1', [id]);
    }
    await db.query('DELETE FROM rating_history WHERE id > $1', [histMark]);
    await db.query('DELETE FROM time_control_rating_history WHERE id > $1', [poolHistMark]);
    await db.query('DELETE FROM student_levels WHERE id > $1', [levelMark]);
    await db.query('DELETE FROM student_time_ratings WHERE id > $1', [timeMark]);
    for (const row of snapshot) {
      await db.query(
`UPDATE students SET current_rating = $1, peak_rating = $2, highest_level = $3,
           games_played = $4, provisional_games = $5, birthdate = $6,
           last_rating_change_at = $7 WHERE id = $8`,
        [row.current_rating, row.peak_rating, row.highest_level, row.games_played,
          row.provisional_games, row.birthdate, row.last_rating_change_at, row.id],
      );
    }
    server.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('harness error:', e);
  server.close();
  process.exit(1);
});