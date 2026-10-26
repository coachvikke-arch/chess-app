const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/onlineController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

router.use(authMiddleware);

router.get('/users', roleMiddleware('admin', 'student'), ctrl.listUsers);
router.get('/live', ctrl.listLive);
router.get('/games', ctrl.listGames);
router.post('/games', roleMiddleware('admin', 'student'), ctrl.createGame);
router.post('/classroom-games', roleMiddleware('admin'), ctrl.createClassroomGames);
router.post('/classroom-bot-games', roleMiddleware('admin'), ctrl.createClassroomBotGames);
router.get('/games/:id', ctrl.getGame);
  router.get('/games/:id/rating-result', ctrl.getRatingResult);
router.get('/games/:id/spectate', ctrl.spectateGame);
router.post('/games/:id/accept', roleMiddleware('admin', 'student'), ctrl.acceptGame);
router.post('/games/:id/decline', roleMiddleware('admin', 'student'), ctrl.declineGame);
router.post('/games/:id/abort', ctrl.abortGame);
router.post('/games/:id/resign', roleMiddleware('admin', 'student'), ctrl.resignGame);
/* A clock ran out. Separate from resign so the recorded reason is genuinely
   'timeout' (and never a resignation inferred from a disconnect/close). */
router.post('/games/:id/timeout', roleMiddleware('admin', 'student'), ctrl.timeoutGame);
router.post('/games/:id/react', ctrl.reactGame);
/* Draw is an OFFER, not an instant finish: the opponent must accept or decline.
   `/end` stays for the abandon-style flow and is no longer what the Draw button
   calls. */
router.post('/games/:id/draw-offer', roleMiddleware('admin', 'student'), ctrl.offerDraw);
router.post('/games/:id/draw-respond', roleMiddleware('admin', 'student'), ctrl.respondDraw);
router.post('/games/:id/move', ctrl.moveGame);
router.post('/games/:id/end', ctrl.endGame);

module.exports = router;