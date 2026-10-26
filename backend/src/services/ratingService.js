const db = require('../config/database');

/* NOTE: certificateService is deliberately NOT imported here.
 *
 * It imports certificateContent, which imports LEVELS from this file. A
 * top-level require would form a cycle: this module would still be mid-load
 * (LEVELS not yet defined) when certificateContent destructured it, and
 * certificateService would then crash on `LEVELS.length`.
 *
 * The one place this module issues a certificate — updateSingleStudent —
 * lazy-requires it inside the branch instead. See that function. */

/**
 * FIDE-style Elo rating + Level/Badge progression.
 *
 * Level tiers are FIXED 200-point rating bands. A student's *current* rating
 * is a live number; their *badge/level* is the highest band EVER reached
 * (monotonic — never downgraded).
 */
const LEVELS = [
  { level: 1, min: 1000, max: 1199, name: 'Beginner',   badge: 'Pawn' },        // ♙
  { level: 2, min: 1200, max: 1399, name: 'Knight',     badge: 'Knight' },      // ♘
  { level: 3, min: 1400, max: 1599, name: 'Bishop',     badge: 'Bishop' },      // ♗
  { level: 4, min: 1600, max: 1799, name: 'Rook',       badge: 'Rook' },        // ♖
  { level: 5, min: 1800, max: 1999, name: 'Queen',      badge: 'Queen' },       // ♕
  { level: 6, min: 2000, max: 2199, name: 'King',       badge: 'King' },        // ♔
  { level: 7, min: 2200, max: Infinity, name: 'Grandmaster', badge: 'Grandmaster' }, // ♚
];

const BADGE_ICONS = {
  1: '♙', 2: '♘', 3: '♗', 4: '♖', 5: '♕', 6: '♔', 7: '♚',
};

const STARTING_RATING = 1000;

/* How many recent Rapid results the profile returns for the card's form strip.
   Fixed here, on the server, so the limit is one decision rather than something
   each caller re-picks. The card shows every row it is given. */
const RECENT_RAPID_RESULTS = 5;

/* ── time controls ──────────────────────────────────────────────────────────
   Every rated game is bucketed into one of these before it touches a rating
   pool. The bands match the existing `timeClassFor` in tournamentController so
   tournaments and online games agree on what "Blitz" means.
     Bullet    base < 3 min
     Blitz     base < 10 min
     Rapid     base < 30 min
     Classical 30 min and above                                            */
const TIME_CLASSES = ['bullet', 'blitz', 'rapid', 'classical'];

const TIME_CLASS_META = {
  bullet: { label: 'Bullet', icon: '⚡', min: 0, max: 3 },
  blitz: { label: 'Blitz', icon: '🔥', min: 3, max: 10 },
  rapid: { label: 'Rapid', icon: '⏱', min: 10, max: 30 },
  classical: { label: 'Classical', icon: '♔', min: 30, max: Infinity },
};

/**
 * Bucket a time control into a class.
 *
 * Accepts the shapes that actually reach us:
 *   '300+0', '3+2', '10+0', '600'   → parsed as base minutes
 *   'Blitz', 'Rapid', 'bullet'       → already a label
 *   null / '' / 'unrated'            → null (no pool touched)
 *
 * Returns null when the value can't be understood, so an unlabelled game never
 * silently pollutes a rating pool.
 */
function classifyTimeControl(tc) {
  const raw = String(tc ?? '').trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  if (TIME_CLASSES.includes(lower)) return lower;
  if (lower === 'standard') return 'classical';

  // "300+0" / "3+2" / "10+5" — base minutes before the '+'.
  const m = raw.match(/^(\d+)\s*(?:\+\s*(\d+))?\s*$/);
  if (m) {
    const base = parseInt(m[1], 10);
    if (!Number.isFinite(base)) return null;
    if (base < 3) return 'bullet';
    if (base < 10) return 'blitz';
    if (base < 30) return 'rapid';
    return 'classical';
  }

  // A label with extra text, e.g. "Blitz 5+0".
  for (const key of ['classical', 'rapid', 'blitz', 'bullet']) {
    if (lower.includes(key)) return key;
  }
  return null;
}

/** Human label for a time class (falls back to the raw key). */
function timeClassLabel(tc) {
  return TIME_CLASS_META[tc]?.label || tc || '—';
}

/** Map a rating to its level tier object (clamps below/above the band range). */
function levelForRating(rating) {
  let lvl = LEVELS[0];
  for (const l of LEVELS) {
    if (rating >= l.min) lvl = l;
    else break;
  }
  return lvl;
}

/** Normalised view of a LEVELS row for the API.
 *  Carries BOTH spellings of the name (`name` and `tier`) and of the level
 *  number (`level` and `number`). The raw LEVELS rows use `name`, but the
 *  analytics `levels` array and the Ratings UI both read `tier` — mixing the two
 *  shapes is what left the "Tier" stat rendering as a blank "—". Emitting both
 *  keeps every existing consumer working whichever it reads. */
function bandLevel(l) {
  return {
    level: l.level,
    number: l.level,
    name: l.name,
    tier: l.name,
    badge: l.badge,
    icon: BADGE_ICONS[l.level] || '♙',
    min: l.min,
    /* Infinity is not JSON-safe and renders as "null" in the UI; the top band
       has no upper bound, which is exactly what null means here. */
    max: l.max === Infinity ? null : l.max,
  };
}

/**
 * Band + "points to next band" + bar percentage for a rating.
 *
 * ONE definition, used by both the Rapid block and each per-pool timeClasses
 * entry, so the switcher can never disagree with the "My Rapid Rating" card
 * about the same number.
 *
 * The sub-floor case is handled explicitly. The Elo floor is 100, so a rating
 * below the first band (1000) is a real and common state — a student can sit at
 * 838 for weeks. `levelForRating` clamps such a rating up to the first band,
 * which then made the page claim "362 pts to Knight (1200)" for an 838 player:
 * wrong by 200 points, and it asked them to chase a tier they had not entered
 * yet. Below the floor we instead report the points needed to actually REACH
 * that first band, and flag it so the UI can say so.
 */
function bandProgress(rating) {
  const floor = LEVELS[0].min;
  if (rating < floor) {
    return { level: bandLevel(LEVELS[0]), pointsToNext: floor - rating, progress: 0, belowFloor: true };
  }
  const l = levelForRating(rating);
  const next = LEVELS[l.level];
  return {
    level: bandLevel(l),
    pointsToNext: next ? Math.max(0, next.min - rating) : 0,
    /* 100% once the top band is reached — there is no next band to divide by. */
    progress: next
      ? Math.max(0, Math.min(100, Math.round(((rating - l.min) / (next.min - l.min)) * 100)))
      : 100,
    belowFloor: false,
  };
}

/** Expected score E = 1 / (1 + 10^((oppRating - playerRating) / 400)). */
function expectedScore(playerRating, opponentRating) {
  return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
}

/**
 * K-factor selection (FIDE-style provisional logic).
 * - New students (first 20 rated games)          → K = 40
 * - Students under 18                             → K = 32
 * - Regular students (after 20 rated games)       → K = 20
 * - Advanced/senior students (peak rating ≥ 2200) → K = 15
 */
function kFactor({ gamesPlayed, age, peakRating }) {
  if (gamesPlayed < 20) return 40;
  if (age !== null && age < 18) return 32;
  if ((peakRating || 0) >= 2200) return 15;
  return 20;
}

/** k-factor labelled for display/debugging. */
function kFactorDetailed({ gamesPlayed, age, peakRating }) {
  if (gamesPlayed < 20) return { k: 40, reason: 'new' };
  if (age !== null && age < 18) return { k: 32, reason: 'under-18' };
  if ((peakRating || 0) >= 2200) return { k: 15, reason: 'advanced' };
  return { k: 20, reason: 'regular' };
}

/** Compute new rating. Rounding toward the direction of change, min floor 100. */
function newRating(oldRating, k, expected, actualScore) {
  const delta = Math.round(k * (actualScore - expected));
  return Math.max(100, oldRating + delta);
}

