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

/* Only the named admin decides. The controller enforces exactly that id, so a
   Super Admin passing this role guard still gets a 403 from the controller. */
router.post('/:id/accept', roleMiddleware('admin'), ctrl.accept);
router.post('/:id/cancel', roleMiddleware('admin'), ctrl.cancel);

module.exports = router;
