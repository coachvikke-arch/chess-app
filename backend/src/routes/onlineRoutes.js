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
router.post('/games/:id/cancel-request', roleMiddleware('admin', 'student'), ctrl.cancelGameRequest);
router.post('/games/:id/abort', ctrl.abortGame);
router.post('/games/:id/resign', roleMiddleware('admin', 'student'), ctrl.resignGame);
/* Walking away from a live board: aborted when no move was played, resigned
   once there is a position worth recording. The server decides, not the UI. */
router.post('/games/:id/leave', roleMiddleware('admin', 'student'), ctrl.leaveGame);
/* "Settle every live board I am on." A plain `/games/:id/leave` cannot reach a
   game whose board rendered on a tab the user already left, so leaving the
   classroom asks once for all of them. */
router.post('/leave-active', roleMiddleware('admin', 'student'), ctrl.leaveActiveGames);
/* A clock ran out. Separate from resign so the recorded reason is genuinely
   'timeout' (and never a resignation inferred from a disconnect/close). */
router.post('/games/:id/timeout', roleMiddleware('admin', 'student'), ctrl.timeoutGame);
/* Draw is an OFFER, not an instant finish: the opponent must accept or decline.
   `/end` stays for the abandon-style flow and is no longer what the Draw button
   calls. */
router.post('/games/:id/draw-offer', roleMiddleware('admin', 'student'), ctrl.offerDraw);
router.post('/games/:id/draw-respond', roleMiddleware('admin', 'student'), ctrl.respondDraw);
/* Rematch: an offer on a FINISHED match, answered the same way a draw offer is.
   The server re-checks that both callers are the two players of that game and
   that the game really is over, so a crafted request cannot open a board for
   somebody else's match. */
/* The read side of the same offer — what the socket may have missed. */
router.get('/rematch-pending', roleMiddleware('admin', 'student'), ctrl.listPendingRematches);
router.post('/games/:id/rematch-request', roleMiddleware('admin', 'student'), ctrl.requestRematch);
router.post('/games/:id/rematch-respond', roleMiddleware('admin', 'student'), ctrl.respondRematch);
router.post('/games/:id/rematch-cancel', roleMiddleware('admin', 'student'), ctrl.cancelRematch);
router.post('/games/:id/move', ctrl.moveGame);
router.post('/games/:id/end', ctrl.endGame);

module.exports = router;
