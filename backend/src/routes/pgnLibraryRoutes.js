const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/pgnLibraryController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

/* PGN-library folder views used by the Puzzle Generator's save panel.
 * Read/write access is admin-only, matching /api/library. */

const adminOnly = [authMiddleware, roleMiddleware('admin')];

router.get('/folders', adminOnly, ctrl.getFolders);
router.post('/folders', adminOnly, ctrl.createFolder);

module.exports = router;
