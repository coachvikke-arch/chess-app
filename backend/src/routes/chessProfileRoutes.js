const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/chessProfileController');
const authMiddleware = require('../middleware/authMiddleware');

// All profile integration routes require an authenticated user.
router.use(authMiddleware);

router.get('/', ctrl.list);
router.post('/validate', ctrl.validate);
router.post('/connect', ctrl.connect);
router.delete('/:id', ctrl.disconnect);
router.post('/:id/sync', ctrl.sync);
router.post('/:id/sync-latest', ctrl.syncLatest);
router.get('/:id/ratings', ctrl.ratings);

router.get('/statistics', ctrl.statistics);
router.get('/openings', ctrl.openings);
router.get('/insights', ctrl.insights);

router.get('/games', ctrl.games);
router.get('/games/:id/analysis', ctrl.gameAnalysis);
router.post('/games/:id/analysis', ctrl.saveAnalysis);
router.delete('/games/:id', ctrl.deleteGame);
router.get('/games/:id', ctrl.game);

module.exports = router;