const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/folderController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

/* Folder tree + management — admin/coach only (readable tree is served for admins;
   students don't need folder structure). */
router.get('/tree', authMiddleware, roleMiddleware('admin', 'coach'), ctrl.getFolderTree);
router.get('/:id/sets', authMiddleware, roleMiddleware('admin', 'coach'), ctrl.getFolderSets);
router.post('/', authMiddleware, roleMiddleware('admin', 'coach'), ctrl.createFolder);
router.patch('/:id', authMiddleware, roleMiddleware('admin', 'coach'), ctrl.renameFolder);
router.patch('/:id/move', authMiddleware, roleMiddleware('admin', 'coach'), ctrl.moveFolder);
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'coach'), ctrl.deleteFolder);

module.exports = router;