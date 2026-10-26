/* Time-control -> rating category/pool, end to end.
 *
 * Run: node scripts/test-time-control-category.js
 *
 * WHAT THIS EXISTS TO CATCH
 * -------------------------
 * The product bug: "no matter what time control is played, the result card shows
 * Rapid rating, and the rating change is applied to Rapid."
 *
 * Two independent things have to agree, and a test that only checks one of them
 * proves nothing:
 *
 *   1. POOL SELECTION - which rating category's pool actually moved.
 *   2. REPORTING - what the history row and the rating-result API call that
 *      category. This is the half that produces the visible wrong label, and it
 *      is the half a "did a rating change?" assertion cannot see.
 *
 * The previous suite (test-rating-opponent.js) covered the pools only, and its
 * pool checks pass even with the opponent-ID bug present - pool resolution comes
 * from student_time_ratings, never from the broken lookup map. These tests are
 * written to FAIL if the category is hardcoded to rapid, whichever half breaks.
 *
 * THE CANONICAL MAPPING (ratingService.classifyTimeControl, the single source of
 * truth that selects the pool):
 *
 *   base < 3  -> bullet      base >= 3 and < 10  -> blitz
 *   base < 30 -> rapid       base >= 30          -> classical
 *
 * Every expectation below is computed by CALLING that function rather than being
 * restated, so the test cannot drift away from the implementation - and if the
 * mapping is ever intentionally changed, these tests follow it and say so.
 *
 * POOL ISOLATION uses deliberately lopsided seeds (Blitz 1500 / Rapid 800) so
 * that selecting the wrong pool produces an unmistakable number, not a subtle
 * difference. A test with equal seeds cannot detect a wrong-pool selection at
 * all, because both pools would move identically.
 *
 * Snapshot/restore throughout: no real rating, pool or history row survives. */
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const db = require('../src/config/database');
const rating = require('../src/services/ratingService');

let pass = 0;
let fail = 0;
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const sign = (id, role) =>
  jwt.sign({ id, role, name: 'tester', email: 't@example.invalid' }, process.env.JWT_SECRET, { expiresIn: '5m' });

async function post(path, token, body = {}) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function get(path, token) {
  const res = await fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, data: await res.json().catch(() => null) };
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

/* The canonical mapping, obtained from the implementation itself. */
const expectClass = (baseMin) => rating.classifyTimeControl(`${baseMin}+0`);
const expectLabel = (baseMin) => rating.timeClassLabel(expectClass(baseMin));

