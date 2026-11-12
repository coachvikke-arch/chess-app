/**
 * One-time repair: rebuild every rating chain PER TIME CONTROL.
 *
 * WHY
 * Rated games used to read and write `students.current_rating`, a single shared
 * number. Every result — Bullet, Blitz, Rapid, Classical — chained through it,
 * so a Bullet game's "before" was the previous Rapid game's "after". The
 * per-control pools were correct, but `rating_history` (the Recent Rated
 * Results feed) recorded the shared chain, and pool peaks drifted from the
 * highest value the same table could produce.
 *
 * WHAT IT DOES
 *  1. Replays `time_control_rating_history` (the authoritative per-control log)
 *     from STARTING_RATING, class by class, using the SAME Elo maths and
 *     K-factor ladder as the live service.
 *  2. Rewrites rating_before / rating_after / rating_change on those rows.
 *  3. Copies the same numbers onto the matching `rating_history` rows, so the
 *     Recent Rated Results table and the profile describe one rating. Rows are
 *     matched per student by chronological position (validated against class,
 *     result and opponent); a student whose two tables disagree is replayed
 *     independently from its own rows and the mismatch is logged.
 *  4. Recomputes every pool: rating = final value, peak = highest value ever
 *     reached, games_played = number of replayed games.
 *  5. Refreshes the legacy `students` mirror: current_rating / peak_rating =
 *     the Rapid pool (the champion control), games_played = all pools.
 *  6. Adds the missing partial UNIQUE index on
 *     (student_id, online_game_id) when the data has no duplicates.
 *
 * SAFETY
 *  - Dry-run by default. Pass --apply to write.
 *  - Both history tables, all pools and the affected `students` columns are
 *    copied into `rating_repair_backup_<timestamp>_*` tables before any write.
 *  - Nothing is deleted. Unclassifiable rows and duplicate gameIds are reported
 *    and left in place (duplicates keep their id, with change neutralised).
 *  - All writes happen in one transaction.
 *
 * Run:
 *   node scripts/fix_per_control_ratings.js            # dry-run, prints the plan
 *   node scripts/fix_per_control_ratings.js --apply    # writes the repair
 */
require('dotenv').config();
const db = require('../src/config/database');
const rating = require('../src/services/ratingService');
const { replayRows, normaliseClass } = require('./lib/perControlReplay');

const APPLY = process.argv.includes('--apply');

const HISTORY_COLUMNS = `id, student_id, time_class, time_control, opponent_id, result,
       played_at, online_game_id, tournament_game_id, rating_before, rating_after,
       rating_change`;

function stamp() {
  return new Date().toISOString().replace(/\D/g, '').slice(0, 14);
}

function at(row) {
  return new Date(row.played_at).getTime();
}

/**
 * Match each rating_history row to the time_control_rating_history row for the
 * same game, per student, by chronological position.
 *
 * Returns { mapping: Map<rhId, tcRowId>, students: Set<rhId that failed> }.
 * A student is only mapped when every position agrees on class, result and
 * opponent; a single disagreement drops that student to the independent-replay
 * fallback (which is still per-control, just not cross-table identical).
 */
function alignTables(rhRows, tcRows) {
  const mapping = new Map();
  const mismatchedStudents = new Set();

  const group = (rows) => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.student_id)) m.set(r.student_id, []);
      m.get(r.student_id).push(r);
    }
    for (const list of m.values()) list.sort((a, b) => at(a) - at(b) || a.id - b.id);
    return m;
  };

  const rhByStudent = group(rhRows);
  const tcByStudent = group(tcRows);

  for (const [studentId, rhList] of rhByStudent) {
    const tcList = tcByStudent.get(studentId) || [];
    let ok = rhList.length === tcList.length;
    if (ok) {
      for (let i = 0; i < rhList.length; i += 1) {
        const r = rhList[i];
        const t = tcList[i];
        if (normaliseClass(r) !== normaliseClass(t)
          || r.result !== t.result
          || (r.opponent_id ?? null) !== (t.opponent_id ?? null)) {
          ok = false;
          break;
        }
      }
    }
    if (ok) {
      for (let i = 0; i < rhList.length; i += 1) mapping.set(rhList[i].id, tcList[i].id);
    } else {
      mismatchedStudents.add(studentId);
    }
  }
  return { mapping, mismatchedStudents };
}

