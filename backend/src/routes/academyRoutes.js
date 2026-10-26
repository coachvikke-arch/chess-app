const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/academyController');
const authMiddleware = require('../middleware/authMiddleware');
const requireFeature = require('../middleware/requireFeature');

router.get('/overview', authMiddleware, requireFeature('piece_lessons'), ctrl.getOverview);
router.get('/levels/:slug', authMiddleware, requireFeature('piece_lessons'), ctrl.getLevel);
router.get('/lessons/:levelSlug/:lessonSlug', authMiddleware, requireFeature('piece_lessons'), ctrl.getLesson);
router.post('/exercises/complete', authMiddleware, ctrl.completeExercise);
router.post('/sessions/complete', authMiddleware, ctrl.completeSession);
router.get('/badges', authMiddleware, ctrl.getBadges);

module.exports = router;