const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/tournamentController');
const authMiddleware = require('../middleware/authMiddleware');

/* Live tournament boards. Mounted on the same /api/tournaments prefix. Whether
   the caller is actually a player in the game is enforced by the game service. */
router.use('/games', authMiddleware);

router.get('/games/:gameId', ctrl.getGame);
router.post('/games/:gameId/move', ctrl.move);
router.post('/games/:gameId/resign', ctrl.resign);
router.post('/games/:gameId/draw', ctrl.offerDraw);
router.post('/games/:gameId/draw/respond', ctrl.respondDraw);
router.post('/games/:gameId/berserk', ctrl.berserk);

module.exports = router;