function indexBy(rows) {
  return new Map(rows.map((r) => [r.id, r]));
}

function keyOf(studentId, timeClass) {
  return `${studentId}:${timeClass}`;
}

/**
 * A pool whose history has fewer rows than `games_played` cannot be replayed
 * from STARTING_RATING — the missing games really happened, and pretending
 * they did not would silently rewrite the student's rating. The task's
 * fallback applies: keep the pool's current rating and rebuild a continuous
 * chain BACKWARDS from it using each row's recorded per-control delta, fixing
 * only the chain and the peak.
 *
 * Mutates tc.byRow / tc.states for those pools and returns a list of the
 * anchored (student, class) keys for the report.
 */
function anchorIncompletePools(tc, poolByKey, tcById) {
  const rowsByPool = new Map();
  for (const [id, c] of tc.byRow) {
    const row = tcById.get(id);
    const key = keyOf(row.student_id, c.timeClass);
    if (!rowsByPool.has(key)) rowsByPool.set(key, []);
    rowsByPool.get(key).push({ id, at: at(row), change: c });
  }

  const anchored = [];
  for (const [key, list] of rowsByPool) {
    const state = tc.states.get(key);
    const pool = poolByKey.get(key);
    if (!state || !pool || state.gamesPlayed === pool.games_played) continue;

    list.sort((a, b) => a.at - b.at || a.id - b.id);
    let anchor = pool.rating;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const c = list[i].change;
      c.ratingAfter = anchor;
      c.ratingBefore = anchor - c.ratingChange;
      anchor = c.ratingBefore;
    }
    state.rating = pool.rating;
    state.gamesPlayed = pool.games_played;
    state.peak = Math.max(pool.peak_rating, pool.rating, ...list.map((e) => e.change.ratingAfter));

    anchored.push({ key, rows: list.length, poolGames: pool.games_played });
  }
  return anchored;
}

