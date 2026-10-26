const db = require('../config/database');
const rating = require('../services/ratingService');

async function studentIdForUser(userId) {
  const r = await db.query('SELECT id FROM students WHERE user_id = $1', [userId]);
  return r.rows[0]?.id || null;
}

// For 'me' (or a missing param on the /me route) or numeric id.
// Students can only fetch their own; admins any.
function resolveStudentId(req) {
  const { id } = req.params;
  if (!id || id === 'me') {
    return studentIdForUser(req.user.id);
  }
  return Promise.resolve(Number(id));
}

// GET /students/:id/rating  (or '/students/me/rating')
exports.getProfile = async (req, res) => {
  try {
    const studentId = await resolveStudentId(req);
    if (!studentId) return res.status(404).json({ message: 'Student profile not found' });
    // Students may only view their own full profile.
    if (req.user.role === 'student' && req.params.id !== 'me') {
      const mine = await studentIdForUser(req.user.id);
      if (mine !== studentId) return res.status(403).json({ message: 'Only your own rating is visible' });
    }
    const profile = await rating.buildProfile(studentId);
    res.json(profile);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load rating profile', error: err.message });
  }
};

// GET /students/ratings/leaderboard
exports.leaderboard = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rows = await rating.leaderboard({ limit, hidePrivate: true });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load rating leaderboard', error: err.message });
  }
};

// GET /students/ratings/coach — all students' rating + badge + progress (admin/coach view)
exports.coachView = async (req, res) => {
  try {
    const rows = await rating.leaderboard({ limit: 500, hidePrivate: false });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load coach rating view', error: err.message });
  }
};

// GET /students/ratings/analytics — academy-wide rating spread, level bands,
// per-time-control pools, weekly movers and the raw result feed.
exports.analytics = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    /* Ownership of the recent feed comes from the AUTHENTICATED SESSION and
       nothing else. `req.query.studentId` / `req.query.userId` are deliberately
       ignored: this route has no `:id` segment, and if the viewer were taken from
       the request a student could read another student's rating history simply
       by editing the URL. A caller with no student record (a coach or admin
       browsing the academy) resolves to null and keeps the academy-wide feed,
       which is the intended behaviour for that audience. */
    const viewerStudentId = await studentIdForUser(req.user.id);
    const data = await rating.ratingAnalytics({ limit, hidePrivate: true, viewerStudentId });
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load rating analytics', error: err.message });
  }
};

// GET /students/ratings/levels — level bands reference (for UI)
exports.levelTable = async (req, res) => {
  res.json(rating.LEVELS.map((l, i) => ({
    level: l.level,
    min: l.min,
    max: l.max === Infinity ? null : l.max,
    tier: l.name,
    badge: l.badge,
    icon: rating.BADGE_ICONS[l.level] || '♟',
  })));
};