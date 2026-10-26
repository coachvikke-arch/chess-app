const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/libraryController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

/* Shared Chess Library.
 *
 * The library is GLOBAL — one set of folders for every admin and the
 * superadmin. There is no owner scoping anywhere in this router or its
 * controller, and `created_by` is never used to filter and never returned.
 *
 * WRITE access requires the admin role; `roleMiddleware('admin')` also admits
 * superadmin by design (see middleware/roleMiddleware.js), so both roles can
 * do everything in the admin group.
 *
 * READ access is split in two:
 *   GET /api/library        → admins and superadmin only.
 *   GET /api/library/public → ANY signed-in user, students included. The live
 *     classroom's Course tab is shown to students, and they need to browse the
 *     course files. Same data, same shape, and `created_by` is not part of it.
 */

/* A whole-library upload can be several megabytes of PGN, so these two routes
 * get their own explicit budget.
 *
 * NOTE: a route-level express.json({ limit }) would be useless here — the
 * app-wide `app.use(express.json({ limit: '25mb' }))` already ran and parsed
 * the body before this router is reached, and body-parser skips a second pass.
 * So the cap is enforced directly: an oversized request is rejected up front
 * with a message that says what the limit is and what to do about it. */
const BIG_BODY_LIMIT = 10 * 1024 * 1024; // 10 MB
const BIG_BODY_LABEL = '10mb';

function limitBody() {
  return (req, res, next) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared && declared > BIG_BODY_LIMIT) {
      return res.status(413).json({
        message: `That upload is too large (${(declared / 1048576).toFixed(1)} MB). The limit for this request is ${BIG_BODY_LABEL}. Split the PGN into smaller files and upload them one at a time.`,
      });
    }
    // No content-length (chunked): fall back to the size actually received.
    const actual = Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
    if (actual > BIG_BODY_LIMIT) {
      return res.status(413).json({
        message: `That upload is too large (${(actual / 1048576).toFixed(1)} MB). The limit for this request is ${BIG_BODY_LABEL}. Split the PGN into smaller files and upload them one at a time.`,
      });
    }
    return next();
  };
}

const adminOnly = [authMiddleware, roleMiddleware('admin')];

router.get('/', adminOnly, ctrl.getLibrary);

/* Read-only, any signed-in user (students included). */
router.get('/public', authMiddleware, ctrl.getLibraryPublic);

router.post('/import', adminOnly, limitBody(), ctrl.importLibrary);
router.post('/items/bulk', adminOnly, limitBody(), ctrl.createItems);
router.post('/bulk-rename', adminOnly, ctrl.bulkRenameItems);

router.post('/folders', adminOnly, ctrl.createFolder);
router.patch('/folders/:id', adminOnly, ctrl.updateFolder);
router.delete('/folders/:id', adminOnly, ctrl.deleteFolder);

router.post('/items', adminOnly, ctrl.createItem);
router.patch('/items/:id', adminOnly, ctrl.updateItem);
router.delete('/items/:id', adminOnly, ctrl.deleteItem);
router.post('/items/:id/reorder', adminOnly, ctrl.reorderItem);

module.exports = router;