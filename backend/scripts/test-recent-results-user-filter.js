/* Recent Rated Results must show ONLY the logged-in student's own games.
 *
 * Run: node scripts/test-recent-results-user-filter.js
 *
 * THE BUG
 * -------
 * GET /students/ratings/analytics feeds two things at once: academy-wide
 * aggregates (overview, rating spread, level bands, per-control pools, weekly
 * movers) and a raw recent-results feed rendered as "Recent Rated Results".
 *
 * The feed's query had no ownership predicate at all:
 *
 *     WHERE h.rated = TRUE AND 1=1 <hideClause>
 *     ORDER BY h.played_at DESC LIMIT $1
 *
 * Every rated game writes TWO rating_history rows - one per player, each naming
 * the other as opponent - so the feed rendered both, stacked:
 *
 *     Nagavel k | win  | Manivel M |  940 -> 953 | +13 | Blitz
 *     Manivel M | loss | Nagavel k | 1063 -> 1050 | -13 | Blitz
 *
 * That reads as though two games were played, and hands each student the other
 * player's rating move. The fix scopes the feed to the authenticated student in
 * SQL, before ORDER BY/LIMIT. It is deliberately NOT a game-id dedup and NOT a
 * frontend name filter: both rows are valid records and both stay in the table.
 *
 * WHAT IS PROVEN HERE
 * -------------------
 *   1. A's feed contains only A's rows; B's contain only B's.
 *   2. The opponent's mirrored row is never present.
 *   3. LIMIT is applied AFTER filtering, so a viewer asking for N gets N of their
 *      own results (this is the assertion that a post-LIMIT filter would fail).
 *   4. A cannot reach B's results by putting B's id in a query parameter - and a
 *      forged/absent session cannot either.
 *   5. Opponent resolution and the win/loss/draw directions are untouched.
 *   6. The academy-wide sections are unaffected by the scoping.
 *
 * Snapshot/restore throughout: no rating, pool or history row survives. */
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

