const adminProfile = require('../services/adminChessProfileService');
const profile = require('../services/unifiedProfileService');
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

/* Same freshness contract as the student-facing controller: every response here
   is live sync state, so neither the browser nor a shared proxy may reuse it. */
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

/* GET /api/admin/chess-profiles — accessible students + linked usernames/ratings */
exports.list = wrap(async (req) => {
  const students = await adminProfile.listStudents(req.user);
  return { students };
});

/* GET /api/admin/chess-profiles/:studentId — header row + full account payload */
exports.profile = wrap(async (req) => {
  return adminProfile.studentProfile(req.user, req.params.studentId);
});

/* POST /api/admin/chess-profiles/:studentId/sync — re-fetch both public APIs */
exports.sync = wrap(async (req) => {
  return adminProfile.syncStudent(req.user, req.params.studentId);
});

/* GET /api/admin/chess-profiles/:studentId/accounts/:accountId/ratings
   Same payload the student's own card reads (current + best + history). The
   account lookup is keyed to the STUDENT's user id, so an account id belonging
   to anyone else answers 404 even inside the coach's own scope. */
exports.ratings = wrap(async (req) => {
  const student = await adminProfile.resolveStudent(req.user, req.params.studentId);
  return profile.ratingsForAccount(Number(req.params.accountId), student.user_id);
});

/* GET /api/admin/chess-profiles/:studentId/statistics[?platform=] */
exports.statistics = wrap(async (req) => {
  const student = await adminProfile.resolveStudent(req.user, req.params.studentId);
  return statistics.buildStatistics(student.user_id, req.query.platform || null);
});

/* GET /api/admin/chess-profiles/:studentId/openings[?platform=] */
exports.openings = wrap(async (req) => {
  const student = await adminProfile.resolveStudent(req.user, req.params.studentId);
  return openings.buildOpenings(student.user_id, req.query.platform || null);
});

/* GET /api/admin/chess-profiles/:studentId/insights */
exports.insights = wrap(async (req) => {
  const student = await adminProfile.resolveStudent(req.user, req.params.studentId);
  return insights.buildInsights(student.user_id);
});

/* GET /api/admin/chess-profiles/:studentId/games — same filters as the student page */
exports.games = wrap(async (req) => {
  const student = await adminProfile.resolveStudent(req.user, req.params.studentId);
  const { platform, result, outcome, timeClass, q, from, to, opponent, page, pageSize, sort } = req.query;
  return profile.listGames(student.user_id, {
    platform: platform || null,
    result: result || null,
    outcome: outcome || null,
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

/* GET /api/admin/chess-profiles/:studentId/games/:gameId */
exports.game = wrap(async (req) => {
  const student = await adminProfile.resolveStudent(req.user, req.params.studentId);
  return profile.getGameForUsers([student.user_id], req.params.gameId);
});

/* GET .../games/:gameId/analysis — the STUDENT's stored analysis, read-only.
   A coach opening the game sees the review the student already computed; they
   do not receive, and cannot overwrite, it. */
exports.gameAnalysis = wrap(async (req) => {
  const student = await adminProfile.resolveStudent(req.user, req.params.studentId);
  /* The game must belong to THIS student, not merely to some student the coach
     can see — otherwise a game id from another assigned student would answer
     with that student's stored review. */
  await profile.getGameForUsers([student.user_id], req.params.gameId);
  return profile.getAnalysis(student.user_id, req.params.gameId);
});

/* POST .../games/:gameId/analysis — the coach's own review of a student's game.
   Keyed to the CALLER's id, so it is stored alongside the student's analysis
   rather than replacing it. */
exports.saveAnalysis = wrap(async (req) => {
  const student = await adminProfile.resolveStudent(req.user, req.params.studentId);
  return profile.saveAnalysisForUsers(
    [student.user_id], req.user.id, req.params.gameId, req.body || {}
  );
});
