const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/permissionController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

/* Every route below needs a verified token, so auth runs for the whole router
   first. (Without this, req.user is undefined and roleMiddleware answers 403.) */
router.use(authMiddleware);

/* Self-service: the signed-in user's own enabled features. Must sit ABOVE the
   superadmin gate — every role needs its own list, and this is the endpoint
   the frontend calls on session load. */
router.get('/me', ctrl.getMyFeatures);

/* Everything below configures the gates, so it is Super Admin only. See the
   lockout note in requireFeature.js: superadmin bypasses feature gates, so
   this panel can never become unreachable. */
router.use(roleMiddleware('superadmin'));

/* Registry + switches. */
router.get('/features', ctrl.listFeatures);
router.patch('/features/:key', ctrl.setFeature);
router.post('/bulk', ctrl.bulkSet);

/* Per-user overrides. */
router.get('/users', ctrl.searchUsers); // ?q= — member picker
router.get('/users/:userId', ctrl.getUserPermissions);
router.put('/users/:userId/:key', ctrl.setUserOverride);

/* Audit trail. */
router.get('/audit', ctrl.listAudit);

module.exports = router;
