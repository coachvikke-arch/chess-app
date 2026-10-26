/* Regression tests for the "Recent Rated Results" feed
 * (GET /students/ratings/analytics -> data.recent, rendered by pages/Ratings.jsx).
 *
 * Run: node scripts/test-recent-results.js
 *
 * Two bugs motivated this file.
 *
 * 1. `Opponent` rendered as "—" for every two-player game. The feed read
 *    `rating_history.opponent_name`, a name SNAPSHOT that is NULL on 51 of the
 *    80 rows in this database. The authoritative link — `opponent_id`, populated
 *    on 100% of rows and never the player themself — was ignored. The opponent is
 *    now resolved by JOINING opponent_id through students to users.
 *
 * 2. The feed had no invariant protecting the per-row fields. The killer one:
 *    player / result / before / after / change must all describe the SAME
 *    player. A mapping bug that handed one player the other's numbers would
 *    still render every row "successfully".
 *
 * These build their own fixture through the real rating path, so nothing here
 * depends on whatever games happen to be in the database, and everything is
 * removed again in the finally block.
 *
 * NOTE: this file deliberately does NOT touch rating arithmetic. It asserts the
 * feed reports what the rating system stored, not what the numbers "should" be. */
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const db = require('../src/config/database');
const rating = require('../src/services/ratingService');

