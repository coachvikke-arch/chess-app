const db = require('../config/database');
const rating = require('./ratingService');
const champion = require('./overallChampionService');

/* ── Student-vs-student comparison ──────────────────────────────────────────
 *
 * Builds the two player cards and the head-to-head record for the Leaderboard
 * "Compare" sheet. Every number is a public chess/academy statistic; nothing
 * here reads an email, phone, password or any other account detail.
 *
 * WHERE EACH STAT COMES FROM, AND WHY
 *
 *   rank / rapid rating / peak / games .... `student_time_ratings` (rapid pool),
 *       ranked with the SAME ordering `ratingService.leaderboard()` uses, so the
 *       rank in the sheet is the rank on the board rather than a second number
 *       that can drift.
 *
 *   games / wins / losses / draws / win % / puzzles solved / puzzle accuracy /
 *   active-day streak .... `overallChampionService.champions()`, reused as-is.
 *       That function already reconciles the permanent per-day rollups with the
 *       not-yet-rolled-up games, so the sheet and the Overall Champion board can
 *       never disagree about how many games someone has played.
 *
 *   puzzle points .... `puzzle_attempts.score` (the same "Puzzle Rush" number
 *       the Leaderboard's Puzzle tab ranks by).
 *
 *   accuracy .... average of the player's OWN side across finished Stockfish
 *       reviews (`game_stockfish_analysis`). Null when they have no reviewed
 *       game — the sheet renders "—", never a fake 0%.
 *
 *   recent form / current streak / head-to-head .... `rating_history`.
 *       This is the only permanent per-opponent record: raw `online_games` rows
 *       are deleted by the daily cleanup after the retention window, so a
 *       head-to-head built from them would silently shrink to the last week.
 *       `rating_history` keeps one row per player per rated game forever, with
 *       the opponent's student id and the result from that player's side.
 *       Colour played is only known while the raw game row still exists, so it
 *       is returned when available and null otherwise.
 */

const FORM_SIZE = 5;
/* Enough history to compute an exact current streak; the oldest games beyond
   this only affect a streak longer than 200, which is displayed as "200+". */
const HISTORY_WINDOW = 200;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function outcomeOf(result) {
  if (result === 'win') return 'W';
  if (result === 'loss') return 'L';
  if (result === 'draw') return 'D';
  return null;
}

/** The colour the owned side played, when the raw game row still exists. */
function colourFor(row, ownerUserId) {
  if (!row || !row.admin_color || row.admin_id == null) return null;
  if (Number(row.admin_id) === Number(ownerUserId)) return row.admin_color;
  return row.admin_color === 'white' ? 'black' : 'white';
}

/** Consecutive identical results from the newest game. A draw ends both a win
 *  and a loss streak, so it reports no streak at all. */
function currentStreak(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  const first = outcomeOf(history[0]?.result);
  if (first !== 'W' && first !== 'L') return null;
  let count = 0;
  for (const row of history) {
    if (outcomeOf(row?.result) !== first) break;
    count += 1;
  }
  return { type: first, count };
}

function formOf(history, ownerUserId) {
  return (history || []).slice(0, FORM_SIZE).map((row) => ({
    id: row.online_game_id ?? null,
    date: row.played_at,
    result: outcomeOf(row.result),
    color: colourFor(row, ownerUserId),
  }));
}

/** Head-to-head from the viewer's own rating_history rows. One row per game, so
 *  counting the rows counts the games exactly once. */
function summariseHeadToHead(rows, viewerUserId) {
  let myWins = 0;
  let opponentWins = 0;
  let draws = 0;
  for (const row of rows || []) {
    const outcome = outcomeOf(row.result);
    if (outcome === 'W') myWins += 1;
    else if (outcome === 'L') opponentWins += 1;
    else if (outcome === 'D') draws += 1;
  }
  const total = myWins + opponentWins + draws;
  return {
    total,
    myWins,
    opponentWins,
    draws,
    winRate: total ? Math.round((myWins / total) * 1000) / 10 : 0,
    lastGames: (rows || []).slice(0, FORM_SIZE).map((row) => ({
      id: row.online_game_id ?? null,
      date: row.played_at,
      result: outcomeOf(row.result),
      color: colourFor(row, viewerUserId),
    })),
  };
}

function levelOf(rapidRating) {
  const l = rating.levelForRating(rapidRating ?? rating.STARTING_RATING);
  return {
    number: l.level,
    tier: l.name,
    badge: l.badge,
    icon: rating.BADGE_ICONS[l.level] || '♟',
  };
}

