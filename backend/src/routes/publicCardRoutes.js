const express = require('express');
const publicCard = require('../controllers/publicCardController');
const { publicCardLimiter } = require('../middleware/rateLimits');

const router = express.Router();

/* No auth on purpose: this is what a QR scan opens. The response is built from
   a whitelist (see publicCardController) and the limiter keeps token guessing
   and scraping cheap to block. */
router.get('/card/:token', publicCardLimiter, publicCard.getCard);

module.exports = router;
