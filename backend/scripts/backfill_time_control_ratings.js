/**
 * One-time backfill: replay `rating_history` into the per-time-control pools.
 *
 * WHY THIS IS NEEDED
 * The per-time-control tables (`student_time_ratings`,
 * `time_control_rating_history`) were added by a migration AFTER most games had
 * already been played, so every pool is empty while `students.current_rating`
 * carries the real history. Until this runs, a time-control-only leaderboard
 * would show nobody.
 *
 * The history rows already record a `time_control` string ('5+0', '15+10',
 * 'Rapid', 'Blitz', …) which `classifyTimeControl` can bucket, so the pools can
 * be rebuilt exactly rather than estimated.
 *
 * HOW IT WORKS
 * For each (student, time class) pair, replay that student's games in
 * chronological order starting from 1000, applying the SAME Elo maths and the
 * SAME K-factor ladder the live code uses (kFactorDetailed). A backfill that
 * used different maths would silently disagree with every future game, so the
 * maths is imported from ratingService rather than re-implemented here.
 *
 * Games whose time control cannot be understood are reported and skipped —
 * they stay in the common rating but cannot be attributed to a pool.
 *
 * SAFE TO RE-RUN: refuses to touch pools that already have games unless
 * --force is passed, and wraps all writes in a single transaction.
 *
 * Run: node scripts/backfill_time_control_ratings.js [--force] [--dry-run]
 */
const db = require('../src/config/database');
const rating = require('../src/services/ratingService');

const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry-run');

