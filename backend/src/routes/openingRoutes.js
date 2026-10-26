const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const ctrl = require('../controllers/openingController');
const authMiddleware = require('../middleware/authMiddleware');

/* Try to decode a Bearer token but keep going when absent/expired —
   course browsing works for guests, progress simply won't attach. */
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    } catch { /* ignore bad token */ }
  }
  next();
}

router.get('/options', ctrl.getOptions);
router.get('/progress-summary', authMiddleware, ctrl.progressSummary);
router.get('/explorer', ctrl.explorerProxy);
router.get('/courses', optionalAuth, ctrl.listCourses);
router.get('/courses/:slug', optionalAuth, ctrl.getCourse);
router.get('/poll', ctrl.getPoll);
router.post('/poll/vote', ctrl.votePoll);
router.post('/poll/suggest', ctrl.suggestOpening);

router.post('/courses', authMiddleware, ctrl.createCourse);
router.patch('/courses/:slug', authMiddleware, ctrl.updateCourse);
router.post('/courses/:slug/progress', authMiddleware, ctrl.recordProgress);
router.post('/courses/:slug/like', authMiddleware, ctrl.toggleLike);
router.post('/courses/:slug/report', authMiddleware, ctrl.reportCourse);

module.exports = router;