/* ── transactions ─────────────────────────────────────────────────────────
 * Every rating update below is read-modify-write: read the current rating,
 * compute the Elo delta, write the new rating plus a history row. Issued as
 * separate statements with no transaction, two games finishing close together
 * interleave like this (real case: 4 rapid games in a few minutes):
 *
 *   game3 SELECT pool → 1038        game4(draw) SELECT pool → 1038
 *   game3 UPDATE pool → 1054 …      game4 UPDATE pool → 1034 (stale base 1038)
 *
 * The draw's update commits last and overwrites the profile with a number
 * computed from a stale "before": the +16 win survives only in history while
 * the profile shows 1034 / peak 1038 / 3 games instead of 1048 / 1054 / 4.
 *
 * So each game commits inside ONE transaction that first locks BOTH players'
 * rows (SELECT … FOR UPDATE, ascending id — see lockPlayers). The lock
 * serialises concurrent finishes for the same pair: the second transaction
 * blocks until the first commits, then reads the committed ratings —
 * "rating before" can never come from a cached or earlier-read value. And
 * because profile UPDATEs and history INSERTs (overall AND pool) commit
 * together, a crash between them can no longer leave the badge a game behind
 * the history. The opponent's rating is only an expectancy input and is read
 * normally (up front, without a lock). */
async function withTransaction(fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* already closed */ }
    throw err;
  } finally {
    client.release();
  }
}

/* Lock every player row a transaction will touch, in canonical (ascending id)
 * order, BEFORE doing any work.
 *
 * WHY BOTH ROWS. History rows reference TWO students rows (student_id AND
 * opponent_id), and Postgres checks each FK with a KEY SHARE lock — which
 * conflicts with the FOR UPDATE a concurrent transaction holds on its own
 * player. Locking only your own row deadlocks exactly the reported way:
 *   txn1 holds A, INSERT wants KEY SHARE on B ─┐
 *   txn2 holds B, INSERT wants KEY SHARE on A ─┘ (cycle → deadlock detected)
 * Locking both rows ascending first means same-pair transactions fully
 * serialise on the students lock, every FK check then targets a self-locked
 * row (no wait), and disjoint pairs never interact. No cycle is possible. */
async function lockPlayers(client, ids) {
  const uniq = [...new Set(ids.filter((n) => Number.isInteger(n)))].sort((x, y) => x - y);
  if (!uniq.length) return;
  await client.query('SELECT id FROM students WHERE id = ANY($1) ORDER BY id FOR UPDATE', [uniq]);
}

/**
 * Apply a single rated result between two students and update both sides.
 *
 * `score` is 1 / 0.5 / 0 from the perspective of the "player".
 * Safe to call from any game-finish path. Each side's update runs inside its
 * own single-row transaction (row lock on that player's row), so concurrent
 * finishes for the same player serialise instead of interleaving.
 * Returns a summary of the change + whether either side levelled up.
 *
 * PARAMS:
 *   player:   { studentId, score }  (winner/side A)
 *   opponent: { studentId, score }  (score must be 1 - player.score)
 *   meta:     { timeControl, gameType, opponentName?, tournamentGameId? }
 */
async function applyGameResult({ player, opponent, meta = {} }) {
  const out = await withTransaction((client) =>
    applyGameResultInTransaction(client, { player, opponent, meta }));
  await issueLevelCertificates(out);
  return shapeGameResult(out);
}

/**
 * The database half of `applyGameResult`, on a caller-owned transaction.
 *
 * WHY IT IS SPLIT OUT: a tournament result and the rating movement it causes
 * must commit together. `tournamentEngine.onGameFinished` already owns a
 * transaction (`tx`) that writes the pairing, so it calls this function with
 * that client instead of `applyGameResult`, which would open a second
 * connection and commit independently. If rating settlement fails, the pairing
 * update rolls back with it and the tournament can retry — never "result saved,
 * rating lost".
 *
 * The exactly-once guard for a tournament game is the duplicate check after
 * `lockPlayers`: two concurrent settlements serialise on the students rows, and
 * the second one sees the first one's committed `rating_history` row and
 * returns `alreadyApplied` without touching a rating. The partial UNIQUE index
 * `(tournament_game_id, student_id)` in the migration is the database backstop.
 */
async function applyGameResultInTransaction(client, { player, opponent, meta = {} }) {
  /* The rating CATEGORY is derived ONCE, here, from the game's time control,
   and then threaded through everything below: the overall rating_history row,
     both per-control pool rows, and the return value the API/UI read. Deriving
     it in one place is the point - the category is what selects the pool, so a
     second independent derivation elsewhere (the controller's display-label
     helper) is exactly the kind of drift that makes a Blitz game report Rapid.
     `meta.timeClass` lets a caller that already knows the category pass it in
     rather than re-deriving it from a display string. Computed BEFORE any
     update so both history rows can carry it at INSERT time (no post-hoc
     stamp, which is itself another statement for a concurrent finish to slip
     between). */
  const timeClass = meta.timeClass || classifyTimeControl(meta.timeControl);
  const metaWithClass = { ...meta, timeClass };

  /* ONE transaction for the whole game: both players' overall + pool + level
     rows commit atomically, so concurrent finishes for the same pair become
     one global serial order (the concurrent outcome always equals A,B or B,A
     exactly) instead of interleaving per player. lockPlayers takes both
     students rows ascending first (see its note): same-pair games serialise
     there, disjoint pairs never interact, and no lock cycle is possible. */
  await lockPlayers(client, [player.studentId, opponent.studentId]);

  /* Tournament idempotency, checked after the locks so a concurrent settlement
     cannot slip between the check and the writes. The unique index would also
     reject a duplicate, but returning cleanly lets the caller mark the game
     "applied" rather than aborting the tournament transaction. */
  if (meta.tournamentGameId != null) {
    const already = await client.query(
      'SELECT 1 FROM rating_history WHERE tournament_game_id = $1 LIMIT 1',
      [meta.tournamentGameId],
    );
    if (already.rows.length) {
      return { alreadyApplied: true, timeClass, playerChange: null, opponentChange: null };
    }
  }

  /* Expectancy inputs, read INSIDE the transaction (no extra locks needed —
     both rows are already held). A value passed in from before the game is
     only a fallback: under concurrency the pre-game read can predate a
     just-committed game, and scoring against it would make the outcome match
     NO sequential order. Reading here means every number in the transaction
     comes from committed state as of this game, so concurrent finishes
     always equal A,B or B,A exactly. */
  const fresh = await client.query(
    'SELECT id, current_rating FROM students WHERE id = ANY($1)',
    [[player.studentId, opponent.studentId]],
  );
  const freshById = {};
  fresh.rows.forEach((r) => { freshById[r.id] = r.current_rating; });
  let freshPools = {};
  if (timeClass && meta.rated !== false) {
    const pr = await client.query(
      'SELECT student_id, rating FROM student_time_ratings WHERE student_id = ANY($1) AND time_class = $2',
      [[player.studentId, opponent.studentId], timeClass],
    );
    pr.rows.forEach((r) => { freshPools[r.student_id] = r.rating; });
  }

  const playerChange = await updateOverallLocked(client, {
    studentId: player.studentId,
    score: player.score,
    opponentId: opponent.studentId,
    opponentName: opponent.name,
    opponentRating: freshById[opponent.studentId] ?? opponent.rating,
    meta: metaWithClass,
  });
  const opponentChange = playerChange && await updateOverallLocked(client, {
    studentId: opponent.studentId,
    score: opponent.score,
    opponentId: player.studentId,
    opponentName: player.name,
    opponentRating: freshById[player.studentId] ?? player.rating,
    meta: metaWithClass,
  });
  if (!playerChange || !opponentChange) {
    return { playerChange, opponentChange, timeClass };
  }

  let playerPool = null;
  let opponentPool = null;
  if (timeClass && meta.rated !== false) {
    playerPool = await updatePoolLocked(client, {
      studentId: player.studentId,
      timeClass,
      score: player.score,
      opponentId: opponent.studentId,
      opponentName: opponent.name,
      opponentRating: freshPools[opponent.studentId] ?? opponent.rating,
      meta: metaWithClass,
    });
    opponentPool = await updatePoolLocked(client, {
      studentId: opponent.studentId,
      timeClass,
      score: opponent.score,
      opponentId: player.studentId,
      opponentName: player.name,
      opponentRating: freshPools[player.studentId] ?? player.rating,
      meta: metaWithClass,
    });
  }

  // Permanently record newly reached level tiers (never downgraded).
  const playerNewLevel = await insertLevelRow(client, player.studentId, playerChange.level);
  const opponentNewLevel = await insertLevelRow(client, opponent.studentId, opponentChange.level);

  return {
    playerChange, opponentChange, playerPool, opponentPool,
    playerNewLevel, opponentNewLevel, timeClass,
  };
}

