const service = require('../services/playerReportService');
const visibility = require('../services/reviewVisibilityService');

/*
 * Player Report access rules, checked on every request:
 *   student    → only their own users.id (or the literal 'me')
 *   admin      → only allocated students (primary coach or student_coaches)
 *   superadmin → any student
 *
 * The :studentId in the URL is a users.id, matching the admin chess-profile
 * routes. visibility already returns users.id values, so no id-space conversion
 * is needed here.
 */

const SOURCES = new Set(['all', 'chesscom', 'lichess', 'matezone']);

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function resolveStudent(req, requestedId) {
  const role = req.user?.role;

  if (role === 'student') {
    const ownId = positiveId(req.user.id);
    if (requestedId != null && String(requestedId) !== 'me') {
      const asked = positiveId(requestedId);
      if (!asked || asked !== ownId) {
        throw visibility.forbidden('You can only view your own player report.');
      }
    }
    return ownId;
  }

  if (role !== 'admin' && role !== 'superadmin') {
    throw visibility.forbidden('Forbidden');
  }

  const id = positiveId(requestedId);
  if (!id) {
    const err = new Error('studentId is required.');
    err.status = 400;
    throw err;
  }
  const visibleIds = await visibility.getVisibleUserIds(req.user);
  return visibility.requireVisible(visibleIds, id, 'That student is not assigned to you.');
}

function noStore(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
}

exports.getReport = async (req, res) => {
  try {
    const source = req.query.source || 'all';
    if (!SOURCES.has(source)) {
      return res.status(400).json({ message: 'Invalid source.' });
    }
    const studentId = await resolveStudent(req, req.params.studentId);
    const fieldRating = req.query.fieldRating == null ? undefined : Number(req.query.fieldRating);
    const report = await service.getReport(studentId, source, fieldRating);
    noStore(res);
    return res.json(report);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('[player report] failed:', err.message);
    return res.status(500).json({ message: 'Failed to load player report.' });
  }
};

exports.getGameFeedback = async (req, res) => {
  try {
    const studentId = await resolveStudent(req, req.query.studentId ?? 'me');
    const gameId = positiveId(req.params.gameId);
    if (!gameId) return res.status(400).json({ message: 'Invalid gameId.' });

    const feedback = await service.getGameFeedback(studentId, gameId, req.query.source);
    noStore(res);
    if (!feedback) {
      return res.status(404).json({ message: 'Stored analysis for this game is not available yet.' });
    }
    return res.json(feedback);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('[player report] feedback failed:', err.message);
    return res.status(500).json({ message: 'Failed to load coach feedback.' });
  }
};
