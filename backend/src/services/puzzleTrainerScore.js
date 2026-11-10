/* Points for the rating-level trainer, and the ladder they build.
 *
 * The feed in services/puzzleTrainer.js hands out a position and its solution
 * line; this module is what happens after the student finds it. Two tables:
 *
 *   puzzle_trainer_solves  one row per (user, puzzle) — the credit ledger. Its
 *                          composite primary key IS the idempotency rule: a
 *                          replayed or double-fired solve lands on ON CONFLICT
 *                          DO NOTHING and is answered with the totals it already
 *                          earned, never with a second award.
 *   puzzle_trainer_scores  one row per user — name, total_points, solved_count,
 *                          updated_at. The leaderboard reads only this, so the
 *                          ladder never aggregates a growing ledger.
 *
 * The award is decided here, not on the device: 10 for a clean first try, 5 once
 * a wrong move has been made, 0 for the wrong move itself, plus 2 for finishing
 * inside 30 s. `first_try` and `solve_ms` are client claims — the board judges
 * moves locally, so only the client knows them — but the LINE is verified against
 * the pool row before anything is written, and the bonus window is capped here.
 *
 * Both tables install themselves, the same idempotent-DDL way the puzzle pool
 * does, because a migration file is not something every database this app runs
 * against has been handed. migrations/add_puzzle_trainer_scores.sql carries the
 * same DDL for the record.
 */

const db = require('../config/database');
const { toTrainerPuzzle } = require('./puzzleGenerator/lichessSource');
const { ensurePool, LEVELS } = require('./puzzleTrainer');

const FIRST_TRY_POINTS = 10;
const AFTER_MISS_POINTS = 5;
const SPEED_BONUS_POINTS = 2;
const SPEED_WINDOW_MS = 30000;
const TOP_LIMIT = 10;

/* A Lichess line is a handful of plies; this only bounds a hand-crafted body. */
const MAX_LINE_PLIES = 40;
const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
/* puzzle_id is VARCHAR(20) in the pool. */
const MAX_PUZZLE_ID = 20;
const MAX_STORED_MS = 86400000;

/* Sent with every leaderboard response so the page can explain its own numbers
   instead of hard-coding a second copy of the rule. */
const SCORING = {
  first_try: FIRST_TRY_POINTS,
  after_miss: AFTER_MISS_POINTS,
  wrong_move: 0,
  speed_bonus: SPEED_BONUS_POINTS,
  speed_window_ms: SPEED_WINDOW_MS,
};

const DDL = [
  `CREATE TABLE IF NOT EXISTS puzzle_trainer_scores (
     user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     name         VARCHAR(150) NOT NULL DEFAULT '',
     total_points INTEGER NOT NULL DEFAULT 0,
     solved_count INTEGER NOT NULL DEFAULT 0,
     updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE TABLE IF NOT EXISTS puzzle_trainer_solves (
     user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     puzzle_id VARCHAR(20) NOT NULL,
     points    INTEGER NOT NULL DEFAULT 0,
     first_try BOOLEAN NOT NULL DEFAULT FALSE,
     solve_ms  INTEGER,
     level     SMALLINT,
     solved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (user_id, puzzle_id)
   )`,
  'CREATE INDEX IF NOT EXISTS puzzle_trainer_scores_ladder_idx ON puzzle_trainer_scores (total_points DESC, solved_count DESC)',
  'CREATE INDEX IF NOT EXISTS puzzle_trainer_solves_user_idx ON puzzle_trainer_solves (user_id, solved_at DESC)',
];

let scoresReady = null;

async function installScores() {
  for (const sql of DDL) await db.query(sql);
}

/* Memoised: one cheap install per container, not per solve. A failure clears the
   memo so the next request retries instead of sticking. */
function ensureScores() {
  if (!scoresReady) {
    scoresReady = installScores().catch((err) => {
      scoresReady = null;
      throw err;
    });
  }
  return scoresReady;
}

