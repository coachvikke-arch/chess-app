/* Regression test: two rated games finishing concurrently for the same player.
 *
 * Run: node scripts/test-rating-concurrent.js
 *
 * BACKGROUND. Rating updates were separate statements with no transaction
 * (SELECT rating → compute Elo → UPDATE profile → INSERT history, then the
 * same for the pool). Two games finishing close together interleaved, and the
 * later UPDATE overwrote the profile with a number computed from a stale
 * "before" — a lost update that survived only in history. Worse, the overall
 * write and the pool write were not atomic either, so the badge (pool) could
 * end up a whole game behind the history.
 *
 * WHAT IT ASSERTS, every run (sequential or concurrent):
 *   1. chains are continuous (row.before == previous row.after, per player,
 *      overall and pool) and every row's arithmetic holds
 *      (after - before == change);
 *   2. badge invariant: overall profile == last overall history row AND pool
 *      profile == last pool history row (rating AND games) — a lost update
 *      breaks exactly this;
 *   3. coverage: every game in the overall history has a pool row for the same
 *      game (matched by online_game_id) and the pool chain starts at 1000 —
 *      the reported bug's signature was overall rows with no pool counterpart
 *      (badge a game behind history);
 *   4. the concurrent outcome EXACTLY equals sequential A,B or sequential B,A
 *      (full snapshots compared) — each game commits in one transaction with
 *      canonical row locking, so concurrent finishes always serialize to one
 *      global order, never a mixture. A lost update or a lock-ordering
 *      regression fails this deterministically.
 *   5. badge invariant: overall profile == last overall history row AND pool
 *      profile == last pool history row (rating, games), in every run.
 *
 * Everything is snapshot/restore: profiles are pinned to a fixed baseline for
 * determinism (K=40, level 1, no certificates) and restored afterwards, and
 * all created history/game rows are deleted. Follows test-rating-result.js.
 */
const assert = require('node:assert/strict');
const db = require('../src/config/database');
const rating = require('../src/services/ratingService');

let pass = 0;
let fail = 0;

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

const BASE = {
  current_rating: 1000, peak_rating: 1000, highest_level: 1,
  games_played: 0, provisional_games: 0, birthdate: null,
};
const BASE_POOL = { rating: 1000, peak_rating: 1000, highest_level: 1, games_played: 0, provisional_games: 0 };

