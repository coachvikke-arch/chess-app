const db = require('../config/database');

/**
 * Overall Champion Score — ONE formula for the whole app.
 *
 * Every number here comes from records that already exist; nothing is written
 * to the database and there is no separate "champion" table to drift out of
 * sync. The leaderboard page and the dashboard position card both read this
 * service, so they can never disagree.
 *
 * ── What is counted, and why it cannot be double counted ───────────────────
 *
 * Games
 *   · `student_game_analysis` — permanent per-student/per-day rollups written
 *     by the game-history cleanup job (online games, including bot games, plus
 *     computer games).
 *   · Finished `online_games` rows not yet rolled up (`analysis_aggregated_at
 *     IS NULL`), for BOTH sides of the board.
 *   · Finished `computer_games` rows not yet rolled up.
 *   The second and third sets are disjoint from the first by that marker, so a
 *   game is counted exactly once whether or not the nightly job has run.
 *
 * Puzzles
 *   · `puzzle_attempts` joined to `puzzles`. "Solved" is COUNT(DISTINCT
 *     puzzle_id) over correct attempts, so replaying the same puzzle cannot
 *     inflate the count. Difficulty weights: Easy 0.6, Medium 1.0, Hard 1.4.
 *
 * Attendance
 *   · `attendance` rows joined to `classes` (cancelled classes excluded).
 *     Present and late both count as attended; the percentage is over every
 *     marked row, so skipped classes count against it.
 *
 * Streak / consistency
 *   · Distinct ACTIVE DAYS across games, puzzles and attended classes. A day
 *     of any one activity keeps the streak alive; it is never counted twice.
 *
 * ── Normalisation and weights ──────────────────────────────────────────────
 *
 * Each metric is normalised to 0..1 against a fixed cap, then multiplied by
 * its weight. The caps stop a marathon player from burying everyone on volume
 * alone, and no single weight exceeds 20 of the 100 available points.
 *
 *   games played .......... min(games, 100) / 100                × 20
 *   win rate .............. (wins + ½·draws + 1) / (decided + 2) × 15
 *   attendance ............ attended / marked                    × 15
 *   puzzles solved ........ min(weighted solved, 60) / 60        × 20
 *   puzzle accuracy ....... (correct + 1) / (attempts + 2)       × 10
 *   active-day streak ..... min(streak, 30) / 30                 × 10
 *   consistency ........... ½·regularity + ½·balance              × 10
 *
 *   regularity = min(active days in the last 30, 20) / 20
 *   balance    = 3 × min(game days, puzzle days, class days) / total days
 *                (0 when the student had no activity in the window)
 *
 * The +1/+2 smoothing on win rate and puzzle accuracy keeps a 1-game wonder
 * from outranking a season-long record; it is applied to the SCORE only, while
 * the UI shows the raw win % and accuracy.
 *
 * Weights can be overridden with the CHAMPION_WEIGHTS environment variable, a
 * JSON object of the same keys. Overrides are normalised back to 100 points so
 * the top score always means "perfect on every metric".
 */

const DEFAULT_WEIGHTS = Object.freeze({
  games: 20,
  winRate: 15,
  attendance: 15,
  puzzles: 20,
  puzzleAccuracy: 10,
  streak: 10,
  consistency: 10,
});

const CAPS = Object.freeze({
  games: 100,
  puzzlesWeighted: 60,
  streakDays: 30,
  consistencyDays: 20,
});

const DIFFICULTY_WEIGHT = Object.freeze({ easy: 0.6, medium: 1, hard: 1.4 });

/* Longest window the activity query looks back. It bounds both the streak and
   the size of the day set returned to Node. */
const ACTIVITY_WINDOW_DAYS = 365;
const CONSISTENCY_WINDOW_DAYS = 30;

function round1(n) {
  return Math.round(n * 10) / 10;
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeWeights(raw) {
  const merged = { ...DEFAULT_WEIGHTS };
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(DEFAULT_WEIGHTS)) {
      const value = Number(raw[key]);
      if (Number.isFinite(value) && value >= 0) merged[key] = value;
    }
  }
  const total = Object.values(merged).reduce((sum, n) => sum + n, 0);
  if (!total) return { ...DEFAULT_WEIGHTS };
  const scaled = {};
  for (const key of Object.keys(merged)) scaled[key] = round1((merged[key] / total) * 100);
  return scaled;
}

function weightsFromEnv() {
  const raw = process.env.CHAMPION_WEIGHTS;
  if (!raw) return { ...DEFAULT_WEIGHTS };
  try {
    return normalizeWeights(JSON.parse(raw));
  } catch (err) {
    console.warn('[champion] CHAMPION_WEIGHTS is not valid JSON, using defaults:', err.message);
    return { ...DEFAULT_WEIGHTS };
  }
}