/** The submitted line as clean UCI, or null when it is not a line at all. */
function normalizeLine(line) {
  const list = Array.isArray(line) ? line : String(line || '').split(/[\s,]+/);
  if (!list.length || list.length > MAX_LINE_PLIES) return null;
  const out = [];
  for (const move of list) {
    const uci = String(move || '').trim().toLowerCase();
    if (!UCI_RE.test(uci)) return null;
    out.push(uci);
  }
  return out;
}

const asRank = (n) => Number(n) || 0;

function rowOut(r) {
  return {
    rank: asRank(r.rank),
    user_id: Number(r.user_id),
    name: r.name,
    total_points: asRank(r.total_points),
    solved_count: asRank(r.solved_count),
    avatar_config: r.avatar_config ?? null,
    profile_image: r.profile_image ?? null,
    updated_at: r.updated_at ?? null,
  };
}

/**
 * The trainer ladder: the top `limit` plus the viewer's own row, even when that
 * row is outside the top ten (or hidden from everybody else).
 *
 * Only students are ranked. Staff can practise on the same feed, but their
 * solves are never written, and the `u.role` filter keeps any stray row from
 * an old role change out of the ladder for good.
 *
 * `hide_from_leaderboard` is applied INSIDE the ranked set, so a private student
 * neither appears in the list nor consumes a rank number and leaves a gap in it.
 * The viewer is the one exception, matching ratingService: the flag stops other
 * people inferring your score, not you reading your own.
 *
 * Names and avatars are joined live from `users`; the snapshot stored on the
 * score row is only the fallback, so a rename reaches the ladder immediately.
 */
async function trainerLeaderboard({ viewerId, limit = TOP_LIMIT } = {}) {
  await ensureScores();
  const top = Math.max(1, Math.min(Number(limit) || TOP_LIMIT, 50));
  const { rows } = await db.query(
    `WITH visible AS (
       SELECT sc.user_id, COALESCE(u.name, sc.name) AS name, sc.total_points,
              sc.solved_count, sc.updated_at, u.avatar_config, u.profile_image
         FROM puzzle_trainer_scores sc
         JOIN users u ON u.id = sc.user_id
         LEFT JOIN students s ON s.user_id = sc.user_id
        WHERE u.role = 'student'
          AND (COALESCE(s.hide_from_leaderboard, FALSE) = FALSE OR sc.user_id = $1)
     ), ranked AS (
       SELECT v.*,
              (ROW_NUMBER() OVER (
                ORDER BY v.total_points DESC, v.solved_count DESC, v.name ASC, v.user_id ASC
              ))::int AS rank
         FROM visible v
     )
     SELECT r.*, (SELECT count(*) FROM visible)::int AS players
       FROM ranked r
      WHERE r.rank <= $2 OR r.user_id = $1
      ORDER BY r.rank`,
    [viewerId, top]
  );

  const mine = rows.find((r) => Number(r.user_id) === Number(viewerId));
  return {
    top: rows.filter((r) => asRank(r.rank) <= top).map(rowOut),
    me: mine ? rowOut(mine) : null,
    players: rows.length ? asRank(rows[0].players) : 0,
    scoring: SCORING,
  };
}

/**
 * Credit one solved puzzle.
 *
 * @returns {Promise<{ok: false, reason: string}|{ok: true, credited: boolean, ...}>}
 *   `reason` is 'puzzle' (unknown id), 'line' (the submitted moves are not this
 *   puzzle's solution) or 'user' (the token names an account that is gone).
 *
 * `count: false` is staff practice: the line is validated exactly as a
 * student's, but nothing is written and `counted` comes back false. The trainer
 * is open to staff; the ladder is not theirs.
 */
