/* One-time repair for profiles that drifted from their rating history.
 *
 * BACKGROUND. Two defect classes, both fixed in ratingService (one game = one
 * transaction, canonical row locks, expectancy read inside the lock):
 *   1. Rating updates were separate statements with no transaction, so two
 *      games finishing close together could interleave (lost update), and an
 *      overall write could commit while its pool write never did.
 *   2. One Oct-8 game predates the pool path, so both players' rapid pools
 *      start a game late and every later pool delta was computed on the
 *      lagging base (self-consistent chain, wrong numbers: 1034/1038/3 games
 *      instead of the true pool series).
 *
 * WHAT IT DOES.
 *   students (overall): replay rating_history in (played_at, id) order —
 *     rating = last rating_after, peak = max(stored peak, max after) [never
 *     lowered], games = count of rated rows. Chain breaks are reported.
 *   student_time_ratings (pools): re-SIMULATE each class series game by game
 *     in global time order (both sides together, same Elo maths as live code
 *     via ratingService). Missing pool rows are reconstructed, diverged rows
 *     rewritten, profile recomputed. A pool is its own Elo series — expect it
 *     to differ from overall by a point here and there, not to equal it.
 * "Last change" and "recent form" are NOT stored columns — the badge derives
 * them from the latest history rows at read time — so once profile and
 * history agree they read correctly with no write needed.
 *
 * Run:  node scripts/repair-rating-profiles.js [--apply] [--student-id=N]
 *   default is DRY RUN: prints every correction it would make, changes
 *   nothing. Pass --apply to write.
 */
const db = require('../src/config/database');
const ratingSvc = require('../src/services/ratingService');

const APPLY = process.argv.includes('--apply');
const onlyArg = process.argv.find((a) => a.startsWith('--student-id='));
const ONLY_STUDENT = onlyArg ? Number(onlyArg.split('=')[1]) : null;

const scoreOf = (result) => (result === 'win' ? 1 : result === 'draw' ? 0.5 : 0);

