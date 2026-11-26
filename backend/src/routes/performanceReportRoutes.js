const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const ctrl = require('../controllers/performanceReportController');

/* Every request passes authMiddleware; the controller then applies the
   student / coach / superadmin rule to the specific studentId in the request. */
router.use(authMiddleware);

router.get('/performance', ctrl.getPerformance);
router.post('/remarks', roleMiddleware('admin'), ctrl.saveRemarks);

module.exports = router;