function earnedBadge(highestLevel) {
  const clamped = Math.max(1, Math.min(rating.LEVELS.length, Number(highestLevel) || 1));
  const l = rating.LEVELS[clamped - 1];
  return {
    level: l.level,
    name: l.badge,
    tier: l.name,
    icon: rating.BADGE_ICONS[l.level] || '♟',
  };
}

function buildPlayer({ student, ladderRow, champRow, points, accuracy, history }) {
  const rapidRating = ladderRow?.rapid_rating ?? null;
  const highestLevel = Math.max(
    Number(student.highest_level) || 1,
    Number(ladderRow?.rapid_highest_level) || 1,
  );
  const streak = currentStreak(history);
  return {
    user_id: student.user_id,
    student_id: student.student_id,
    name: student.name,
    profile_image: student.profile_image || null,
    avatar_config: student.avatar_config || null,
    group_name: student.group_name || null,
    rank: ladderRow?.rank ?? null,
    rapidRating,
    rapidPeakRating: ladderRow?.rapid_peak ?? null,
    rapidGames: ladderRow?.rapid_games ?? 0,
    level: levelOf(rapidRating),
    badge: earnedBadge(highestLevel),
    games: champRow?.games ?? 0,
    wins: champRow?.wins ?? 0,
    losses: champRow?.losses ?? 0,
    draws: champRow?.draws ?? 0,
    winRate: champRow?.winRate ?? 0,
    streak,
    streakCapped: Boolean(streak && history.length >= HISTORY_WINDOW && streak.count >= history.length),
    puzzlesSolved: champRow?.puzzlesSolved ?? 0,
    puzzleAccuracy: champRow?.puzzleAccuracy ?? null,
    puzzlePoints: points ?? 0,
    accuracy: accuracy ?? null,
    lastGames: formOf(history, student.user_id),
  };
}

