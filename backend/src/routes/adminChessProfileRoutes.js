const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const ctrl = require('../controllers/adminChessProfileController');

const router = express.Router();

/* Staff-only, and enforced HERE rather than only in the UI: a student token is
   refused with 403 before any handler runs. Super admins inherit 'admin', so
   one `roleMiddleware('admin')` covers both staff roles. */
router.use(authMiddleware);
router.use(roleMiddleware('admin'));

router.get('/', ctrl.list);
router.get('/:studentId', ctrl.profile);
router.post('/:studentId/sync', ctrl.sync);
router.get('/:studentId/accounts/:accountId/ratings', ctrl.ratings);
router.get('/:studentId/statistics', ctrl.statistics);
router.get('/:studentId/openings', ctrl.openings);
router.get('/:studentId/insights', ctrl.insights);
router.get('/:studentId/games', ctrl.games);
router.get('/:studentId/games/:gameId/analysis', ctrl.gameAnalysis);
router.post('/:studentId/games/:gameId/analysis', ctrl.saveAnalysis);
router.get('/:studentId/games/:gameId', ctrl.game);

module.exports = router;