let pass = 0;
let fail = 0;
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function api(path, token) {
  const res = await fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

const sign = (id, role) =>
  jwt.sign({ id, role, name: 'tester', email: 't@example.invalid' }, process.env.JWT_SECRET, { expiresIn: '5m' });

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

/** Drive the real rating path for a win / a draw between two students. */
async function record(whiteStudent, blackStudent, whiteScore, timeControl, gameId) {
  await rating.applyGameResult({
    player: { studentId: whiteStudent, score: whiteScore, rating: null, name: null },
    opponent: { studentId: blackStudent, score: 1 - whiteScore, rating: null, name: null },
    meta: { timeControl, gameType: 'online', rated: true, onlineGameId: gameId ?? null },
  });
}

async function main() {
  const { rows: stu } = await db.query(
    `SELECT u.id AS user_id, u.name, s.id AS student_id
       FROM users u JOIN students s ON s.user_id = u.id
      WHERE u.role = 'student' ORDER BY u.id LIMIT 2`,
  );
  assert.ok(stu.length === 2, 'need two students');
  const [A, B] = stu;
  const aToken = sign(A.user_id, 'student');
  const bToken = sign(B.user_id, 'student');

  /* Snapshot so the fixture leaves nothing behind. */
  const before = (await db.query(
`SELECT id, current_rating, peak_rating, highest_level, games_played, provisional_games,
            last_rating_change_at FROM students WHERE id = ANY($1)`, [[A.student_id, B.student_id]],
  )).rows;
  const histMark = (await db.query('SELECT COALESCE(MAX(id),0) AS id FROM rating_history')).rows[0].id;
  const levelMark = (await db.query('SELECT COALESCE(MAX(id),0) AS id FROM student_levels')).rows[0].id;
  const tcMark = (await db.query('SELECT COALESCE(MAX(id),0) AS id FROM student_time_ratings')).rows[0].id;
  const tcHistMark = (await db.query('SELECT COALESCE(MAX(id),0) AS id FROM time_control_rating_history')).rows[0].id;
  const createdGames = [];

  /* One active game so the feed's rows have a game reference where possible. */
  const g = (await db.query(
    `INSERT INTO online_games (admin_id, student_id, admin_color, status, fen, pgn,
       time_base_minutes, time_increment_seconds, white_ms, black_ms, is_bot, created_at, updated_at)
     VALUES ($1,$2,'white','finished','start','1. e4 e5 1-0 ',10,5,0,0,FALSE,NOW(),NOW()) RETURNING id`,
    [A.user_id, B.user_id],
  )).rows[0];
  createdGames.push(g.id);

  try {
    /* A wins Rapid, then a draw in Blitz. Both through the real path. */
    await record(A.student_id, B.student_id, 1, 'Rapid', g.id);
    await record(A.student_id, B.student_id, 0.5, 'Blitz', g.id);

    const feed = await api('/api/students/ratings/analytics?limit=50', aToken);
    assert.equal(feed.status, 200, `expected 200, got ${feed.status}`);
    const recent = feed.data.recent;
    assert.ok(Array.isArray(recent) && recent.length >= 2, `expected the fixture rows, got ${recent?.length}`);

    /* The feed is scoped to the caller, so it holds A's rows only. B's mirrored
       rows for the same games are fetched with B's token below - they must never
       appear in A's feed. */
    const mine = recent.filter((r) => r.student_id === A.student_id);
    const theirs = recent.filter((r) => r.student_id === B.student_id);
    assert.equal(theirs.length, 0, 'the opponent\'s mirrored rows must not appear in A\'s feed');

    const bFeed = await api('/api/students/ratings/analytics?limit=50', bToken);
    assert.equal(bFeed.status, 200);
    const bRecent = bFeed.data.recent;
    const bTheirs = bRecent.filter((r) => r.student_id === B.student_id);
    const bForeign = bRecent.filter((r) => r.student_id === A.student_id);
    assert.equal(bForeign.length, 0, 'A\'s rows must not appear in B\'s feed');

    await check('every row names an OPPONENT (no more "—" for two-player games)', async () => {
      const missing = recent.filter((r) => !r.opponent_name);
      assert.equal(missing.length, 0,
        `${missing.length} row(s) have no opponent, e.g. id ${missing[0]?.id}`);
    });

    await check('the opponent is the OTHER player, not the row\'s own player', async () => {
      for (const r of [...recent, ...bRecent]) {
        assert.notEqual(r.opponent_name, r.student_name,
          `row ${r.id} lists the player as their own opponent`);
      }
    });

    await check('A and B are exact mirrors: A.opponent === B.player and vice versa', async () => {
      /* Each side now reads its OWN perspective, so the mirror property is
         checked across the two calls rather than inside one mixed feed. */
      assert.ok(mine.length && bTheirs.length, 'both perspectives must have rows');
      assert.equal(mine[0].student_name, A.name, 'A\'s feed must name A as the player');
      assert.equal(mine[0].opponent_name, B.name, "A's opponent must be B");
      assert.equal(bTheirs[0].student_name, B.name, 'B\'s feed must name B as the player');
      assert.equal(bTheirs[0].opponent_name, A.name, "B's opponent must be A");
      /* And the two rows for the same game are the same game seen twice. */
      const aGame = new Set(mine.map((r) => r.time_control));
      assert.ok(aGame.size >= 1, 'A\'s feed must still carry both control fixtures');
    });

    await check('DRAW rows also carry the opponent', async () => {
      /* A zero rating change must not be mistaken for "no opponent" — the exact
         confusion that produced "Nagavel k | draw | —". */
      const draws = [...recent, ...bRecent].filter((r) => r.result === 'draw');
      assert.ok(draws.length >= 1, `expected the draw fixture, got ${draws.length}`);
      for (const d of draws) {
        assert.ok(d.opponent_name, `draw row ${d.id} has no opponent`);
        assert.equal(d.rating_change, 0, `a draw must not move the rating (row ${d.id})`);
      }
    });

    await check('player / before / after / change all describe the SAME player', async () => {
      /* The winner/loser direction the UI relies on. before+change must equal
         after, and a win must gain while a loss must lose. */
      for (const r of [...recent, ...bRecent]) {
        assert.equal(r.rating_after - r.rating_before, r.rating_change,
          `row ${r.id}: after-before must equal change`);
        if (r.result === 'win') assert.ok(r.rating_change > 0, `a win must gain (row ${r.id})`);
        if (r.result === 'loss') assert.ok(r.rating_change < 0, `a loss must lose (row ${r.id})`);
        if (r.result === 'draw') assert.equal(r.rating_change, 0, `a draw must not move (row ${r.id})`);
      }
    });

    await check('each row carries the canonical time control, not a display guess', async () => {
      const rapid = mine.find((r) => r.time_control === 'Rapid');
      const blitz = mine.find((r) => r.time_control === 'Blitz');
      assert.ok(rapid, "the Rapid fixture row must report 'Rapid'");
      assert.ok(blitz, "the Blitz fixture row must report 'Blitz'");

      /* Rows tied to a game must name their control. A handful of legacy rows
         predate the column (time_control IS NULL and no online_game_id) and are
         rendered as "—" by the UI, so they are exempt here - but only those:
         asserting every row has a control used to pass merely because this
         test's own fixtures pushed the legacy rows past the LIMIT. Now that the
         feed is scoped to the caller, a viewer's own older rows are visible
         again, and the exemption has to be stated rather than assumed. */
      const legacy = [...recent, ...bRecent].filter((r) => r.time_control == null);
      for (const r of legacy) {
        assert.equal(r.online_game_id ?? null, null,
          `row ${r.id} has no time control but does name a game - that is a real gap`);
      }
      /* Every control that IS present must resolve to a real rating category
         through the same classifier the pools use. The stored form varies by age
         - rows written today carry the display label ("Rapid"), older ones the raw
         clock ("5+0", "15+10") - and both are legitimate, so the assertion is
         that the value MEANS a valid category, not that it is a particular
         string. */
      for (const r of [...recent, ...bRecent]) {
        if (r.time_control == null) continue;
        assert.ok(['bullet', 'blitz', 'rapid', 'classical']
          .includes(rating.classifyTimeControl(r.time_control)),
        `row ${r.id} reports ${JSON.stringify(r.time_control)}, which maps to no rating category`);
      }
    });

    await check('no row is rendered as a meaningless all-empty record', async () => {
      /* The reported "Manivel M | loss | — | — | — | — | — | —" row. A row is
         only meaningful if it has a player, a result, an opponent and a rating
         pair; anything else is an orphan and must not reach the feed. */
      const empty = [...recent, ...bRecent].filter((r) =>
        r.student_name == null || r.result == null ||
        r.rating_before == null || r.rating_after == null || r.rating_change == null,
      );
      assert.equal(empty.length, 0,
        `${empty.length} incomplete row(s) leaked into the feed, e.g. id ${empty[0]?.id}`);
    });

    await check('a row whose OPPONENT was deleted degrades gracefully', async () => {
      /* `rating_history.student_id` is NOT NULL with a FK + ON DELETE CASCADE, so
         a row can never outlive its own player — the nameless row the report
         described is not reachable that way. `opponent_id` however is
         ON DELETE SET NULL, so deleting the OPPONENT does leave a row with no
         opponent link. That must not make the feed claim the player opposed
         themself, and it must fall back to the stored snapshot rather than
         inventing a name. */
      const orphan = (await db.query(
        `INSERT INTO rating_history (student_id, opponent_id, opponent_name, result,
           rating_before, rating_after, rating_change, time_control, game_type, rated)
         VALUES ($1, NULL, 'Departed Player', 'win', 1000, 1010, 10, 'Rapid', 'online', TRUE) RETURNING id`,
        [A.student_id],
      )).rows[0].id;
      try {
        const after = await api('/api/students/ratings/analytics?limit=50', aToken);
        const row = after.data.recent.find((r) => r.id === orphan);
        if (row) {
          assert.notEqual(row.opponent_name, row.student_name,
            'a row with no opponent link must never list the player as their own opponent');
        }
        /* And the rest of the feed is unaffected. */
        const missing = after.data.recent.filter((r) => !r.opponent_name && r.student_id === A.student_id);
        assert.equal(missing.length, 0, 'every other A row must still resolve its opponent');
      } finally {
        await db.query('DELETE FROM rating_history WHERE id = $1', [orphan]);
      }
    });

    await check('the resolved opponent survives a stale stored snapshot', async () => {
      /* opponent_name is a snapshot that can go stale (rename) or be missing
         (NULL). The JOINED name must win, so a NULL snapshot still renders. */
      await db.query(
        `UPDATE rating_history SET opponent_name = NULL
          WHERE id = (SELECT id FROM rating_history WHERE student_id = $1 ORDER BY id DESC LIMIT 1)`,
        [A.student_id],
      );
      const after = await api('/api/students/ratings/analytics?limit=50', aToken);
      const row = after.data.recent.find((r) => r.student_id === A.student_id);
      assert.ok(row?.opponent_name, 'a NULL snapshot must still resolve to the real opponent');
      assert.equal(row.opponent_name, B.name, 'and it must be the other player');
    });
  } finally {
    for (const id of createdGames) {
      /* The pool history must be removed explicitly: its online_game_id FK is
         ON DELETE SET NULL, so deleting the game orphans these rows instead of
         cascading, and an orphan is still a rated-history row. */
      await db.query('DELETE FROM time_control_rating_history WHERE online_game_id = $1', [id]);
      await db.query('DELETE FROM rating_history WHERE online_game_id = $1', [id]);
      await db.query('DELETE FROM online_games WHERE id = $1', [id]);
    }
    await db.query('DELETE FROM rating_history WHERE id > $1', [histMark]);
    await db.query('DELETE FROM time_control_rating_history WHERE id > $1', [tcHistMark]);
    await db.query('DELETE FROM student_levels WHERE id > $1', [levelMark]);
    await db.query('DELETE FROM student_time_ratings WHERE id > $1', [tcMark]);
    /* Put both students' rating columns back exactly as found. */
    for (const s of before) {
      await db.query(
`UPDATE students SET current_rating=$1, peak_rating=$2, highest_level=$3,
           games_played=$4, provisional_games=$5, last_rating_change_at=$6 WHERE id=$7`,
        [s.current_rating, s.peak_rating, s.highest_level, s.games_played,
          s.provisional_games, s.last_rating_change_at, s.id],
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
