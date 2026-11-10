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
/* Coach-managed links. The student id in the path is the ONLY target: the
   service resolves it through the visibility gate before touching any row, so
   an unassigned student answers 403 and a student token never reaches the
   handler at all (router-level roleMiddleware). */
router.post('/:studentId/accounts', ctrl.connectAccount);
router.put('/:studentId/accounts/:accountId', ctrl.updateAccount);
router.delete('/:studentId/accounts/:accountId', ctrl.removeAccount);
router.get('/:studentId/accounts/:accountId/ratings', ctrl.ratings);
router.get('/:studentId/statistics', ctrl.statistics);
router.get('/:studentId/openings', ctrl.openings);
router.get('/:studentId/insights', ctrl.insights);
router.get('/:studentId/games', ctrl.games);
router.get('/:studentId/games/:gameId/analysis', ctrl.gameAnalysis);
router.post('/:studentId/games/:gameId/analysis', ctrl.saveAnalysis);
router.get('/:studentId/games/:gameId', ctrl.game);

module.exports = router;