/* Day helpers — dates arrive as 'YYYY-MM-DD' strings (to_char in SQL) so they
   are never shifted by the driver's local-time DATE parsing. */
function dayIndex(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return null;
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function localTodayIso() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function emptyDays() {
  return { game: new Set(), puzzle: new Set(), class: new Set() };
}

/** Build the ranking. `hidePrivate` follows the caller's audience: the public
 *  board omits students who opted out, the coach view includes them. */
async function champions({ hidePrivate = true, limit = 1000 } = {}) {
  const hideClause = hidePrivate ? 'AND s.hide_from_leaderboard = FALSE' : '';

  const [baseR, rollupR, onlineR, computerR, puzzleR, attendanceR, activityR] = await Promise.all([
    db.query(
      `SELECT s.id AS student_id, u.id AS user_id, u.name, u.avatar_config, u.profile_image,
              g.name AS group_name
       FROM students s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN groups g ON g.id = s.group_id
       WHERE u.role = 'student' AND s.active = TRUE ${hideClause}
       ORDER BY u.name ASC`
    ),

    /* Finished games already rolled up by the cleanup job. */
    db.query(
      `SELECT student_user_id AS user_id,
              COALESCE(SUM(games), 0)::int AS games,
              COALESCE(SUM(wins), 0)::int AS wins,
              COALESCE(SUM(losses), 0)::int AS losses,
              COALESCE(SUM(draws), 0)::int AS draws
       FROM student_game_analysis
       GROUP BY student_user_id`
    ),

    /* Finished online games the job has not rolled up yet — both sides. The
       side that is not the creator sees the mirrored result. Abandoned games
       still count as "played" (matching the rollup) but not as wins/losses. */
    db.query(
      `WITH sides AS (
         SELECT og.student_id AS user_id,
                (og.result = CASE WHEN og.admin_color = 'white' THEN 'black' ELSE 'white' END) AS win,
                (og.result = 'draw') AS draw,
                (og.result IN ('white','black')
                  AND og.result <> CASE WHEN og.admin_color = 'white' THEN 'black' ELSE 'white' END) AS loss
         FROM online_games og
         WHERE og.status = 'finished' AND og.analysis_aggregated_at IS NULL
           AND og.student_id IS NOT NULL
         UNION ALL
         SELECT og.admin_id,
                (og.result = og.admin_color),
                (og.result = 'draw'),
                (og.result IN ('white','black') AND og.result <> og.admin_color)
         FROM online_games og
         WHERE og.status = 'finished' AND og.analysis_aggregated_at IS NULL
           AND og.admin_id IS NOT NULL
       )
       SELECT user_id,
              COUNT(*)::int AS games,
              COUNT(*) FILTER (WHERE win)::int AS wins,
              COUNT(*) FILTER (WHERE draw)::int AS draws,
              COUNT(*) FILTER (WHERE loss)::int AS losses
       FROM sides
       GROUP BY user_id`
    ),

    /* Finished computer games not yet rolled up. */
    db.query(
      `SELECT student_user_id AS user_id,
              COUNT(*)::int AS games,
              COUNT(*) FILTER (WHERE result = player_color)::int AS wins,
              COUNT(*) FILTER (WHERE result = 'draw')::int AS draws,
              COUNT(*) FILTER (WHERE result IS NOT NULL
                                AND result <> player_color AND result <> 'draw')::int AS losses
       FROM computer_games
       WHERE status = 'finished' AND analysis_aggregated_at IS NULL
       GROUP BY student_user_id`
    ),

    /* Puzzle effort. Solved is DISTINCT so replays cannot inflate it. */
    db.query(
      `SELECT pa.student_id,
              COUNT(*)::int AS attempts,
              COUNT(*) FILTER (WHERE pa.result = 'correct')::int AS correct,
              COUNT(DISTINCT pa.puzzle_id) FILTER (WHERE pa.result = 'correct')::int AS solved,
              COUNT(DISTINCT pa.puzzle_id) FILTER (
                WHERE pa.result = 'correct' AND LOWER(COALESCE(p.difficulty, 'medium')) = 'easy'
              )::int AS solved_easy,
              COUNT(DISTINCT pa.puzzle_id) FILTER (
                WHERE pa.result = 'correct' AND LOWER(COALESCE(p.difficulty, 'medium')) = 'medium'
              )::int AS solved_medium,
              COUNT(DISTINCT pa.puzzle_id) FILTER (
                WHERE pa.result = 'correct' AND LOWER(COALESCE(p.difficulty, 'medium')) = 'hard'
              )::int AS solved_hard
       FROM puzzle_attempts pa
       JOIN puzzles p ON p.id = pa.puzzle_id
       GROUP BY pa.student_id`
    ),

    db.query(
      `SELECT a.student_id,
              COUNT(*)::int AS marked,
              COUNT(*) FILTER (WHERE a.status IN ('present','late'))::int AS attended
       FROM attendance a
       JOIN classes c ON c.id = a.class_id
       WHERE a.status IN ('present','late','absent')
         AND c.status <> 'cancelled'
       GROUP BY a.student_id`
    ),

    /* Every active day in the window, tagged with the area that caused it.
       Game days come from the permanent rollups plus games not yet rolled up,
       so deleting old raw online rows never shortens a streak. */
    db.query(
      `WITH activity AS (
         SELECT student_user_id AS user_id, period_start AS day, 'game'::text AS area
         FROM student_game_analysis
         WHERE period_start >= CURRENT_DATE - $1::int

         UNION ALL
         SELECT og.student_id, og.updated_at::date, 'game'
         FROM online_games og
         WHERE og.status = 'finished' AND og.analysis_aggregated_at IS NULL
           AND og.student_id IS NOT NULL
           AND og.updated_at >= CURRENT_DATE - $1::int

         UNION ALL
         SELECT og.admin_id, og.updated_at::date, 'game'
         FROM online_games og
         WHERE og.status = 'finished' AND og.analysis_aggregated_at IS NULL
           AND og.admin_id IS NOT NULL
           AND og.updated_at >= CURRENT_DATE - $1::int

         UNION ALL
         SELECT cg.student_user_id, cg.created_at::date, 'game'
         FROM computer_games cg
         WHERE cg.status = 'finished' AND cg.analysis_aggregated_at IS NULL
           AND cg.created_at >= CURRENT_DATE - $1::int

         UNION ALL
         SELECT st.user_id, pa.attempted_at::date, 'puzzle'
         FROM puzzle_attempts pa
         JOIN students st ON st.id = pa.student_id
         WHERE pa.attempted_at >= CURRENT_DATE - $1::int

         UNION ALL
         SELECT st.user_id, c.class_date, 'class'
         FROM attendance a
         JOIN classes c ON c.id = a.class_id
         JOIN students st ON st.id = a.student_id
         WHERE a.status IN ('present','late')
           AND c.class_date >= CURRENT_DATE - $1::int
       )
       SELECT DISTINCT user_id, to_char(day, 'YYYY-MM-DD') AS day, area
       FROM activity
       WHERE user_id IS NOT NULL`
      , [ACTIVITY_WINDOW_DAYS]
    ),
  ]);

  const gamesBy = new Map();
  for (const row of rollupR.rows) {
    gamesBy.set(row.user_id, { games: row.games, wins: row.wins, losses: row.losses, draws: row.draws });
  }
  for (const row of onlineR.rows) {
    const current = gamesBy.get(row.user_id) || { games: 0, wins: 0, losses: 0, draws: 0 };
    current.games += row.games;
    current.wins += row.wins;
    current.losses += row.losses;
    current.draws += row.draws;
    gamesBy.set(row.user_id, current);
  }
  for (const row of computerR.rows) {
    const current = gamesBy.get(row.user_id) || { games: 0, wins: 0, losses: 0, draws: 0 };
    current.games += row.games;
    current.wins += row.wins;
    current.losses += row.losses;
    current.draws += row.draws;
    gamesBy.set(row.user_id, current);
  }

  const puzzlesBy = new Map();
  for (const row of puzzleR.rows) {
    const easy = row.solved_easy || 0;
    const medium = row.solved_medium || 0;
    const hard = row.solved_hard || 0;
    puzzlesBy.set(row.student_id, {
      attempts: row.attempts,
      correct: row.correct,
      solved: row.solved,
      easy,
      medium,
      hard,
      weighted: easy * DIFFICULTY_WEIGHT.easy + medium * DIFFICULTY_WEIGHT.medium + hard * DIFFICULTY_WEIGHT.hard,
    });
  }

  const attendanceBy = new Map(attendanceR.rows.map((r) => [r.student_id, r]));

  const daysBy = new Map();
  for (const row of activityR.rows) {
    const idx = dayIndex(row.day);
    if (idx == null) continue;
    let entry = daysBy.get(row.user_id);
    if (!entry) {
      entry = emptyDays();
      daysBy.set(row.user_id, entry);
    }
    const bucket = entry[row.area];
    if (bucket) bucket.add(idx);
  }

  const weights = weightsFromEnv();
  const todayIdx = dayIndex(localTodayIso());
  const consistencyStart = todayIdx - (CONSISTENCY_WINDOW_DAYS - 1);

  const rows = baseR.rows.map((student) => {
    const uid = student.user_id;
    const games = gamesBy.get(uid) || { games: 0, wins: 0, losses: 0, draws: 0 };
    const puzzles = puzzlesBy.get(student.student_id) || {
      attempts: 0, correct: 0, solved: 0, easy: 0, medium: 0, hard: 0, weighted: 0,
    };
    const att = attendanceBy.get(student.student_id) || { marked: 0, attended: 0 };
    const days = daysBy.get(uid) || emptyDays();

    /* Streak: consecutive distinct active days ending today (or yesterday, so
       the number does not drop to zero before the student has played today). */
    const allDays = new Set([...days.game, ...days.puzzle, ...days.class]);
    let cursor = allDays.has(todayIdx) ? todayIdx : todayIdx - 1;
    let streak = 0;
    while (allDays.has(cursor)) {
      streak += 1;
      cursor -= 1;
    }

    const recent = (set) => {
      let n = 0;
      for (const idx of set) if (idx >= consistencyStart) n += 1;
      return n;
    };
    const gameDays = recent(days.game);
    const puzzleDays = recent(days.puzzle);
    const classDays = recent(days.class);
    const activeDays30 = gameDays + puzzleDays + classDays === 0
      ? 0
      : new Set(
        [...days.game, ...days.puzzle, ...days.class].filter((idx) => idx >= consistencyStart)
      ).size;

    const regularity = Math.min(activeDays30, CAPS.consistencyDays) / CAPS.consistencyDays;
    const areaTotal = gameDays + puzzleDays + classDays;
    const balance = areaTotal > 0
      ? clamp01((3 * Math.min(gameDays, puzzleDays, classDays)) / areaTotal)
      : 0;
    const consistencyNorm = clamp01(0.5 * regularity + 0.5 * balance);

    const decided = games.wins + games.losses + games.draws;
    const winRateRaw = decided > 0 ? games.wins / decided : 0;
    const winRateNorm = decided > 0
      ? clamp01((games.wins + 0.5 * games.draws + 1) / (decided + 2))
      : 0;

    const attendanceNorm = att.marked > 0 ? clamp01(att.attended / att.marked) : 0;
    const puzzleVolumeNorm = clamp01(puzzles.weighted / CAPS.puzzlesWeighted);
    const puzzleAccuracyNorm = puzzles.attempts > 0
      ? clamp01((puzzles.correct + 1) / (puzzles.attempts + 2))
      : 0;
    const streakNorm = clamp01(streak / CAPS.streakDays);

    const breakdown = {
      games: round1(weights.games * clamp01(games.games / CAPS.games)),
      winRate: round1(weights.winRate * winRateNorm),
      attendance: round1(weights.attendance * attendanceNorm),
      puzzles: round1(weights.puzzles * puzzleVolumeNorm),
      puzzleAccuracy: round1(weights.puzzleAccuracy * puzzleAccuracyNorm),
      streak: round1(weights.streak * streakNorm),
      consistency: round1(weights.consistency * consistencyNorm),
    };
    const score = round1(Object.values(breakdown).reduce((sum, n) => sum + n, 0));

    return {
      student_id: student.student_id,
      user_id: student.user_id,
      name: student.name,
      avatar_config: student.avatar_config,
      profile_image: student.profile_image,
      group_name: student.group_name,
      score,
      games: games.games,
      wins: games.wins,
      losses: games.losses,
      draws: games.draws,
      winRate: round1(winRateRaw * 100),
      attendance: att.marked > 0 ? round1((att.attended / att.marked) * 100) : null,
      attendanceMarked: att.marked,
      attendanceAttended: att.attended,
      puzzlesSolved: puzzles.solved,
      puzzlesWeighted: round1(puzzles.weighted),
      puzzleAttempts: puzzles.attempts,
      puzzleCorrect: puzzles.correct,
      puzzleAccuracy: puzzles.attempts > 0 ? round1((puzzles.correct / puzzles.attempts) * 100) : null,
      puzzleDifficulty: { easy: puzzles.easy, medium: puzzles.medium, hard: puzzles.hard },
      streak,
      activeDays30,
      consistency: round1(consistencyNorm * 100),
      breakdown,
    };
  });

  rows.sort((a, b) => (
    b.score - a.score
    || b.winRate - a.winRate
    || (b.wins + b.losses + b.draws) - (a.wins + a.losses + a.draws)
    || a.name.localeCompare(b.name)
  ));

  const ranked = rows.slice(0, Math.max(1, limit)).map((row, i) => ({ rank: i + 1, ...row }));

  return {
    rows: ranked,
    weights,
    caps: CAPS,
    scoringVersion: 1,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  champions,
  DEFAULT_WEIGHTS,
  CAPS,
  DIFFICULTY_WEIGHT,
  ACTIVITY_WINDOW_DAYS,
  CONSISTENCY_WINDOW_DAYS,
};