/** Issue any level certificates AFTER the rating transaction committed.
 *  Shared with the tournament settlement path, which owns its own transaction
 *  and therefore schedules this on its post-commit queue. */
async function issueLevelCertificates(out) {
  if (!out || out.alreadyApplied) return;
  if (out.playerNewLevel && out.playerChange?.level) {
    await maybeIssueLevelCertificate(out.player.studentId, out.playerChange.level.level);
  }
  if (out.opponentNewLevel && out.opponentChange?.level) {
    await maybeIssueLevelCertificate(out.opponent.studentId, out.opponentChange.level.level);
  }
}

/** Shape the transaction result into the public return value. */
function shapeGameResult(out) {
  const playerChange = out.playerChange || null;
  const opponentChange = out.opponentChange || null;
  return {
    player: playerChange,
    opponent: opponentChange,
    timeClass: out.timeClass,
    timeClassLabel: out.timeClass ? timeClassLabel(out.timeClass) : null,
    timeControlChange: out.playerPool || null,
    levelUp: playerChange?.leveled || opponentChange?.leveled,
    leveledStudents: [playerChange, opponentChange]
      .filter((c) => c && c.leveled)
      .map((c) => c.studentId),
  };
}

/**
 * Read (or create) a student's rating pool for one time class.
 *
 * Pools are created lazily on the student's first rated game in that control,
 * so a player who only ever plays blitz never gets a meaningless 1000 in
 * classical. Returns null when the student doesn't exist.
 */
