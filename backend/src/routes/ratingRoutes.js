const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/ratingController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const requireFeature = require('../middleware/requireFeature');

router.use(authMiddleware);

// Order matters: specific static paths before the /:id routes.
router.get('/leaderboard', requireFeature('leaderboard'), ctrl.leaderboard);
router.get('/champions', requireFeature('leaderboard'), ctrl.champions);
router.get('/champions/coach', roleMiddleware('admin'), ctrl.championsCoach);
router.get('/analytics', requireFeature('leaderboard'), ctrl.analytics);
router.get('/coach', roleMiddleware('admin'), ctrl.coachView);
router.get('/levels', ctrl.levelTable);

// /students/me/rating — a student's own rating profile.
router.get('/me', ctrl.getProfile);

// /students/:id/rating — admin view of a specific student.
router.get('/:id', ctrl.getProfile);

module.exports = router;