const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/sidebarController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

/* Every route below needs a verified token, so auth runs for the whole router
   first. (Without this, req.user is undefined and roleMiddleware answers 403.) */
router.use(authMiddleware);

/* Every signed-in user applies the order to their own sidebar, so the read sits
   ABOVE the superadmin gate. */
router.get('/', ctrl.getOrder);

/* Writing the order configures the navigation for everybody, so it is Super
   Admin only — the same split as permissionRoutes.js. */
router.use(roleMiddleware('superadmin'));

router.put('/order', ctrl.setOrder);
router.post('/order/reset', ctrl.resetOrder);

module.exports = router;