async function getTimeRating(studentId, timeClass) {
  if (!TIME_CLASSES.includes(timeClass)) return null;
  const existing = await db.query(
    'SELECT * FROM student_time_ratings WHERE student_id = $1 AND time_class = $2',
    [studentId, timeClass]
  );
  if (existing.rows.length) return existing.rows[0];

  const created = await db.query(
    `INSERT INTO student_time_ratings (student_id, time_class, rating, peak_rating, provisional_games)
     VALUES ($1, $2, $3, $3, 20)
     ON CONFLICT (student_id, time_class) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [studentId, timeClass, STARTING_RATING]
  );
  return created.rows[0];
}

/* ── locked single-player updates ─────────────────────────────────────────
 * The two helpers below do the actual writes and MUST run inside a
 * transaction holding the relevant row lock (see withTransaction). They take
 * a client, never touch the pool, and never commit — the caller owns the
 * transaction so overall + pool + level rows commit atomically.
 *
 * Lock order is ALWAYS both students rows (ascending id via lockPlayers)
 * first, then pool rows: same-pair transactions fully serialise on the
 * students lock, so a waiter never holds a lock another waiter needs and no
 * lock cycle is possible (the FK KEY SHARE checks then target self-locked
 * rows — see lockPlayers). */

/** Overall-rating half of a player's update, on an already-locked row. */
async function updateOverallLocked(client, { studentId, score, opponentId, opponentName, opponentRating, meta }) {
  const { rows } = await client.query(
    `SELECT s.id, s.current_rating, s.peak_rating, s.highest_level,
            s.games_played, s.provisional_games, s.birthdate
     FROM students s WHERE s.id = $1 FOR UPDATE`,
    [studentId]
  );
  const profile = rows[0];
  if (!profile) return null;

  // K-factor needs the games count BEFORE this match is recorded.
  const gamesPlayed = profile.games_played;
  const age = computeAge(profile.birthdate);
  const { k, reason } = kFactorDetailed({ gamesPlayed, age, peakRating: profile.peak_rating });

  const exp = expectedScore(profile.current_rating, opponentRating ?? profile.current_rating);
  const oldRating = profile.current_rating;
  const newR = newRating(oldRating, k, exp, score);
  const change = newR - oldRating;
  const level = levelForRating(newR);

  // Persist rating + counters, compare against peak/highest level.
  await client.query(
    `UPDATE students SET
       current_rating = $1,
       peak_rating = GREATEST(peak_rating, $2),
       highest_level = GREATEST(highest_level, $3),
       games_played = games_played + 1,
       provisional_games = GREATEST(0, provisional_games - 1),
       last_rating_change_at = NOW()
     WHERE id = $4`,
    [newR, newR, level.level, studentId]
  );

  // Log the rating history entry.
  // `online_game_id` is what lets the game screen show THIS player the change
  // for THIS game (onlineController.getRatingResult). It is NULL for games that
  // have no online row - tournaments, imports, anything recorded by hand.
  //
  // `time_class` is the CANONICAL category key ('bullet' | 'blitz' | 'rapid' |
  // 'classical') alongside the human-readable `time_control` label ('Rapid').
  // The label is what the player reads; the key is what the rating pool is
  // selected by, so storing both makes the category of a given game
  // queryable and assertable rather than something a test has to re-derive
  // from a display string.
  const result = score === 1 ? 'win' : score === 0 ? 'loss' : 'draw';
  /* `tournament_game_id` is only written by the tournament settlement path.
     Keeping it in a separate statement shape means the online (and every other)
     rated game does not depend on the tournament migration having run. */
  if (meta.tournamentGameId != null) {
    await client.query(
      `INSERT INTO rating_history
         (student_id, opponent_id, opponent_name, result, rating_before, rating_after,
          rating_change, time_control, time_class, game_type, rated, online_game_id,
          tournament_game_id, played_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, TRUE, $11, $12, clock_timestamp())`,
      [studentId, opponentId, opponentName, result, oldRating, newR, change,
        meta.timeControl || null, meta.timeClass || null, meta.gameType || 'official',
        meta.onlineGameId != null ? meta.onlineGameId : null, meta.tournamentGameId]
    );
  } else {
    await client.query(
      `INSERT INTO rating_history
         (student_id, opponent_id, opponent_name, result, rating_before, rating_after,
          rating_change, time_control, time_class, game_type, rated, online_game_id, played_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, TRUE, $11, clock_timestamp())`,
      [studentId, opponentId, opponentName, result, oldRating, newR, change,
        meta.timeControl || null, meta.timeClass || null, meta.gameType || 'official',
        meta.onlineGameId != null ? meta.onlineGameId : null]
    );
  }

  // Was the previous unlocked level < this level tier → level up event.
  const leveled = level.level > profile.highest_level;

  return {
    ratingBefore: oldRating,
    ratingAfter: newR,
    ratingChange: change,
    kFactor: k,
    kReason: reason,
    level,
    prevHighestLevel: profile.highest_level,
    gamesPlayed: gamesPlayed + 1,
    leveled,
  };
}

/** Pool half of a player's update: ensure, lock, update, log — atomically. */
async function updatePoolLocked(client, { studentId, timeClass, score, opponentId, opponentName, opponentRating, meta }) {
  // Lazy pool creation is idempotent (UNIQUE on student_id + time_class), so
  // concurrent first-games converge on one row and then serialise below.
  await client.query(
    `INSERT INTO student_time_ratings (student_id, time_class, rating, peak_rating, provisional_games)
     VALUES ($1, $2, $3, $3, 20)
     ON CONFLICT (student_id, time_class) DO NOTHING`,
    [studentId, timeClass, STARTING_RATING]
  );
  const { rows } = await client.query(
    'SELECT * FROM student_time_ratings WHERE student_id = $1 AND time_class = $2 FOR UPDATE',
    [studentId, timeClass]
  );
  const pool = rows[0];
  if (!pool) return null;

  const { k, reason } = kFactorDetailed({
    gamesPlayed: pool.games_played,
    age: null,
    peakRating: pool.peak_rating,
  });

  const exp = expectedScore(pool.rating, opponentRating ?? pool.rating);
  const oldRating = pool.rating;
  const newR = newRating(oldRating, k, exp, score);
  const change = newR - oldRating;
  const level = levelForRating(newR);

  await client.query(
    `UPDATE student_time_ratings SET
       rating = $1,
       peak_rating = GREATEST(peak_rating, $2),
       highest_level = GREATEST(highest_level, $3),
       games_played = games_played + 1,
       provisional_games = GREATEST(0, provisional_games - 1),
       last_changed_at = NOW(),
       updated_at = NOW()
     WHERE student_id = $4 AND time_class = $5`,
    [newR, newR, level.level, studentId, timeClass]
  );

  const result = score === 1 ? 'win' : score === 0 ? 'loss' : 'draw';
  // `online_game_id` links this pool row to the game that moved it, so "which
  // rating category did THIS game update?" is answerable without guessing from
  // the display label. NULL for games with no online row. Tournaments use
  // `tournament_game_id` instead (same split as the overall table).
  if (meta.tournamentGameId != null) {
    await client.query(
      `INSERT INTO time_control_rating_history
         (student_id, time_class, opponent_id, opponent_name, result,
          rating_before, rating_after, rating_change, time_control, game_type,
          online_game_id, tournament_game_id, played_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, clock_timestamp())`,
      [studentId, timeClass, opponentId || null, opponentName || null, result,
        oldRating, newR, change, meta.timeControl || null, meta.gameType || 'official',
        meta.onlineGameId != null ? meta.onlineGameId : null, meta.tournamentGameId]
    );
  } else {
    await client.query(
      `INSERT INTO time_control_rating_history
         (student_id, time_class, opponent_id, opponent_name, result,
          rating_before, rating_after, rating_change, time_control, game_type, online_game_id, played_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, clock_timestamp())`,
      [studentId, timeClass, opponentId || null, opponentName || null, result,
        oldRating, newR, change, meta.timeControl || null, meta.gameType || 'official',
        meta.onlineGameId != null ? meta.onlineGameId : null]
    );
  }

  return {
    studentId,
    timeClass,
    timeClassLabel: timeClassLabel(timeClass),
    ratingBefore: oldRating,
    ratingAfter: newR,
    ratingChange: change,
    kFactor: k,
    kReason: reason,
    level,
    leveled: level.level > (pool.highest_level || 1),
    gamesPlayed: (pool.games_played || 0) + 1,
  };
}

/** Permanently record a newly reached level tier (never downgraded).
 *  Returns true when the band is new (RETURNING is the duplicate detector:
 *  with ON CONFLICT DO NOTHING a conflicting row returns nothing). Must run
 *  inside the rating transaction so the level row commits with the rating. */
async function insertLevelRow(client, studentId, level) {
  const { rows } = await client.query(
    `INSERT INTO student_levels (student_id, level, badge_name)
     VALUES ($1,$2,$3) ON CONFLICT (student_id, level) DO NOTHING
     RETURNING level`,
    [studentId, level.level, level.badge]
  );
  return rows.length > 0;
}

/** Issue a level certificate AFTER the rating commit (never under the lock).
 *  The require is INSIDE the function on purpose. certificateService imports
 *  certificateContent, which imports LEVELS from this file; a top-level import
 *  would form a cycle and `LEVELS` would be destructured as undefined. */
async function maybeIssueLevelCertificate(studentId, levelNum) {
  try {
    await require('./certificateService').issueLevelCertificates({
      studentId,
      levels: [levelNum],
    });
  } catch (e) {
    // A certificate failure must never fail a rated game - the rating rows are
    // already committed, the certificate row records its own failure in
    // file_error, and backfill_certificates.js can issue anything missed.
    console.error('level certificate issue failed:', e.message);
  }
}

/**
 * Apply one rated result to a single student's pool for a single time class.
 *
 * Uses the same FIDE-style Elo maths as the overall rating, and keeps its own
 * K-factor/provisional counter so a player stays provisional within EACH
 * control rather than only overall. `opponentRating` should be the opponent's
 * rating in the SAME class, so a blitz game isn't scored against a classical
 * number.
 *
 * Same atomicity contract as updateSingleStudent: the pool row is created
 * idempotently if missing, then locked (SELECT … FOR UPDATE), and the pool
 * UPDATE + pool-history INSERT commit together — so the badge (which reads
 * the pool) and the pool history (which the card's "last change" reads) can
 * never disagree, no matter how close together two games finish.
 */
async function applyTimeControlResult({ studentId, timeClass, score, opponentId, opponentName, opponentRating, meta = {} }) {
  return withTransaction(async (client) => {
    // Both rows first (canonical order): this INSERT references opponent_id
    // too, so without the opponent lock it can deadlock against a concurrent
    // game transaction exactly like rating_history did — see lockPlayers.
    await lockPlayers(client, [studentId, opponentId]);
    return updatePoolLocked(client, {
      studentId, timeClass, score, opponentId, opponentName, opponentRating, meta,
    });
  });
}

/**
 * Fetch a student's profile (rating, games, birthdate) and applies a single
 * match, returning the after-state. Overall-rating only (no pool touch) —
 * the game-finish path uses applyPlayerUpdate instead so overall + pool
 * commit in one transaction.
 */
async function updateSingleStudent({ studentId, score, meta = {}, opponentId, opponentName, opponentRating }) {
  const change = await withTransaction(async (client) => {
    // Both rows first (canonical order) — see lockPlayers: the history INSERT
    // below references opponent_id as well.
    await lockPlayers(client, [studentId, opponentId]);
    const change = await updateOverallLocked(client, {
      studentId, score, opponentId, opponentName, opponentRating, meta,
    });
    if (!change) return null;
    const newLevelReached = await insertLevelRow(client, studentId, change.level);
    return { ...change, newLevelReached };
  });

  if (!change) return null;

  // Issued AFTER the rating transaction commits: holding the player's row lock
  // across certificate work would serialise every concurrent finish behind it,
  // and a certificate failure must never roll back an already-decided rating.
  if (change.newLevelReached) {
    await maybeIssueLevelCertificate(studentId, change.level.level);
  }

  return {
    studentId,
    ratingBefore: change.ratingBefore,
    ratingAfter: change.ratingAfter,
    ratingChange: change.ratingChange,
    kFactor: change.kFactor,
    kReason: change.kReason,
    level: change.level,
    levelsUnlocked: change.leveled,
    prevHighestLevel: change.prevHighestLevel,
    gamesPlayed: change.gamesPlayed,
    levels: {
      all: LEVELS,
      current: change.level,
      icon: BADGE_ICONS[change.level.level] || '♟',
    },
    leveled: change.leveled,
  };
}

/** Grab the live rating-relevant row for a student. */
async function getStudentRatingRow(studentId) {
  const r = await db.query(
    `SELECT s.id, s.current_rating, s.peak_rating, s.highest_level,
            s.games_played, s.provisional_games, s.birthdate
     FROM students s WHERE s.id = $1`,
    [studentId]
  );
  return r.rows[0] || null;
}

/** Birthdate → age in whole years (null if unknown). */
function computeAge(birthdate) {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

/** Full rating profile for display: current rating, badge, progress, history. */
async function buildProfile(studentId, { limit = 60 } = {}) {
  const row = await getStudentRatingRow(studentId);
  if (!row) return null;

  const level = levelForRating(row.current_rating);
  const peakLevel = levelForRating(row.peak_rating);
  const next = level.level < LEVELS.length ? LEVELS[level.level] : null;
  const nextThreshold = next ? next.min : level.min;

  const progress = next
    ? Math.max(0, Math.min(100, Math.round(((row.current_rating - level.min) / (next.min - level.min)) * 100)))
    : 100;
  const pointsToNext = next ? Math.max(0, next.min - row.current_rating) : 0;

  const [history, levels, pools, histAll] = await Promise.all([
    db.query(
      `SELECT id, opponent_name, result, rating_before, rating_after, rating_change,
              time_control, game_type, played_at
       FROM rating_history WHERE student_id = $1 ORDER BY played_at DESC LIMIT $2`,
      [studentId, limit]
    ),
    db.query(
      `SELECT level, badge_name, achieved_at FROM student_levels
       WHERE student_id = $1 ORDER BY level ASC`,
      [studentId]
    ),
    /* The four time-control pools. Rapid is the one the overall champion
       ladder uses, so the profile surfaces it explicitly alongside the rest. */
    db.query(
      `SELECT time_class, rating, peak_rating, games_played, highest_level
         FROM student_time_ratings WHERE student_id = $1`,
      [studentId]
    ),
    /* Per-time-control history for the ratings-page switcher. One query for all
       four classes rather than four round trips. `time_class` is already
       normalised here, so the UI never has to re-derive a class from a raw
       "5+0" string. Over-fetched relative to `limit` because one global LIMIT
       would starve the smaller pools. */
    db.query(
      `SELECT id, opponent_name, result, rating_before, rating_after, rating_change,
              time_control, game_type, played_at, time_class
         FROM time_control_rating_history
        WHERE student_id = $1
        ORDER BY played_at DESC LIMIT $2`,
      [studentId, limit * 4]
    ),
  ]);

  const byClass = Object.fromEntries(pools.rows.map((r) => [r.time_class, r]));
  const rapid = byClass.rapid || null;

  const historyAsc = [...history.rows].reverse();

  /* Split the per-class rows into four ascending lists, one per time control.
     Each control can have far fewer games than another, so a single global
     LIMIT is a poor fit; over-fetching here is cheap (a few dozen rows) and
     keeps every pool's chart complete. */
  const historyByClass = Object.fromEntries(TIME_CLASSES.map((c) => [c, []]));
  for (const r of histAll.rows) {
    if (historyByClass[r.time_class]) historyByClass[r.time_class].push(r);
  }
  for (const c of TIME_CLASSES) historyByClass[c].reverse();

  /* `rapidHistory` keeps its original contract — Rapid only, capped at `limit`
     — because RatingCard and studentController both read it. */
  const rapidHistoryAsc = historyByClass.rapid.slice(-limit);

  /* THE authoritative "latest Rapid rating move", plus the recent form strip the
     Rapid card renders.

     Both come from `time_control_rating_history` filtered to `time_class =
     'rapid'`, which is the same pool the rating was actually written to, so
     these can never be Blitz/Bullet/Classical rows and never another player's
     row (the query is keyed on this student's own `student_id`).

     `latestRapid` is the newest row ASCENDING - i.e. the most recent game. Its
     rating_before / rating_after / rating_change ARE the transition, already
     computed by the rating service; nothing here re-derives Elo.

     This exists because the card used to subtract the SUM of the recent rows,
     which nets several games together and is not "the latest move" at all - a
     single win after two losses read as a loss. `currentRating` is the live
     pool rating and is asserted to equal `latestRapid.rating_after` by the
     regression tests, so the two can never drift. */
  const rapidRecent = rapidHistoryAsc.slice(-RECENT_RAPID_RESULTS);
  const latestRapid = rapidRecent.length
    ? {
        ratingBefore: rapidRecent[rapidRecent.length - 1].rating_before,
        ratingAfter: rapidRecent[rapidRecent.length - 1].rating_after,
        ratingChange: rapidRecent[rapidRecent.length - 1].rating_change,
        result: rapidRecent[rapidRecent.length - 1].result,
        opponentName: rapidRecent[rapidRecent.length - 1].opponent_name || null,
        playedAt: rapidRecent[rapidRecent.length - 1].played_at,
      }
    : null;

  return {
    studentId,
    currentRating: row.current_rating,
    peakRating: row.peak_rating,
    gamesPlayed: row.games_played,
    /* The Rapid pool — this is what the overall champion ladder ranks on, so
       it is the number the UI leads with. null when the student has never
       played a rated Rapid game. Band/progress come from the shared
       `bandProgress` helper so they always match the per-pool copies. */
    rapid: rapid
      ? (() => {
          const bp = bandProgress(rapid.rating);
          return {
            rating: rapid.rating,
            peakRating: rapid.peak_rating,
            gamesPlayed: rapid.games_played,
            level: bp.level,
            belowFloor: bp.belowFloor,
            provisional: rapid.games_played < 20,
            pointsToNext: bp.pointsToNext,
            progress: bp.progress,
          };
        })()
      : null,
    /* All four pools, for the per-control breakdown on the Ratings page.
       Each pool carries the SAME band + progress fields the Rapid block has
       above, so the time-control switcher can draw the "pts to next tier" bar
       for whichever pool is selected — not just for Rapid. */
    timeClasses: Object.fromEntries(
      TIME_CLASSES.map((cls) => {
        const p = byClass[cls];
        if (!p) {
          return [cls, { rating: null, peakRating: null, gamesPlayed: 0, label: timeClassLabel(cls), icon: TIME_CLASS_META[cls].icon, provisional: true, level: null, belowFloor: false, pointsToNext: 0, progress: 0 }];
        }
        const bp = bandProgress(p.rating);
        return [cls, {
          rating: p.rating,
          peakRating: p.peak_rating,
          gamesPlayed: p.games_played,
          label: timeClassLabel(cls),
          icon: TIME_CLASS_META[cls].icon,
          provisional: p.games_played < 20,
          level: bp.level,
          belowFloor: bp.belowFloor,
          pointsToNext: bp.pointsToNext,
          progress: bp.progress,
        }];
      })
    ),
    provisionalGames: row.provisional_games,
    isProvisional: row.games_played < 20 || row.provisional_games > 0,
    age: computeAge(row.birthdate),
    // live tier (current rating) — can dip
    level: {
      number: level.level,
      name: level.badge,
      tier: level.name,
      icon: BADGE_ICONS[level.level] || '♟',
      min: level.min,
      max: level.max === Infinity ? null : level.max,
    },
    // peak tier backing the locked badge (never downgraded) — display "max"
    maxLevel: {
      number: peakLevel.level,
      name: peakLevel.badge,
      tier: peakLevel.name,
      icon: BADGE_ICONS[peakLevel.level] || '♟',
      min: peakLevel.min,
      max: peakLevel.max === Infinity ? null : peakLevel.max,
    },
    highestLevel: row.highest_level,
    levelsUnlocked: levels.rows,
    nextLevel: next ? { number: next.level, name: next.badge, tier: next.name, min: next.min, icon: BADGE_ICONS[next.level] || '♟' } : null,
    nextThreshold,
    progress,
    pointsToNext,
    // ascending history for line chart
    history: historyAsc,
    historyRecent: history.rows,
    /* Rapid-only, ascending — what the chart should draw, since Rapid is the
       ladder. Empty when the student has no Rapid games. */
    rapidHistory: rapidHistoryAsc,
    /* THE authoritative "latest Rapid rating move", plus the recent form strip
       the Rapid card renders.

       Both come from `time_control_rating_history` filtered to
       `time_class = 'rapid'` — the same pool the rating was written to — and are
       keyed on this student's own `student_id`, so neither another category nor
       another player's row can leak in. `latestRapid` is the newest row, whose
       rating_before / rating_after / rating_change ARE the transition; no Elo is
       re-derived here or in the UI.

       These exist because the card used to net the SUM of the recent rows, which
       is not "the latest move": a single win after two losses read as a loss.
       `rapid.rating` is the live pool rating and is asserted to equal
       `latestRapid.ratingAfter`, so the two cannot drift apart. */
    latestRapid,
    rapidRecent,
    recentRapidLimit: RECENT_RAPID_RESULTS,
    /* All four pools, each ascending, for the time-control switcher on the
       Ratings page. Always has exactly the four TIME_CLASSES keys, each an
       array (possibly empty), so the UI can index without guarding. */
    historyByClass,
  };
}

/** Leaderboard ranked by RAPID rating (the overall champion ladder).
 *  The common/unified `current_rating` is still returned for reference, but it
 *  no longer decides rank. Enriched per row from real stored data:
 *    W/L/D ......... student_game_analysis day rollups (online + computer games)
 *    puzzlePoints .. sum of correct puzzle_attempts scores
 *    streak ........ current consecutive online wins (online_games)
 *    spark ......... last ≤14 rating_history points, chronological
 *    weeklyDelta .. current rating − rating at start of the rating window
 *    blitzRating / rapidRating .. latest rating in each time-control bucket
 *    nemesis ...... opponent this student loses to most often (online games)
 */
async function leaderboard({ limit = 100, hidePrivate = true } = {}) {
  const hideClause = hidePrivate ? 'AND s.hide_from_leaderboard = FALSE' : '';

  const streakSQL = `
    WITH sides AS (
      SELECT student_id AS user_id, id, created_at,
             (result = CASE WHEN admin_color = 'white' THEN 'black' ELSE 'white' END) AS win
      FROM online_games
      WHERE status = 'finished' AND result IN ('white','black','draw')
      UNION ALL
      SELECT admin_id, id, created_at, (result = admin_color)
      FROM online_games
      WHERE status = 'finished' AND result IN ('white','black','draw')
    ),
    grp AS (
      SELECT user_id, id, created_at, win,
             SUM(CASE WHEN win THEN 0 ELSE 1 END)
               OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC ROWS UNBOUNDED PRECEDING) AS g
      FROM sides
    )
    SELECT user_id, COUNT(*)::int AS streak
    FROM grp WHERE g = 0 AND win
    GROUP BY user_id`;

  const nemesisSQL = `
    WITH sides AS (
      SELECT student_id AS user_id, admin_id AS opp,
             (result = CASE WHEN admin_color = 'white' THEN 'black' ELSE 'white' END) AS lost
      FROM online_games WHERE status = 'finished' AND result IS NOT NULL
      UNION ALL
      SELECT admin_id, student_id, (result = admin_color)
      FROM online_games WHERE status = 'finished' AND result IS NOT NULL
    ),
    agg AS (
      SELECT user_id, opp, SUM((lost)::int) AS n FROM sides WHERE lost GROUP BY user_id, opp
    ),
    rn AS (
      SELECT user_id, opp, n, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY n DESC, opp) AS r
      FROM agg
    )
    SELECT rn.user_id, rn.n AS defeats, u.name AS nemesis
    FROM rn JOIN users u ON u.id = rn.opp WHERE rn.r = 1`;

  const [base, wldR, puzzleR, histR, rapidHistR, streakR, nemR, timePoolsR, tcHistR2] = await Promise.all([
    /* RANKING IS RAPID-BASED.
       The common/unified `current_rating` is no longer the ladder: the overall
       champion is the strongest RAPID player, so `student_time_ratings` is
       LEFT JOINed on the rapid pool and ordered by that rating. Students with
       no rapid games get NULL and sort last (the frontend maps null to
       -Infinity), so they can never outrank an actual rapid player.

       current_rating is still selected only so the API response shape does not
       break existing consumers; no screen displays it any more. */
    db.query(
      `SELECT u.id AS user_id, u.name, u.avatar_config, u.profile_image, s.id AS student_id, s.current_rating,
              s.peak_rating, s.highest_level, s.games_played, s.group_id, g.name AS group_name,
              rt.rating AS rapid_rating, rt.peak_rating AS rapid_peak,
              rt.games_played AS rapid_games, rt.highest_level AS rapid_level
       FROM students s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN groups g ON g.id = s.group_id
       LEFT JOIN student_time_ratings rt ON rt.student_id = s.id AND rt.time_class = 'rapid'
       WHERE 1=1 ${hideClause}
       ORDER BY rt.rating DESC NULLS LAST, rt.games_played DESC NULLS LAST, u.name ASC
       LIMIT $1`,
      [limit]
    ),
    db.query(
      `SELECT student_user_id AS user_id, SUM(wins)::int AS wins, SUM(losses)::int AS losses, SUM(draws)::int AS draws
       FROM student_game_analysis GROUP BY student_user_id`
    ),
    db.query(
      `SELECT student_id, COALESCE(SUM(score), 0)::int AS pts
       FROM puzzle_attempts WHERE result = 'correct' GROUP BY student_id`
    ),
    db.query(
      `SELECT student_id, rating_after, time_control, played_at
       FROM (
         SELECT student_id, rating_after, time_control, played_at,
                ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY played_at DESC) AS rn
         FROM rating_history
       ) h WHERE h.rn <= 14`,
    ),
    /* RAPID-pool history for the last 14 Rapid games per student. The Weekly
       tab ranks on this, NOT `rating_history` — the common pool is no longer a
       rating anywhere in the UI, so a Weekly number taken from it would be the
       one place the old combined rating still leaked through. */
    db.query(
      `SELECT s.user_id, h.rating_after, h.played_at
         FROM (
           SELECT student_id, rating_after, played_at,
                  ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY played_at DESC) AS rn
             FROM time_control_rating_history
            WHERE time_class = 'rapid'
         ) h
         JOIN students s ON s.id = h.student_id
        WHERE h.rn <= 14`
    ),
    db.query(streakSQL),
    db.query(nemesisSQL),
    // Per-time-control rating pools, keyed by the student's USER id (the rest
    // of this function works in user-id space).
    db.query(
      `SELECT s.user_id, t.time_class, t.rating, t.peak_rating, t.games_played, t.highest_level
       FROM student_time_ratings t
       JOIN students s ON s.id = t.student_id
       WHERE 1=1 ${hideClause}`,
      []
    ),
    // Last 14 games per control, for each control's own sparkline. Joined to
    // students so the rows come back keyed by USER id, matching `timePoolsR`.
    db.query(
      `SELECT s.user_id, h.time_class, h.rating_after
       FROM (
         SELECT student_id, time_class, rating_after, played_at,
                ROW_NUMBER() OVER (PARTITION BY student_id, time_class ORDER BY played_at DESC) AS rn
         FROM time_control_rating_history
       ) h
       JOIN students s ON s.id = h.student_id
       WHERE h.rn <= 14`
    ),
  ]);

  const wld = new Map(wldR.rows.map(r => [r.user_id, r]));
  const puzzle = new Map(puzzleR.rows.map(r => [r.student_id, r.pts]));
  const streaks = new Map(streakR.rows.map(r => [r.user_id, r.streak]));
  const nemeses = new Map(nemR.rows.map(r => [r.user_id, r]));
  const history = new Map();
  for (const r of histR.rows) {
    if (!history.has(r.student_id)) history.set(r.student_id, []);
    history.get(r.student_id).push(r);
  }
  /* Rapid history keyed by USER id, to match the rest of this function. */
  const rapidHistory = new Map();
  for (const r of rapidHistR.rows) {
    const key = r.user_id;
    if (!rapidHistory.has(key)) rapidHistory.set(key, []);
    rapidHistory.get(key).push(r);
  }

  const WEEK = 7 * 24 * 60 * 60 * 1000;

  return base.rows.map((row, i) => {
    const lvl = levelForRating(row.current_rating);
    const rowWld = wld.get(row.user_id);
    const pts = puzzle.get(row.student_id) || 0;
    const rows = (history.get(row.student_id) || [])
      .slice()
      .sort((a, b) => new Date(a.played_at) - new Date(b.played_at));
    const spark = rows.map(r => r.rating_after);

    const nowMs = Date.now();

    /* WEEKLY = this week's RAPID form.
       It used to be read from `rating_history` (the common pool), which meant
       the Weekly tab still showed the combined rating the rest of the app had
       moved away from — and disagreed with the Overall Champion tab, since the
       two were computed from different pools. Weekly now derives from the same
       rapid pool the champion ladder uses.

         weeklyRating .. rapid rating as of the last Rapid game inside 7 days;
                          null when the student has no Rapid game this week, so
                          they sort last instead of inheriting a stale number.
         weeklyDelta ... change across the 7-day window, from the rating before
                          their first Rapid game in it to their latest. */
    const rapidRows = (rapidHistory.get(row.user_id) || []).slice()
      .sort((a, b) => new Date(a.played_at) - new Date(b.played_at));
    const lastRapid = rapidRows[rapidRows.length - 1];
    const hasRecentRapid = lastRapid && (nowMs - new Date(lastRapid.played_at).getTime()) < WEEK;
    const rapidWeekly = hasRecentRapid ? lastRapid.rating_after : null;
    const rapidWeekRows = rapidRows.filter((r) => (nowMs - new Date(r.played_at).getTime()) < WEEK);
    /* Net change across the window: the rating BEFORE the first in-window game
       to the rating AFTER the last one. `firstIdx` is the index of that first
       in-window game, so its predecessor may be at index 0 — there is no
       `firstIdx - 1` to read unguarded. */
    const firstIdx = rapidWeekRows.length ? rapidRows.indexOf(rapidWeekRows[0]) : -1;
    const beforeFirst = firstIdx > 0 ? rapidRows[firstIdx - 1].rating_after : STARTING_RATING;
    const rapidWeekDelta = rapidWeekRows.length
      ? rapidRows[rapidRows.length - 1].rating_after - beforeFirst
      : 0;

    /* Real per-time-control ratings, straight from `student_time_ratings`.
       A student with no games in a control has no row, so that control reports
       gamesPlayed 0 and rating null — never a fake 1000. */
    const timeRatings = {};
    for (const r of timePoolsR.rows) {
      timeRatings[r.user_id] = timeRatings[r.user_id] || {};
      timeRatings[r.user_id][r.time_class] = {
        rating: r.rating,
        peakRating: r.peak_rating,
        gamesPlayed: r.games_played,
        provisional: r.games_played < 20,
        level: r.highest_level,
      };
    }

    /* Recent per-class games, used for each control's own sparkline. */
    const tcHistory = new Map();
    for (const r of tcHistR2.rows) {
      const key = String(r.user_id);
      if (!tcHistory.has(key)) tcHistory.set(key, {});
      const byClass = tcHistory.get(key);
      if (!byClass[r.time_class]) byClass[r.time_class] = [];
      byClass[r.time_class].push(r.rating_after);
    }

    const perClass = (userId, cls) => timeRatings[userId]?.[cls] || null;
    const sparkFor = (userId, cls) => {
      const arr = tcHistory.get(String(userId))?.[cls];
      return arr ? arr.slice().reverse() : [];
    };

    const streak = streaks.get(row.user_id) || 0;
    const nemesis = nemeses.get(row.user_id);

    const timeRatingsOut = {};
    for (const cls of TIME_CLASSES) {
      const p = perClass(row.user_id, cls);
      timeRatingsOut[cls] = p
        ? { ...p, label: timeClassLabel(cls), icon: TIME_CLASS_META[cls].icon, spark: sparkFor(row.user_id, cls) }
        : { rating: null, peakRating: null, gamesPlayed: 0, provisional: true,
            label: timeClassLabel(cls), icon: TIME_CLASS_META[cls].icon, spark: [] };
    }

    return {
      rank: i + 1,
      ...row,
      wins: rowWld?.wins || 0,
      losses: rowWld?.losses || 0,
      draws: rowWld?.draws || 0,
      puzzlePoints: pts,
      streak,
      spark,
      weeklyRating: rapidWeekly,
      weeklyGames: rapidWeekRows.length,
      weeklyDelta: rapidWeekDelta,
      timeRatings: timeRatingsOut,
      // Kept for the existing Leaderboard tabs.
      blitzRating: perClass(row.user_id, 'blitz')?.rating ?? null,
      rapidRating: perClass(row.user_id, 'rapid')?.rating ?? null,
      /* The rapid numbers that decide the overall champion. A student who has
         never played rapid has rapidRating null and ranks last. */
      rapidPeakRating: row.rapid_peak ?? null,
      rapidGames: row.rapid_games ?? 0,
      rapidLevel: row.rapid_level ?? null,
      nemesisName: nemesis?.nemesis || null,
      nemesisDefeats: nemesis?.defeats || 0,
      badgedLevel: Math.max(lvl.level, row.highest_level || 1),
      badgeName: LEVELS[Math.max(lvl.level, row.highest_level || 1) - 1].badge,
      badgeIcon: BADGE_ICONS[Math.max(lvl.level, row.highest_level || 1)] || '♟',
      level: { number: lvl.level, tier: lvl.name, badge: lvl.badge, icon: BADGE_ICONS[lvl.level] },
    };
  });
}

/* ── rating analytics ─────────────────────────────────────────────────────
 * Everything the "Ratings" page needs in ONE round-trip. The leaderboard
 * answers "who is on top"; this answers "how does the whole academy look" —
 * spread of ratings, which level band everyone sits in, how the four
 * time-control pools compare, who moved most this week, and the raw
 * result-by-result feed.
 */

/** Width of one histogram bucket, in rating points. */
const HIST_BUCKET = 100;

/** Median of a numeric array (returns 0 for an empty list). */
function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Academy-wide rating analytics.
 *
 * `hidePrivate` mirrors leaderboard(): students who opted out of public
 * standings are excluded from every aggregate here too, so this page can't be
 * used to infer a hidden player's rating.
 *
 * `viewerStudentId` scopes the RECENT FEED to a single student - see the note on
 * that query below. It is passed by the controller from the authenticated
 * session, never from a request parameter, and is null for callers that want the
 * academy-wide feed (a coach, or an admin who has no student record). Every other
 * section of this payload (overview, histogram, level bands, per-control pools,
 * movers) stays academy-wide either way.
 */
async function ratingAnalytics({ limit = 20, hidePrivate = true, viewerStudentId = null } = {}) {
  const hideClause = hidePrivate ? 'AND s.hide_from_leaderboard = FALSE' : '';
  /* Interpolated as a constant (not a bind param) because Postgres will not
     accept a parameter inside an INTERVAL expression. */
  const WEEK = '7 days';

  /* Is there a known viewer to scope the feed to? Normalised to a positive
     integer here so a malformed value can never widen the feed instead of
     narrowing it - a bad id must not silently fall back to "everyone". */
  const scopedViewer = Number.isInteger(viewerStudentId) && viewerStudentId > 0
    ? viewerStudentId
    : null;

  const [overviewR, ratingsR, levelsR, classesR, moversR, recentR] = await Promise.all([
    /* Headline stats are RAPID-based, matching the champion ladder: a student
       with no Rapid games is unrated, not counted as a 1000. */
    db.query(
      `SELECT COUNT(*)::int AS students,
              COUNT(*) FILTER (WHERE rt.rating IS NOT NULL)::int AS rated,
              COALESCE(ROUND(AVG(rt.rating)), 0)::int AS avg_rating,
              COALESCE(MIN(rt.rating), 0)::int AS min_rating,
              COALESCE(MAX(rt.rating), 0)::int AS max_rating,
              COALESCE(SUM(rt.games_played), 0)::int AS total_games,
              COUNT(*) FILTER (WHERE rt.games_played < 20)::int AS provisional
       FROM students s
       LEFT JOIN student_time_ratings rt ON rt.student_id = s.id AND rt.time_class = 'rapid'
       WHERE 1=1 ${hideClause}`
    ),
    /* Histogram and level spread are RAPID-based too, so every number on the
       page describes the same ladder. A student with no Rapid pool has no
       rating to plot and is excluded (they are not a 0 or a 1000). */
    db.query(
      `SELECT rt.rating AS current_rating
         FROM students s
         JOIN student_time_ratings rt ON rt.student_id = s.id AND rt.time_class = 'rapid'
        WHERE 1=1 ${hideClause}`
    ),
    db.query(
      `SELECT rt.highest_level AS level, count(*)::int AS count
         FROM students s
         JOIN student_time_ratings rt ON rt.student_id = s.id AND rt.time_class = 'rapid'
        WHERE 1=1 ${hideClause}
        GROUP BY rt.highest_level ORDER BY rt.highest_level`
    ),
    db.query(
      `SELECT t.time_class,
              COUNT(DISTINCT t.student_id)::int AS players,
              COALESCE(ROUND(AVG(t.rating)), 0)::int AS avg_rating,
              COALESCE(MAX(t.rating), 0)::int AS top_rating,
              COALESCE(SUM(t.games_played), 0)::int AS games,
              COUNT(*) FILTER (WHERE t.games_played < 20)::int AS provisional
       FROM student_time_ratings t
       JOIN students s ON s.id = t.student_id
       WHERE 1=1 ${hideClause}
       GROUP BY t.time_class ORDER BY t.time_class`
    ),
    /* Movers: within the 7-day window, the rating BEFORE the player's first
       game vs the rating AFTER their last one. MIN/MAX over those two columns
       is the true net change regardless of the order results arrived in. */
    db.query(
      `WITH win AS (
         SELECT student_id,
                MIN(rating_before) AS start_rating,
                MAX(rating_after)  AS end_rating,
                COUNT(*)::int      AS games
         FROM rating_history
         WHERE rated = TRUE AND played_at >= NOW() - INTERVAL '${WEEK}'
         GROUP BY student_id
       )
       SELECT w.student_id, u.name, u.avatar_config, u.profile_image,
              w.start_rating, w.end_rating,
              (w.end_rating - w.start_rating)::int AS delta, w.games
       FROM win w
       JOIN students s ON s.id = w.student_id
       JOIN users u ON u.id = s.user_id
       WHERE 1=1 ${hideClause}
       ORDER BY ABS(w.end_rating - w.start_rating) DESC, w.games DESC
       LIMIT $1`,
      [limit]
    ),
    /* The raw result feed.

       OWNERSHIP. Every rated game writes TWO rows: one per player, each naming
       the other as their opponent. An unscoped feed therefore renders the
       opponent's mirrored row immediately under the viewer's own -

           Nagavel k | win  | Manivel M |  940 -> 953 | +13
           Manivel M | loss | Nagavel k | 1063 -> 1050 | -13

       - which reads as though two games were played, and hands each student the
       other player's rating move. When the caller is a known viewer the feed is
       restricted to `h.student_id = viewerStudentId`.

       The restriction is in the WHERE clause, BEFORE ORDER BY and LIMIT, so the
       viewer still receives `limit` rows of their OWN most recent games. Filtering
       after the LIMIT would shrink the page to roughly half its size, because
       every opponent row within it would then be discarded. It is deliberately
       NOT a game-id dedup: both rows are valid records and both stay in the
       table - this only decides which perspective each viewer is shown.

       `hide_from_leaderboard` is deliberately NOT applied to the viewer's own
       rows. That flag exists so one student's rating cannot be inferred by
       somebody else, and a student's own history is not inferable by anyone. It
       still applies to the unscoped academy-wide feed.

       The OPPONENT is resolved by JOINING `h.opponent_id` through students to
       users, NOT by reading `h.opponent_name`. That column is a name SNAPSHOT
       taken when the row was written, and it is NULL on rows written before
       applyOnlineRating's student-id bug was fixed (it built its name map keyed
       on a column its own SELECT did not return). `opponent_id`, by contrast, is
       populated and resolves on every row and is never the player themself.

       So: the live joined name is the answer (it also survives a rename, which a
       snapshot cannot), the stored snapshot is only a last-resort fallback, and
       `h.opponent_name` is aliased away so no caller can accidentally read the
       unreliable column instead of the resolved one. */
    db.query(
      `SELECT h.id, h.result, h.rating_before, h.rating_after, h.rating_change,
              h.time_control, h.game_type, h.played_at,
              h.opponent_id,
              COALESCE(ou.name, h.opponent_name) AS opponent_name,
              s.id AS student_id, u.name AS student_name,
              u.avatar_config, u.profile_image
       FROM rating_history h
       JOIN students s ON s.id = h.student_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN students os ON os.id = h.opponent_id
       LEFT JOIN users ou ON ou.id = os.user_id
       WHERE h.rated = TRUE
         AND 1=1 ${scopedViewer ? 'AND h.student_id = $2' : hideClause}
       ORDER BY h.played_at DESC, h.id DESC
       LIMIT $1`,
      scopedViewer ? [limit, scopedViewer] : [limit]
    ),
  ]);
  const all = ratingsR.rows.map((r) => r.current_rating);
  const levelCounts = new Map(levelsR.rows.map((r) => [r.level, r.count]));

  /* Level bands, each annotated with how many students ever reached it. */
  const levels = LEVELS.map((l) => ({
    level: l.level,
    min: l.min,
    max: l.max === Infinity ? null : l.max,
    tier: l.name,
    badge: l.badge,
    icon: BADGE_ICONS[l.level] || '♟',
    count: levelCounts.get(l.level) || 0,
  }));

  /* 100-point histogram, ordered low → high for the bar chart. A trailing
     bucket absorbs anything above the top band (2200+). */
  const start = all.length ? Math.floor(Math.min(...all) / HIST_BUCKET) * HIST_BUCKET : 1000;
  const end = all.length ? Math.floor(Math.max(...all) / HIST_BUCKET) * HIST_BUCKET : 1000;
  const buckets = [];
  for (let b = start; b <= end; b += HIST_BUCKET) buckets.push({ from: b, to: b + HIST_BUCKET - 1, count: 0 });
  for (const v of all) {
    const i = Math.min(buckets.length - 1, Math.max(0, Math.floor(v / HIST_BUCKET) - Math.floor(start / HIST_BUCKET)));
    buckets[i].count += 1;
  }

  /* Always return all four controls (in ratingService order) even when a pool
     is empty, so the UI keeps a stable four-column layout. */
  const classes = new Map(classesR.rows.map((r) => [r.time_class, r]));
  const timeClasses = TIME_CLASSES.map((cls) => {
    const r = classes.get(cls) || {};
    return {
      timeClass: cls,
      label: timeClassLabel(cls),
      icon: TIME_CLASS_META[cls].icon,
      players: r.players || 0,
      avgRating: r.avg_rating ?? null,
      topRating: r.top_rating ?? null,
      games: r.games || 0,
      provisional: r.provisional || 0,
    };
  });

  return {
    overview: { ...overviewR.rows[0], median_rating: median(all) },
    levels,
    histogram: buckets,
    timeClasses,
    movers: moversR.rows,
    recent: recentR.rows,
    /* The exact rules the maths uses, so the page explains itself instead of
       asking the reader to trust a number. */
    kFactors: [
      { k: 40, reason: 'new', when: 'First 20 rated games (provisional)' },
      { k: 32, reason: 'under-18', when: 'Under 18 years old' },
      { k: 15, reason: 'advanced', when: 'Peak rating 2200 or above' },
      { k: 20, reason: 'regular', when: 'Established player' },
    ],
    /* The four time-control bands, as the classifier applies them. */
    bands: TIME_CLASSES.map((cls) => ({ timeClass: cls, ...TIME_CLASS_META[cls] })),
  };
}

module.exports = {
  applyGameResult,
  applyGameResultInTransaction,
  issueLevelCertificates,
  applyTimeControlResult,
  getTimeRating,
  classifyTimeControl,
  timeClassLabel,
  TIME_CLASSES,
  TIME_CLASS_META,
  buildProfile,
  leaderboard,
  ratingAnalytics,
  kFactor,
  kFactorDetailed,
  expectedScore,
  newRating,
  levelForRating,
  STARTING_RATING,
  LEVELS,
  BADGE_ICONS,
};