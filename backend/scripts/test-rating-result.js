/* End-to-end check of the per-game rating result shown after a rated
 * player-vs-player game: GET /api/online/games/:id/rating-result
 *
 * Run: node scripts/test-rating-result.js
 *
 * The point of the endpoint is that a finished rated game tells YOU your own
 * rating change. Two properties matter and are easy to get wrong:
 *
 *   1. It is participant-only and ONE-SIDED. The game screen must not be able to
 *      read the opponent's delta. This is why the delta does not travel in
 *      payload(): emitGameUpdate broadcasts {forAdmin, forStudent} to both
 *      sockets, so a delta inside payload() hands each player the other's
 *      rating change too.
 *   2. Bot games are NOT rated, by design - a bot has no student row and no real
 *      rating to move. So the endpoint must answer `rated: false` for them
 *      rather than inventing a number.
 *
 * Everything here is snapshot/restore: no permission rows, ratings or game rows
 * are left modified. */
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const db = require('../src/config/database');
const rating = require('../src/services/ratingService');

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

  /* Snapshot the ratings we are about to move, plus the audit tail, so the
     assertions below cannot leave real ratings altered. */
  const before = (
    await db.query('SELECT id, current_rating, peak_rating, highest_level, games_played, provisional_games, last_rating_change_at FROM students WHERE id = ANY($1)', [[a.student_id, b.student_id]])
  ).rows;
  const histMark = (await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM rating_history')).rows[0].id;
  /* applyGameResult also inserts a student_levels row when a level is reached,
     and that has to be put back too - ON CONFLICT DO NOTHING means re-running
     would silently keep a level this test created. */
  const levelMark = (await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM student_levels')).rows[0].id;
  /* Marks for the per-control tables, so this suite leaves no rated residue. */
  const tcMark = (await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM student_time_ratings')).rows[0].id;
  const tcHistMark = (await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM time_control_rating_history')).rows[0].id;
  let gameId = null;
  /* Every game this script creates, so the finally block can remove them all.
   * Deleting inline at the end of each test looked tidier but leaked: when an
   * assertion threw first, the delete never ran and the row survived - which is
   * exactly how four test games ended up orphaned in the real table. Cleanup
   * that depends on the assertions passing is not cleanup. */
  const created = [];
  const track = (row) => { created.push(row.id); return row; };

  try {
    /* ── a real finished rated game between the two students ── */
    await check('a rated finished game reports the caller\'s own change', async () => {
      const g = (
        await db.query(
          `INSERT INTO online_games (admin_id, student_id, admin_color, status, result, result_reason,
             fen, pgn, time_base_minutes, time_increment_seconds, white_ms, black_ms, is_bot, created_at, updated_at)
           VALUES ($1,$2,'white','finished','white','checkmate',
             'start','1. e4 e5 2. Nf3 Nc6 1-0',10,5,600000,600000,FALSE,NOW(),NOW())
           RETURNING id`,
          [a.user_id, b.user_id],
        )
      ).rows[0];
      track(g);
      gameId = g.id;

      /* Route it through the real rating path so the online_game_id link is
         written exactly as a live game would write it. */
      const applied = await rating.applyGameResult({
        player: { studentId: a.student_id, score: 1, rating: 1000, name: 'A' },
        opponent: { studentId: b.student_id, score: 0, rating: 1000, name: 'B' },
        meta: { timeControl: 'Rapid', gameType: 'online', rated: true, onlineGameId: gameId },
      });
      assert.ok(applied?.player?.ratingChange != null, 'applyGameResult must return the change');

      const r = await api(`/api/online/games/${gameId}/rating-result`, aToken);
      assert.equal(r.status, 200, `expected 200, got ${r.status}`);
      assert.equal(r.data.rated, true, 'a rated finished game must report rated:true');
      assert.equal(typeof r.data.ratingChange, 'number', 'ratingChange must be a number');
      assert.equal(
        r.data.ratingAfter - r.data.ratingBefore,
        r.data.ratingChange,
        'ratingAfter - ratingBefore must equal ratingChange',
      );
      assert.equal(r.data.result, 'win', 'the caller won, so their row says win');
      assert.ok(r.data.ratingChange > 0, `a win must gain rating, got ${r.data.ratingChange}`);
    });

    await check('the loser sees their own loss, not the winner\'s gain', async () => {
      const r = await api(`/api/online/games/${gameId}/rating-result`, bToken);
      assert.equal(r.status, 200);
      assert.equal(r.data.rated, true);
      assert.equal(r.data.result, 'loss', 'the loser\'s row says loss');
      assert.ok(r.data.ratingChange < 0, `a loss must lose rating, got ${r.data.ratingChange}`);
    });

    await check('each side sees a DIFFERENT number (no cross-contamination)', async () => {
      const ra = await api(`/api/online/games/${gameId}/rating-result`, aToken);
      const rb = await api(`/api/online/games/${gameId}/rating-result`, bToken);
      assert.notEqual(
        ra.data.ratingChange,
        rb.data.ratingChange,
        'winner and loser must not be handed the same rating change',
      );
    });

    /* ────────────────────────────────────────────────────────────────────────
       Two-sided attribution for the result card's two rating rows.

       The check above proves the two callers get DIFFERENT numbers, which is
       necessary but not sufficient: an endpoint that handed each caller the
       opponent's row (or the same arbitrary row) would also satisfy it. These
       assert the stronger property the card depends on — each caller's OWN
       numbers are its own, and the `opponent` object is the other player's —
       checked against the rating_history rows directly rather than against
       each other.
       ──────────────────────────────────────────────────────────────────────── */
    const truth = (
      await db.query(
        `SELECT student_id, rating_before, rating_after, rating_change, result
           FROM rating_history WHERE online_game_id = $1`,
        [gameId],
      )
    ).rows;
    const rowFor = (studentId) => truth.find((t) => t.student_id === studentId);
    const rowA = rowFor(a.student_id);
    const rowB = rowFor(b.student_id);

    await check('the winner\'s response puts the WINNER\'s numbers in the own fields', async () => {
      assert.ok(rowA && rowB, 'both players must have a rating_history row');
      const r = await api(`/api/online/games/${gameId}/rating-result`, aToken);
      assert.equal(r.status, 200);
      assert.equal(r.data.ratingBefore, rowA.rating_before, 'own ratingBefore must be the winner\'s');
      assert.equal(r.data.ratingAfter, rowA.rating_after, 'own ratingAfter must be the winner\'s');
      assert.equal(r.data.ratingChange, rowA.rating_change, 'own ratingChange must be the winner\'s');
      assert.equal(r.data.result, 'win', 'own result must be the winner\'s outcome');
    });

    await check('the winner\'s response puts the LOSER\'s numbers in opponent', async () => {
      const r = await api(`/api/online/games/${gameId}/rating-result`, aToken);
      assert.ok(r.data.opponent, 'opponent must be present for a rated 1v1 game');
      assert.equal(r.data.opponent.ratingBefore, rowB.rating_before, 'opponent ratingBefore must be the loser\'s');
      assert.equal(r.data.opponent.ratingAfter, rowB.rating_after, 'opponent ratingAfter must be the loser\'s');
      assert.equal(r.data.opponent.ratingChange, rowB.rating_change, 'opponent ratingChange must be the loser\'s');
      assert.equal(r.data.opponent.result, 'loss', 'opponent result must be the loser\'s outcome');
    });

    await check('the loser\'s response puts the LOSER\'s numbers in the own fields', async () => {
      const r = await api(`/api/online/games/${gameId}/rating-result`, bToken);
      assert.equal(r.status, 200);
      assert.equal(r.data.ratingBefore, rowB.rating_before, 'own ratingBefore must be the loser\'s');
      assert.equal(r.data.ratingAfter, rowB.rating_after, 'own ratingAfter must be the loser\'s');
      assert.equal(r.data.ratingChange, rowB.rating_change, 'own ratingChange must be the loser\'s');
      assert.equal(r.data.result, 'loss', 'own result must be the loser\'s outcome');
    });

    await check('the loser\'s response puts the WINNER\'s numbers in opponent', async () => {
      const r = await api(`/api/online/games/${gameId}/rating-result`, bToken);
      assert.ok(r.data.opponent, 'opponent must be present for a rated 1v1 game');
      assert.equal(r.data.opponent.ratingBefore, rowA.rating_before);
      assert.equal(r.data.opponent.ratingAfter, rowA.rating_after);
      assert.equal(r.data.opponent.ratingChange, rowA.rating_change);
    });

    await check('the two callers\' own + opponent values are exact mirrors', async () => {
      const ra = await api(`/api/online/games/${gameId}/rating-result`, aToken);
      const rb = await api(`/api/online/games/${gameId}/rating-result`, bToken);
      assert.equal(ra.data.ratingChange, rb.data.opponent.ratingChange,
        'A\'s own delta must equal B\'s opponent delta');
      assert.equal(rb.data.ratingChange, ra.data.opponent.ratingChange,
        'B\'s own delta must equal A\'s opponent delta');
    });

    await check('the colours are reported and are opposite each other', async () => {
      /* The fixture is admin_color='white' with A as the admin, so A sat White
         and B sat Black. `rating_history.result` is an OUTCOME ('win'/'loss'),
         never a colour — reading a colour out of it silently yields null, which
         is exactly the bug these assertions lock down. */
      const ra = await api(`/api/online/games/${gameId}/rating-result`, aToken);
      const rb = await api(`/api/online/games/${gameId}/rating-result`, bToken);
      assert.ok(['white', 'black'].includes(ra.data.myColor),
        `A's myColor must be a real colour, got ${JSON.stringify(ra.data.myColor)}`);
      assert.ok(['white', 'black'].includes(ra.data.opponentColor),
        `A's opponentColor must be a real colour, got ${JSON.stringify(ra.data.opponentColor)}`);
      assert.equal(ra.data.myColor, 'white', 'A sat White in this fixture');
      assert.equal(ra.data.opponentColor, 'black');
      assert.equal(rb.data.myColor, 'black', 'B sat Black in this fixture');
      assert.equal(rb.data.opponentColor, 'white');
    });

    await check('the opponent carries a usable name, never a raw null', async () => {
      const r = await api(`/api/online/games/${gameId}/rating-result`, aToken);
      assert.ok(r.data.opponent, 'opponent must be present');
      /* `opponent_name` is nullable on older rows; the field must still exist so
         the UI can fall back deliberately instead of rendering "null". */
      assert.ok('name' in r.data.opponent, 'opponent must expose a name field');
      if (r.data.opponent.name !== null) {
        assert.equal(typeof r.data.opponent.name, 'string');
        assert.ok(r.data.opponent.name.trim().length > 0, 'a present name must not be blank');
      }
    });

    await check('myName is MY name and opponent.name is theirs, not both the same', async () => {
      /* The bug this locks down: a single top-level `opponentName` (the OTHER
         player's name, as recorded on your own rating_history row) was consumed
         by the card as the caller's own label, so both rating rows rendered the
         opponent's name. The two names must come from OPPOSITE columns of the
         game row. */
      /* `admin_name` / `student_name` are not columns — they are the aliases
         getGameRow() gives the two joined users, so alias them the same way. */
      const g = (
        await db.query(
          `SELECT au.name AS admin_name, su.name AS student_name,
                  g.admin_color, g.admin_id
             FROM online_games g
             JOIN users au ON au.id = g.admin_id
             JOIN users su ON su.id = g.student_id
            WHERE g.id = $1`,
          [gameId],
        )
      ).rows[0];
      /* The fixture: A is the admin and admin_color is 'white'. */
      const adminIsWhite = g.admin_color === 'white';
      const whiteName = adminIsWhite ? g.admin_name : g.student_name;
      const blackName = adminIsWhite ? g.student_name : g.admin_name;

      const ra = await api(`/api/online/games/${gameId}/rating-result`, aToken);
      const rb = await api(`/api/online/games/${gameId}/rating-result`, bToken);

      /* A sat White, B sat Black. */
      assert.equal(ra.data.myColor, 'white');
      assert.equal(rb.data.myColor, 'black');

      /* Each caller is told their OWN name, and it is the name of the colour
         they actually sat. */
      assert.equal(ra.data.myName, whiteName, "A's myName must be the White player's name");
      assert.equal(rb.data.myName, blackName, "B's myName must be the Black player's name");

      /* And each is told the OTHER player's name. When the two names differ this
         is what proves the rows are not both showing one player. */
      assert.equal(ra.data.opponent.name, blackName, "A's opponent.name must be the Black player's name");
      assert.equal(rb.data.opponent.name, whiteName, "B's opponent.name must be the White player's name");

      /* The relationship the card depends on: myName is never handed the
         opponent's name, and the two callers disagree. */
      assert.notEqual(
        ra.data.myName,
        ra.data.opponent.name,
        "a player's own name must not be reported as the opponent's name",
      );
      assert.equal(ra.data.myName, rb.data.opponent.name, "A's myName must equal B's opponent name");
      assert.equal(rb.data.myName, ra.data.opponent.name, "B's myName must equal A's opponent name");

      /* No top-level `opponentName` any more: a field whose name does not say
         whose it is is exactly what caused the duplicate-name bug. */
      assert.equal(ra.data.opponentName, undefined,
        'the ambiguous top-level opponentName must not come back');
    });

    await check('the rating fields are numbers, never strings', async () => {
      /* Postgres INTEGER comes back as a JS number, but a careless future edit
         (or a NUMERIC cast) would hand the UI "14" and render ▲ +14 as text that
         silently sorts wrong. */
      const r = await api(`/api/online/games/${gameId}/rating-result`, aToken);
      for (const k of ['ratingBefore', 'ratingAfter', 'ratingChange']) {
        assert.equal(typeof r.data[k], 'number', `${k} must be a number, got ${typeof r.data[k]}`);
        assert.ok(Number.isFinite(r.data[k]), `${k} must be finite`);
      }
      for (const k of ['ratingBefore', 'ratingAfter', 'ratingChange']) {
        assert.equal(typeof r.data.opponent[k], 'number', `opponent.${k} must be a number`);
      }
      /* The invariant the whole delta display rests on. */
      assert.equal(r.data.ratingAfter - r.data.ratingBefore, r.data.ratingChange);
      assert.equal(
        r.data.opponent.ratingAfter - r.data.opponent.ratingBefore,
        r.data.opponent.ratingChange,
      );
    });

    await check('an unrated game exposes no opponent object to crash on', async () => {
      /* An in-progress game: the card must be able to read `response.opponent`
         without a guard. Assert the shape it actually gets so that contract is
         pinned rather than assumed. */
      const g = (
        await db.query(
          `INSERT INTO online_games (admin_id, student_id, admin_color, status, result, result_reason,
             fen, pgn, time_base_minutes, time_increment_seconds, white_ms, black_ms, is_bot, created_at, updated_at)
           VALUES ($1,$2,'white','active',NULL,NULL,
             'start','',10,5,600000,600000,FALSE,NOW(),NOW())
           RETURNING id`,
          [a.user_id, b.user_id],
        )
      ).rows[0];
      track(g);
      const r = await api(`/api/online/games/${g.id}/rating-result`, aToken);
      assert.equal(r.status, 200);
      assert.equal(r.data.rated, false);
      assert.equal(r.data.reason, 'in_progress');
      /* No rating keys at all — the UI gates the whole block on `rated`. */
      assert.equal(r.data.ratingChange, undefined, 'an unrated game must not carry a delta');
      assert.equal(r.data.opponent, undefined, 'an unrated game must not carry an opponent');
    });

    await check('a non-participant is refused', async () => {
      const r = await api(`/api/online/games/${gameId}/rating-result`, coachToken);
      assert.equal(r.status, 403, `a coach who is not in the match must get 403, got ${r.status}`);
    });

    await check('an unauthenticated request is refused', async () => {
      const r = await api(`/api/online/games/${gameId}/rating-result`, null);
      assert.equal(r.status, 401, `expected 401, got ${r.status}`);
    });

    await check('a bot game reports unrated, not an invented delta', async () => {
      const g = (
        await db.query(
          `INSERT INTO online_games (admin_id, student_id, admin_color, status, result, result_reason,
             fen, pgn, time_base_minutes, time_increment_seconds, white_ms, black_ms, is_bot, bot_level, created_at, updated_at)
           VALUES ($1,$2,'black','finished','black','checkmate',
             'start','1. e4 e5 0-1',10,5,600000,600000,TRUE,6,NOW(),NOW())
           RETURNING id`,
          [a.user_id, b.user_id],
        )
      ).rows[0];
      track(g);
      const r = await api(`/api/online/games/${g.id}/rating-result`, aToken);
      assert.equal(r.status, 200);
      assert.equal(r.data.rated, false, 'a bot game must never be rated');
      assert.equal(r.data.reason, 'bot_game', `expected reason bot_game, got ${r.data.reason}`);
      assert.equal(r.data.ratingChange, undefined, 'no rating number may be reported');
    });

    await check('an in-progress game reports unrated', async () => {
      const g = (
        await db.query(
          `INSERT INTO online_games (admin_id, student_id, admin_color, status,
             fen, pgn, time_base_minutes, time_increment_seconds, white_ms, black_ms, is_bot, created_at, updated_at)
           VALUES ($1,$2,'white','active','start','',10,5,600000,600000,FALSE,NOW(),NOW())
           RETURNING id`,
          [a.user_id, b.user_id],
        )
      ).rows[0];
      track(g);
      const r = await api(`/api/online/games/${g.id}/rating-result`, aToken);
      assert.equal(r.data.rated, false);
      assert.equal(r.data.reason, 'in_progress');
    });

    await check('an abandoned game reports unrated', async () => {
      const g = (
        await db.query(
          `INSERT INTO online_games (admin_id, student_id, admin_color, status, result, result_reason,
             fen, pgn, time_base_minutes, time_increment_seconds, white_ms, black_ms, is_bot, created_at, updated_at)
           VALUES ($1,$2,'white','finished','abandoned','agreement',
             'start','',10,5,600000,600000,FALSE,NOW(),NOW())
           RETURNING id`,
          [a.user_id, b.user_id],
        )
      ).rows[0];
      track(g);
      const r = await api(`/api/online/games/${g.id}/rating-result`, aToken);
      assert.equal(r.data.rated, false, 'an abandoned game is never rated');
      assert.equal(r.data.reason, 'no_result');
    });

    await check('a finished but unrecorded game reports unrated, not an error', async () => {
      const g = (
        await db.query(
          `INSERT INTO online_games (admin_id, student_id, admin_color, status, result, result_reason,
             fen, pgn, time_base_minutes, time_increment_seconds, white_ms, black_ms, is_bot, created_at, updated_at)
           VALUES ($1,$2,'white','finished','white','checkmate',
             'start','1. e4 1-0',10,5,600000,600000,FALSE,NOW(),NOW())
           RETURNING id`,
          [a.user_id, b.user_id],
        )
      ).rows[0];
      track(g);
      const r = await api(`/api/online/games/${g.id}/rating-result`, aToken);
      assert.equal(r.status, 200, 'a missing history row must not 500');
      assert.equal(r.data.rated, false);
      assert.equal(r.data.reason, 'unrated');
    });

    await check('an unknown game id is 404', async () => {
      const r = await api('/api/online/games/99999999/rating-result', aToken);
      assert.equal(r.status, 404, `expected 404, got ${r.status}`);
    });

    await check('the rating_history rows carry the game link', async () => {
      const h = (
        await db.query('SELECT online_game_id, rating_change FROM rating_history WHERE id > $1', [histMark])
      ).rows;
      assert.equal(h.length, 2, `expected 2 history rows (one per player), got ${h.length}`);
      for (const row of h) {
        assert.equal(Number(row.online_game_id), Number(gameId),
          'every row must point back at the game that produced it');
      }
    });
  } finally {
    /* ── restore exactly ── */
    /* Every created game, not just the rated one: this block is the ONLY thing
       standing between a failed assertion and junk rows in online_games. */
    if (created.length) {
      /* time_control_rating_history first: its online_game_id FK is ON DELETE
         SET NULL, so deleting the game row would ORPHAN the pool history rather
         than remove it, and an orphan still counts as a rated-history row. */
      await db.query('DELETE FROM time_control_rating_history WHERE online_game_id = ANY($1)', [created]);
      await db.query('DELETE FROM rating_history WHERE online_game_id = ANY($1)', [created]);
      await db.query('DELETE FROM online_games WHERE id = ANY($1)', [created]);
    }
    for (const row of before) {
      await db.query(
        `UPDATE students SET current_rating = $1, peak_rating = $2, highest_level = $3,
           games_played = $4, provisional_games = $5, last_rating_change_at = $6
         WHERE id = $7`,
        [row.current_rating, row.peak_rating, row.highest_level,
          row.games_played, row.provisional_games, row.last_rating_change_at, row.id],
      );
    }
    await db.query('DELETE FROM rating_history WHERE id > $1', [histMark]);
    /* Pools this suite created are removed by id mark, and the pool history
       alongside them, so a fresh database stays fresh after a test run. */
    await db.query('DELETE FROM time_control_rating_history WHERE id > $1', [tcHistMark]);
    await db.query('DELETE FROM student_time_ratings WHERE id > $1', [tcMark]);
    await db.query('DELETE FROM student_levels WHERE id > $1', [levelMark]);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exitCode = fail === 0 ? 0 : 1;
}

main()
  .catch((e) => { console.error('ERR:', e.message || e); process.exitCode = 1; })
  .finally(async () => { await db.pool.end(); });