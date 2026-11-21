const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const ctrl = require('../controllers/playerReportController');

/* New exact prefix. Mounted in app.js before the bare `/api` catch-all so it
   can never fall through to the unrelated game-analysis routes. */
const router = express.Router();
router.use(authMiddleware);

/* Specific path first: `/game/:gameId` must never be swallowed by
   `/:studentId` if the route table is ever extended. */
router.get('/game/:gameId', ctrl.getGameFeedback);
router.get('/:studentId', ctrl.getReport);

module.exports = router;
