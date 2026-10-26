/* ──────────── Which games get analysed automatically? ────────────

   Two tiers are analysed, and ONLY these two. Anything else is never
   enqueued, so the queue can never fill up with work nobody asked for:

     app_played      — the game was played inside this app, by a student, and
                       they can see it again from their own history. Analysing
                       it is the feature working: they finish a game and the
                       verdicts are already there when they open the review.
     profile_import  — the game came from a connected chess.com / Lichess
                       account and now sits in their library. Analysing it is
                       bulk work: real value, but nobody is waiting at a spinner
                       for it, so it yields to app_played in the queue.

   NOT ELIGIBLE, deliberately:
     · gm_games (the admin-imported grandmaster catalogue) — those are reference
       games, not anybody's own play, and there are thousands of them. A bulk
       import would keep the worker busy forever and starve real students.
     · a game that has no moves, or whose PGN will not replay. Enqueuing it
       would burn a job to produce an error; see isWorthAnalysing below.
     · anyone who has opted out.

   WHY THIS IS A SEPARATE MODULE AND NOT AN `IF` AT EACH CALL SITE
   Four different places enqueue work (online finish, computer save, profile
   import, tournament finish) and they must agree, exactly. One table, one
   function, and a test that pins the mapping is the only way "computer games
   are app_played" cannot quietly become "computer games are skipped" in one
   of the four. */

/** The sources the analysis tables know about. Mirrors their CHECK constraint. */
const GAME_SOURCES = ['chess_profile', 'online', 'computer', 'tournament'];

/**
 * Source → eligibility tier. This IS the policy; everything else reads it.
 *
 * `tournament` is app_played because its games are played inside this app by
 * students, exactly like an online game — it is a real student's own game with
 * a real result they will want reviewed.
 */
const SOURCE_ELIGIBILITY = {
  online: 'app_played',
  computer: 'app_played',
  tournament: 'app_played',
  chess_profile: 'profile_import',
};

/** What the two tiers mean, for callers that need to branch (e.g. bulk pacing). */
const ELIGIBILITY_TIERS = ['app_played', 'profile_import'];

/**
 * The queue runs app_played first. Numbered so "is this at least as urgent as
 * that?" is a comparison rather than a string sort.
 */
const ELIGIBILITY_PRIORITY = { app_played: 0, profile_import: 1 };

/** An empty/missing PGN cannot be reviewed, so it must never be queued. */
function isWorthAnalysing({ pgn, movesCount } = {}) {
  if (typeof pgn === 'string' && pgn.trim().length) return true;
  return Number.isFinite(Number(movesCount)) && Number(movesCount) > 0;
}

/**
 * Decide whether a game should be analysed automatically.
 *
 * Returns { eligible, eligibility, reason }. `reason` is a stable machine
 * token, not prose: the API returns it so a caller can tell "not eligible"
 * (do not retry) from "queued" (poll again), and the tests assert on it.
 */
function classifyGame({ gameSource, pgn, movesCount } = {}) {
  if (!GAME_SOURCES.includes(gameSource)) {
    return { eligible: false, eligibility: null, reason: 'unknown_source' };
  }
  const eligibility = SOURCE_ELIGIBILITY[gameSource];
  if (!eligibility) {
    return { eligible: false, eligibility: null, reason: 'source_not_eligible' };
  }
  if (!isWorthAnalysing({ pgn, movesCount })) {
    return { eligible: false, eligibility, reason: 'no_moves' };
  }
  return { eligible: true, eligibility, reason: 'eligible' };
}

/** The narrow question most call sites actually ask. */
function isAutoAnalysisEligible(game) {
  return classifyGame(game).eligible;
}

/**
 * How many bulk-import jobs may be queued at once.
 *
 * A chess.com sync can bring in hundreds of games at a time. Queuing every one
 * of them immediately means a student's own finished game — enqueued a minute
 * later — sits behind an hour of library backfill. So a bulk import only fills
 * the queue up to this many PROFILE-IMPORT jobs; anything beyond waits for the
 * next sync. App-played jobs are never throttled.
 */
function profileImportBudget({ queuedProfileImports = 0, cap = Number(process.env.ANALYSIS_IMPORT_QUEUE_CAP) || 50 } = {}) {
  return Math.max(0, cap - queuedProfileImports);
}

module.exports = {
  GAME_SOURCES,
  SOURCE_ELIGIBILITY,
  ELIGIBILITY_TIERS,
  ELIGIBILITY_PRIORITY,
  classifyGame,
  isAutoAnalysisEligible,
  isWorthAnalysing,
  profileImportBudget,
};