async function main() {
  const [rhRes, tcRes, poolRes, studentRes] = await Promise.all([
    db.query(`SELECT ${HISTORY_COLUMNS} FROM rating_history ORDER BY student_id, played_at, id`),
    db.query(`SELECT ${HISTORY_COLUMNS} FROM time_control_rating_history ORDER BY student_id, played_at, id`),
    db.query('SELECT * FROM student_time_ratings'),
    db.query(
      `SELECT s.id, s.current_rating, s.peak_rating, s.highest_level, s.games_played,
              s.provisional_games, u.name
         FROM students s JOIN users u ON u.id = s.user_id`
    ),
  ]);

  const tc = replayRows(tcRes.rows);
  const rh = replayRows(rhRes.rows);
  const { mapping, mismatchedStudents } = alignTables(rhRes.rows, tcRes.rows);

  const rhById = indexBy(rhRes.rows);
  const tcById = indexBy(tcRes.rows);
  const poolByKey = new Map(poolRes.rows.map((p) => [keyOf(p.student_id, p.time_class), p]));
  const studentById = new Map(studentRes.rows.map((s) => [s.id, s]));

  /* Pools whose history is shorter than their game counter are anchored to
     their existing rating instead of replayed — see anchorIncompletePools. */
  const anchoredPools = anchorIncompletePools(tc, poolByKey, tcById);

  /* Proposed numbers for each history row. */
  const rhProposed = new Map();
  for (const row of rhRes.rows) {
    const mappedId = mapping.get(row.id);
    const change = mappedId != null ? tc.byRow.get(mappedId) : rh.byRow.get(row.id);
    if (change) rhProposed.set(row.id, change);
  }

  /* Per-student, per-class summary: pool before → after plus row churn. */
  const perUser = new Map();
  const ensure = (studentId, timeClass) => {
    const k = keyOf(studentId, timeClass);
    if (!perUser.has(k)) perUser.set(k, { studentId, timeClass, tcRows: 0, rhRows: 0 });
    return perUser.get(k);
  };

  for (const [id, c] of tc.byRow) {
    const row = tcById.get(id);
    const entry = ensure(row.student_id, c.timeClass);
    const changed = row.rating_before !== c.ratingBefore
      || row.rating_after !== c.ratingAfter || row.rating_change !== c.ratingChange
      || row.time_class !== c.timeClass;
    if (changed) entry.tcRows += 1;
  }
  for (const [id, c] of rhProposed) {
    const row = rhById.get(id);
    const entry = ensure(row.student_id, c.timeClass);
    const changed = row.rating_before !== c.ratingBefore
      || row.rating_after !== c.ratingAfter || row.rating_change !== c.ratingChange
      || row.time_class !== c.timeClass;
    if (changed) entry.rhRows += 1;
  }

  const anchoredKeys = new Set(anchoredPools.map((a) => a.key));
  const stateRows = [];
  for (const [key, st] of tc.states) {
    const old = poolByKey.get(key);
    const student = studentById.get(st.studentId);
    stateRows.push({
      student: st.studentId,
      name: student ? student.name : '?',
      cls: st.timeClass,
      mode: anchoredKeys.has(key) ? 'anchored' : 'replayed',
      'pool rating': `${old ? old.rating : '—'} → ${st.rating}`,
      'pool peak': `${old ? old.peak_rating : '—'} → ${st.peak}`,
      'pool games': `${old ? old.games_played : '—'} → ${st.gamesPlayed}`,
      'tc rows fixed': perUser.get(key)?.tcRows || 0,
      'rh rows fixed': perUser.get(key)?.rhRows || 0,
    });
  }
  stateRows.sort((a, b) => a.student - b.student || a.cls.localeCompare(b.cls));

  console.log(`time_control_rating_history : ${tcRes.rows.length} rows, ${tc.games.length} games, `
    + `${tc.skipped.length} skipped, ${tc.duplicates.length} duplicate(s)`);
  console.log(`rating_history              : ${rhRes.rows.length} rows, ${rh.games.length} games, `
    + `${rh.skipped.length} skipped, ${rh.duplicates.length} duplicate(s)`);
  console.log(`pools                       : ${poolRes.rows.length}`);
  console.log(`cross-table alignment       : ${mapping.size} rating_history rows mapped`
    + (mismatchedStudents.size ? `, ${mismatchedStudents.size} student(s) fell back to their own replay` : ''));
  if (mismatchedStudents.size) {
    console.log('  fallback students:', [...mismatchedStudents].join(', '));
  }
  if (tc.skipped.length) console.log('  unclassifiable tc rows:', JSON.stringify(tc.skipped.slice(0, 10)));
  if (rh.skipped.length) console.log('  unclassifiable rh rows:', JSON.stringify(rh.skipped.slice(0, 10)));
  if (tc.duplicates.length) console.log('  duplicate tc rows:', JSON.stringify(tc.duplicates.slice(0, 10)));
  if (rh.duplicates.length) console.log('  duplicate rh rows:', JSON.stringify(rh.duplicates.slice(0, 10)));

  if (anchoredPools.length) {
    console.log('  ANCHORED pools (history shorter than games_played → rating kept, chain repaired backwards):');
    for (const a of anchoredPools) console.log(`    ${a.key}: ${a.rows} history rows vs ${a.poolGames} games`);
  }

  console.log('\nBEFORE → AFTER per student / control');
  console.table(stateRows);

  /* Verification of the proposed state: the profile number must be the latest
     replayed game in its class, and peak must cover every replayed value. */
  const latest = new Map();
  for (const [id, c] of tc.byRow) {
    const row = tcById.get(id);
    const key = keyOf(row.student_id, c.timeClass);
    const prev = latest.get(key);
    if (!prev || at(row) >= at(prev.row)) latest.set(key, { row, change: c });
  }
  const problems = [];
  for (const [key, st] of tc.states) {
    const last = latest.get(key);
    if (last && last.change.ratingAfter !== st.rating) {
      problems.push(`${key}: pool ${st.rating} != latest after ${last.change.ratingAfter}`);
    }
    if (st.peak < st.rating) problems.push(`${key}: peak ${st.peak} < rating ${st.rating}`);
  }
  console.log(problems.length
    ? `\nVERIFY FAILED:\n  ${problems.join('\n  ')}`
    : '\nVERIFY OK: every pool equals its latest game and peak covers it.');

  /* Chain continuity: in every control, a game's "before" must be the previous
     game's "after" for the same student. */
  const chainBreaks = (rows, proposed, label) => {
    const byPool = new Map();
    for (const row of rows) {
      const change = proposed.get(row.id);
      if (!change) continue;
      const key = keyOf(row.student_id, change.timeClass);
      if (!byPool.has(key)) byPool.set(key, []);
      byPool.get(key).push({ at: at(row), id: row.id, change });
    }
    let breaks = 0;
    for (const list of byPool.values()) {
      list.sort((a, b) => a.at - b.at || a.id - b.id);
      for (let i = 1; i < list.length; i += 1) {
        if (list[i].change.ratingBefore !== list[i - 1].change.ratingAfter) breaks += 1;
      }
    }
    console.log(`chain breaks in ${label}: ${breaks}`);
    return breaks;
  };
  chainBreaks(tcRes.rows, tc.byRow, 'time_control_rating_history');
  chainBreaks(rhRes.rows, rhProposed, 'rating_history');

  /* Duplicate-index readiness. */
  const dupChecks = {};
  for (const [table, alias] of [['rating_history', 'rh'], ['time_control_rating_history', 'tc']]) {
    const r = await db.query(
      `SELECT count(*)::int AS n FROM (
         SELECT student_id, online_game_id FROM ${table}
          WHERE online_game_id IS NOT NULL
          GROUP BY student_id, online_game_id HAVING count(*) > 1
       ) d`
    );
    dupChecks[alias] = r.rows[0].n;
  }
  console.log(`duplicate (student, online_game_id) groups — rating_history: ${dupChecks.rh}, `
    + `time_control_rating_history: ${dupChecks.tc}`);

  if (!APPLY) {
    console.log('\n[dry-run] no writes performed. Re-run with --apply to write the repair.');
    return db.pool.end();
  }

  const ts = stamp();
  const backup = {
    pools: `rating_repair_backup_${ts}_pools`,
    tc: `rating_repair_backup_${ts}_tc_history`,
    rh: `rating_repair_backup_${ts}_history`,
    students: `rating_repair_backup_${ts}_students`,
  };

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TABLE ${backup.pools} AS TABLE student_time_ratings`);
    await client.query(`CREATE TABLE ${backup.tc} AS TABLE time_control_rating_history`);
    await client.query(`CREATE TABLE ${backup.rh} AS TABLE rating_history`);
    await client.query(
      `CREATE TABLE ${backup.students} AS
       SELECT id, current_rating, peak_rating, highest_level, games_played, provisional_games
         FROM students`
    );
    console.log(`\nbackup tables: ${Object.values(backup).join(', ')}`);

    let tcUpdates = 0;
    for (const [id, c] of tc.byRow) {
      const row = tcById.get(id);
      if (row.rating_before === c.ratingBefore && row.rating_after === c.ratingAfter
        && row.rating_change === c.ratingChange && row.time_class === c.timeClass) continue;
      await client.query(
        `UPDATE time_control_rating_history
            SET time_class = $2, rating_before = $3, rating_after = $4, rating_change = $5
          WHERE id = $1`,
        [id, c.timeClass, c.ratingBefore, c.ratingAfter, c.ratingChange]
      );
      tcUpdates += 1;
    }

    let rhUpdates = 0;
    for (const [id, c] of rhProposed) {
      const row = rhById.get(id);
      if (row.rating_before === c.ratingBefore && row.rating_after === c.ratingAfter
        && row.rating_change === c.ratingChange && row.time_class === c.timeClass) continue;
      await client.query(
        `UPDATE rating_history
            SET time_class = $2, rating_before = $3, rating_after = $4, rating_change = $5
          WHERE id = $1`,
        [id, c.timeClass, c.ratingBefore, c.ratingAfter, c.ratingChange]
      );
      rhUpdates += 1;
    }

    /* Neutralise duplicate rows without deleting them: a repeated gameId keeps
       the value its first row applied, with zero movement. */
    for (const d of tc.duplicates) {
      const applied = tc.byRow.get(d.keptId);
      if (!applied) continue;
      await client.query(
        `UPDATE time_control_rating_history
            SET rating_before = $2, rating_after = $2, rating_change = 0
          WHERE id = $1`,
        [d.id, applied.ratingAfter]
      );
    }
    for (const d of rh.duplicates) {
      const applied = rhProposed.get(d.keptId);
      if (!applied) continue;
      await client.query(
        `UPDATE rating_history
            SET rating_before = $2, rating_after = $2, rating_change = 0
          WHERE id = $1`,
        [d.id, applied.ratingAfter]
      );
    }

    for (const [key, st] of tc.states) {
      const level = rating.levelForRating(st.peak);
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
        [st.studentId, st.timeClass, st.rating, st.peak, level.level, st.gamesPlayed,
          Math.max(0, 20 - st.gamesPlayed)]
      );
    }

    /* `students` mirror: Rapid pool drives the displayed rating/peak; the
       counters span every class, exactly as the live write path keeps them. */
    const byStudent = new Map();
    for (const st of tc.states.values()) {
      if (!byStudent.has(st.studentId)) byStudent.set(st.studentId, []);
      byStudent.get(st.studentId).push(st);
    }
    for (const [studentId, states] of byStudent) {
      const rapid = states.find((s) => s.timeClass === 'rapid');
      const totalGames = states.reduce((n, s) => n + s.gamesPlayed, 0);
      const topLevel = Math.max(1, ...states.map((s) => rating.levelForRating(s.peak).level));
      if (rapid) {
        await client.query(
          `UPDATE students
              SET current_rating = $1, peak_rating = $2,
                  highest_level = GREATEST(highest_level, $3),
                  games_played = $4,
                  provisional_games = GREATEST(0, 20 - $4)
            WHERE id = $5`,
          [rapid.rating, rapid.peak, topLevel, totalGames, studentId]
        );
      } else {
        await client.query(
          `UPDATE students
              SET highest_level = GREATEST(highest_level, $1),
                  games_played = $2,
                  provisional_games = GREATEST(0, 20 - $2)
            WHERE id = $3`,
          [topLevel, totalGames, studentId]
        );
      }
    }

    if (dupChecks.rh === 0) {
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_rating_history_student_online
           ON rating_history (student_id, online_game_id)
           WHERE online_game_id IS NOT NULL`
      );
    } else {
      console.warn('SKIPPED unique index on rating_history: duplicate (student, online_game_id) rows exist.');
    }
    if (dupChecks.tc === 0) {
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_tc_rating_history_student_online
           ON time_control_rating_history (student_id, online_game_id)
           WHERE online_game_id IS NOT NULL`
      );
    } else {
      console.warn('SKIPPED unique index on time_control_rating_history: duplicates exist.');
    }

    await client.query('COMMIT');
    console.log(`\nApplied: ${tcUpdates} time-control rows, ${rhUpdates} rating_history rows, `
      + `${tc.states.size} pools, ${byStudent.size} students.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Repair failed, rolled back:', err.message);
    throw err;
  } finally {
    client.release();
  }

  return db.pool.end();
}

if (require.main === module) {
  main().catch(async (e) => {
    console.error(e.message);
    await db.pool.end().catch(() => {});
    process.exit(1);
  });
}

module.exports = { alignTables };
