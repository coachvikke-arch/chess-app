const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/attendanceController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

router.use(authMiddleware);
router.get('/me', ctrl.myAttendance);
router.get('/offline', roleMiddleware('admin'), ctrl.offlineDay);
router.get('/offline/overview', roleMiddleware('admin'), ctrl.offlineOverview);
router.post('/offline', roleMiddleware('admin'), ctrl.saveOfflineDay);

module.exports = router;