/* Lopsided seeds: if the wrong pool is touched, the numbers cannot be mistaken. */
const SEED = { blitz: 1500, rapid: 800, bullet: 1600, classical: 700 };

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
  const SIDS = [A.student_id, B.student_id];

  /* Snapshot everything this file moves. */
  const stuSnap = (await db.query(
    `SELECT id, current_rating, peak_rating, highest_level, games_played,
            provisional_games, birthdate, last_rating_change_at FROM students WHERE id = ANY($1)`, [SIDS],
  )).rows;
  const poolSnap = (await db.query(
    'SELECT * FROM student_time_ratings WHERE student_id = ANY($1)', [SIDS],
  )).rows;
  const marks = {
    hist: (await db.query('SELECT COALESCE(MAX(id),0) m FROM rating_history')).rows[0].m,
    poolHist: (await db.query('SELECT COALESCE(MAX(id),0) m FROM time_control_rating_history')).rows[0].m,
    levels: (await db.query('SELECT COALESCE(MAX(id),0) m FROM student_levels')).rows[0].m,
    pools: (await db.query('SELECT COALESCE(MAX(id),0) m FROM student_time_ratings')).rows[0].m,
    games: (await db.query('SELECT COALESCE(MAX(id),0) m FROM online_games')).rows[0].m,
  };
  const createdGames = [];

  /* Deterministic K=20: >=20 games, adult, peak well under 2200. */
  async function resetOverall(a = 1000, b = 1400) {
    for (const [sid, val] of [[A.student_id, a], [B.student_id, b]]) {
      await db.query(
        `UPDATE students SET current_rating=$1, peak_rating=GREATEST(peak_rating,$1),
            highest_level=1, games_played=25, provisional_games=0, birthdate=DATE '2000-01-01'
          WHERE id=$2`,
        [val, sid],
      );
    }
  }

  /* Seed every pool to its lopsided value so a wrong-pool write is glaring. */
  async function seedPools() {
    await db.query('DELETE FROM student_time_ratings WHERE student_id = ANY($1)', [SIDS]);
    for (const sid of SIDS) {
      for (const [cls, val] of Object.entries(SEED)) {
        await db.query(
          `INSERT INTO student_time_ratings
             (student_id, time_class, rating, peak_rating, highest_level, games_played, provisional_games)
           VALUES ($1,$2,$3,$3,1,25,0)`,
          [sid, cls, val],
        );
      }
    }
  }

  const poolRating = (sid, cls) => db.query(
    'SELECT rating FROM student_time_ratings WHERE student_id=$1 AND time_class=$2', [sid, cls],
  ).then((r) => r.rows[0]?.rating);

  async function makeActiveGame(baseMin, incSec = 0) {
    const g = (await db.query(
      `INSERT INTO online_games (admin_id, student_id, admin_color, status, result, result_reason,
         fen, pgn, time_base_minutes, time_increment_seconds, white_ms, black_ms, is_bot,
         created_at, updated_at)
       VALUES ($1,$2,'white','active',NULL,NULL,'start','',$3,$4,600000,600000,FALSE,NOW(),NOW())
       RETURNING id`,
      [A.user_id, B.user_id, baseMin, incSec],
    )).rows[0];
    createdGames.push(g.id);
    return g.id;
  }

  const historyFor = (gid) => db.query(
    `SELECT student_id, time_control, time_class, result, rating_before, rating_after, rating_change
       FROM rating_history WHERE online_game_id=$1 ORDER BY student_id`, [gid],
  ).then((r) => r.rows);

  const poolHistoryFor = (gid) => db.query(
    `SELECT student_id, time_class, rating_before, rating_after, rating_change
       FROM time_control_rating_history WHERE online_game_id=$1 ORDER BY student_id`, [gid],
  ).then((r) => r.rows);

  try {
    /* ══ 1 · the mapping itself ══════════════════════════════════════════ */

    await check('the canonical mapping is bullet/blitz/rapid/classical by base minutes', () => {
      /* Restated deliberately: if a mapping change is intentional these four
         lines are the thing to edit, and the message names the boundary. */
      assert.equal(expectClass(1), 'bullet', '1 min must be bullet');
      assert.equal(expectClass(3), 'blitz', '3 min must be blitz');
      assert.equal(expectClass(5), 'blitz', '5 min must be blitz');
      assert.equal(expectClass(10), 'rapid', '10 min must be rapid');
      assert.equal(expectClass(30), 'classical', '30 min must be classical');
      /* The value the report called out: a 3-minute game is NOT rapid. */
      assert.notEqual(expectClass(3), 'rapid', 'a 3 min game must never be rapid');
      assert.notEqual(expectClass(5), 'rapid', 'a 5 min game must never be rapid');
    });

    /* ══ 2 · each time control end to end ════════════════════════════════ */

    for (const baseMin of [1, 3, 5, 10]) {
      await check(`${baseMin}+0 is categorised ${expectClass(baseMin)} (${expectLabel(baseMin)}) all the way through`, async () => {
        await resetOverall();
        await seedPools();
        const expected = expectClass(baseMin);
        const gid = await makeActiveGame(baseMin);

        /* B resigns; A is White (admin_color), so A wins. */
        const res = await post(`/api/online/games/${gid}/resign`, bToken);
        assert.equal(res.status, 200, `resign failed: ${res.status}`);

        /* (a) The POOL that moved must be this game's category. */
        const poolHist = await poolHistoryFor(gid);
        assert.equal(poolHist.length, 2, `expected 2 pool history rows, got ${poolHist.length}`);
        for (const p of poolHist) {
          assert.equal(p.time_class, expected,
            `pool history row must record the ${expected} pool for a ${baseMin} min game`);
        }

        /* (b) Every OTHER pool must be untouched. */
        for (const cls of Object.keys(SEED)) {
          if (cls === expected) continue;
          for (const sid of SIDS) {
            assert.equal(await poolRating(sid, cls), SEED[cls],
              `the ${cls} pool must NOT move for a ${baseMin} min game (expected ${expected})`);
          }
        }

        /* (c) rating_history must agree with the game's real time control. */
        const hist = await historyFor(gid);
        assert.equal(hist.length, 2);
        for (const h of hist) {
          assert.equal(h.time_control, expectLabel(baseMin),
            `rating_history.time_control must be the ${expectLabel(baseMin)} label`);
          assert.equal(h.time_class, expected,
            `rating_history.time_class must be the canonical '${expected}' key`);
        }

        /* (d) The API must report the same category - this is the half the
           player actually sees, and the half that used to say Rapid. */
        for (const [token, who] of [[aToken, 'A'], [bToken, 'B']]) {
          const api = await get(`/api/online/games/${gid}/rating-result`, token);
          assert.equal(api.status, 200);
          assert.equal(api.data.rated, true, `${who}: game must be rated`);
          assert.equal(api.data.timeClass, expected,
            `${who}: rating-result must report timeClass='${expected}', got ${api.data.timeClass}`);
          assert.equal(api.data.timeClassLabel, expectLabel(baseMin),
            `${who}: rating-result label must be ${expectLabel(baseMin)}`);
          assert.ok(api.data.timeControlChange,
            `${who}: rating-result must carry the pool move for this game`);
          assert.equal(api.data.timeControlChange.timeClass, expected,
            `${who}: the reported pool move must be the ${expected} one`);
        }
      });
    }

    /* ══ 3 · pool isolation, the sharp version ═══════════════════════════ */

    await check('a BLITZ game changes Blitz and leaves Rapid exactly 800', async () => {
      await resetOverall();
      await seedPools();
      const gid = await makeActiveGame(3);
      const res = await post(`/api/online/games/${gid}/resign`, bToken);
      assert.equal(res.status, 200);

      /* Blitz moved for both; Rapid did not move by even one point. */
      for (const sid of SIDS) {
        assert.notEqual(await poolRating(sid, 'blitz'), SEED.blitz,
          'the Blitz pool must move for a Blitz game');
        assert.equal(await poolRating(sid, 'rapid'), 800,
          `the Rapid pool must stay exactly 800 after a Blitz game (student ${sid})`);
      }
    });

    await check('a RAPID game changes Rapid and leaves Blitz exactly 1500', async () => {
      await resetOverall();
      await seedPools();
      const gid = await makeActiveGame(10);
      const res = await post(`/api/online/games/${gid}/resign`, bToken);
      assert.equal(res.status, 200);

      for (const sid of SIDS) {
        assert.notEqual(await poolRating(sid, 'rapid'), SEED.rapid,
          'the Rapid pool must move for a Rapid game');
        assert.equal(await poolRating(sid, 'blitz'), 1500,
          `the Blitz pool must stay exactly 1500 after a Rapid game (student ${sid})`);
      }
    });

    /* The mirror of the bug report: if a hardcoded 'rapid' were used to pick the
       pool, this is where it shows. Blitz seeded 700 points above Rapid, so the
       two outcomes cannot be confused. */
    await check('a BULLET game does not touch the Rapid pool (would catch a hardcoded rapid)', async () => {
      await resetOverall();
      await seedPools();
      const gid = await makeActiveGame(1);
      const res = await post(`/api/online/games/${gid}/resign`, bToken);
      assert.equal(res.status, 200);
      for (const sid of SIDS) {
        assert.notEqual(await poolRating(sid, 'bullet'), SEED.bullet,
          'the Bullet pool must move for a 1 min game');
        assert.equal(await poolRating(sid, 'rapid'), 800,
          `a Bullet game must leave Rapid at 800 (student ${sid})`);
      }
    });

    /* ══ 4 · both players derive the category from the same game ══════════ */

    await check('both players see the SAME category for the same game', async () => {
      await resetOverall();
      await seedPools();
      const gid = await makeActiveGame(5);
      const res = await post(`/api/online/games/${gid}/resign`, bToken);
      assert.equal(res.status, 200);

      const [ra, rb] = await Promise.all([
        get(`/api/online/games/${gid}/rating-result`, aToken),
        get(`/api/online/games/${gid}/rating-result`, bToken),
      ]);
      assert.equal(ra.data.timeClass, rb.data.timeClass,
        'both participants must derive the category from the same persisted game');
      assert.equal(ra.data.timeClass, 'blitz');
      assert.equal(ra.data.timeClassLabel, rb.data.timeClassLabel);
      /* And their pool moves are in the same category, not inferred separately. */
      assert.equal(ra.data.timeControlChange.timeClass, rb.data.timeControlChange.timeClass);
      assert.equal(ra.data.timeControlChange.timeClass, 'blitz');
    });

    /* ══ 5 · the pool move reported is real and consistent ════════════════ */

    await check('the reported pool move matches the pool history row exactly', async () => {
      await resetOverall();
      await seedPools();
      const gid = await makeActiveGame(3);
      const res = await post(`/api/online/games/${gid}/resign`, bToken);
      assert.equal(res.status, 200);

      const poolHist = await poolHistoryFor(gid);
      const api = await get(`/api/online/games/${gid}/rating-result`, aToken);
      const reported = api.data.timeControlChange;

      for (const p of poolHist) {
        const isA = p.student_id === A.student_id;
        if (isA) {
          assert.equal(reported.ratingBefore, p.rating_before);
          assert.equal(reported.ratingAfter, p.rating_after);
          assert.equal(reported.ratingChange, p.rating_change);
        }
        assert.equal(p.rating_after - p.rating_before, p.rating_change,
          'pool history after - before must equal change');
        assert.equal(p.rating_before, isA ? SEED.blitz : SEED.blitz,
          'the pool must have been scored from the seeded Blitz value');
      }
      /* Winner gains in the blitz pool, loser loses, and they mirror. */
      const loser = poolHist.find((p) => p.student_id === B.student_id);
      assert.ok(reported.ratingChange > 0, `the winner must gain in the pool, got ${reported.ratingChange}`);
      assert.equal(reported.ratingChange, -loser.rating_change);
    });

    /* ══ 6 · the opponent-rating fix still holds, with categories ═════════ */

    await check('the pool is scored against the opponent\'s real rating in that category', async () => {
      await resetOverall(1000, 1400);
      /* Both Blitz pools equal, so the pool maths is deterministic. */
      await db.query('DELETE FROM student_time_ratings WHERE student_id = ANY($1)', [SIDS]);
      for (const sid of SIDS) {
        await db.query(
          `INSERT INTO student_time_ratings
             (student_id, time_class, rating, peak_rating, highest_level, games_played, provisional_games)
           VALUES ($1,'blitz',1000,1000,1,25,0)`, [sid],
        );
      }
      const gid = await makeActiveGame(3);
      const res = await post(`/api/online/games/${gid}/resign`, bToken);
      assert.equal(res.status, 200);

      const poolHist = await poolHistoryFor(gid);
      const winner = poolHist.find((p) => p.student_id === A.student_id);
      /* Equal 1000 Blitz pools with K=20 and a win: expected 0.5 -> +10. */
      assert.equal(winner.rating_change, 10,
        'equal Blitz ratings must give the same +10 the formula always gave');
      const api = await get(`/api/online/games/${gid}/rating-result`, aToken);
      assert.equal(api.data.timeControlChange.ratingChange, 10);
    });
  } finally {
    for (const id of createdGames) {
      await db.query('DELETE FROM time_control_rating_history WHERE online_game_id=$1', [id]);
      await db.query('DELETE FROM rating_history WHERE online_game_id=$1', [id]);
      await db.query('DELETE FROM online_games WHERE id=$1', [id]);
    }
    await db.query('DELETE FROM rating_history WHERE id > $1', [marks.hist]);
    await db.query('DELETE FROM student_levels WHERE id > $1', [marks.levels]);
    await db.query('DELETE FROM time_control_rating_history WHERE id > $1', [marks.poolHist]);
    await db.query('DELETE FROM student_time_ratings WHERE id > $1', [marks.pools]);
    for (const row of poolSnap) {
      await db.query(
        `INSERT INTO student_time_ratings
           (student_id, time_class, rating, peak_rating, highest_level, games_played, provisional_games, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (student_id, time_class) DO UPDATE
           SET rating=$3, peak_rating=$4, highest_level=$5, games_played=$6, provisional_games=$7`,
        [row.student_id, row.time_class, row.rating, row.peak_rating,
          row.highest_level, row.games_played, row.provisional_games],
      );
    }
    await db.query(
      'DELETE FROM student_time_ratings WHERE student_id = ANY($1)', [SIDS],
    );
    for (const row of poolSnap) {
      await db.query(
        `INSERT INTO student_time_ratings
           (student_id, time_class, rating, peak_rating, highest_level, games_played, provisional_games)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [row.student_id, row.time_class, row.rating, row.peak_rating,
          row.highest_level, row.games_played, row.provisional_games],
      );
    }
    for (const row of stuSnap) {
      await db.query(
`UPDATE students SET current_rating=$1, peak_rating=$2, highest_level=$3,
           games_played=$4, provisional_games=$5, birthdate=$6,
           last_rating_change_at=$7 WHERE id=$8`,
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