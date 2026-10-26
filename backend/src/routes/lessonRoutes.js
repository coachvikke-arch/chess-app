const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/courseController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

router.get('/:id', authMiddleware, ctrl.getLesson);
router.post('/', authMiddleware, roleMiddleware('admin'), ctrl.createLesson);
router.put('/:id', authMiddleware, roleMiddleware('admin'), ctrl.updateLesson);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), ctrl.deleteLesson);
router.post('/:id/complete', authMiddleware, roleMiddleware('student'), ctrl.completeLesson);

module.exports = router;
