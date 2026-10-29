const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/puzzleGeneratorController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

/* Admin Puzzle Generator.
 *
 * Admin/coach only: `roleMiddleware('admin')` also admits the superadmin, and
 * nothing here is exposed to students.
 *
 * Generation itself runs in a forked child (services/puzzleGenerator/jobs.js),
 * so POST /start returns immediately with a job id the UI polls once a second.
 */

const adminOnly = [authMiddleware, roleMiddleware('admin')];

router.get('/topics', adminOnly, ctrl.listTopics);
router.post('/start', adminOnly, ctrl.start);
router.post('/save', adminOnly, ctrl.save);
router.get('/:jobId', adminOnly, ctrl.status);
router.post('/:jobId/cancel', adminOnly, ctrl.cancel);

module.exports = router;