async function recordSolve({ userId, puzzleId, line, firstTry = false, solveMs = null, level = null, count = true }) {
  const id = String(puzzleId || '').trim();
  if (!id || id.length > MAX_PUZZLE_ID) return { ok: false, reason: 'puzzle' };
  const played = normalizeLine(line);
  if (!played) return { ok: false, reason: 'line' };

  await ensurePool();
  await ensureScores();

  const found = await db.query(
    'SELECT puzzle_id, fen, moves FROM lichess_puzzles WHERE puzzle_id = $1',
    [id]
  );
  const puzzle = found.rows[0] ? toTrainerPuzzle(found.rows[0]) : null;
  if (!puzzle) return { ok: false, reason: 'puzzle' };
  /* The client already holds the line (it judges moves against it), so this is
     not anti-cheat — it is what stops a stale or crossed response from crediting
     a solve against the wrong position. */
  if (puzzle.moves.join(' ') !== played.join(' ')) return { ok: false, reason: 'line' };

  /* Staff practice: verified against the same solution, but no ledger row and
     no ladder row exists for it, so the student leaderboard never moves. */
  if (!count) {
    return {
      ok: true,
      counted: false,
      practice: true,
      credited: false,
      already: false,
      points: 0,
      base_points: 0,
      bonus_points: 0,
      first_try: firstTry === true || firstTry === 'true',
      total_points: 0,
      solved_count: 0,
      leaderboard: await trainerLeaderboard({ viewerId: userId }),
    };
  }

  const clean = firstTry === true || firstTry === 'true';
  const base = clean ? FIRST_TRY_POINTS : AFTER_MISS_POINTS;
  /* Number(null) and Number('') are both 0, which would hand the speed bonus to
     a client that reported no time at all. Only a real number (or a non-empty
     numeric string) is a claim. */
  const ms = typeof solveMs === 'number'
    ? solveMs
    : (typeof solveMs === 'string' && solveMs.trim() ? Number(solveMs) : NaN);
  const timed = Number.isFinite(ms) && ms >= 0;
  const bonus = timed && ms <= SPEED_WINDOW_MS ? SPEED_BONUS_POINTS : 0;
  const points = base + bonus;
  const storedMs = timed ? Math.min(Math.round(ms), MAX_STORED_MS) : null;
  const band = Number.isInteger(Number(level)) && LEVELS[Number(level)] ? Number(level) : null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const who = await client.query('SELECT name FROM users WHERE id = $1', [userId]);
    if (!who.rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'user' };
    }

    /* The ledger write and the aggregate it feeds are one transaction: a crash
       between them would leave a solve that can never be credited again, because
       the retry hits the primary key and is told "already counted". */
    const insert = await client.query(
      `INSERT INTO puzzle_trainer_solves (user_id, puzzle_id, points, first_try, solve_ms, level)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, puzzle_id) DO NOTHING
       RETURNING points`,
      [userId, id, points, clean, storedMs, band]
    );
    const credited = insert.rows.length > 0;

    const totals = credited
      ? (await client.query(
        `INSERT INTO puzzle_trainer_scores (user_id, name, total_points, solved_count, updated_at)
         VALUES ($1, $2, $3, 1, NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET total_points = puzzle_trainer_scores.total_points + EXCLUDED.total_points,
               solved_count = puzzle_trainer_scores.solved_count + 1,
               name = EXCLUDED.name,
               updated_at = NOW()
         RETURNING total_points, solved_count`,
        [userId, who.rows[0].name, points]
      )).rows[0]
      : (await client.query(
        'SELECT total_points, solved_count FROM puzzle_trainer_scores WHERE user_id = $1',
        [userId]
      )).rows[0] || { total_points: 0, solved_count: 0 };

    await client.query('COMMIT');

    /* The fresh ladder rides back with the award, so the page updates points,
       rank and the top ten from one response instead of racing a second GET. */
    const leaderboard = await trainerLeaderboard({ viewerId: userId });
    return {
      ok: true,
      counted: true,
      credited,
      already: !credited,
      points: credited ? points : 0,
      base_points: credited ? base : 0,
      bonus_points: credited ? bonus : 0,
      first_try: clean,
      total_points: asRank(totals.total_points),
      solved_count: asRank(totals.solved_count),
      leaderboard,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  recordSolve,
  trainerLeaderboard,
  ensureScores,
  normalizeLine,
  SCORING,
  TOP_LIMIT,
};