const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/courseController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

router.get('/', ctrl.listCourses);
router.get('/:id', ctrl.getCourse);
router.post('/', authMiddleware, roleMiddleware('admin'), ctrl.createCourse);
router.put('/:id', authMiddleware, roleMiddleware('admin'), ctrl.updateCourse);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), ctrl.deleteCourse);

router.post('/modules', authMiddleware, roleMiddleware('admin'), ctrl.createModule);

module.exports = router;
