const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/leaderboardController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const requireFeature = require('../middleware/requireFeature');

router.use(authMiddleware);

/* The comparison is a student's view of themself against a classmate, so it is
   student-only and sits behind the same `leaderboard` switch as the public
   board it is opened from. A staff account has no "me" on this ladder. */
router.get(
  '/compare/:opponentId',
  roleMiddleware('student'),
  requireFeature('leaderboard'),
  ctrl.compare,
);

module.exports = router;
