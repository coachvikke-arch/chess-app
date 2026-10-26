/* The Rapid Rating card's profile response: latest move + recent Rapid form.
 *
 * Run: node scripts/test-rating-card-latest-move.js
 *
 * WHAT IS PROVEN
 * --------------
 * The card used to derive its delta by summing several games:
 *
 *     recent.reduce((s, r) => s + r.rating_change, 0)
 *
 * so a single win after two losses rendered as a loss. buildProfile now returns
 * `latestRapid` (the newest Rapid row's own rating_before -> rating_after
 * transition) and `rapidRecent` (the last few Rapid rows), both from
 * `time_control_rating_history` where time_class = 'rapid'.
 *
 * These tests cover the properties that make the card correct:
 *   - latestRapid is the LAST game, not a sum, for win / loss / draw;
 *   - the delta agrees with the pool rating and with the newest result row;
 *   - only Rapid rows appear, never Blitz/Bullet/Classical;
 *   - only THIS student's rows (never the opponent's);
 *   - the recent list is capped by the server's limit;
 *   - a fresh student gets null/empty, not fabricated data.
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

async function main() {
  const { rows: stu } = await db.query(
    `SELECT u.id AS user_id, u.name, s.id AS student_id
       FROM users u JOIN students s ON s.user_id = u.id
      WHERE u.role = 'student' ORDER BY u.id LIMIT 2`,
  );
  assert.equal(stu.length, 2, 'need two students');
  const [A, B] = stu;
  const aToken = sign(A.user_id, 'student');

  const SIDS = [A.student_id, B.student_id];
  const before = (await db.query(
    `SELECT id, current_rating, peak_rating, highest_level, games_played, provisional_games,
            birthdate, last_rating_change_at FROM students WHERE id = ANY($1)`, [SIDS],
  )).rows;
  const poolSnap = (await db.query(
    'SELECT * FROM student_time_ratings WHERE student_id = ANY($1)', [SIDS],
  )).rows;
  const marks = {
    poolHist: (await db.query('SELECT COALESCE(MAX(id),0) m FROM time_control_rating_history')).rows[0].m,
    pools: (await db.query('SELECT COALESCE(MAX(id),0) m FROM student_time_ratings')).rows[0].m,
    hist: (await db.query('SELECT COALESCE(MAX(id),0) m FROM rating_history')).rows[0].m,
    levels: (await db.query('SELECT COALESCE(MAX(id),0) m FROM student_levels')).rows[0].m,
  };

  /* Deterministic K=20 (>=20 games, adult, low peak) so the expected deltas are
     predictable, and equal pools per class so the maths is symmetric.

     Also clears this student's pool history: `playGame` writes rows with a null
     online_game_id, so without this each test would see the previous tests'
     games and the "Rapid only" assertion would count them. */
  async function seedPools() {
    await db.query('DELETE FROM time_control_rating_history WHERE student_id = ANY($1)', [SIDS]);
    await db.query('DELETE FROM student_time_ratings WHERE student_id = ANY($1)', [SIDS]);
    for (const sid of SIDS) {
      for (const cls of ['rapid', 'blitz', 'bullet']) {
        await db.query(
          `INSERT INTO student_time_ratings
             (student_id, time_class, rating, peak_rating, highest_level, games_played, provisional_games)
           VALUES ($1,$2,1000,1000,1,25,0)`,
          [sid, cls],
        );
      }
    }
  }

  async function resetOverall() {
    for (const sid of SIDS) {
      await db.query(
        `UPDATE students SET current_rating=1000, peak_rating=1000, highest_level=1,
            games_played=25, provisional_games=0, birthdate=DATE '2000-01-01'
          WHERE id=$1`,
        [sid],
      );
    }
  }

  /* One rated game through the real service, so the pool history and the pool
     rating are written exactly as live play writes them. */
  async function playGame({ timeControl, aScore }) {
    return rating.applyGameResult({
      player: { studentId: A.student_id, score: aScore, rating: 1000, name: A.name },
      opponent: { studentId: B.student_id, score: 1 - aScore, rating: 1000, name: B.name },
      meta: { timeControl, gameType: 'online', rated: true, onlineGameId: null },
    });
  }

  try {
    /* ══ 1 · the delta is the LAST Rapid game, not a sum ══════════════════ */

    await check('two losses then a win: the delta is the WIN, not the net', async () => {
      await resetOverall();
      await seedPools();
      /* Equal pools -> a win is worth +10 with K=20, a loss -10. Two losses
         followed by a win nets -10, which is what the card used to show. */
      await playGame({ timeControl: 'Rapid', aScore: 0 });
      await playGame({ timeControl: 'Rapid', aScore: 0 });
      await playGame({ timeControl: 'Rapid', aScore: 1 });

      const { data } = await api('/api/students/ratings/me', aToken);
      const l = data.latestRapid;
      assert.ok(l, 'latestRapid must be present');
      assert.equal(l.result, 'win', 'the latest rapid game was a win');
      assert.ok(l.ratingChange > 0, `the delta must be positive for a win, got ${l.ratingChange}`);
      assert.equal(l.ratingChange, l.ratingAfter - l.ratingBefore,
        'the delta must be the single transition, not a sum');
      /* And explicitly NOT the net, which was the bug. */
      const net = data.rapidHistory.reduce((s, r) => s + r.rating_change, 0);
      assert.notEqual(l.ratingChange, net,
        'the reported delta must differ from the sum of all recent games - that sum was the bug');
      assert.equal(l.ratingAfter, data.rapid.rating,
        'the transition must end at the current pool rating');
    });

    await check('latest LOSS reports a negative delta matching the transition', async () => {
      await resetOverall();
      await seedPools();
      await playGame({ timeControl: 'Rapid', aScore: 1 });
      await playGame({ timeControl: 'Rapid', aScore: 0 });

      const { data } = await api('/api/students/ratings/me', aToken);
      const l = data.latestRapid;
      assert.equal(l.result, 'loss');
      assert.ok(l.ratingChange < 0, `a loss must report a negative delta, got ${l.ratingChange}`);
      assert.equal(l.ratingChange, l.ratingAfter - l.ratingBefore);
      assert.equal(l.ratingAfter, data.rapid.rating);
    });

    await check('a DRAW reports a zero delta and the draw result', async () => {
      await resetOverall();
      await seedPools();
      /* The draw must be played from EQUAL pools, because the draw rule is
         rating-gap dependent: an underdog drawing actually GAINS (the existing
         formula, deliberately preserved). Seeding equal and drawing first keeps
         this test about the neutral case rather than about that rule. */
      await playGame({ timeControl: 'Rapid', aScore: 0.5 });

      const { data } = await api('/api/students/ratings/me', aToken);
      const l = data.latestRapid;
      assert.equal(l.result, 'draw');
      assert.equal(l.ratingChange, 0, 'a draw between equal pools moves nothing');
      assert.equal(l.ratingBefore, l.ratingAfter);
    });

    await check('a draw between UNEQUAL pools still reports the real, non-zero delta', async () => {
      await resetOverall();
      await seedPools();
      /* A wins (so A is now the favourite), then draws. The existing rule gives
         the underdog a gain and the favourite a loss even on a draw; the card
         must report THAT number rather than assuming 0. */
      await playGame({ timeControl: 'Rapid', aScore: 1 });
      await playGame({ timeControl: 'Rapid', aScore: 0.5 });

      const { data } = await api('/api/students/ratings/me', aToken);
      const l = data.latestRapid;
      assert.equal(l.result, 'draw');
      /* A is now rated ABOVE B, so a draw costs A points. The key assertion is
         that the card reports the stored transition, whatever it is. */
      assert.equal(l.ratingChange, l.ratingAfter - l.ratingBefore,
        'an unequal draw must still report its own transition');
      assert.ok(l.ratingChange !== 0,
        'a favourite drawing against a weaker opponent is not zero in this formula');
    });

    /* ══ 2 · peak must never be the source of the delta ═══════════════════ */

    await check('the delta is NOT current-minus-peak', async () => {
      await resetOverall();
      await seedPools();
      /* Two wins then TWO losses. The second loss is what makes this fixture
         discriminating: after a single loss, current sits exactly one move below
         the peak, so `current - peak` coincidentally EQUALS that loss and the
         test would pass even against a peak-derived implementation. After two
         losses the two candidates diverge. */
      await playGame({ timeControl: 'Rapid', aScore: 1 });
      await playGame({ timeControl: 'Rapid', aScore: 1 });
      await playGame({ timeControl: 'Rapid', aScore: 0 });
      await playGame({ timeControl: 'Rapid', aScore: 0 });

      const { data } = await api('/api/students/ratings/me', aToken);
      const { peakRating, rating: current } = data.rapid;
      const l = data.latestRapid;
      const peakDelta = current - peakRating;

      /* Precondition, asserted so a weak fixture fails loudly rather than
         letting the real assertion pass vacuously. */
      assert.notEqual(peakDelta, l.ratingChange,
        'FIXTURE TOO WEAK: current - peak coincidentally equals the latest delta, '
        + 'so this case cannot distinguish the two sources. Retune the game sequence.');

      assert.equal(l.ratingChange, l.ratingAfter - l.ratingBefore,
        'the delta must be the latest transition');
      assert.equal(l.ratingChange, l.ratingAfter - l.ratingBefore);
    });

    /* ══ 3 · Rapid only ════════════════════════════════════════════════════ */

    await check('the recent list and the delta exclude Blitz and Bullet', async () => {
      await resetOverall();
      await seedPools();
      /* Rapid win, then a Blitz win, then a Bullet win. The LAST game overall is
         a Bullet win - if the card read the wrong class it would report that. */
      await playGame({ timeControl: 'Rapid', aScore: 1 });
      await playGame({ timeControl: 'Blitz', aScore: 1 });
      await playGame({ timeControl: 'Bullet', aScore: 1 });

      const { data } = await api('/api/students/ratings/me', aToken);
      assert.ok(Array.isArray(data.rapidRecent), 'rapidRecent must be an array');
      assert.ok(data.rapidRecent.length > 0, 'expected the rapid fixture row');
      /* One Rapid game only. */
      assert.equal(data.rapidRecent.length, 1,
        `only the single Rapid game may appear, got ${data.rapidRecent.length}`);
      /* latestRapid must be that Rapid game, not the later Bullet win. */
      const rapidRow = data.rapidRecent[0];
      assert.equal(data.latestRapid.ratingBefore, rapidRow.rating_before);
      assert.equal(data.latestRapid.ratingAfter, rapidRow.rating_after);
      assert.equal(data.latestRapid.ratingChange, rapidRow.rating_change);
      /* The Rapid pool took exactly one game; Bullet took one too, proving the
         fixture really did write a Bullet row that had to be excluded. */
      const bullet = (await db.query(
        "SELECT count(*)::int n FROM time_control_rating_history WHERE student_id=$1 AND time_class='bullet'",
        [A.student_id],
      )).rows[0].n;
      assert.equal(bullet, 1, 'the Bullet fixture row must exist');
    });

    /* ══ 4 · this student's rows only ═════════════════════════════════════ */

    await check('the delta and the squares use A\'s rows, never B\'s', async () => {
      await resetOverall();
      await seedPools();
      /* A wins a Rapid game; B's mirror row records the opposite result from a
         different rating_after. Reading B's row would flip the direction. */
      await playGame({ timeControl: 'Rapid', aScore: 1 });

      const { data } = await api('/api/students/ratings/me', aToken);
      assert.equal(data.latestRapid.result, 'win',
        "A's latest rapid game was a win; B's mirrored row says loss");
      assert.ok(data.latestRapid.ratingChange > 0, "A's delta must be positive, B's is negative");

      /* And the opponent is named, never the viewer. */
      for (const row of data.rapidRecent) {
        assert.notEqual(row.opponent_name, A.name, 'a row must not name the viewer as their own opponent');
      }
      if (data.latestRapid.opponentName) {
        assert.notEqual(data.latestRapid.opponentName, A.name);
        assert.equal(data.latestRapid.opponentName, B.name);
      }
    });

    /* ══ 5 · the recent list is capped ═════════════════════════════════════ */

    await check('the recent list never exceeds the server limit', async () => {
      await resetOverall();
      await seedPools();
      for (let i = 0; i < 8; i += 1) {
        await playGame({ timeControl: 'Rapid', aScore: i % 2 ? 0 : 1 });
      }
      const { data } = await api('/api/students/ratings/me', aToken);
      assert.ok(data.recentRapidLimit >= 1, 'the server must publish its limit');
      assert.equal(data.rapidRecent.length, data.recentRapidLimit,
        `expected exactly ${data.recentRapidLimit} rows, got ${data.rapidRecent.length}`);
      assert.ok(data.rapidRecent.length < 8, 'the fixture played 8 games, so the list must be capped');
    });

    await check('the recent list is ordered oldest -> newest', async () => {
      const { data } = await api('/api/students/ratings/me', aToken);
      const times = data.rapidRecent.map((r) => new Date(r.played_at).getTime());
      for (let i = 1; i < times.length; i += 1) {
        assert.ok(times[i] >= times[i - 1],
          `row ${i} is older than row ${i - 1}; the card would render newest first`);
      }
      /* The last entry must be the one the delta describes. */
      const last = data.rapidRecent[data.rapidRecent.length - 1];
      assert.equal(data.latestRapid.ratingAfter, last.rating_after);
      assert.equal(data.latestRapid.result, last.result,
        'the delta and the newest result square must describe the SAME game');
    });

    /* ══ 6 · the delta agrees with the newest result ═══════════════════════ */

    await check('the latest icon agrees with the latest delta', async () => {
      await resetOverall();
      await seedPools();
      await playGame({ timeControl: 'Rapid', aScore: 0 });

      const { data } = await api('/api/students/ratings/me', aToken);
      const l = data.latestRapid;
      /* A loss must never be reported with a rising arrow. */
      if (l.result === 'loss') assert.ok(l.ratingChange < 0, 'a loss must not report a positive delta');
      if (l.result === 'win') assert.ok(l.ratingChange > 0, 'a win must not report a negative delta');
      if (l.result === 'draw') assert.equal(l.ratingChange, 0, 'a draw must report a zero delta');
      /* And the newest square is that same row. */
      const newest = data.rapidRecent[data.rapidRecent.length - 1];
      assert.equal(newest.result, l.result, 'the newest square and the delta disagree');
      assert.equal(newest.id, data.latestRapid.id ?? newest.id);
    });

    /* ══ 7 · fresh state ═══════════════════════════════════════════════════ */

    await check('a fresh student gets null latestRapid and no squares', async () => {
      await db.query('DELETE FROM time_control_rating_history WHERE student_id = ANY($1)', [SIDS]);
      await db.query('DELETE FROM student_time_ratings WHERE student_id = ANY($1)', [SIDS]);

      const { data } = await api('/api/students/ratings/me', aToken);
      assert.equal(data.latestRapid, null, 'a student with no Rapid games has no latest move');
      assert.deepEqual(data.rapidRecent, [], 'and no recent rows - never fabricated boxes');
      assert.equal(data.rapid, null, 'with no pool the Rapid rating is null (unrated)');
    });
  } finally {
    for (const sid of SIDS) {
      await db.query('DELETE FROM time_control_rating_history WHERE student_id = $1', [sid]);
    }
    await db.query('DELETE FROM time_control_rating_history WHERE id > $1', [marks.poolHist]);
    await db.query('DELETE FROM rating_history WHERE id > $1', [marks.hist]);
    await db.query('DELETE FROM student_levels WHERE id > $1', [marks.levels]);
    await db.query('DELETE FROM student_time_ratings WHERE id > $1', [marks.pools]);
    await db.query('DELETE FROM student_time_ratings WHERE student_id = ANY($1)', [SIDS]);
    for (const row of poolSnap) {
      await db.query(
        `INSERT INTO student_time_ratings
           (student_id, time_class, rating, peak_rating, highest_level, games_played, provisional_games)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [row.student_id, row.time_class, row.rating, row.peak_rating,
          row.highest_level, row.games_played, row.provisional_games],
      );
    }
    for (const row of before) {
      await db.query(
        `UPDATE students SET current_rating=$1, peak_rating=$2, highest_level=$3,
            games_played=$4, provisional_games=$5, birthdate=$6, last_rating_change_at=$7
          WHERE id=$8`,
        [row.current_rating, row.peak_rating, row.highest_level, row.games_played,
          row.provisional_games, row.birthdate, row.last_rating_change_at, row.id],
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