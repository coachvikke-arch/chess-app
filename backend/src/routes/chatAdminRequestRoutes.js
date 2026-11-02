const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/chatAdminRequestController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

/* A student asking their allocated coach for permission to chat.
 *
 * Mounted at its own path rather than under /api/chat for the same reason
 * /api/chat-requests is: the chat router is feature-gated per role, and an admin
 * whose messaging switch is off must still be able to answer a request, or the
 * gate has no operator.
 *
 * Each route states its role, and every controller re-checks the relationship
 * (who is allocated to whom, whose request this is) because the role alone is not
 * authorisation - any coach passes roleMiddleware('admin'), only ONE of them owns
 * a given request.
 */
router.use(authMiddleware);

/* The caller's own requests, as student or as admin. */
router.get('/', ctrl.mine);

/* Only a student asks. An admin sending this would be a request to themselves. */
router.post('/', roleMiddleware('student'), ctrl.create);

/* Only the named admin, or the academy owner standing in for them, may answer.
   The role guard is the door; the controller still checks WHICH request, because
   any coach passes roleMiddleware('admin') and only one of them owns a given row. */
router.post('/:id/accept', roleMiddleware('admin'), ctrl.accept);

/* Same authority as Accept, plus the learner who sent it: an unanswered ask is
   theirs to take back, and the controller refuses them the moment the row has
   been accepted (only a coach closes an open chat). */
router.post('/:id/cancel', roleMiddleware('admin', 'student'), ctrl.cancel);

module.exports = router;
