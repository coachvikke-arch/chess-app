const db = require('../config/database');
const tournamentLogic = require('./tournamentLogic');

/*
 * Performance Report data.
 *
 * One endpoint assembles the whole screen (summary, insights, weekly chart,
 * rating, sessions, puzzle assignments, tournaments and remarks) so every card
 * is derived from the SAME from/to window. Nothing here is client-filtered.
 *
 * Two id spaces matter throughout this file:
 *   students.id  — attendance, puzzle attempts, assignments, rating history
 *   users.id     — tournament registrations and pairings
 * The bridge is students.user_id. Mixing them silently produces empty
 * tournaments, so the tournament queries join on it explicitly.
 */

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const num = (v) => Number(v) || 0;
const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);

const TOPIC_SQL = `COALESCE(NULLIF(p.theme, ''), NULLIF(p.themes[1], ''), 'General')`;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/** Last 30 days including today — the report's default filter. */
function defaultRange() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: iso(from), to: iso(to) };
}

function parseRange(query = {}) {
  const fallback = defaultRange();
  const valid = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
  const from = valid(query.from) ? query.from : fallback.from;
  const to = valid(query.to) ? query.to : fallback.to;
  if (from > to) throw badRequest('From date must be on or before To date.');
  return { from, to };
}

/* Missing optional subsystems (tournaments, per-time-control ratings) must
   never take the whole report down — an older database simply shows an empty
   section, exactly as the screen's empty state says. */
function isMissingSchema(err) {
  return /does not exist|relation .* not found/i.test(err?.message || '');
}

async function optionalQuery(sql, params = []) {
  try {
    return await db.query(sql, params);
  } catch (err) {
    if (isMissingSchema(err)) return { rows: [] };
    throw err;
  }
}

/* ── remarks table ──────────────────────────────────────────────────────── */

const REMARKS_DDL = `
  CREATE TABLE IF NOT EXISTS performance_report_remarks (
    id            SERIAL PRIMARY KEY,
    student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    period_start  DATE NOT NULL,
    period_end    DATE NOT NULL,
    text          TEXT NOT NULL DEFAULT '',
    updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_performance_report_remarks_period
      UNIQUE (student_id, period_start, period_end)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_performance_report_remarks_period
    ON performance_report_remarks (student_id, period_start, period_end)`;

let remarksReady = null;
function ensureRemarksSchema() {
  if (!remarksReady) {
    remarksReady = db.query(REMARKS_DDL).catch((err) => {
      remarksReady = null;
      throw err;
    });
  }
  return remarksReady;
}

async function getRemarks(studentId, from, to) {
  await ensureRemarksSchema();
  const r = await db.query(
    `SELECT r.text, r.updated_at, u.name AS updated_by
       FROM performance_report_remarks r
       LEFT JOIN users u ON u.id = r.updated_by
      WHERE r.student_id = $1 AND r.period_start = $2::date AND r.period_end = $3::date`,
    [studentId, from, to]
  );
  const row = r.rows[0];
  return row
    ? { text: row.text || '', updatedAt: row.updated_at, updatedBy: row.updated_by || '' }
    : { text: '', updatedAt: null, updatedBy: '' };
}

