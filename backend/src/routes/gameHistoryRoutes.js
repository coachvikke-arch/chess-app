const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/gameHistoryController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

router.use(authMiddleware);

router.get('/', roleMiddleware('student'), ctrl.studentHistory);
router.post('/computer', roleMiddleware('student'), ctrl.saveComputerGame);
router.get('/students', roleMiddleware('admin'), ctrl.adminHistory);

module.exports = router;