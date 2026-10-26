const express = require('express');
const studentRouter = express.Router();
const adminRouter = express.Router();

const homework = require('../controllers/homeworkController');
const puzzleCtrl = require('../controllers/puzzleController');
const assignmentCtrl = require('../controllers/assignmentController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const requireFeature = require('../middleware/requireFeature');

/* Student surface — /api/student/homework.
   Gated exactly like /api/puzzles (puzzle_trainer), so a student whose puzzle
   access is switched off does not get a Homework card they cannot open. */
studentRouter.use(authMiddleware, roleMiddleware('student'), requireFeature('puzzle_trainer'));

studentRouter.get('/', homework.listStudentHomework);
studentRouter.get('/:id', homework.getStudentHomework);
studentRouter.post('/:id/progress', homework.saveStudentProgress);
/* Submission reuses the one implementation the Puzzles page already calls, so
   scoring and the lock-after-submit rule cannot diverge between the two. */
studentRouter.post('/:id/submit', puzzleCtrl.submitPuzzleAssignment);

/* Admin surface — /api/homework. Coaches and the owner both pass
   roleMiddleware('admin'); students are rejected here. */
adminRouter.use(authMiddleware, roleMiddleware('admin'));

adminRouter.get('/', homework.listHomework);
adminRouter.get('/:id/progress', assignmentCtrl.getPuzzleAssignmentStudents);

module.exports = { studentRouter, adminRouter };
