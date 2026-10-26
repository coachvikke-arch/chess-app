const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/analysisController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const { analysisRequestLimiter } = require('../middleware/rateLimits');

router.use(authMiddleware);

/* The review page's own load. Poll-friendly: a 200 with a `status` the client
   acts on, never a 202 or a spinner of its own. */
router.get('/games/:gameSource/:gameId', ctrl.getAnalysis);

/* Queue it (or re-run it). Rate limited per user — this can start minutes of
   engine work, and force=1 deliberately discards a finished result. */
router.post('/games/:gameSource/:gameId', analysisRequestLimiter, ctrl.requestAnalysis);

/* Queue health, for an operator telling "worker down" apart from "engine wedged"
   apart from "one bad game". */
router.get('/queue', roleMiddleware('admin'), ctrl.getQueueStats);
router.get('/stuck', roleMiddleware('admin'), ctrl.getStuckJobs);

module.exports = router;