async function main() {
  const studentFilter = ONLY_STUDENT ? 'WHERE s.id = $1' : '';
  const params = ONLY_STUDENT ? [ONLY_STUDENT] : [];
  const { rows: students } = await db.query(
    `SELECT s.id, s.user_id, u.name, s.current_rating, s.peak_rating, s.games_played
       FROM students s JOIN users u ON u.id = s.user_id ${studentFilter}
       ORDER BY s.id`,
    params,
  );

  /* All rated overall rows once — games grouped by online_game_id for the
     pool re-simulation, per-student chains for the overall replay. */
  const allOverall = (await db.query(
    `SELECT id, student_id, opponent_id, result, rating_before, rating_after,
            rating_change, time_class, time_control, rated, played_at, online_game_id
       FROM rating_history
      ${ONLY_STUDENT ? 'WHERE student_id = $1' : ''}
      ORDER BY played_at ASC, id ASC`,
    params,
  )).rows;

  let profileWrites = 0;
  let poolRowWrites = 0;
  let poolWrites = 0;

  /* ── pool re-simulation state, keyed student:Class ── */
  const sim = new Map(); // key -> { before, peak, games, maxLevel }
  const simKey = (sid, cls) => `${sid}:${cls}`;
  const simState = (sid, cls) => {
    const k = simKey(sid, cls);
    if (!sim.has(k)) sim.set(k, { before: ratingSvc.STARTING_RATING, peak: ratingSvc.STARTING_RATING, games: 0, maxLevel: 1 });
    return sim.get(k);
  };

  /* Games with a linkable id, in global time order. (Rows with NULL game ids
     predate the link; they are replay-validated only, never re-simulated.) */
  const games = new Map();
  for (const r of allOverall) {
    if (r.rated === false || r.online_game_id == null) continue;
    if (!games.has(r.online_game_id)) games.set(r.online_game_id, []);
    games.get(r.online_game_id).push(r);
  }
  const orderedGames = [...games.entries()]
    .map(([gid, rows]) => ({ gid, rows, t: rows[0].played_at, i: rows[0].id }))
    .sort((x, y) => (x.t < y.t ? -1 : x.t > y.t ? 1 : x.i - y.i));

  /* What the pool table SHOULD hold: keyed student:Class:gameId. */
  const wantPoolRows = new Map(); // `${sid}:${cls}:${gid}` -> { before, after, change, result, opponentId, opponentName?, playedAt }
  const allPool = (await db.query(
    `SELECT id, student_id, time_class, opponent_id, result, rating_before,
            rating_after, rating_change, online_game_id, played_at
       FROM time_control_rating_history
      ${ONLY_STUDENT ? 'WHERE student_id = $1' : ''}
      ORDER BY played_at ASC, id ASC`,
    params,
  )).rows;
  const havePoolRows = new Map(); // `${sid}:${cls}:${gid}` -> row
  for (const r of allPool) {
    if (r.online_game_id != null) havePoolRows.set(`${r.student_id}:${r.time_class}:${r.online_game_id}`, r);
  }

  for (const g of orderedGames) {
    /* Expectancy inputs come from PRE-game state for BOTH sides (mirrors live:
       pre-reads happen before either side updates, so a side never scores
       against the opponent's just-written number from this same game). */
    const steps = [];
    for (const side of g.rows) {
      const cls = side.time_class;
      if (!cls) continue;
      const st = simState(side.student_id, cls);
      const oppSt = sim.get(simKey(side.opponent_id, cls));
      let oppRating;
      if (oppSt) oppRating = oppSt.before;
      else {
        const oppRow = g.rows.find((r) => r.student_id === side.opponent_id);
        oppRating = oppRow ? oppRow.rating_before : ratingSvc.STARTING_RATING;
      }
      const { k } = ratingSvc.kFactorDetailed({ gamesPlayed: st.games, age: null, peakRating: st.peak });
      const exp = ratingSvc.expectedScore(st.before, oppRating);
      const after = ratingSvc.newRating(st.before, k, exp, scoreOf(side.result));
      steps.push({
        side, cls, st, oppRating,
        before: st.before,
        after,
        change: after - st.before,
        playedAt: side.played_at,
      });
    }
    for (const s of steps) {
      wantPoolRows.set(`${s.side.student_id}:${s.cls}:${g.gid}`, {
        before: s.before,
        after: s.after,
        change: s.change,
        result: s.side.result,
        oppRating: s.oppRating,
        playedAt: s.playedAt,
      });
      s.st.before = s.after;
      s.st.peak = Math.max(s.st.peak, s.after);
      s.st.maxLevel = Math.max(s.st.maxLevel, ratingSvc.levelForRating(s.after).level);
      s.st.games += 1;
    }
  }

  for (const s of students) {
    const label = `${s.name || '(no name)'} (student_id=${s.id})`;
    const lines = [];

    /* ── overall replay ── */
    const hist = allOverall.filter((r) => r.student_id === s.id && r.rated !== false);
    if (hist.length) {
      const breaks = [];
      for (let i = 1; i < hist.length; i += 1) {
        if (hist[i].rating_before !== hist[i - 1].rating_after) {
          breaks.push(`row ${hist[i].id}: before=${hist[i].rating_before} != prev after=${hist[i - 1].rating_after}`);
        }
      }
      if (breaks.length) {
        lines.push(`  overall chain breaks (${breaks.length}):`);
        breaks.slice(0, 5).forEach((b) => lines.push(`    - ${b}`));
      }
      const last = hist[hist.length - 1];
      const wantProfile = {
        current_rating: last.rating_after,
        peak_rating: Math.max(s.peak_rating, ...hist.map((r) => r.rating_after)),
        games_played: hist.length,
      };
      const diffs = ['current_rating', 'peak_rating', 'games_played']
        .filter((k) => s[k] !== wantProfile[k])
        .map((k) => `${k}: ${s[k]} -> ${wantProfile[k]}`);
      if (diffs.length) {
        lines.push(`  profile: ${diffs.join('; ')}  [${hist.length} rated rows, last change ${last.rating_change >= 0 ? '+' : ''}${last.rating_change}, form ${hist.slice(-4).map((r) => r.result).join('/')}]`);
        if (APPLY) {
          await db.query(
            'UPDATE students SET current_rating = $1, peak_rating = $2, games_played = $3 WHERE id = $4',
            [wantProfile.current_rating, wantProfile.peak_rating, wantProfile.games_played, s.id],
          );
          profileWrites += 1;
        }
      }
    }

    /* ── pool diffs (simulated vs stored) ── */
    const pools = (await db.query(
      'SELECT time_class, rating, peak_rating, highest_level, games_played, provisional_games FROM student_time_ratings WHERE student_id = $1 ORDER BY time_class',
      [s.id],
    )).rows;
    const classes = new Set([
      ...pools.map((p) => p.time_class),
      ...[...wantPoolRows.keys()].filter((k) => k.startsWith(`${s.id}:`)).map((k) => k.split(':')[1]),
    ]);
    for (const cls of classes) {
      const pool = pools.find((p) => p.time_class === cls);
      const wanted = [...wantPoolRows.entries()]
        .filter(([k]) => k.startsWith(`${s.id}:${cls}:`))
        .map(([k, v]) => ({ gid: Number(k.split(':')[2]), ...v }));
      if (!wanted.length) continue; // pool-only series: replay-validated below
      const simEnd = sim.get(simKey(s.id, cls));
      const wantPool = {
        rating: simEnd.before,
        peak_rating: Math.max(pool ? pool.peak_rating : 0, simEnd.peak),
        highest_level: Math.max(pool ? pool.highest_level : 1, simEnd.maxLevel),
        games_played: wanted.length,
        provisional_games: Math.max(0, 20 - wanted.length),
      };
      const rowFixes = [];
      for (const w of wanted) {
        const have = havePoolRows.get(`${s.id}:${cls}:${w.gid}`);
        if (!have) {
          rowFixes.push(`game ${w.gid}: MISSING -> insert ${w.before} -> ${w.after} (${w.change >= 0 ? '+' : ''}${w.change} ${w.result}, K-opp ${w.oppRating})`);
        } else if (have.rating_before !== w.before || have.rating_after !== w.after || have.rating_change !== w.change) {
          rowFixes.push(`game ${w.gid}: ${have.rating_before} -> ${have.rating_after} (${have.rating_change >= 0 ? '+' : ''}${have.rating_change}) -> rewrite ${w.before} -> ${w.after} (${w.change >= 0 ? '+' : ''}${w.change})`);
        }
      }
      const profDiffs = pool
        ? ['rating', 'peak_rating', 'highest_level', 'games_played', 'provisional_games']
          .filter((k) => pool[k] !== wantPool[k])
          .map((k) => `${k}: ${pool[k]} -> ${wantPool[k]}`)
        : [`(no ${cls} pool row) -> create ${JSON.stringify(wantPool)}`];
      if (rowFixes.length || profDiffs.length) {
        lines.push(`  pool ${cls}: ${profDiffs.join('; ') || 'profile ok'}`);
        rowFixes.forEach((f) => lines.push(`    - ${f}`));
        if (APPLY) {
          for (const w of wanted) {
            const have = havePoolRows.get(`${s.id}:${cls}:${w.gid}`);
            if (!have) {
              const overallRow = allOverall.find((r) => r.student_id === s.id && r.online_game_id === w.gid);
              await db.query(
                `INSERT INTO time_control_rating_history
                   (student_id, time_class, opponent_id, opponent_name, result,
                    rating_before, rating_after, rating_change, time_control, game_type, online_game_id, played_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
                [s.id, cls, overallRow ? overallRow.opponent_id : null, null, w.result,
                  w.before, w.after, w.change, overallRow ? overallRow.time_control : null, 'official', w.gid, w.playedAt],
              );
              poolRowWrites += 1;
            } else if (have.rating_before !== w.before || have.rating_after !== w.after || have.rating_change !== w.change) {
              await db.query(
                'UPDATE time_control_rating_history SET rating_before = $1, rating_after = $2, rating_change = $3 WHERE id = $4',
                [w.before, w.after, w.change, have.id],
              );
              poolRowWrites += 1;
            }
          }
          if (pool) {
            await db.query(
              `UPDATE student_time_ratings SET rating = $1, peak_rating = $2, highest_level = $3,
                      games_played = $4, provisional_games = $5 WHERE student_id = $6 AND time_class = $7`,
              [wantPool.rating, wantPool.peak_rating, wantPool.highest_level,
                wantPool.games_played, wantPool.provisional_games, s.id, cls],
            );
          } else {
            await db.query(
              `INSERT INTO student_time_ratings (student_id, time_class, rating, peak_rating, highest_level, games_played, provisional_games)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [s.id, cls, wantPool.rating, wantPool.peak_rating, wantPool.highest_level,
                wantPool.games_played, wantPool.provisional_games],
            );
          }
          poolWrites += 1;
        }
      }
    }

    /* ── pool-only series (no overall rows to simulate from): replay check ── */
    if (!lines.length) continue;
    console.log(`\n${label}`);
    lines.forEach((l) => console.log(l));
  }

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN (no writes)'}: ${profileWrites} overall profiles, ${poolWrites} pool profiles, ${poolRowWrites} pool rows.`);
  if (!APPLY) console.log('Re-run with --apply to write these corrections.');
  await db.pool.end();
}

main().catch((err) => {
  console.error('repair failed:', err);
  process.exitCode = 1;
  db.pool.end();
});
