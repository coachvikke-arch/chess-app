const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/quizController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

router.get('/leaderboard', ctrl.getLeaderboard);
router.get('/', authMiddleware, ctrl.listQuizzes);
router.get('/:id', authMiddleware, ctrl.getQuiz);
router.post('/', authMiddleware, roleMiddleware('admin'), ctrl.createQuiz);
router.post('/:id/submit', authMiddleware, roleMiddleware('student'), ctrl.submitQuiz);

module.exports = router;