async function compare({ viewerUserId, opponentUserId }) {
  if (!Number.isInteger(viewerUserId) || viewerUserId <= 0) {
    throw httpError(403, 'Compare is available to student accounts');
  }
  if (!Number.isInteger(opponentUserId) || opponentUserId <= 0) {
    throw httpError(400, 'Invalid opponent');
  }
  if (viewerUserId === opponentUserId) {
    throw httpError(400, 'Pick a different student');
  }

  const studentsR = await db.query(
    `SELECT s.id AS student_id, s.user_id, u.name, u.role, u.avatar_config, u.profile_image,
            s.hide_from_leaderboard, s.active, s.highest_level, g.name AS group_name
     FROM students s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN groups g ON g.id = s.group_id
     WHERE s.user_id = ANY($1::int[])`,
    [[viewerUserId, opponentUserId]],
  );
  const byUser = new Map(studentsR.rows.map((r) => [Number(r.user_id), r]));
  const me = byUser.get(viewerUserId);
  const opponent = byUser.get(opponentUserId);

  if (!me) throw httpError(403, 'Compare is available to student accounts');
  if (me.role !== 'student') throw httpError(403, 'Compare is available to student accounts');
  /* A missing, inactive, or opted-out student is one indistinguishable answer:
     the compare sheet must never reveal that an account exists but is hidden. */
  if (!opponent || opponent.role !== 'student' || opponent.active === false || opponent.hide_from_leaderboard) {
    throw httpError(404, 'Student not found');
  }

  const studentIds = [me.student_id, opponent.student_id];

  const [ladderR, pointsR, accuracyR, historyR, headToHeadR, champData] = await Promise.all([
    /* Same ordering as ratingService.leaderboard(): rapid rating first, then
       rapid games, then name. Students with no rapid rating rank below every
       rated player, exactly as the board does. */
    db.query(
      `WITH ladder AS (
         SELECT s.user_id,
                ROW_NUMBER() OVER (
                  ORDER BY rt.rating DESC NULLS LAST,
                           rt.games_played DESC NULLS LAST,
                           u.name ASC
                )::int AS rank,
                rt.rating AS rapid_rating,
                rt.peak_rating AS rapid_peak,
                rt.games_played AS rapid_games,
                rt.highest_level AS rapid_highest_level
         FROM students s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN student_time_ratings rt
           ON rt.student_id = s.id AND rt.time_class = 'rapid'
         WHERE u.role = 'student' AND s.hide_from_leaderboard = FALSE
       )
       SELECT * FROM ladder WHERE user_id = ANY($1::int[])`,
      [[viewerUserId, opponentUserId]],
    ),

    db.query(
      `SELECT pa.student_id, COALESCE(SUM(pa.score), 0)::int AS points
       FROM puzzle_attempts pa
       WHERE pa.result = 'correct' AND pa.student_id = ANY($1::int[])
       GROUP BY pa.student_id`,
      [studentIds],
    ),

    /* The player's own accuracy, averaged over reviewed games. Which side of the
       board the owner played is derived from the game row: creator's colour for
       an online game, `player_color` for a computer game. */
    db.query(
      `WITH analysed AS (
         SELECT gs.owner_user_id AS user_id,
                CASE
                  WHEN gs.game_source = 'online' AND og.admin_id = gs.owner_user_id
                    THEN CASE WHEN og.admin_color = 'white' THEN gs.accuracy_white ELSE gs.accuracy_black END
                  WHEN gs.game_source = 'online'
                    THEN CASE WHEN og.admin_color = 'white' THEN gs.accuracy_black ELSE gs.accuracy_white END
                  WHEN gs.game_source = 'computer' AND cg.player_color = 'white' THEN gs.accuracy_white
                  WHEN gs.game_source = 'computer' THEN gs.accuracy_black
                  ELSE NULL
                END AS acc
         FROM game_stockfish_analysis gs
         LEFT JOIN online_games og
           ON gs.game_source = 'online' AND og.id = gs.game_id
         LEFT JOIN computer_games cg
           ON gs.game_source = 'computer' AND cg.id = gs.game_id
         WHERE gs.status = 'done' AND gs.owner_user_id = ANY($1::int[])
       )
       SELECT user_id, ROUND(AVG(acc)::numeric, 1) AS accuracy
       FROM analysed
       WHERE acc IS NOT NULL
       GROUP BY user_id`,
      [[viewerUserId, opponentUserId]],
    /* Accuracy is the one optional metric; an analysis table that is missing or
       unreadable must leave it blank, not take the whole comparison down. */
    ).catch((err) => {
      console.warn('[leaderboard] compare accuracy unavailable:', err.message);
      return { rows: [] };
    }),

    db.query(
      `WITH recent AS (
         SELECT rh.student_id, rh.result, rh.opponent_id, rh.played_at, rh.online_game_id,
                ROW_NUMBER() OVER (
                  PARTITION BY rh.student_id ORDER BY rh.played_at DESC, rh.id DESC
                )::int AS rn
         FROM rating_history rh
         WHERE rh.student_id = ANY($1::int[])
       )
       SELECT r.student_id, r.result, r.opponent_id, r.played_at, r.online_game_id,
              s.user_id AS owner_user_id, og.admin_id, og.admin_color
       FROM recent r
       JOIN students s ON s.id = r.student_id
       LEFT JOIN online_games og ON og.id = r.online_game_id
       WHERE r.rn <= $2
       ORDER BY r.student_id, r.rn`,
      [studentIds, HISTORY_WINDOW],
    ),

    db.query(
      `SELECT rh.result, rh.played_at, rh.online_game_id,
              og.admin_id, og.admin_color
       FROM rating_history rh
       LEFT JOIN online_games og ON og.id = rh.online_game_id
       WHERE rh.student_id = $1 AND rh.opponent_id = $2
       ORDER BY rh.played_at DESC, rh.id DESC`,
      [me.student_id, opponent.student_id],
    ),

    champion.champions({ hidePrivate: false }),
  ]);

  const ladderByUser = new Map(ladderR.rows.map((r) => [Number(r.user_id), r]));
  const pointsByStudent = new Map(pointsR.rows.map((r) => [Number(r.student_id), r.points]));
  const accuracyByUser = new Map(accuracyR.rows.map((r) => [Number(r.user_id), Number(r.accuracy)]));
  const champByUser = new Map((champData.rows || []).map((r) => [Number(r.user_id), r]));

  const historyByStudent = new Map();
  for (const row of historyR.rows) {
    const key = Number(row.student_id);
    if (!historyByStudent.has(key)) historyByStudent.set(key, []);
    historyByStudent.get(key).push(row);
  }

  const meOut = buildPlayer({
    student: me,
    ladderRow: ladderByUser.get(viewerUserId),
    champRow: champByUser.get(viewerUserId),
    points: pointsByStudent.get(me.student_id),
    accuracy: accuracyByUser.get(viewerUserId),
    history: historyByStudent.get(me.student_id) || [],
  });
  const opponentOut = buildPlayer({
    student: opponent,
    ladderRow: ladderByUser.get(opponentUserId),
    champRow: champByUser.get(opponentUserId),
    points: pointsByStudent.get(opponent.student_id),
    accuracy: accuracyByUser.get(opponentUserId),
    history: historyByStudent.get(opponent.student_id) || [],
  });

  return {
    me: meOut,
    opponent: opponentOut,
    headToHead: summariseHeadToHead(headToHeadR.rows, viewerUserId),
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  compare,
  // Exported for tests: pure helpers over already-fetched rows.
  outcomeOf,
  colourFor,
  currentStreak,
  summariseHeadToHead,
  levelOf,
  earnedBadge,
};
