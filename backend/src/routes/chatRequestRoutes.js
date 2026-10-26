const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/chatRequestController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

/* Coach-approval-gated messaging requests.
 *
 * Deliberately NOT mounted under /api/chat: that router is wrapped in
 * requireFeatureByRole for the messenger itself, and a coach whose
 * 'messaging_students' switch is off must still be able to review and approve a
 * request - otherwise the gate would have no operator and requests would stall
 * forever behind a feature toggle. Authentication is the only blanket guard;
 * authorisation is per route.
 */
router.use(authMiddleware);

/* The eligibility check drives the Message button, so every signed-in user needs
 * it: a student asking "may I message this classmate?" is the whole feature. */
router.get('/eligibility', ctrl.eligibility);

/* Requester's own history - shown next to the Message button. */
router.get('/mine', ctrl.mine);

/* Creating a request is open to any signed-in user; the service decides whether
 * one is warranted (staff pairs never need one). */
router.post('/', ctrl.create);

/* Cancelling is deliberately NOT behind roleMiddleware: a student must be able to
 * end their own chat, so the route admits every signed-in user and the controller
 * decides per request - the two participants, the request's recorded panel, or
 * any admin. The status gate (pending or approved only) is enforced there too. */
router.post('/:id/cancel', ctrl.cancel);

/* The panel that decides a request: the two students' primary coaches AND Super
 * Admin. All three may approve OR reject, so roleMiddleware admits both roles here
 * - unlike every other admin route in the app.
 *
 * ORDERING MATTERS: '/inbox' and '/admin/all' are literal paths and MUST be
 * declared before the '/:id' catch-all below, or Express hands '/inbox' to the
 * detail handler with id="inbox" and the coach queue 500s. */
router.get('/inbox', roleMiddleware('admin', 'superadmin'), ctrl.inbox);
router.post('/:id/approve', roleMiddleware('admin', 'superadmin'), ctrl.approve);
router.post('/:id/reject', roleMiddleware('admin', 'superadmin'), ctrl.reject);

/* Super Admin oversight across all requests. Read-only. */
router.get('/admin/all', roleMiddleware('superadmin'), ctrl.adminList);

/* Detail + pair history: participants, the owning coach, and Super Admin. The
 * controller enforces that, since it depends on who is asking. This catch-all
 * is declared last on purpose. */
router.get('/:id', ctrl.detail);

module.exports = router;