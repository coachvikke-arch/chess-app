const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dashboardController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

router.get('/student', authMiddleware, roleMiddleware('student'), ctrl.studentDashboard);
router.get('/coach', authMiddleware, roleMiddleware('admin'), ctrl.coachDashboard);
router.get('/analysis', authMiddleware, roleMiddleware('admin'), ctrl.gameAnalysis);

/* Coach/admin analytics for the redesigned dashboard. Each endpoint returns
   real aggregated data scoped to the coach's own students via student_id /
   coach_id relationships. No hardcoded values. */
router.get('/coach/activity', authMiddleware, roleMiddleware('admin'), ctrl.studentActivity);
router.get('/coach/assignments', authMiddleware, roleMiddleware('admin'), ctrl.assignmentProgress);
router.get('/coach/puzzles', authMiddleware, roleMiddleware('admin'), ctrl.puzzleAnalytics);
router.get('/coach/attendance', authMiddleware, roleMiddleware('admin'), ctrl.attendanceAnalytics);
router.get('/coach/chess-performance', authMiddleware, roleMiddleware('admin'), ctrl.chessPerformance);

module.exports = router;