/** Buckets history rows into per-student, per-class chronological games. */
function bucketRows(rows) {
  const buckets = new Map();
  const skipped = [];

  for (const r of rows) {
    const cls = rating.classifyTimeControl(r.time_control);
    if (!cls) {
      skipped.push({ id: r.id, time_control: r.time_control });
      continue;
    }
    const key = `${r.student_id}:${cls}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({
      id: r.id,
      cls,
      score: r.result === 'win' ? 1 : r.result === 'draw' ? 0.5 : 0,
      opponentId: r.opponent_id,
      opponentName: r.opponent_name,
      timeControl: r.time_control,
      gameType: r.game_type,
      playedAt: r.played_at,
    });
  }

  /* Chronological order matters: each game's rating depends on the previous
     one, so an unordered replay would produce a different (wrong) number. */
  for (const list of buckets.values()) {
    list.sort((a, b) => new Date(a.playedAt) - new Date(b.playedAt));
  }
  return { buckets, skipped };
}

async function main() {
  const existing = await db.query(
    `SELECT count(*)::int AS n FROM student_time_ratings WHERE games_played > 0`
  );
  if (existing.rows[0].n > 0 && !force) {
    console.log(
      `REFUSING: ${existing.rows[0].n} pool(s) already have games. Re-run with --force to rebuild.`
    );
    return db.pool.end();
  }

  const { rows } = await db.query(
    `SELECT student_id, opponent_id, opponent_name, result, time_control,
            game_type, played_at, rating_before, rating_after, id
       FROM rating_history
      WHERE rated = TRUE
      ORDER BY student_id, played_at ASC, id ASC`
  );
  console.log(`Replaying ${rows.length} rated history rows…`);

  const { buckets, skipped } = bucketRows(rows);
  console.log(`→ ${skipped.length} row(s) skipped (unclassifiable time control)`);
  if (skipped.length) console.log(`   e.g. ${JSON.stringify(skipped.slice(0, 5))}`);

  /* A single game touches TWO pools (both players). The live path scores each
     side against the opponent's rating in the SAME control, so the replay has
     to do the same or the numbers disagree with every future game.

     Processing one (student, class) bucket in isolation would assume every
     opponent was exactly equal, which punishes losses far too hard — a player
     who lost to a much stronger opponent would lose rating as though it were a
     coin flip. Instead we walk the WHOLE history in chronological order,
     holding the live state of every pool in memory, so each side is scored
     against the opponent's real current pool rating.

     PAIRING IS THE TRICKY PART. `rating_history` stores one row PER PLAYER, and
     a single match therefore lands as TWO rows with DIFFERENT ids, written
     milliseconds apart by two independent UPDATEs. Keying on `id` would treat
     one match as two half-games and double-count everyone's games.

     So we group by unordered pair + time class, then pair consecutive rows:
     both sides of a match are always written back-to-back, and back-to-back
     matches between the same two players (ids 19-22 below) fall out
     correctly as two consecutive pairs rather than being merged. */
  const pairGroups = new Map();
  for (const r of rows) {
    const cls = rating.classifyTimeControl(r.time_control);
    if (!cls || r.opponent_id == null) continue;
    const lo = Math.min(r.student_id, r.opponent_id);
    const hi = Math.max(r.student_id, r.opponent_id);
    const key = `${lo}:${hi}:${cls}`;
    if (!pairGroups.has(key)) pairGroups.set(key, []);
    pairGroups.get(key).push(r);
  }

  const games = [];
  let unpaired = 0;
  for (const list of pairGroups.values()) {
    list.sort((a, b) => new Date(a.played_at) - new Date(b.played_at) || a.id - b.id);
    for (let i = 0; i < list.length; i += 2) {
      const pair = list.slice(i, i + 2);
      /* A genuine match has exactly two sides with complementary results
         (win+loss, or draw+draw). Anything else means a counterpart row is
         missing — e.g. the opponent was later deleted, so only one side was
         written. Those are replayed as an unopposed result. */
      const [a, b] = pair;
      const complementary =
        pair.length === 2 &&
        ((a.result === 'win' && b.result === 'loss') ||
         (a.result === 'loss' && b.result === 'win') ||
         (a.result === 'draw' && b.result === 'draw'));
      if (pair.length === 1) unpaired += 1;
      games.push({
        id: a.id,
        cls: rating.classifyTimeControl(a.time_control),
        playedAt: a.played_at,
        gameType: a.game_type,
        paired: complementary,
        sides: pair.map((r) => ({
          studentId: r.student_id,
          score: r.result === 'win' ? 1 : r.result === 'draw' ? 0.5 : 0,
          opponentId: r.opponent_id,
          opponentName: r.opponent_name,
          timeControl: r.time_control,
        })),
      });
    }
  }

  /* Rows with no opponent recorded (a game whose counterpart was never stored)
     still belong in the pool, just as a standalone result. */
  for (const r of rows) {
    const cls = rating.classifyTimeControl(r.time_control);
    if (!cls || r.opponent_id != null) continue;
    games.push({
      id: r.id,
      cls,
      playedAt: r.played_at,
      gameType: r.game_type,
      paired: false,
      sides: [{
        studentId: r.student_id,
        score: r.result === 'win' ? 1 : r.result === 'draw' ? 0.5 : 0,
        opponentId: null,
        opponentName: r.opponent_name,
        timeControl: r.time_control,
      }],
    });
    unpaired += 1;
  }

  games.sort((a, b) => new Date(a.playedAt) - new Date(b.playedAt) || a.id - b.id);
  console.log(`→ ${games.length} distinct games across ${buckets.size} pools`);
  if (unpaired) console.log(`→ ${unpaired} unpaired result(s) replayed without an opponent rating`);

  if (dryRun) {
    console.log('\n[dry-run] no writes performed.');
    return db.pool.end();
  }

  const client = await db.pool.connect();
  let poolCount = 0;
  let gameCount = 0;
  const poolState = new Map(); // `${studentId}:${cls}` → { rating, peak, gamesPlayed }
  const historyOut = new Map(); // same key → rows[]

  const stateFor = (studentId, cls) => {
    const key = `${studentId}:${cls}`;
    if (!poolState.has(key)) {
      poolState.set(key, { rating: rating.STARTING_RATING, peak: rating.STARTING_RATING, gamesPlayed: 0 });
    }
    return poolState.get(key);
  };

  try {
    await client.query('BEGIN');
    if (force) {
      await client.query('DELETE FROM time_control_rating_history');
      await client.query('DELETE FROM student_time_ratings');
    }

    for (const g of games) {
      const oppById = new Map();
      for (const s of g.sides) {
        if (s.opponentId == null) continue;
        oppById.set(s.studentId, s.opponentId);
      }

      /* Snapshot every side's rating BEFORE this game so both sides of the
         same game are scored against pre-game ratings, exactly as the live
         path does (it reads both pools before writing either). */
      const before = new Map();
      for (const s of g.sides) before.set(s.studentId, stateFor(s.studentId, g.cls).rating);

      for (const s of g.sides) {
        const st = stateFor(s.studentId, g.cls);
        const oppId = oppById.get(s.studentId);
        const oppRating = oppId != null ? before.get(oppId) : undefined;
        const { k } = rating.kFactorDetailed({
          gamesPlayed: st.gamesPlayed,
          age: null,
          peakRating: st.peak,
        });
        const expected = rating.expectedScore(
          st.rating,
          oppRating == null ? st.rating : oppRating
        );
        const next = rating.newRating(st.rating, k, expected, s.score);
        const key = `${s.studentId}:${g.cls}`;
        if (!historyOut.has(key)) historyOut.set(key, []);
        historyOut.get(key).push([
          s.studentId, g.cls, s.opponentId || null, s.opponentName || null,
          s.score === 1 ? 'win' : s.score === 0 ? 'loss' : 'draw',
          st.rating, next, next - st.rating,
          s.timeControl || null, g.gameType || 'official', g.playedAt,
        ]);
        st.peak = Math.max(st.peak, next);
        st.rating = next;
        st.gamesPlayed += 1;
      }
    }

    /* Persist every pool we touched, then its history. */
    for (const [key, st] of poolState) {
      const [studentIdStr, timeClass] = key.split(':');
      await client.query(
        `INSERT INTO student_time_ratings
           (student_id, time_class, rating, peak_rating, highest_level, games_played,
            provisional_games, last_changed_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
         ON CONFLICT (student_id, time_class) DO UPDATE
           SET rating = EXCLUDED.rating, peak_rating = EXCLUDED.peak_rating,
               highest_level = EXCLUDED.highest_level, games_played = EXCLUDED.games_played,
               provisional_games = EXCLUDED.provisional_games,
               last_changed_at = NOW(), updated_at = NOW()`,
        [Number(studentIdStr), timeClass, st.rating, st.peak,
         rating.levelForRating(st.peak).level, st.gamesPlayed, Math.max(0, 20 - st.gamesPlayed)]
      );
      poolCount += 1;
    }

    /* Bulk-insert the replayed games in chunks. */
    for (const [, rowsOut] of historyOut) {
      for (let i = 0; i < rowsOut.length; i += 200) {
        const chunk = rowsOut.slice(i, i + 200);
        const cols = chunk[0].length;
        const placeholders = chunk
          .map((_, r) => `(${Array.from({ length: cols }, (_, c) => `$${r * cols + c + 1}`).join(',')})`)
          .join(',');
        await client.query(
          `INSERT INTO time_control_rating_history
             (student_id, time_class, opponent_id, opponent_name, result,
              rating_before, rating_after, rating_change, time_control, game_type, played_at)
           VALUES ${placeholders}`,
          chunk.flat()
        );
        gameCount += chunk.length;
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Backfill failed, rolled back:', err.message);
    throw err;
  } finally {
    client.release();
  }

  const after = await db.query(
    `SELECT t.time_class, count(*)::int AS players, sum(t.games_played)::int AS games,
            round(avg(t.rating))::int AS avg_rating, max(t.rating)::int AS top
       FROM student_time_ratings t GROUP BY t.time_class ORDER BY t.time_class`
  );
  console.log(`\nDone: ${poolCount} pools, ${gameCount} replayed games.`);
  console.table(after.rows);
  return db.pool.end();
}

main().catch(async (e) => {
  console.error(e.message);
  await db.pool.end().catch(() => {});
  process.exit(1);
});
