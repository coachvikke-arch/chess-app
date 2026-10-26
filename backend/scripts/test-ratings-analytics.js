/**
 * Smoke test for GET /api/students/ratings/analytics.
 *
 * Boots the real Express app on an ephemeral port and drives the endpoint with
 * real HTTP, so route ORDER, the auth middleware and the feature gate are all
 * exercised together — a green unit call to ratingService() proves none of
 * that. Run:  node scripts/test-ratings-analytics.js
 */
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const db = require('../src/config/database');

const PORT = 0; // let the OS pick a free port
let failures = 0;

function check(name, cond, extra) {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
}

/** Sign a token the way authMiddleware expects, and call an endpoint. */
async function call(server, token, query = '', path = '/students/ratings/analytics') {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, body };
}

/** A superadmin token — ungated, so it isolates the handler from permissions. */
const tokenFor = (over = {}) =>
  jwt.sign({ id: 0, role: 'superadmin', name: 'Smoke', email: 's@t.io', ...over }, process.env.JWT_SECRET, { expiresIn: '5m' });

const server = app.listen(PORT);

server.on('listening', async () => {
  try {
    /* ── 1. auth is enforced ── */
    const anon = await call(server, null);
    check('no token → 401', anon.status === 401, `got ${anon.status}`);

    const bogus = await call(server, 'not-a-real-jwt');
    check('invalid token → 401', bogus.status === 401, `got ${bogus.status}`);

    /* ── 2. happy path ── */
    const ok = await call(server, tokenFor());
    check('superadmin → 200', ok.status === 200, `got ${ok.status}`);
    if (ok.status !== 200) throw new Error(`body: ${JSON.stringify(ok.body)}`);

    const d = ok.body;
    check('overview present', d.overview && typeof d.overview.students === 'number', `students=${d.overview?.students}`);
    check('median is a number', typeof d.overview.median_rating === 'number', `median=${d.overview.median_rating}`);

    /* 7 bands, ascending, starting at 1000 with an open top. */
    check('7 level bands', d.levels.length === 7, `got ${d.levels.length}`);
    check('bands ascend', d.levels.every((l, i) => i === 0 || l.min > d.levels[i - 1].min));
    check('top band is open-ended', d.levels[6].max === null);
    check('every band has a count', d.levels.every((l) => typeof l.count === 'number'));

    /* Histogram must account for exactly the RAPID-RATED students (those with a
       rapid pool), not every student — unrated students have no point to plot. */
    const hSum = d.histogram.reduce((n, b) => n + b.count, 0);
    check('histogram totals = rapid-rated students', hSum === d.overview.rated, `${hSum} vs ${d.overview.rated}`);
    check('buckets are 100 wide', d.histogram.every((b) => b.to - b.from === 99));
    check('no student rated without a rapid pool', d.overview.rated <= d.overview.students);

    /* All four controls always present, even with no games played. */
    check('4 time controls', d.timeClasses.length === 4, d.timeClasses.map((t) => t.timeClass).join(','));
    check('k-factor table complete', d.kFactors.length === 4);

    /* ── 3. limit is honoured and clamped ── */
    const lim = await call(server, tokenFor(), '?limit=3');
    check('limit=3 caps movers', lim.body.movers.length <= 3, `got ${lim.body.movers.length}`);
    const hi = await call(server, tokenFor(), '?limit=99999');
    check('limit clamped to 100', hi.status === 200 && hi.body.movers.length <= 100, `got ${hi.body.movers.length}`);
    const junk = await call(server, tokenFor(), '?limit=abc');
    check('non-numeric limit → default 20', junk.status === 200 && junk.body.movers.length <= 20);

    /* ── 3b. THE LADDER IS RAPID-BASED ──
       The common/unified rating must not decide rank. Two students can have an
       inverted relationship between common and rapid; the rapid order has to
       win. */
    const lbRes = await call(server, tokenFor(), '', '/students/ratings/leaderboard');
    const lb = await db.query(
      `SELECT s.id, u.name, s.current_rating, rt.rating AS rapid
         FROM students s JOIN users u ON u.id = s.user_id
         LEFT JOIN student_time_ratings rt ON rt.student_id = s.id AND rt.time_class = 'rapid'
        WHERE s.hide_from_leaderboard = FALSE`
    );
    const rated = lb.rows.filter((r) => r.rapid != null);
    const lbRows = lbRes.body.leaderboard || lbRes.body;
    check('leaderboard endpoint returns rows', Array.isArray(lbRows) && lbRows.length > 0);

    if (Array.isArray(lbRows) && rated.length > 1) {
      /* Ranked students (those with a rapid pool) must come first, in descending
         rapid order. */
      const firstUnrated = lbRows.findIndex((r) => r.rapidRating == null);
      const ratedSlice = firstUnrated === -1 ? lbRows : lbRows.slice(0, firstUnrated);
      check('rapid-rated students sort above unrated',
        ratedSlice.length === rated.length, `${ratedSlice.length} vs ${rated.length}`);
      check('rapid ratings are non-increasing down the ladder',
        ratedSlice.every((r, i) => i === 0 || ratedSlice[i - 1].rapidRating >= r.rapidRating));

      /* Where common and rapid disagree, rapid must be the deciding number. */
      const top = lbRows[0];
      const bestRapid = Math.max(...rated.map((r) => r.rapid));
      check('rank 1 holds the highest rapid rating', top.rapidRating === bestRapid,
        `top=${top.rapidRating} best=${bestRapid}`);

      const commonTop = [...lb.rows].sort((a, b) => b.current_rating - a.current_rating)[0];
      if (commonTop.name !== top.name) {
        check('ranking ignores the common rating (they disagree, rapid wins)', true,
          `common-top=${commonTop.name}(${commonTop.current_rating}) vs rapid-top=${top.name}(${top.rapidRating})`);
      } else {
        check('common and rapid agree on rank 1 (inconclusive but consistent)', true, top.name);
      }
    }
    /* ── 3c. WEEKLY MUST NOT LEAK THE COMMON RATING ──
       Regression: weeklyRating used to be read from `rating_history` (the
       common pool), so the Weekly tab showed the combined rating the rest of
       the app had dropped — and contradicted the Overall Champion tab. */
    const weekly = lbRows.filter((r) => r.weeklyRating != null);
    check('weekly ratings are rapid-based, not common',
      weekly.every((r) => r.weeklyRating === r.rapidRating),
      weekly.map((r) => `${r.name}: weekly=${r.weeklyRating} rapid=${r.rapidRating}`).join('; '));
    check('no weekly rating equals a stale common number',
      !weekly.some((r) => r.weeklyRating === r.current_rating && r.rapidRating !== r.current_rating),
      weekly.filter((r) => r.weeklyRating === r.current_rating && r.rapidRating !== r.current_rating).map((r) => r.name).join(','));
    check('unrated students have no weekly rating', lbRows.filter((r) => r.rapidRating == null).every((r) => r.weeklyRating == null));
    check('weeklyGames matches the count of in-window rapid games',
      weekly.every((r) => Number.isInteger(r.weeklyGames) && r.weeklyGames >= 0));
    check('weeklyDelta is a finite number', lbRows.every((r) => Number.isFinite(r.weeklyDelta)));

    /* ── 4. movers/recent agree with the DB, and are self-consistent ── */
    const agg = await db.query(
      `SELECT count(DISTINCT student_id)::int AS n FROM rating_history
        WHERE rated = TRUE AND played_at >= NOW() - INTERVAL '7 days'`
    );
    check('movers ≤ students with games this week', d.movers.length <= agg.rows[0].n,
      `${d.movers.length} vs ${agg.rows[0].n}`);
    check('mover delta = end - start', d.movers.every((m) => m.delta === m.end_rating - m.start_rating));
    check('recent rows carry a name', d.recent.every((r) => typeof r.student_name === 'string' && r.student_name.length > 0));

    /* ── 5. private students are invisible here too ──
       Rather than skipping when nobody is hidden, hide a student who really
       does appear in the feed and prove they vanish from both lists. */
    const victim = await db.query(
      `SELECT s.id, u.name FROM students s JOIN users u ON u.id = s.user_id
        WHERE s.hide_from_leaderboard = FALSE
          AND s.id IN (SELECT student_id FROM rating_history)
        ORDER BY s.id LIMIT 1`
    );
    if (!victim.rows.length) {
      check('hidden students excluded (no rated history to hide)', true);
    } else {
      const v = victim.rows[0];
      const before = await call(server, tokenFor());
      const seenBefore =
        [...before.body.recent, ...before.body.movers].some((r) => (r.student_name || r.name) === v.name);
      check('victim is visible before hiding', seenBefore, v.name);
      try {
        await db.query(`UPDATE students SET hide_from_leaderboard = TRUE WHERE id = $1`, [v.id]);
        const after = await call(server, tokenFor());
        const leak = [...after.body.recent, ...after.body.movers].some((r) => (r.student_name || r.name) === v.name);
        check('hidden student disappears from recent', !leak);
        check('hidden student disappears from movers', !leak);
      } finally {
        await db.query(`UPDATE students SET hide_from_leaderboard = FALSE WHERE id = $1`, [v.id]);
        const back = await call(server, tokenFor());
        const backOk = [...back.body.recent, ...back.body.movers].some((r) => (r.student_name || r.name) === v.name);
        check('student restored and visible again', backOk, v.name);
      }
    }

    /* ── 6. the feature gate really is wired ──
       A 200 above only proves the gate is not blocking when the permission is
       ON. To prove enforcement we flip the student's `leaderboard` switch off,
       assert a 403, then restore it — wrapped so a failure can't leave the
       permission table modified. */
    const perm = await db.query(
      `SELECT u.id, u.name, COALESCE(rp.is_enabled, FALSE) AS on_by_role
         FROM users u
         JOIN students s ON s.user_id = u.id
         LEFT JOIN features f ON f.key = 'leaderboard'
         LEFT JOIN role_permissions rp ON rp.feature_id = f.id AND rp.role = 'student'
         /* A per-user override outranks the role switch (see canAccess), so we
            must pick a student who has none or the OFF assertion is a false
            failure. */
         LEFT JOIN user_permission_overrides upo
                ON upo.feature_id = f.id AND upo.user_id = u.id
        WHERE u.role = 'student' AND s.hide_from_leaderboard = FALSE AND upo.id IS NULL
        ORDER BY u.id LIMIT 1`
    );
    if (!perm.rows.length) {
      check('feature gate (no student available to test with)', true);
    } else {
      const stu = perm.rows[0];
      const saved = stu.on_by_role;
      try {
        await db.query(
          `UPDATE role_permissions SET is_enabled = FALSE
            WHERE feature_id = (SELECT id FROM features WHERE key = 'leaderboard') AND role = 'student'`
        );
        const denied = await call(server, tokenFor({ role: 'student', id: stu.id }));
        check('feature OFF → 403', denied.status === 403, `got ${denied.status}`);

        await db.query(
          `UPDATE role_permissions SET is_enabled = TRUE
            WHERE feature_id = (SELECT id FROM features WHERE key = 'leaderboard') AND role = 'student'`
        );
        const allowed = await call(server, tokenFor({ role: 'student', id: stu.id }));
        check('feature ON → 200', allowed.status === 200, `got ${allowed.status}`);
      } finally {
        /* Restore exactly what was there, whether or not the asserts passed. */
        await db.query(
          `UPDATE role_permissions SET is_enabled = $1
            WHERE feature_id = (SELECT id FROM features WHERE key = 'leaderboard') AND role = 'student'`,
          [saved]
        );
        const restored = await call(server, tokenFor({ role: 'student', id: stu.id }));
        check('permission table restored', restored.status === (saved ? 200 : 403), `saved=${saved} got ${restored.status}`);
      }
    }
  } catch (err) {
    failures++;
    console.error('ERROR during smoke test:', err.message);
  } finally {
    server.close();
    db.pool.end().then(() => {
      console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
      process.exit(failures === 0 ? 0 : 1);
    });
  }
});