async function saveRemarks({ studentId, from, to, text, userId }) {
  await ensureRemarksSchema();
  await db.query(
    `INSERT INTO performance_report_remarks (student_id, period_start, period_end, text, updated_by, updated_at)
     VALUES ($1, $2::date, $3::date, $4, $5, NOW())
     ON CONFLICT (student_id, period_start, period_end)
     DO UPDATE SET text = EXCLUDED.text, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [studentId, from, to, text, userId]
  );
  return getRemarks(studentId, from, to);
}

/* ── sessions ───────────────────────────────────────────────────────────── */

function classDurationMinutes(row) {
  const at = (value) => (value ? new Date(value) : null);
  const start = at(row.started_at) || (row.start_time && row.class_date ? at(`${row.class_date}T${row.start_time}`) : null);
  const end = at(row.ended_at) || (row.end_time && row.class_date ? at(`${row.class_date}T${row.end_time}`) : null);
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

async function getSessions(studentId, groupId, from, to) {
  const r = await db.query(
    `SELECT cl.id, cl.title, to_char(cl.class_date, 'YYYY-MM-DD') AS scheduled,
            cl.class_date, cl.start_time, cl.end_time,
            cl.started_at, cl.ended_at, cu.name AS coach_name,
            COALESCE(att.status, 'absent') AS attendance
       FROM classes cl
       LEFT JOIN users cu ON cu.id = cl.coach_id
       LEFT JOIN attendance att ON att.class_id = cl.id AND att.student_id = $2
      WHERE cl.status = 'completed'
        AND cl.class_date::date BETWEEN $3::date AND $4::date
        AND (
          EXISTS (SELECT 1 FROM class_students cs WHERE cs.class_id = cl.id AND cs.student_id = $2)
          OR (
            NOT EXISTS (SELECT 1 FROM class_students WHERE class_id = cl.id)
            AND (cl.group_id IS NULL OR cl.group_id = $1)
          )
        )
      ORDER BY cl.class_date DESC, cl.start_time DESC`,
    [groupId, studentId, from, to]
  );

  const rows = r.rows.map((row, i) => ({
    sNo: i + 1,
    session: row.title || 'Class',
    coach: row.coach_name || '—',
    scheduled: row.scheduled,
    attended: row.attendance === 'present' || row.attendance === 'late',
    attendance: row.attendance === 'present' || row.attendance === 'late' ? 'Present' : 'Absent',
    durationMinutes: classDurationMinutes(row),
  }));
  const attended = rows.filter((x) => x.attended);
  return {
    scheduled: rows.length,
    attended: attended.length,
    durationMinutes: attended.reduce((sum, x) => sum + x.durationMinutes, 0),
    rows,
  };
}

/* ── quiz (puzzle assignments only) ────────────────────────────────────── */

async function getQuiz(studentId, from, to) {
  const r = await db.query(
    `SELECT p.id AS puzzle_id, ${TOPIC_SQL} AS topic, pa.assigned_at,
            EXISTS (
              SELECT 1 FROM puzzle_attempts a
              WHERE a.student_id = $1 AND a.puzzle_id = pa.puzzle_id
                AND a.attempted_at::date BETWEEN $2::date AND $3::date
            ) AS attempted,
            EXISTS (
              SELECT 1 FROM puzzle_attempts a
              WHERE a.student_id = $1 AND a.puzzle_id = pa.puzzle_id
                AND a.result = 'correct'
                AND a.attempted_at::date BETWEEN $2::date AND $3::date
            ) AS solved,
            COALESCE((
              SELECT MAX(COALESCE(a.points_earned, a.score, 0))::int
                FROM puzzle_attempts a
               WHERE a.student_id = $1 AND a.puzzle_id = pa.puzzle_id
                 AND a.result = 'correct'
                 AND a.attempted_at::date BETWEEN $2::date AND $3::date
            ), 0) AS points
       FROM puzzle_assignments pa
       JOIN puzzles p ON p.id = pa.puzzle_id
      WHERE pa.student_id = $1
        AND pa.assigned_at::date BETWEEN $2::date AND $3::date
      ORDER BY topic ASC, pa.assigned_at DESC`,
    [studentId, from, to]
  );

  const byTopic = new Map();
  for (const row of r.rows) {
    const key = row.topic || 'General';
    if (!byTopic.has(key)) byTopic.set(key, { topic: key, assigned: 0, attempted: 0, solved: 0, points: 0 });
    const t = byTopic.get(key);
    t.assigned += 1;
    if (row.attempted) t.attempted += 1;
    if (row.solved) t.solved += 1;
    t.points += num(row.points);
  }

  const rows = [...byTopic.values()]
    .sort((a, b) => a.topic.localeCompare(b.topic))
    .map((t, i) => ({
      sNo: i + 1,
      ...t,
      progress: pct(t.solved, t.assigned),
      accuracy: pct(t.solved, t.attempted),
    }));

  const total = rows.reduce((acc, t) => ({
    topics: acc.topics + 1,
    assigned: acc.assigned + t.assigned,
    attempted: acc.attempted + t.attempted,
    solved: acc.solved + t.solved,
    points: acc.points + t.points,
  }), { topics: 0, assigned: 0, attempted: 0, solved: 0, points: 0 });

  return { ...total, rows };
}

async function getClassAveragePoints(from, to) {
  const r = await optionalQuery(
    `SELECT COALESCE(AVG(best.points), 0) AS average
       FROM (
         SELECT a.student_id, a.puzzle_id,
                MAX(COALESCE(a.points_earned, a.score, 0))::numeric AS points
           FROM puzzle_attempts a
          WHERE a.result = 'correct'
            AND a.attempted_at::date BETWEEN $1::date AND $2::date
          GROUP BY a.student_id, a.puzzle_id
       ) best`,
    [from, to]
  );
  return Math.round(num(r.rows[0]?.average) * 10) / 10;
}

/* ── weekly solved + streak ────────────────────────────────────────────── */

function startOfWeek(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7; // Monday
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function buildWeeklySolved(attempts, from, to) {
  const counts = new Map();
  for (const a of attempts) {
    const key = startOfWeek(iso(new Date(a.attempted_at)));
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const out = [];
  const cursor = new Date(`${startOfWeek(from)}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end && out.length < 260) {
    const key = cursor.toISOString().slice(0, 10);
    out.push({
      weekStart: key,
      label: cursor.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }),
      value: counts.get(key) || 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return out;
}

function longestSolvingStreak(attempts, from, to) {
  const days = new Set(attempts.map((a) => iso(new Date(a.attempted_at))));
  if (days.size === 0) return { days: 0, from: null, to: null };
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  let best = 0;
  let current = 0;
  let bestStart = null;
  let runStart = null;
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    if (days.has(key)) {
      if (current === 0) runStart = key;
      current += 1;
      if (current > best) { best = current; bestStart = runStart; }
    } else {
      current = 0;
      runStart = null;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const last = bestStart ? new Date(`${bestStart}T00:00:00Z`) : null;
  if (last && best > 1) last.setUTCDate(last.getUTCDate() + best - 1);
  return { days: best, from: bestStart, to: last ? last.toISOString().slice(0, 10) : null };
}

async function getCorrectAttempts(studentId, from, to) {
  const r = await db.query(
    `SELECT a.attempted_at, a.puzzle_id, ${TOPIC_SQL} AS topic,
            COALESCE(a.points_earned, a.score, 0) AS points
       FROM puzzle_attempts a
       JOIN puzzles p ON p.id = a.puzzle_id
      WHERE a.student_id = $1
        AND a.result = 'correct'
        AND a.attempted_at::date BETWEEN $2::date AND $3::date
      ORDER BY a.attempted_at ASC`,
    [studentId, from, to]
  );
  return r.rows;
}

/* ── rating ─────────────────────────────────────────────────────────────── */

async function getRating(studentId, from, to) {
  /* Read the range straight from the history table. ratingService.buildProfile()
     still caps `rapidHistory` at 60 rows, so using it here would report the wrong
     starting rating whenever a long window contains more than 60 Rapid games. */
  const [historyRes, poolRes] = await Promise.all([
    optionalQuery(
      `SELECT rating_before, rating_after, played_at
         FROM time_control_rating_history
        WHERE student_id = $1
          AND time_class = 'rapid'
          AND played_at >= $2::date
          AND played_at < ($3::date + 1)
        ORDER BY played_at ASC`,
      [studentId, from, to]
    ),
    optionalQuery(
      `SELECT rating
         FROM student_time_ratings
        WHERE student_id = $1 AND time_class = 'rapid'`,
      [studentId]
    ),
  ]);

  /* No Rapid pool row means the student has never played Rapid — the profile
     API also falls back to the legacy current_rating for the displayed number. */
  let current = poolRes.rows[0]?.rating == null ? null : num(poolRes.rows[0].rating);
  if (current == null) {
    const legacy = await optionalQuery(
      `SELECT current_rating FROM students WHERE id = $1`,
      [studentId]
    );
    current = num(legacy.rows[0]?.current_rating) || 1000;
  }

  const sorted = historyRes.rows.slice().sort((a, b) => new Date(a.played_at) - new Date(b.played_at));
  const start = sorted.length ? num(sorted[0].rating_before ?? sorted[0].rating_after) : current;
  const end = sorted.length ? num(sorted[sorted.length - 1].rating_after) : current;

  /* Same ordering as the Rapid leaderboard's base query: private students are
     excluded, an unrated student sorts last, ties break on games then name, and
     ROW_NUMBER gives each position once (not a competition rank shared by ties). */
  let rank = null;
  try {
    const r = await db.query(
      `SELECT rn.leaderboard_rank AS rank
         FROM (
           SELECT s.id AS student_id,
                  CAST(ROW_NUMBER() OVER (
                    ORDER BY rt.rating DESC NULLS LAST,
                             rt.games_played DESC NULLS LAST,
                             u.name ASC
                  ) AS integer) AS leaderboard_rank
             FROM students s
             JOIN users u ON u.id = s.user_id
             LEFT JOIN student_time_ratings rt
               ON rt.student_id = s.id AND rt.time_class = 'rapid'
            WHERE s.hide_from_leaderboard = FALSE
         ) rn
        WHERE rn.student_id = $1`,
      [studentId]
    );
    rank = r.rows[0]?.rank == null ? null : num(r.rows[0].rank) || null;
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    /* Older databases have only the legacy current_rating mirror. */
    const r = await optionalQuery(
      `SELECT rn.leaderboard_rank AS rank
         FROM (
           SELECT s.id AS student_id,
                  CAST(ROW_NUMBER() OVER (
                    ORDER BY s.current_rating DESC NULLS LAST, u.name ASC
                  ) AS integer) AS leaderboard_rank
             FROM students s
             JOIN users u ON u.id = s.user_id
            WHERE s.hide_from_leaderboard = FALSE
         ) rn
        WHERE rn.student_id = $1`,
      [studentId]
    );
    rank = r.rows[0]?.rank == null ? null : num(r.rows[0].rank) || null;
  }

  return { start, end, change: end - start, rank, gamesInRange: sorted.length };
}

/* ── tournaments ────────────────────────────────────────────────────────── */

async function getTournaments(userId, from, to) {
  const res = await optionalQuery(
    `SELECT t.id, t.name, t.format, t.rounds, t.current_round,
            COALESCE(t.completed_at, t.end_time, t.updated_at, t.created_at) AS played_at
       FROM tournaments t
       JOIN tournament_registrations tr ON tr.tournament_id = t.id
      WHERE tr.student_id = $1
        AND t.status = 'completed'
        AND COALESCE(t.completed_at, t.end_time, t.updated_at, t.created_at)::date BETWEEN $2::date AND $3::date
      ORDER BY played_at DESC`,
    [userId, from, to]
  );

  const rows = [];
  for (const t of res.rows) {
    const [playersRes, pairingsRes] = await Promise.all([
      optionalQuery(
        `SELECT u.id, u.name, COALESCE(s.current_rating, 1000)::int AS rating, tr.seed
           FROM tournament_registrations tr
           JOIN users u ON u.id = tr.student_id
           LEFT JOIN students s ON s.user_id = u.id
          WHERE tr.tournament_id = $1`,
        [t.id]
      ),
      optionalQuery('SELECT * FROM tournament_pairings WHERE tournament_id = $1', [t.id]),
    ]);
    const standings = tournamentLogic.computeStandings(t.format, playersRes.rows, pairingsRes.rows, {
      totalRounds: t.format === 'knockout' ? t.rounds : null,
    });
    const mine = standings.find((s) => String(s.playerId) === String(userId));
    rows.push({
      sNo: rows.length + 1,
      tournament: t.name || `Tournament #${t.id}`,
      playedOn: t.played_at ? iso(new Date(t.played_at)) : '—',
      wins: num(mine?.wins),
      drawn: num(mine?.draws),
      lost: num(mine?.losses),
      position: num(mine?.games) > 0 ? num(mine?.rank) || null : null,
    });
  }

  const total = rows.reduce((acc, r) => ({
    played: acc.played + 1,
    wins: acc.wins + r.wins,
    drawn: acc.drawn + r.drawn,
    lost: acc.lost + r.lost,
  }), { played: 0, wins: 0, drawn: 0, lost: 0 });
  const ranked = rows.map((r) => r.position).filter((p) => Number.isInteger(p) && p > 0);
  return { ...total, bestFinish: ranked.length ? Math.min(...ranked) : null, rows };
}

/* ── top-level assembly ────────────────────────────────────────────────── */

async function buildReport({ studentId, from, to }) {
  const profileRes = await db.query(
    `SELECT s.id, s.group_id, s.user_id, u.name
       FROM students s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1`,
    [studentId]
  );
  const profile = profileRes.rows[0];
  if (!profile) return null;

  const [
    sessions,
    quiz,
    attempts,
    classAverage,
    tournaments,
    rating,
    remarks,
  ] = await Promise.all([
    getSessions(studentId, profile.group_id, from, to),
    getQuiz(studentId, from, to),
    getCorrectAttempts(studentId, from, to),
    getClassAveragePoints(from, to),
    getTournaments(profile.user_id, from, to),
    getRating(studentId, from, to),
    getRemarks(studentId, from, to),
  ]);

  const solved = quiz.solved;
  const pointsPerSolved = solved > 0 ? Math.round((quiz.points / solved) * 10) / 10 : 0;
  const withAttempts = quiz.rows.filter((r) => r.attempted > 0);
  const best = quiz.rows.slice().sort((a, b) => b.solved - a.solved || b.accuracy - a.accuracy)[0];
  const needs = withAttempts.slice().sort((a, b) => a.accuracy - b.accuracy || b.attempted - a.attempted)[0];
  const streak = longestSolvingStreak(attempts, from, to);

  return {
    student: { id: profile.id, name: profile.name },
    from,
    to,
    summary: {
      classes: {
        scheduled: sessions.scheduled,
        attended: sessions.attended,
        attendancePct: pct(sessions.attended, sessions.scheduled),
      },
      learningTimeMinutes: sessions.durationMinutes,
      puzzles: {
        solved,
        attempted: quiz.attempted,
        solvedPct: pct(solved, quiz.attempted),
        points: quiz.points,
      },
      tournaments: {
        played: tournaments.played,
        bestFinish: tournaments.bestFinish,
      },
    },
    insights: {
      bestTopic: best && best.solved > 0 ? best : null,
      needsPractice: needs || null,
      pointsPerSolved: { value: pointsPerSolved, classAverage },
      solvingStreak: streak,
    },
    weeklySolved: buildWeeklySolved(attempts, from, to),
    rating,
    sessions,
    quiz,
    tournaments,
    remarks,
  };
}

module.exports = {
  parseRange,
  defaultRange,
  buildReport,
  saveRemarks,
};
