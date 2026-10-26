const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/sigmaController');
const authMiddleware = require('../middleware/authMiddleware');

/**
 * Σ Sigma Moves.
 *
 * Authenticated users only — but NOT role-restricted the way certificates are.
 * A Sigma belongs to the player, so a student needs their own list, and the
 * per-request scoping (own id, or a linked student via ?userId=) lives in the
 * controller because it depends on who is asking rather than on the route.
 */
router.use(authMiddleware);

router.get('/moves', ctrl.list);
router.post('/moves', ctrl.save);
router.get('/moves/:source/:gameId', ctrl.forGame);

module.exports = router;