async function main() {
  const { rows: stu } = await db.query(
    "SELECT u.id AS user_id, u.name, s.id AS student_id FROM users u JOIN students s ON s.user_id = u.id WHERE u.role = 'student' ORDER BY u.id LIMIT 2",
  );
  assert.ok(stu.length === 2, 'need two students');
  const [a, b] = stu;

  /* Seed level-1 rows BEFORE taking marks so no certificate work can fire
     mid-test (both players stay in band 1 throughout). */
  for (const s of stu) {
    await db.query(
      `INSERT INTO student_levels (student_id, level, badge_name)
       VALUES ($1, 1, 'Pawn') ON CONFLICT (student_id, level) DO NOTHING`,
      [s.student_id],
    );
  }

  const beforeStudents = (await db.query(
    'SELECT id, current_rating, peak_rating, highest_level, games_played, provisional_games, birthdate FROM students WHERE id = ANY($1)',
    [[a.student_id, b.student_id]],
  )).rows;
  const beforePools = (await db.query(
    'SELECT student_id, time_class, rating, peak_rating, highest_level, games_played, provisional_games FROM student_time_ratings WHERE student_id = ANY($1)',
    [[a.student_id, b.student_id]],
  )).rows;
  const histMark = (await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM rating_history')).rows[0].id;
  const levelMark = (await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM student_levels')).rows[0].id;
  const poolMark = (await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM student_time_ratings')).rows[0].id;
  const tcHistMark = (await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM time_control_rating_history')).rows[0].id;
  const createdGames = [];

  async function makeGame(result) {
    const g = (await db.query(
      `INSERT INTO online_games (admin_id, student_id, admin_color, status, result, result_reason,
         fen, pgn, time_base_minutes, time_increment_seconds, white_ms, black_ms, is_bot, created_at, updated_at)
       VALUES ($1,$2,'white','finished',$3,'checkmate',
         'start','1. e4 e5 1-0',15,10,900000,900000,FALSE,NOW(),NOW())
       RETURNING id`,
      [a.user_id, b.user_id, result],
    )).rows[0];
    createdGames.push(g.id);
    return g.id;
  }

  /* Pin both players (overall + rapid pool) to the fixed baseline. */
  async function resetFixtures() {
    await db.query('DELETE FROM time_control_rating_history WHERE id > $1', [tcHistMark]);
    await db.query('DELETE FROM rating_history WHERE id > $1', [histMark]);
    await db.query(
      `UPDATE students SET current_rating=$1, peak_rating=$2, highest_level=$3,
              games_played=$4, provisional_games=$5, birthdate=$6 WHERE id = ANY($7)`,
      [BASE.current_rating, BASE.peak_rating, BASE.highest_level,
        BASE.games_played, BASE.provisional_games, BASE.birthdate, [a.student_id, b.student_id]],
    );
    for (const s of stu) {
      await db.query(
        `INSERT INTO student_time_ratings (student_id, time_class, rating, peak_rating, highest_level, games_played, provisional_games)
         VALUES ($1, 'rapid', $2, $3, $4, $5, $6)
         ON CONFLICT (student_id, time_class) DO UPDATE SET
           rating = EXCLUDED.rating, peak_rating = EXCLUDED.peak_rating,
           highest_level = EXCLUDED.highest_level, games_played = EXCLUDED.games_played,
           provisional_games = EXCLUDED.provisional_games`,
        [s.student_id, BASE_POOL.rating, BASE_POOL.peak_rating, BASE_POOL.highest_level,
          BASE_POOL.games_played, BASE_POOL.provisional_games],
      );
    }
  }

  /* One finished game through the real path. Reads live ratings like the
     controller does (they are expectancy inputs, not state). */
  async function finishGame(gameId, whiteScore) {
    const blackScore = whiteScore === 0.5 ? 0.5 : 1 - whiteScore;
    const info = await db.query(
      'SELECT s.id, s.current_rating FROM students s WHERE s.id = ANY($1)',
      [[a.student_id, b.student_id]],
    );
    const r = {};
    info.rows.forEach((row) => { r[row.id] = row.current_rating; });
    return rating.applyGameResult({
      player: { studentId: a.student_id, score: whiteScore, rating: r[a.student_id], name: a.name },
      opponent: { studentId: b.student_id, score: blackScore, rating: r[b.student_id], name: b.name },
      meta: { timeControl: 'Rapid', gameType: 'online', rated: true, onlineGameId: gameId },
    });
  }

  /* Full observable state for both players: profiles + ordered history rows. */
  async function snapshot() {
    const prof = (await db.query(
      'SELECT id, current_rating, peak_rating, games_played FROM students WHERE id = ANY($1) ORDER BY id',
      [[a.student_id, b.student_id]],
    )).rows;
    const pools = (await db.query(
      "SELECT student_id, rating, peak_rating, games_played FROM student_time_ratings WHERE student_id = ANY($1) AND time_class = 'rapid' ORDER BY student_id",
      [[a.student_id, b.student_id]],
    )).rows;
    /* Ordered by id: with serialized transactions the id sequence IS the true
       serial order (played_at is transaction-start time and can skew when a
       later-starting transaction commits first). */
    const hist = (await db.query(
      'SELECT student_id, result, rating_before, rating_after, rating_change, online_game_id FROM rating_history WHERE id > $1 ORDER BY student_id, id',
      [histMark],
    )).rows;
    const tcHist = (await db.query(
      "SELECT student_id, result, rating_before, rating_after, rating_change, online_game_id FROM time_control_rating_history WHERE id > $1 AND time_class = 'rapid' ORDER BY student_id, id",
      [tcHistMark],
    )).rows;
    return { prof, pools, hist, tcHist };
  }

  function assertChains(snap, who) {
    for (const [rows, label] of [[snap.hist, 'overall'], [snap.tcHist, 'pool']]) {
      for (const sid of [a.student_id, b.student_id]) {
        const seq = rows.filter((r) => r.student_id === sid);
        assert.equal(seq.length, 2, `${who}: ${label} history for ${sid} must hold 2 rows, got ${seq.length}`);
        assert.equal(seq[1].rating_before, seq[0].rating_after, `${who}: ${label} chain broken for ${sid}`);
        assert.equal(seq[0].rating_after - seq[0].rating_before, seq[0].rating_change, `${who}: ${label} change mismatch`);
      }
    }
    for (const p of snap.prof) {
      const last = snap.hist.filter((r) => r.student_id === p.id).pop();
      assert.equal(p.current_rating, last.rating_after, `${who}: overall profile != last history row`);
      assert.equal(p.games_played, snap.hist.filter((r) => r.student_id === p.id).length, `${who}: overall games != history count`);
    }
    for (const p of snap.pools) {
      const last = snap.tcHist.filter((r) => r.student_id === p.student_id).pop();
      assert.equal(p.rating, last.rating_after, `${who}: pool profile != last pool history row (badge drift!)`);
      assert.equal(p.games_played, snap.tcHist.filter((r) => r.student_id === p.student_id).length, `${who}: pool games != pool history count`);
    }
  }

  /* The reported bug's signature: games present overall but missing from
     the pool (badge a game behind history). Matched by online_game_id, and
     the pool chain must start at the 1000 baseline. */
  function assertCoverage(snap, who) {
    for (const sid of [a.student_id, b.student_id]) {
      const overallGames = snap.hist.filter((r) => r.student_id === sid).map((r) => r.online_game_id).sort();
      const poolGames = snap.tcHist.filter((r) => r.student_id === sid).map((r) => r.online_game_id).sort();
      assert.deepEqual(poolGames, overallGames, `${who}: pool games ${JSON.stringify(poolGames)} != overall games ${JSON.stringify(overallGames)}`);
      const first = snap.tcHist.filter((r) => r.student_id === sid)[0];
      assert.equal(first.rating_before, 1000, `${who}: pool chain must start at 1000`);
    }
  }

  try {
    /* References: both sequential orders (Elo is order-dependent, so both are
       valid — they document the range, not a single expected outcome). */
    const gameA = await makeGame('white'); // A: white wins
    const gameB = await makeGame('draw'); // B: draw
    await resetFixtures();
    await finishGame(gameA, 1);
    await finishGame(gameB, 0.5);
    const refAB = await snapshot();
    await check('sequential A-then-B is consistent and fully covered', async () => {
      assertChains(refAB, 'A,B');
      assertCoverage(refAB, 'A,B');
    });

    await resetFixtures();
    await finishGame(gameB, 0.5);
    await finishGame(gameA, 1);
    const refBA = await snapshot();
    await check('sequential B-then-A is consistent and fully covered', async () => {
      assertChains(refBA, 'B,A');
      assertCoverage(refBA, 'B,A');
    });

    /* Concurrent finishes, repeated to shake out interleavings: every outcome
       must exactly equal one of the two sequential orders. */
    await check('concurrent finishes equal a valid sequential order (6x)', async () => {
      const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
      for (let i = 0; i < 6; i += 1) {
        const g1 = await makeGame('white');
        const g2 = await makeGame('draw');
        await resetFixtures();
        await Promise.all([finishGame(g1, 1), finishGame(g2, 0.5)]);
        const snap = await snapshot();
        // Strip the game ids (fresh rows each iteration) before comparing.
        const norm = (s) => JSON.parse(JSON.stringify(s, (k, v) => (k === 'online_game_id' ? 0 : v)));
        assertChains(snap, `concurrent#${i}`);
        assertCoverage(snap, `concurrent#${i}`);
        assert.ok(
          same(norm(snap), norm(refAB)) || same(norm(snap), norm(refBA)),
          `concurrent#${i}: outcome is a mixture of orders, not one serial order → lost update or lock regression`,
        );
      }
    });
  } finally {
    await db.query('DELETE FROM time_control_rating_history WHERE id > $1', [tcHistMark]);
    await db.query('DELETE FROM rating_history WHERE id > $1', [histMark]);
    await db.query('DELETE FROM student_levels WHERE id > $1', [levelMark]);
    await db.query('DELETE FROM student_time_ratings WHERE id > $1', [poolMark]);
    if (createdGames.length) {
      await db.query('DELETE FROM online_games WHERE id = ANY($1)', [createdGames]);
    }
    for (const row of beforeStudents) {
      await db.query(
        `UPDATE students SET current_rating=$1, peak_rating=$2, highest_level=$3,
                games_played=$4, provisional_games=$5, birthdate=$6 WHERE id=$7`,
        [row.current_rating, row.peak_rating, row.highest_level,
          row.games_played, row.provisional_games, row.birthdate, row.id],
      );
    }
    for (const row of beforePools) {
      await db.query(
        `UPDATE student_time_ratings SET rating=$1, peak_rating=$2, highest_level=$3,
                games_played=$4, provisional_games=$5 WHERE student_id=$6 AND time_class=$7`,
        [row.rating, row.peak_rating, row.highest_level,
          row.games_played, row.provisional_games, row.student_id, row.time_class],
      );
    }
    await db.pool.end();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((err) => {
  console.error('test crashed:', err);
  process.exitCode = 1;
});
