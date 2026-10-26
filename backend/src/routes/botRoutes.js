/* Bot progression routes.
 *
 * Every endpoint is student-scoped and requires a session. The bot feature
 * itself works entirely offline (frontend/src/services/botsApi.js falls back to
 * the local cache on any failure), so these routes are a mirror for real
 * accounts, never a hard dependency of playing.
 *
 * A guest hitting these gets a 401, which the client treats as "sync skipped"
 * rather than an error.
 */
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const ctrl = require('../controllers/botController');

router.get('/progress', authMiddleware, ctrl.getProgress);
router.get('/summary', authMiddleware, ctrl.summary);
router.post('/result', authMiddleware, ctrl.submitResult);
/* Declared last so it cannot shadow `/progress`, `/summary` or `/result`. */
router.get('/:botId', authMiddleware, ctrl.verifyBot);

module.exports = router;