async function api(path, token) {
  const res = await fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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

/* One rated game through the real path, so the pair of rows is exactly what
   live play produces. */
async function recordGame({ whiteStudent, blackStudent, whiteScore, timeControl, gameId }) {
  await rating.applyGameResult({
    player: { studentId: whiteStudent, score: whiteScore, rating: null, name: null },
    opponent: { studentId: blackStudent, score: 1 - whiteScore, rating: null, name: null },
    meta: {
      timeControl, gameType: 'online', rated: true, onlineGameId: gameId ?? null,
    },
  });
}

async function main() {
  const { rows: stu } = await db.query(
    `SELECT u.id AS user_id, u.name, s.id AS student_id
       FROM users u JOIN students s ON s.user_id = u.id
      WHERE u.role = 'student' ORDER BY u.id LIMIT 2`,
  );
  assert.equal(stu.length, 2, 'need two students');
  const [A, B] = stu;
  const aToken = sign(A.user_id, 'student');
  const bToken = sign(B.user_id, 'student');

  const before = (await db.query(
`SELECT id, current_rating, peak_rating, highest_level, games_played, provisional_games,
            last_rating_change_at FROM students WHERE id = ANY($1)`, [[A.student_id, B.student_id]],
  )).rows;
  const histMark = (await db.query('SELECT COALESCE(MAX(id),0) AS id FROM rating_history')).rows[0].id;
  const tcHistMark = (await db.query('SELECT COALESCE(MAX(id),0) AS id FROM time_control_rating_history')).rows[0].id;
  const levelMark = (await db.query('SELECT COALESCE(MAX(id),0) AS id FROM student_levels')).rows[0].id;
  const tcMark = (await db.query('SELECT COALESCE(MAX(id),0) AS id FROM student_time_ratings')).rows[0].id;
  const createdGames = [];

  const mkGame = async () => {
    const g = (await db.query(
      `INSERT INTO online_games (admin_id, student_id, admin_color, status, fen, pgn,
         time_base_minutes, time_increment_seconds, white_ms, black_ms, is_bot, created_at, updated_at)
       VALUES ($1,$2,'white','finished','start','1. e4 e5 1-0 ',10,5,0,0,FALSE,NOW(),NOW()) RETURNING id`,
      [A.user_id, B.user_id],
    )).rows[0];
    createdGames.push(g.id);
    return g.id;
  };

  try {
    /* Three games: a win for A, a win for B, and a draw. Each writes one row per
       player, so the unfiltered feed would hold six rows for three games. */
    const g1 = await mkGame();
    await recordGame({ whiteStudent: A.student_id, blackStudent: B.student_id, whiteScore: 1, timeControl: 'Rapid', gameId: g1 });
    const g2 = await mkGame();
    await recordGame({ whiteStudent: B.student_id, blackStudent: A.student_id, whiteScore: 1, timeControl: 'Blitz', gameId: g2 });
    const g3 = await mkGame();
    await recordGame({ whiteStudent: A.student_id, blackStudent: B.student_id, whiteScore: 0.5, timeControl: 'Rapid', gameId: g3 });

    const aFeed = (await api('/api/students/ratings/analytics?limit=100', aToken)).data;
    const bFeed = (await api('/api/students/ratings/analytics?limit=100', bToken)).data;
    assert.ok(aFeed?.recent, 'A\'s feed must have a recent array');
    assert.ok(bFeed?.recent, 'B\'s feed must have a recent array');

    /* ══ 1 · ownership ═════════════════════════════════════════════════════ */

    await check('A sees ONLY A\'s rows - no row belongs to B', async () => {
      const foreign = aFeed.recent.filter((r) => r.student_id === B.student_id);
      assert.equal(foreign.length, 0,
        `${foreign.length} of B's row(s) leaked into A's feed, e.g. id ${foreign[0]?.id}`);
      for (const r of aFeed.recent) {
        assert.equal(r.student_id, A.student_id,
          `row ${r.id} belongs to student ${r.student_id}, not A`);
        assert.equal(r.student_name, A.name,
          `row ${r.id} must name the logged-in student as the player`);
      }
    });

    await check('B sees ONLY B\'s rows - no row belongs to A', async () => {
      const foreign = bFeed.recent.filter((r) => r.student_id === A.student_id);
      assert.equal(foreign.length, 0,
        `${foreign.length} of A's row(s) leaked into B's feed, e.g. id ${foreign[0]?.id}`);
      for (const r of bFeed.recent) {
        assert.equal(r.student_id, B.student_id,
          `row ${r.id} belongs to student ${r.student_id}, not B`);
        assert.equal(r.student_name, B.name,
          `row ${r.id} must name the logged-in student as the player`);
      }
    });

    await check('the two perspectives are complementary: a game appears once per viewer', async () => {
      const aIds = new Set(aFeed.recent.map((r) => r.id));
      const bIds = new Set(bFeed.recent.map((r) => r.id));
      /* Disjoint by construction: a row is owned by exactly one student. */
      for (const id of aIds) assert.ok(!bIds.has(id), `row ${id} is visible to BOTH viewers`);
      /* And the three fixtures produced three rows on each side. */
      assert.ok(aFeed.recent.length >= 3, `A should see its 3 fixture rows, got ${aFeed.recent.length}`);
      assert.ok(bFeed.recent.length >= 3, `B should see its 3 fixture rows, got ${bFeed.recent.length}`);
    });

    /* ══ 2 · the mirrored row is gone, the database is not ═════════════════ */

    await check('BOTH players\' rows still exist in the database', async () => {
      /* The feed hides a row; it must never delete one. Both records are valid
         and both are needed for each player's own history. */
      for (const gid of createdGames) {
        const rows = (await db.query(
          'SELECT student_id, opponent_id FROM rating_history WHERE online_game_id = $1 ORDER BY student_id',
          [gid],
        )).rows;
        assert.equal(rows.length, 2, `game ${gid} must still hold 2 rating_history rows, found ${rows.length}`);
        assert.deepEqual(
          rows.map((r) => r.student_id).sort((x, y) => x - y),
          [A.student_id, B.student_id].sort((x, y) => x - y),
          `game ${gid} must still hold one row per player`,
        );
      }
    });

    await check('no rating was recalculated: the pair stays zero-sum', async () => {
      const rows = (await db.query(
        `SELECT student_id, rating_change FROM rating_history WHERE online_game_id = ANY($1)`,
        [createdGames],
      )).rows;
      const byStudent = new Map();
      for (const r of rows) byStudent.set(r.student_id, (byStudent.get(r.student_id) || 0) + r.rating_change);
      const aDelta = byStudent.get(A.student_id) || 0;
      const bDelta = byStudent.get(B.student_id) || 0;
      /* Summed with `+` rather than compared pairwise: assert.equal uses
         Object.is, under which 0 !== -0, which would fail a correct zero-sum. */
      assert.ok(aDelta + bDelta === 0,
        `the two sides must remain exact mirrors: A ${aDelta} vs B ${bDelta}`);
      /* And the recorded changes are still per-player, not one shared number. */
      assert.ok(rows.some((r) => r.rating_change > 0) && rows.some((r) => r.rating_change < 0),
        'the fixtures must still contain a gain and a loss');
    });

    /* ══ 3 · opponent resolution ═══════════════════════════════════════════ */

    await check('opponent is never the viewer, on any row', async () => {
      /* Applies to the WHOLE feed, including this viewer's older games against
         other opponents - not just the fixtures. A row must never claim the
         logged-in player faced themself. */
      for (const [feed, me, who] of [[aFeed, A, 'A'], [bFeed, B, 'B']]) {
        for (const r of feed.recent) {
          assert.notEqual(r.opponent_name, me.name,
            `${who}: row ${r.id} shows the logged-in player as their own opponent`);
          if (r.opponent_id != null) {
            assert.notEqual(r.opponent_id, r.student_id,
              `${who}: row ${r.id} links the viewer as their own opponent`);
          }
        }
      }
    });

    await check('the fixture rows name the OTHER player as opponent', async () => {
      /* Scoped to the rows this test created, where B is the only opponent. Older
         rows legitimately name other students - the two facts are checked
         separately above and here so neither masks the other. */
      const fixtureIds = new Set(
        (await db.query(
          'SELECT id FROM rating_history WHERE online_game_id = ANY($1)', [createdGames],
        )).rows.map((r) => r.id),
      );
      for (const [feed, them, who] of [[aFeed, B, 'A'], [bFeed, A, 'B']]) {
        const fixtures = feed.recent.filter((r) => fixtureIds.has(r.id));
        assert.ok(fixtures.length >= 3, `${who}: expected 3 fixture rows, got ${fixtures.length}`);
        for (const r of fixtures) {
          assert.equal(r.opponent_id, them.student_id, `${who}: row ${r.id} must be against ${them.name}`);
          assert.equal(r.opponent_name, them.name, `${who}: row ${r.id} must name ${them.name}`);
        }
      }
    });

    await check('win / loss / draw directions are the viewer\'s own', async () => {
      /* B won game 2, so A must have a loss and B a win for that same game, and
         the ratings must be A's and B's respectively - not swapped between them. */
      const aLoss = aFeed.recent.find((r) => r.result === 'loss');
      const bWin = bFeed.recent.find((r) => r.result === 'win');
      assert.ok(aLoss, 'A must have the loss from the game B won');
      assert.ok(bWin, 'B must have the win from that same game');
      assert.ok(aLoss.rating_change < 0, `A's loss must lower A's rating, got ${aLoss.rating_change}`);
      assert.ok(bWin.rating_change > 0, `B's win must raise B's rating, got ${bWin.rating_change}`);
      assert.equal(aLoss.rating_after - aLoss.rating_before, aLoss.rating_change);
      assert.equal(bWin.rating_after - bWin.rating_before, bWin.rating_change);

      const aDraw = aFeed.recent.find((r) => r.result === 'draw');
      assert.ok(aDraw, 'A must have the draw');
      assert.equal(aDraw.rating_change, 0, 'a draw must not move A\'s rating');
      const bDraw = bFeed.recent.find((r) => r.result === 'draw');
      assert.ok(bDraw, 'B must have the draw too');
      assert.equal(bDraw.rating_change, 0);
    });

    /* ══ 4 · LIMIT is applied AFTER the filter ═════════════════════════════ */

    await check('a small limit still returns that many of the viewer\'s OWN rows', async () => {
      /* This is the assertion a post-LIMIT filter would fail. Three games wrote
         six rows; interleaved by played_at, the six rows are A,B,A,B,A,B. An
         unscoped `LIMIT 3` would hand back a mix, and stripping the foreign rows
         afterwards would leave 1-2 rows instead of the 3 requested. */
      for (const limit of [1, 2, 3, 5, 10]) {
        const feed = (await api(`/api/students/ratings/analytics?limit=${limit}`, aToken)).data;
        assert.ok(feed.recent.length <= limit, `limit=${limit} returned ${feed.recent.length} rows`);
        for (const r of feed.recent) {
          assert.equal(r.student_id, A.student_id,
            `limit=${limit}: row ${r.id} is not A's and must not be in A's page`);
        }
      }
      /* At limit=3 the viewer must get three of their own rows, not fewer. */
      const three = (await api('/api/students/ratings/analytics?limit=3', aToken)).data;
      assert.equal(three.recent.length, 3,
        'limit=3 must yield exactly 3 of A\'s rows, not fewer after foreign rows are dropped');
    });

    /* ══ 5 · ownership comes from the session, not the request ═════════════ */

    await check('A cannot request B\'s results via a query parameter', async () => {
      for (const qs of [
        `?limit=100&studentId=${B.student_id}`,
        `?limit=100&studentId=${B.user_id}`,
        `?limit=100&userId=${B.user_id}`,
        `?limit=100&userId=${B.student_id}`,
        `?limit=100&student_id=${B.student_id}`,
        `?limit=100&viewer=${B.student_id}`,
        `?limit=100&as=${B.student_id}`,
      ]) {
        const feed = await api(`/api/students/ratings/analytics${qs}`, aToken);
        assert.equal(feed.status, 200, `expected 200 for ${qs}`);
        const foreign = feed.data.recent.filter((r) => r.student_id === B.student_id);
        assert.equal(foreign.length, 0,
          `${qs} exposed ${foreign.length} of B's row(s) to A`);
        for (const r of feed.data.recent) {
          assert.equal(r.student_id, A.student_id, `${qs} returned a row that is not A's`);
        }
      }
    });

    await check('a forged or absent token returns no recent results at all', async () => {
      const anon = await api('/api/students/ratings/analytics?limit=100', null);
      assert.ok(anon.status === 401 || anon.status === 403,
        `an unauthenticated request must be refused, got ${anon.status}`);
      assert.ok(!anon.data?.recent?.length, 'an unauthenticated request must not return rows');

      const bad = await api('/api/students/ratings/analytics?limit=100', 'not-a-real-token');
      assert.ok(bad.status === 401 || bad.status === 403,
        `a forged token must be refused, got ${bad.status}`);
      assert.ok(!bad.data?.recent?.length, 'a forged token must not return rows');
    });

    /* ══ 6 · the academy-wide sections are untouched ═══════════════════════ */

    await check('scoping the feed does not change the academy-wide sections', async () => {
      /* Only the feed is viewer-specific. The aggregates describe the academy, so
         two different viewers must receive byte-identical numbers for them -
         which is exactly what would break if the ownership filter had leaked into
         the shared queries. */
      assert.deepEqual(aFeed.overview, bFeed.overview,
        'the overview must be identical for every viewer');
      assert.deepEqual(aFeed.movers, bFeed.movers,
        'the weekly movers list must be identical for every viewer');
      assert.deepEqual(aFeed.levels, bFeed.levels,
        'the level bands must be identical for every viewer');
      assert.deepEqual(aFeed.timeClasses, bFeed.timeClasses,
        'the per-control pools must be identical for every viewer');
      assert.ok(aFeed.overview.students > 0, 'the overview must still aggregate students');
      assert.ok(aFeed.movers.length > 0, 'the movers list must still have rows');
    });

    await check('the feed scoping does not widen access for a non-student account', async () => {
      /* The route sits behind requireFeature('leaderboard'), which is student
         only - so the academy-wide (unscoped) branch of ratingAnalytics is not
         reachable over HTTP at all. Assert that rather than assuming it. */
      const other = (await db.query(
        "SELECT id, role FROM users WHERE role IN ('admin','superadmin') ORDER BY id LIMIT 1",
      )).rows[0];
      if (!other) return; // no coach account in this database
      const coachToken = sign(other.id, other.role);
      const coachFeed = await api('/api/students/ratings/analytics?limit=100', coachToken);
      assert.ok(coachFeed.status === 401 || coachFeed.status === 403,
        `a coach must not reach the student analytics feed, got ${coachFeed.status}`);
      assert.ok(!coachFeed.data?.recent?.length,
        'a coach must not receive any recent-rating rows');
    });

    await check('the leaderboard is unaffected by the feed scoping', async () => {
      const board = await api('/api/students/ratings/leaderboard', aToken);
      assert.equal(board.status, 200, `leaderboard must still load, got ${board.status}`);
      const names = board.data.map((r) => r.name);
      assert.ok(names.includes(A.name), 'the leaderboard must still list A');
      assert.ok(names.includes(B.name), 'the leaderboard must still list B');
    });
  } finally {
    for (const id of createdGames) {
      /* time_control_rating_history must go too. Its online_game_id FK is
         ON DELETE SET NULL, so deleting the game row silently ORPHANS the pool
         history instead of removing it - and an orphaned pool row is still a
         rated-history row as far as the rating system is concerned. */
      await db.query('DELETE FROM time_control_rating_history WHERE online_game_id = $1', [id]);
      await db.query('DELETE FROM rating_history WHERE online_game_id = $1', [id]);
      await db.query('DELETE FROM online_games WHERE id = $1', [id]);
    }
    await db.query('DELETE FROM rating_history WHERE id > $1', [histMark]);
    await db.query('DELETE FROM time_control_rating_history WHERE id > $1', [tcHistMark]);
    await db.query('DELETE FROM student_levels WHERE id > $1', [levelMark]);
    await db.query('DELETE FROM student_time_ratings WHERE id > $1', [tcMark]);
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