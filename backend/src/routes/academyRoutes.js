const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/academyController');
const authMiddleware = require('../middleware/authMiddleware');
const requireFeature = require('../middleware/requireFeature');

/* Coach/Admin/Super Admin browse the academy in preview mode, so the
   student-facing feature switch must not lock staff out of the pages they are
   meant to inspect. Students keep the normal gate. */
const STAFF_ROLES = new Set(['superadmin', 'super_admin', 'admin', 'coach']);
const pieceLessonsGate = requireFeature('piece_lessons');
const gateUnlessStaff = (req, res, next) =>
  STAFF_ROLES.has(String(req.user?.role)) ? next() : pieceLessonsGate(req, res, next);

router.get('/overview', authMiddleware, gateUnlessStaff, ctrl.getOverview);
router.get('/levels/:slug', authMiddleware, gateUnlessStaff, ctrl.getLevel);
router.get('/lessons/:levelSlug/:lessonSlug', authMiddleware, gateUnlessStaff, ctrl.getLesson);
router.post('/exercises/complete', authMiddleware, ctrl.completeExercise);
router.post('/sessions/complete', authMiddleware, ctrl.completeSession);
router.get('/badges', authMiddleware, ctrl.getBadges);

module.exports = router;