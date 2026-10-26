const profile = require('../services/unifiedProfileService');
/* The one place that decides whose games/members a signed-in user may see. */
const visibility = require('../services/reviewVisibilityService');
const statistics = require('../services/statisticsService');
const openings = require('../services/openingService');
const insights = require('../services/insightsService');
const { PlatformHttpError } = require('../services/platformApi');

function friendly(err) {
  if (err instanceof PlatformHttpError) {
    return { status: err.status, message: err.message };
  }
  if (err.status) return { status: err.status, message: err.message };
  return { status: 500, message: err.message || 'Unexpected error' };
}

/* Every response on this controller is live sync state: account lists, game
   lists, and the result of a sync the user just triggered. A cached copy of any
   of them is exactly the "my game isn't showing" symptom this module exists to
   fix, so they are marked uncacheable at both the browser and any shared proxy.
   `cache: false` on the client only bypasses its in-memory map — it does not stop
   the browser or a CDN from reusing a previous response. */
function wrap(fn) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    try {
      const out = await fn(req);
      res.json(out);
    } catch (err) {
      const f = friendly(err);
      res.status(f.status).json({ message: f.message });
    }
  };
}

/* GET /api/chess-profiles — all connected accounts with ratings + counts */
exports.list = wrap(async (req) => {
  const accounts = await profile.accountsForUser(req.user.id);
  return { accounts };
});

/* POST /api/chess-profiles/validate — { platform, username } (no persistence) */
exports.validate = wrap(async (req) => {
  return profile.validate(req.body.platform, req.body.username);
});

/* POST /api/chess-profiles/connect — { platform, username } */
exports.connect = wrap(async (req) => {
  return profile.connect(req.user.id, req.body.platform, req.body.username);
});

/* DELETE /api/chess-profiles/:id */
exports.disconnect = wrap(async (req) => {
  return profile.disconnect(req.user.id, Number(req.params.id));
});

/* POST /api/chess-profiles/:id/sync[?recent=1] */
exports.sync = wrap(async (req) => {
  return profile.syncAccount(req.user.id, Number(req.params.id), { recent: req.query.recent === '1' });
});

/* POST /api/chess-profiles/:id/sync-latest
   The poll endpoint. Always incremental: it asks for the current Chess.com month
   directly rather than trusting the archive index for which month is current,
   advances a watermark, and dedupes on the game URL. Exposed separately from
   /sync so the polling client can never accidentally trigger the 24-month
   backfill. `partial`/`note` are surfaced so a rate-limited month is visible to
   the user instead of reading as a clean check. */
exports.syncLatest = wrap(async (req) => {
  return profile.syncLatest(req.user.id, Number(req.params.id));
});

/* GET /api/chess-profiles/:id/ratings — current + best + history */
exports.ratings = wrap(async (req) => {
  return profile.ratingsForAccount(Number(req.params.id), req.user.id);
});

/* GET /api/chess-profiles/statistics[?platform=] */
exports.statistics = wrap(async (req) => {
  return statistics.buildStatistics(req.user.id, req.query.platform || null);
});

/* GET /api/chess-profiles/openings[?platform=] */
exports.openings = wrap(async (req) => {
  return openings.buildOpenings(req.user.id, req.query.platform || null);
});

/* GET /api/chess-profiles/insights */
exports.insights = wrap(async (req) => {
  return insights.buildInsights(req.user.id);
});

/* GET /api/chess-profiles/games — unified, paginated, filterable */
exports.games = wrap(async (req) => {
  const { platform, result, timeClass, q, from, to, opponent, page, pageSize, sort } = req.query;
  return profile.listGames(req.user.id, {
    platform: platform || null,
    result: result || null,
    timeClass: timeClass || null,
    q: q || null,
    from: from || null,
    to: to || null,
    opponent: opponent || null,
    page: page || 1,
    pageSize: pageSize || 25,
    sort: sort || 'desc',
  });
});

/* GET /api/chess-profiles/games/:id
 *
 * Scoped to the caller's VISIBILITY set, not to their own id: a coach must be
 * able to open one of their students' imported games in order to review it.
 * reviewVisibilityService decides the set from the JWT - a plain [own id] for a
 * student, the assigned students for a coach, everything for a superadmin. A
 * game outside the set is reported as 404, so it is indistinguishable from one
 * that does not exist. */
exports.game = wrap(async (req) => {
  const visibleIds = await visibility.getVisibleUserIds(req.user);
  return profile.getGameForUsers(visibility.visibleIdArray(visibleIds), req.params.id);
});

/* GET /api/chess-profiles/games/:id/analysis
 *
 * Deliberately NOT widened. imported_game_analysis is keyed (game_id, user_id):
 * it is the viewer's own saved notes. Reading another student's analysis would
 * hand over their coaching history, which is not what "review this game" needs. */
exports.gameAnalysis = wrap(async (req) => {
  return profile.getAnalysis(req.user.id, req.params.id);
});

/* POST /api/chess-profiles/games/:id/analysis — persist client-computed Stockfish analysis.
 *
 * The GAME may belong to any visible user (so a coach can record their review of
 * a student's game), but the row written is keyed by the viewer's own id - so a
 * coach's analysis is added alongside the student's, never over the top of it. */
exports.saveAnalysis = wrap(async (req) => {
  const visibleIds = await visibility.getVisibleUserIds(req.user);
  return profile.saveAnalysisForUsers(
    visibility.visibleIdArray(visibleIds), req.user.id, req.params.id, req.body || {}
  );
});

/* DELETE /api/chess-profiles/games/:id — remove one imported game */
exports.deleteGame = wrap(async (req) => {
  return profile.deleteGame(req.user.id, req.params.id);
});