const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/reviewedGamesController');
const authMiddleware = require('../middleware/authMiddleware');

/* Every route here is per-user, so the whole router is authenticated rather
   than each handler repeating the middleware. The owner is always the token —
   the controllers never read a user id from the request body. */
router.use(authMiddleware);

router.get('/', ctrl.list);
router.post('/', ctrl.mark);

module.exports = router;
