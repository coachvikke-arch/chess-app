const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/assignmentController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const requireFeature = require('../middleware/requireFeature');
const { requireFeatureByRole } = requireFeature;

router.use(authMiddleware);

// ── coach puzzle assignments (puzzle-based) ──
// These MUST stay above the `/:id` routes, otherwise Express matches
// "/puzzle-assignments" as an :id and these endpoints 404.
router.get('/puzzle-assignments', roleMiddleware('admin'), ctrl.listPuzzleAssignments);
router.get('/puzzle-assignments/sets', roleMiddleware('admin'), ctrl.listPuzzleAssignmentSets);
router.post('/puzzle-assignments', roleMiddleware('admin'), ctrl.createPuzzleAssignment);
router.patch('/puzzle-assignments/:id', roleMiddleware('admin'), ctrl.updatePuzzleAssignment);
router.post('/puzzle-assignments/:id/assign', roleMiddleware('admin'), ctrl.assignPuzzleAssignment);
router.get('/puzzle-assignments/:id/students', roleMiddleware('admin'), ctrl.getPuzzleAssignmentStudents);
router.get('/submissions/:submissionId/review', roleMiddleware('admin'), ctrl.getPuzzleAssignmentReview);
router.patch('/submissions/:submissionId/review', roleMiddleware('admin'), ctrl.markPuzzleAssignmentReviewed);

router.get('/', requireFeatureByRole({ student: 'assignments', coach: 'assign_lessons' }), ctrl.listAssignments);
router.get('/:id', requireFeatureByRole({ student: 'assignments', coach: 'assign_lessons' }), ctrl.getAssignment);
router.post('/', roleMiddleware('admin'), ctrl.createAssignment);
router.put('/:id', roleMiddleware('admin'), ctrl.updateAssignment);
router.delete('/:id', roleMiddleware('admin'), ctrl.deleteAssignment);
router.post('/:id/submit', roleMiddleware('student'), requireFeature('assignments'), ctrl.submitAssignment);
router.get('/:id/submissions', roleMiddleware('admin'), ctrl.getSubmissions);
router.put('/submissions/:submissionId/grade', roleMiddleware('admin'), ctrl.gradeSubmission);

module.exports = router;
