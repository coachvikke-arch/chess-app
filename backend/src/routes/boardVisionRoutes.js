const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/boardVisionController');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/progress', authMiddleware, ctrl.getProgress);
router.put('/progress', authMiddleware, ctrl.saveProgress);

module.exports = router;
