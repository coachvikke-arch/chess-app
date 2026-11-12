const compareService = require('../services/leaderboardCompareService');

// GET /api/leaderboard/compare/:opponentId
//
// "Me" is ALWAYS the authenticated session — there is no query parameter for
// it. A caller can only ask who they are, so a student cannot read a stat sheet
// about two other people by editing the URL.
exports.compare = async (req, res) => {
  try {
    const opponentId = Number(req.params.opponentId);
    if (!Number.isInteger(opponentId) || opponentId <= 0) {
      return res.status(400).json({ message: 'Invalid opponent' });
    }
    const data = await compareService.compare({
      viewerUserId: req.user.id,
      opponentUserId: opponentId,
    });
    res.json(data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('[leaderboard] compare failed:', err.message);
    res.status(500).json({ message: 'Failed to compare players' });
  }
};
