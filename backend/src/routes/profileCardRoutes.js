const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const profileCard = require('../controllers/profileCardController');

const router = express.Router();

router.use(authMiddleware);

/* Card controls for the signed-in member — every role has exactly one card. */
router.post('/card/regenerate', profileCard.regenerate);
router.patch('/card', profileCard.updateVisibility);

module.exports = router;
